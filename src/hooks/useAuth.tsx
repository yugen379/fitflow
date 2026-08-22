import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, completeRedirectSignIn, friendlyAuthError } from '../lib/firebase';
import { UserProfile } from '../types';
import { identify } from '../lib/telemetry';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  /**
   * True when the profile could not be fetched within PROFILE_TIMEOUT_MS.
   *
   * Distinct from "no profile": the user is signed in and probably HAS a
   * profile, we simply could not reach it. The difference matters — treating
   * this as "no profile" walks an existing user into Onboarding and offers to
   * overwrite their account.
   */
  profileUnreachable: boolean;
  /** Re-attempt the profile subscription after a stall. */
  retryProfile: () => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * How long the app will block on the profile before giving up and saying so.
 *
 * Chosen against the reported failure: a user sat on the loading screen for
 * three minutes. Anything the user experiences as "it never opened" is a bug
 * regardless of the cause, so the ceiling is a small multiple of a slow-but-
 * working cold start, not a network timeout.
 */
const PROFILE_TIMEOUT_MS = 6000;

/**
 * Absolute ceiling on the loading screen, measured from when the provider
 * mounts — i.e. from what the user experiences as "I opened the app".
 *
 * PROFILE_TIMEOUT_MS alone was not enough. It only starts once Firebase Auth
 * has restored the session AND the Firestore chunk has imported, so a measured
 * stall still took 13.5s to surface. This clock starts immediately and runs in
 * parallel with everything else, which is the only way to bound what the user
 * actually waits.
 */
const BOOT_TIMEOUT_MS = 6000;

