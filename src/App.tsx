import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { Logo } from './components/Logo';
import { requestNotificationPermission, onMessageListener } from './lib/firebase';
import { isNativeApp } from './lib/pushPermission';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { useToast } from './hooks/useToast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initTelemetry, identify } from './lib/telemetry';
import { warmLikelyRoutes } from './lib/prefetch';
import { LiquidSkeleton, ParticleField, SpatialPageTransition } from './components/layout/SpatialPageTransition';
// The bottom nav is the only other eager consumer of the animation library and
// it never renders on the signed-out first paint, so it loads a beat later
// rather than holding up the hero.
const FloatingDock = lazy(() => import('./components/layout/FloatingDock').then(m => ({ default: m.FloatingDock })));

initTelemetry();

const Home = lazy(() => import('./pages/Home').then(m => ({ default: m.Home })));
const Track = lazy(() => import('./pages/Track').then(m => ({ default: m.Track })));
const Workout = lazy(() => import('./pages/Workout').then(m => ({ default: m.Workout })));
const Community = lazy(() => import('./pages/Community').then(m => ({ default: m.Community })));
const Profile = lazy(() => import('./pages/Profile').then(m => ({ default: m.Profile })));
const Wellness = lazy(() => import('./pages/Wellness').then(m => ({ default: m.Wellness })));
const Explore = lazy(() => import('./pages/Explore').then(m => ({ default: m.Explore })));
const Library = lazy(() => import('./pages/Library').then(m => ({ default: m.Library })));
const Analytics = lazy(() => import('./pages/Analytics').then(m => ({ default: m.Analytics })));
const MealPlan = lazy(() => import('./pages/MealPlan').then(m => ({ default: m.MealPlan })));
const Challenges = lazy(() => import('./pages/Challenges').then(m => ({ default: m.Challenges })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Privacy = lazy(() => import('./pages/Privacy').then(m => ({ default: m.Privacy })));
const DeleteAccount = lazy(() => import('./pages/DeleteAccount').then(m => ({ default: m.DeleteAccount })));
const Terms = lazy(() => import('./pages/Terms').then(m => ({ default: m.Terms })));
const Pro = lazy(() => import('./pages/Pro').then(m => ({ default: m.Pro })));
const Coach = lazy(() => import('./pages/Coach').then(m => ({ default: m.Coach })));
const NutritionGoals = lazy(() => import('./pages/NutritionGoals').then(m => ({ default: m.NutritionGoals })));
// Onboarding renders only for a profile that is still incomplete, so it has no
// business sitting on the boot path for the millions of loads where it is not shown.
const Onboarding = lazy(() => import('./pages/Onboarding').then(m => ({ default: m.Onboarding })));
// The Lab pulls in three.js, so it stays in its own chunk and is only fetched
// when an athlete actually opens the 3D view.
const Lab = lazy(() => import('./pages/Lab').then(m => ({ default: m.Lab })));

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, loading } = useAuth();
  const { showToast } = useToast();

  // Warm the bottom-nav destinations once the app is up. Deliberately after
  // auth resolves: before that the user may still be looking at a spinner, and
  // speculative chunks must never compete with the screen they are waiting for.
  React.useEffect(() => {
    if (!user || loading) return;
    warmLikelyRoutes();
  }, [user, loading]);

  React.useEffect(() => {
    // Only request push permission if the browser hasn't already decided AND we haven't asked this session.
    const askedKey = user ? `ff_asked_notif_${user.uid}` : null;
    const shouldAsk =
      user && profile && !profile.notificationsEnabled &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default' &&
      askedKey && !sessionStorage.getItem(askedKey);

    if (shouldAsk) {
      sessionStorage.setItem(askedKey!, '1');
      // Wait a moment so the prompt doesn't slam the user at login.
      const t = setTimeout(() => {
        requestNotificationPermission(user!.uid).then(token => {
          if (token) showToast('Notifications on', 'info');
        });
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [user, profile]);

  React.useEffect(() => {
    // Web: FCM foreground messages arrive via the messaging SDK.
    const unsubscribeMessage = onMessageListener((payload: any) => {
      showToast(`${payload?.notification?.title}: ${payload?.notification?.body}`, 'info');
    });
    // Native: FCM only auto-displays when backgrounded — surface foreground
    // pushes as the same in-app toast the web shows.
    let nativeHandle: { remove(): Promise<void> } | undefined;
    if (isNativeApp()) {
      import('@capacitor/push-notifications')
        .then(({ PushNotifications }) =>
          PushNotifications.addListener('pushNotificationReceived', n => {
            const text = [n.title, n.body].filter(Boolean).join(': ');
            if (text) showToast(text, 'info');
          }).then(h => { nativeHandle = h; }))
        .catch(() => { /* plugin missing on this platform — fine */ });
    }
    return () => {
      if (unsubscribeMessage) unsubscribeMessage();
      nativeHandle?.remove().catch(() => {});
    };
  }, [showToast]);
  
  if (loading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-bg">
        <div className="w-10 h-10 border-2 border-white/10 border-t-accent rounded-full mb-6 animate-spin" />
        <p className="text-xs text-text-dim font-medium ff-fade-dim">Loading your training data</p>
      </div>
    );
  }
  
  if (!user) {
    return <LoginView />;
  }

  // A profile counts as "ready" once core measurements + goal are set. healthConditions
  // is treated as optional — an empty array still satisfies, because the older Firestore
  // rule schema requires it to be a list but the user may legitimately have none.
  const hasArray = (v: any) => Array.isArray(v);
  const isProfileIncomplete =
    !profile?.age || !profile?.weight || !profile?.height || !profile?.goal ||
    !hasArray((profile as any)?.healthConditions);

  if (isProfileIncomplete && window.location.pathname !== '/onboarding') {
    return (
      <Suspense fallback={<LiquidSkeleton />}>
        <Onboarding />
      </Suspense>
    );
  }
  
  return (
    <div className="min-h-dvh bg-bg text-white font-sans max-w-md mx-auto relative overflow-x-hidden">
      {/* Deliberately OUTSIDE the transition: the atmosphere is continuous
          across routes, so the screen is never actually blank between them. */}
      <ParticleField />
      <SpatialPageTransition>{children}</SpatialPageTransition>
      {!isProfileIncomplete && (
        <Suspense fallback={null}>
          <FloatingDock />
        </Suspense>
      )}
    </div>
  );
};

const LoginView: React.FC = () => {
  const { showToast } = useToast();
  const { authError, clearAuthError } = useAuth();

  React.useEffect(() => {
    if (authError) {
      showToast(authError, 'error');
      clearAuthError();
    }
  }, [authError, showToast, clearAuthError]);

  return (
    <div className="h-screen w-screen flex flex-col bg-bg px-6 overflow-hidden relative">
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-accent/8 blur-[140px] rounded-full pointer-events-none" />
      <div className="absolute -bottom-40 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-accent-3/6 blur-[140px] rounded-full pointer-events-none" />

      <div className="flex-1 flex flex-col items-center justify-center text-center max-w-sm mx-auto w-full relative z-10">
        <div className="ff-rise">
          <Logo size="xl" showText={false} />
        </div>

        <h1 className="ff-rise ff-d1 font-display text-5xl font-extrabold text-white mt-8 tracking-tight leading-[0.95]">
          Train smarter.<br/>
          <span className="gradient-text-accent">Move farther.</span>
        </h1>

        <p className="ff-rise ff-d2 text-text-dim text-base font-medium mt-5 max-w-[320px] leading-relaxed">
          AI workouts, nutrition, recovery and community.
          One app, built to replace the rest.
        </p>

        <ul className="ff-rise ff-d3 mt-10 grid grid-cols-2 gap-2 text-left w-full max-w-[320px]">
          {[
            'AI coach',
            'Food scan',
            'Live workouts',
            'Wearable sync',
          ].map(f => (
            <li key={f} className="flex items-center gap-2 text-sm text-white/80">
              <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" />
              {f}
            </li>
          ))}
        </ul>
      </div>

      <div className="ff-rise-lg ff-d4 w-full max-w-sm mx-auto pb-12 relative z-10">
        <GoogleSignInButton
          onError={(msg) => showToast(msg, 'error')}
        />
        <p className="text-center text-xs text-text-mute mt-4">
          By continuing you agree to our{' '}
          <a href="/terms" className="text-text-dim hover:text-accent underline-offset-2 hover:underline">Terms</a>{' '}
          and{' '}
          <a href="/privacy" className="text-text-dim hover:text-accent underline-offset-2 hover:underline">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
};

import { ToastProvider } from './hooks/useToast';

const lazyRoute = (el: React.ReactNode) => (
  <ErrorBoundary>
    {/* A flowing shimmer shaped like the page, so the swap to real content
        reads as a fill rather than a second flash of blank. */}
    <Suspense fallback={<LiquidSkeleton />}>{el}</Suspense>
  </ErrorBoundary>
);

export default function App() {
  return (
    <ErrorBoundary>
    <ToastProvider>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/" element={<ProtectedRoute>{lazyRoute(<Home />)}</ProtectedRoute>} />
            <Route path="/track" element={<ProtectedRoute>{lazyRoute(<Track />)}</ProtectedRoute>} />
            <Route path="/workout" element={<ProtectedRoute>{lazyRoute(<Workout />)}</ProtectedRoute>} />
            <Route path="/community" element={<ProtectedRoute>{lazyRoute(<Community />)}</ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute>{lazyRoute(<Profile />)}</ProtectedRoute>} />
            <Route path="/onboarding" element={<ProtectedRoute>{lazyRoute(<Onboarding />)}</ProtectedRoute>} />
            <Route path="/wellness" element={<ProtectedRoute>{lazyRoute(<Wellness />)}</ProtectedRoute>} />
            <Route path="/explore" element={<ProtectedRoute>{lazyRoute(<Explore />)}</ProtectedRoute>} />
            <Route path="/library" element={<ProtectedRoute>{lazyRoute(<Library />)}</ProtectedRoute>} />
            <Route path="/analytics" element={<ProtectedRoute>{lazyRoute(<Analytics />)}</ProtectedRoute>} />
            <Route path="/meal-plan" element={<ProtectedRoute>{lazyRoute(<MealPlan />)}</ProtectedRoute>} />
            <Route path="/challenges" element={<ProtectedRoute>{lazyRoute(<Challenges />)}</ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute>{lazyRoute(<Settings />)}</ProtectedRoute>} />
            <Route path="/privacy" element={lazyRoute(<Privacy />)} />
            <Route path="/delete-account" element={lazyRoute(<DeleteAccount />)} />
            <Route path="/terms" element={lazyRoute(<Terms />)} />
            <Route path="/pro" element={<ProtectedRoute>{lazyRoute(<Pro />)}</ProtectedRoute>} />
            <Route path="/coach" element={<ProtectedRoute>{lazyRoute(<Coach />)}</ProtectedRoute>} />
            <Route path="/nutrition-goals" element={<ProtectedRoute>{lazyRoute(<NutritionGoals />)}</ProtectedRoute>} />
            <Route path="/lab" element={<ProtectedRoute>{lazyRoute(<Lab />)}</ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Router>
      </AuthProvider>
    </ToastProvider>
    </ErrorBoundary>
  );
}
