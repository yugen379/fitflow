import React, { createContext, useContext, useEffect, useState } from 'react';
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
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

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

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setUser(user);
      const myGeneration = ++generation;

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
      unsubscribeAuth();
      safeUnsubscribe(unsubscribeProfile);
    };
  }, []);

  const signIn = async () => {
    // Sign in logic is already in firebase.ts, but we keep it here for context if needed
  };

  const signOut = () => auth.signOut();

  return (
    <AuthContext.Provider value={{
      user, profile, loading, signIn, signOut,
      authError, clearAuthError: () => setAuthError(null),
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