/*
 * Why 6s and not something more cautious: being early is cheap. If the profile
 * arrives afterwards, the snapshot handler clears `profileUnreachable` and the
 * app replaces the message on its own — ProtectedRoute only shows it while
 * there is still no profile. The worst case for a slow-but-working connection
 * is a few seconds of an honest status message, never a dead end.
 */

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profileUnreachable, setProfileUnreachable] = useState(false);
  /** Set the moment anything resolves the gate, so the boot watchdog can stand down. */
  const resolvedRef = useRef(false);
  /** Bumped to re-run the auth/profile effect on an explicit retry. */
  const [retryToken, setRetryToken] = useState(0);

  /**
   * The hard ceiling. Runs from mount, in parallel with auth restore, the
   * Firestore import and the profile subscription — so no combination of slow
   * steps can add up past it.
   */
  useEffect(() => {
    resolvedRef.current = false;
    const timer = setTimeout(() => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      setProfileUnreachable(true);
      setLoading(false);
    }, BOOT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [retryToken]);

  // Resolve any pending redirect-based sign-in before setting up the auth listener.
  // Without this, mobile users come back from the Google redirect to an empty login screen.
  useEffect(() => {
    completeRedirectSignIn().catch((e: any) => {
      setAuthError(friendlyAuthError(e?.code));
    });
  }, []);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;
    let disposed = false;
    // Bumped on every auth event. An await inside the callback means a slow
    // Firestore chunk could otherwise let a listener for a previous user attach
    // after the next sign-in has already been handled.
    let generation = 0;
    // Bound once the Firestore chunk lands; until then a plain guarded call.
    let safeUnsubscribe = (fn?: (() => void) | null) => {
      try { fn?.(); } catch { /* nothing to salvage */ }
    };

    // Nothing may hold the app on the loading screen indefinitely.
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const clearWatchdog = () => {
      if (watchdog) { clearTimeout(watchdog); watchdog = undefined; }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setUser(user);
      const myGeneration = ++generation;
      clearWatchdog();

      // Cleanup previous profile listener if it exists. Guarded: the Firestore
      // SDK can throw out of unsubscribe() when its queue is mid-teardown, and
      // an auth callback is the last place that should be able to take down the
      // whole app. See safeUnsubscribe in lib/firestore.
      if (unsubscribeProfile) {
        safeUnsubscribe(unsubscribeProfile);
        unsubscribeProfile = undefined;
      }

      if (!user) {
        setProfile(null);
        setProfileUnreachable(false);
        resolvedRef.current = true;
        setLoading(false);
        return;
      }

      void (async () => {
        // Firestore is ~80 kB gzipped and is worthless until we know there IS a
        // user, so it is fetched here rather than imported at module scope. For
        // anyone with a persisted session it has already been warmed in parallel
        // since the first frame (see warmDataLayer in lib/prefetch.ts), so this
        // await is normally already resolved.
        let db: import('firebase/firestore').Firestore;
        let fs: typeof import('firebase/firestore');
        try {
          const [firestoreModule, sdk] = await Promise.all([
            import('../lib/firestore'),
            import('firebase/firestore'),
          ]);
          db = firestoreModule.db;
          safeUnsubscribe = firestoreModule.safeUnsubscribe;
          fs = sdk;
        } catch (error) {
          console.error('Firestore unavailable:', error);
          setLoading(false);
          return;
        }

        if (disposed || myGeneration !== generation) return;

        const { doc, setDoc, updateDoc, serverTimestamp, onSnapshot } = fs;
        const userRef = doc(db, 'users', user.uid);

        /**
         * The gate must always open.
         *
         * There is a path through the snapshot handler below that sets nothing
         * at all: a doc that does not exist AND came `fromCache`. That is the
         * ordinary state of a cold start on a slow or unreachable network — the
         * local cache has no profile yet and the server has not answered — and
         * it used to leave `loading` true forever. Users sat on "Loading your
         * training data" indefinitely.
         *
         * So the wait is bounded. On expiry the app stops blocking and says it
         * cannot reach the server, which is both true and actionable, rather
         * than pretending to still be working.
         */
        watchdog = setTimeout(() => {
          if (disposed || myGeneration !== generation) return;
          setProfileUnreachable(true);
          resolvedRef.current = true;
          setLoading(false);
        }, PROFILE_TIMEOUT_MS);
        const tzOffsetHours = -new Date().getTimezoneOffset() / 60;
        const tzId = Intl.DateTimeFormat().resolvedOptions().timeZone;

        // Subscribe FIRST: with the persistent Firestore cache the profile
        // paints instantly from disk and the server update follows — the old
        // flow blocked this listener behind a full getDoc network round-trip
        // (the long "Loading your training data" wait on cold starts).
        let ensuredOnce = false;
        unsubscribeProfile = onSnapshot(userRef, (snapshot) => {
          const fromCache = snapshot.metadata.fromCache;
          if (snapshot.exists()) {
            const data = snapshot.data() as any;
            setProfile({ uid: user.uid, ...data } as UserProfile);
            identify(user.uid, {
              email: user.email || undefined,
              displayName: data.displayName,
              subscriptionType: data.subscriptionType,
            });
            clearWatchdog();
            setProfileUnreachable(false);
            resolvedRef.current = true;
            setLoading(false);
            if (!ensuredOnce) {
              ensuredOnce = true;
              // Keep timezone in sync (cheap; server reminders need this)
              if (data.tzOffsetHours !== tzOffsetHours || data.tzId !== tzId) {
                updateDoc(userRef, { tzOffsetHours, tzId }).catch(() => {});
              }
            }
          } else if (!fromCache && !ensuredOnce) {
            // The SERVER confirmed there is no profile → first sign-in ever.
            // (A cache-only miss must not create: the real doc may exist.)
            ensuredOnce = true;
            clearWatchdog();
            const initialProfile: UserProfile = {
              uid: user.uid,
              displayName: user.displayName || 'Guest',
              photoURL: user.photoURL || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.uid,
              subscriptionType: 'free',
              // Cardless 6-day trial starts the instant the account is created.
              // trialStartedAt == serverTimestamp() == rules' request.time, which
              // makes it tamper-proof (the user can never reset or extend it).
              trialStartedAt: serverTimestamp(),
              subscriptionStatus: 'trialing',
              streak: 0,
              points: 0,
              level: 1,
              badges: [],
              createdAt: serverTimestamp(),
            };
            // The snapshot listener fires again once this lands.
            setDoc(userRef, { ...initialProfile, tzOffsetHours, tzId } as any).catch(err => {
              console.error('Initial profile create error:', err);
              setLoading(false);
            });
          }
        }, (error) => {
          console.error('Profile sync error:', error);
          clearWatchdog();
          // An error IS an answer — the app stops blocking. Whether the user can
          // continue depends on whether a cached profile already arrived.
          setProfileUnreachable(true);
          resolvedRef.current = true;
          setLoading(false);
        });

        // The effect may have been torn down while the import was in flight.
        if (disposed || myGeneration !== generation) {
          unsubscribeProfile();
          unsubscribeProfile = undefined;
        }
      })();
    });

    return () => {
      disposed = true;
      clearWatchdog();
      unsubscribeAuth();
      safeUnsubscribe(unsubscribeProfile);
    };
  }, [retryToken]);

  const signIn = async () => {
    // Sign in logic is already in firebase.ts, but we keep it here for context if needed
  };

  const signOut = () => auth.signOut();

  const retryProfile = () => {
    setProfileUnreachable(false);
    setLoading(true);
    setRetryToken((n) => n + 1);
  };

  return (
    <AuthContext.Provider value={{
      user, profile, loading, signIn, signOut,
      authError, clearAuthError: () => setAuthError(null),
      profileUnreachable, retryProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
