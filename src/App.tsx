import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { BottomNav } from './components/BottomNav';
import { Onboarding } from './pages/Onboarding';
import { Logo } from './components/Logo';
import { requestNotificationPermission, onMessageListener } from './lib/firebase';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { motion } from 'motion/react';
import { useToast } from './hooks/useToast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageSkeleton } from './components/PageSkeleton';
import { initTelemetry, identify } from './lib/telemetry';

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

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, loading } = useAuth();
  const { showToast } = useToast();

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
    const unsubscribeMessage = onMessageListener((payload: any) => {
      showToast(`${payload?.notification?.title}: ${payload?.notification?.body}`, 'info');
    });
    return () => { if (unsubscribeMessage) unsubscribeMessage(); };
  }, [showToast]);
  
  if (loading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-bg">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
          className="w-10 h-10 border-2 border-white/10 border-t-accent rounded-full mb-6"
        />
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.7 }}
          transition={{ delay: 0.4 }}
          className="text-xs text-text-dim font-medium"
        >
          Loading your training data
        </motion.p>
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
    return <Onboarding />;
  }
  
  return (
    <div className="min-h-screen bg-bg text-white font-sans max-w-md mx-auto relative overflow-x-hidden">
      {children}
      {!isProfileIncomplete && <BottomNav />}
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
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <Logo size="xl" showText={false} />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="font-display text-5xl font-extrabold text-white mt-8 tracking-tight leading-[0.95]"
        >
          Train smarter.<br/>
          <span className="gradient-text-accent">Move farther.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="text-text-dim text-base font-medium mt-5 max-w-[320px] leading-relaxed"
        >
          AI workouts, nutrition, recovery and community.
          One app, built to replace the rest.
        </motion.p>

        <motion.ul
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="mt-10 grid grid-cols-2 gap-2 text-left w-full max-w-[320px]"
        >
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
        </motion.ul>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.6 }}
        className="w-full max-w-sm mx-auto pb-12 relative z-10"
      >
        <GoogleSignInButton
          onError={(msg) => showToast(msg, 'error')}
        />
        <p className="text-center text-xs text-text-mute mt-4">
          By continuing you agree to our{' '}
          <a href="/terms" className="text-text-dim hover:text-accent underline-offset-2 hover:underline">Terms</a>{' '}
          and{' '}
          <a href="/privacy" className="text-text-dim hover:text-accent underline-offset-2 hover:underline">Privacy Policy</a>.
        </p>
      </motion.div>
    </div>
  );
};

import { ToastProvider } from './hooks/useToast';

const lazyRoute = (el: React.ReactNode) => (
  <ErrorBoundary>
    <Suspense fallback={<PageSkeleton />}>{el}</Suspense>
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
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Router>
      </AuthProvider>
    </ToastProvider>
    </ErrorBoundary>
  );
}
