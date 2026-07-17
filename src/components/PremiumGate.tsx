import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, Sparkles, X, Check, Crown } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { isProUnlocked } from '../lib/billing';
import { purchaseUiAllowed } from '../services/playBillingService';

interface PremiumGateProps {
  feature: string;
  children: React.ReactNode;
  className?: string;
}

const PERKS = [
  'Unlimited AI form check, meal plans, weekly recaps',
  'Native Health Connect & HealthKit sync',
  'Advanced analytics with plateau detection',
  'Priority Gemini responses + voice coaching',
  'Full data export and history retention',
];

export const PremiumGate: React.FC<PremiumGateProps> = ({ feature, children, className }) => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);

  if (isProUnlocked(profile)) return <>{children}</>;

  // Entitlement (trial + paid) is granted only server-side via the Stripe
  // webhook — the client never writes billing fields. The gate just routes to
  // the Pro page where checkout happens.
  const handleUpgrade = () => {
    setShowModal(false);
    navigate('/pro');
  };

  return (
    <>
      <div className={`relative ${className ?? ''}`}>
        <div className="pointer-events-none select-none" style={{ filter: 'blur(6px)', opacity: 0.3 }}>
          {children}
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => setShowModal(true)}
            className="flex flex-col items-center gap-3"
          >
            <div className="w-14 h-14 glass rounded-2xl flex items-center justify-center">
              <Lock className="text-accent" size={22} />
            </div>
            <div className="glass px-4 py-3 rounded-2xl space-y-1">
              <p className="text-eyebrow text-accent">FitFlow Pro</p>
              <p className="text-white font-display text-base font-bold tracking-tight">{feature}</p>
              <p className="text-text-dim text-xs">Tap to unlock</p>
            </div>
          </motion.button>
        </div>
      </div>

      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/85 backdrop-blur-xl" onClick={() => setShowModal(false)}
            />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="relative bg-surface w-full max-w-md sm:rounded-3xl rounded-t-3xl border border-white/[0.06] p-6 space-y-6 overflow-hidden"
            >
              <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[400px] h-[400px] bg-accent/8 blur-[120px] rounded-full pointer-events-none" />
              <button onClick={() => setShowModal(false)} className="absolute top-5 right-5 w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim hover:text-white z-10" aria-label="Close">
                <X size={16} />
              </button>

              <div className="flex flex-col items-center text-center gap-3 relative">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent-soft to-accent flex items-center justify-center shadow-[0_16px_40px_-8px_rgba(198,255,61,0.6)]">
                  <Crown className="text-bg" size={24} />
                </div>
                <div>
                  <p className="text-eyebrow text-accent">FitFlow Pro</p>
                  <h2 className="font-display text-3xl font-bold text-white tracking-tight mt-1">Unlock {feature}</h2>
                </div>
              </div>

              <ul className="space-y-2.5 relative">
                {PERKS.map((p, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <Check className="text-accent shrink-0 mt-0.5" size={14} />
                    <span className="text-white/85 text-sm leading-relaxed">{p}</span>
                  </li>
                ))}
              </ul>

              <div className="space-y-3 relative">
                {purchaseUiAllowed() && (
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="num font-display text-4xl font-bold text-white">$4.99</span>
                    <span className="text-text-dim text-sm">/ month · cancel anytime</span>
                  </div>
                )}
                <button onClick={handleUpgrade} className="btn-3d w-full h-13">
                  <Sparkles size={14} />
                  {purchaseUiAllowed() ? <>See plans &amp; subscribe</> : <>See what's included</>}
                </button>
                <p className="w-full text-center text-xs text-text-mute">
                  New accounts get a 6-day free trial — no card needed.
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
