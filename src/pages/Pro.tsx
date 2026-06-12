import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Check, Sparkles, Zap, Camera, Heart, TrendingUp, Bell, Crown } from 'lucide-react';
import { LogoMark } from '../components/Logo';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { startCheckout, isStripeConfigured } from '../services/stripeService';
import { allFeaturesFree } from '../lib/billing';

const FEATURES = [
  { icon: Camera, title: 'Unlimited AI Form Check', sub: 'Live Gemini Vision form scoring on every set' },
  { icon: Sparkles, title: 'AI weekly recap & meal plans', sub: 'Personalized coach summary every Sunday' },
  { icon: Heart, title: 'Health Connect & HealthKit', sub: 'Native wearable sync with HR, sleep, exercise' },
  { icon: TrendingUp, title: 'Advanced analytics', sub: 'Volume trends, muscle balance, plateau detection' },
  { icon: Bell, title: 'Smart auto-scheduled reminders', sub: 'Learns when you actually train and nudges you' },
  { icon: Zap, title: 'Priority AI', sub: 'Faster Gemini responses, voice coaching during workouts' },
];

const PLANS = [
  { id: 'monthly' as const, label: 'Monthly', price: 9.99, perWhat: '/month', total: '$9.99 billed monthly' },
  { id: 'yearly' as const, label: 'Yearly', price: 4.99, perWhat: '/month', total: '$59.88 billed yearly · save 50%', badge: 'Best value' },
];

export const Pro: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [plan, setPlan] = useState<'monthly' | 'yearly'>('yearly');
  const [starting, setStarting] = useState(false);
  const billingReady = isStripeConfigured();
  const allFree = allFeaturesFree();

  const startTrial = async () => {
    if (allFree) {
      showToast('All features are free right now — enjoy.', 'success');
      navigate('/');
      return;
    }
    if (!billingReady) {
      showToast('Billing is being configured — try again shortly.', 'info');
      return;
    }
    setStarting(true);
    const result = await startCheckout(plan);
    setStarting(false);
    if (!result.ok) {
      showToast(result.reason || 'Could not start checkout', 'error');
    }
  };

  return (
    <div className="pb-28 pt-4 px-5 min-h-screen relative overflow-hidden">
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-accent/10 blur-[160px] rounded-full pointer-events-none" />

      <header className="relative flex items-center justify-between mb-6">
        <button onClick={() => navigate(-1)} className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white" aria-label="Back">
          <ChevronLeft size={18} />
        </button>
        <LogoMark size={28} />
        <div className="w-10" />
      </header>

      <div className="relative flex flex-col items-center text-center mb-8">
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 18 }}
          className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-soft to-accent flex items-center justify-center mb-5 shadow-[0_20px_60px_-12px_rgba(198,255,61,0.6)]"
        >
          <Crown size={28} className="text-bg" />
        </motion.div>
        <h1 className="font-display text-4xl font-bold text-white tracking-tight leading-[1.05]">
          {allFree
            ? <>You have <span className="gradient-text-accent">FitFlow Pro</span></>
            : <>Unlock <span className="gradient-text-accent">FitFlow Pro</span></>}
        </h1>
        <p className="text-text-dim text-base mt-3 max-w-sm leading-relaxed">
          {allFree
            ? 'Every Pro feature is unlocked while we’re in launch. No payment, no trial countdown. Train.'
            : 'The full AI coach. Native wearable sync. Unlimited everything. Built to make every other fitness app obsolete.'}
        </p>
      </div>

      {allFree ? (
        <div className="glass p-4 mb-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0">
            <Check size={16} />
          </div>
          <div className="flex-1">
            <p className="text-eyebrow text-accent">Launch perk</p>
            <p className="text-white text-sm font-medium mt-0.5">All Pro features are free during launch.</p>
          </div>
        </div>
      ) : (
        <div className="glass p-2 grid grid-cols-2 gap-2 mb-5">
          {PLANS.map(p => {
            const active = plan === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setPlan(p.id)}
                className={`relative p-4 rounded-2xl text-left transition-all ${active ? 'bg-accent/15 border border-accent/40' : 'bg-transparent border border-transparent'}`}
              >
                {p.badge && (
                  <span className="absolute -top-2 right-3 bg-accent text-bg text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {p.badge}
                  </span>
                )}
                <p className={`text-xs font-medium ${active ? 'text-accent' : 'text-text-dim'}`}>{p.label}</p>
                <p className="num font-display text-3xl font-bold text-white mt-1 leading-none">
                  ${p.price}
                  <span className="text-sm text-text-dim font-medium ml-1">{p.perWhat}</span>
                </p>
                <p className="text-xs text-text-dim mt-2">{p.total}</p>
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-3 mb-6">
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className="glass p-4 flex items-start gap-3"
          >
            <div className="w-10 h-10 rounded-xl bg-accent/12 border border-accent/25 flex items-center justify-center text-accent shrink-0">
              <f.icon size={16} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-white font-medium text-sm">{f.title}</p>
                <Check size={14} className="text-accent shrink-0" />
              </div>
              <p className="text-xs text-text-dim mt-0.5 leading-relaxed">{f.sub}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <button
        onClick={startTrial}
        disabled={starting}
        className="btn-3d w-full h-14 disabled:opacity-60"
      >
        {starting ? 'Opening checkout…' : allFree ? 'Continue training' : 'Start 7-day free trial'}
      </button>
      {!allFree && (
        <p className="text-center text-xs text-text-mute mt-3 leading-relaxed">
          Free for 7 days, then ${plan === 'yearly' ? '59.88/year' : '9.99/month'}. Cancel anytime in your{' '}
          {/iPhone|iPad/.test(navigator.userAgent) ? 'App Store' : 'Play Store'} settings.
        </p>
      )}

      {!allFree && profile?.subscriptionType === 'premium' && (
        <div className="mt-6 glass p-4 flex items-center gap-3">
          <Crown className="text-accent" size={18} />
          <p className="text-sm text-white">You're already on Pro — thanks for supporting us.</p>
        </div>
      )}
    </div>
  );
};
