import React from 'react';
import { motion } from 'motion/react';
import { Crown, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { allFeaturesFree, getEntitlement } from '../lib/billing';
import { purchaseUiAllowed } from '../services/playBillingService';
import { t } from '../i18n/i18n';

/**
 * Compact trial-status banner. Renders only when there's something to nudge:
 * - during the cardless trial (days remaining + subscribe CTA)
 * - after the trial has expired (re-subscribe CTA)
 * Hidden for paying users, in launch-giveaway mode, and before a profile loads.
 */
export const TrialBanner: React.FC<{ className?: string }> = ({ className }) => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  if (!profile || allFeaturesFree()) return null;

  const ent = getEntitlement(profile);
  const isTrialing = ent.isPro && ent.source === 'trial';
  const isExpired = !ent.isPro && ent.status === 'expired';
  if (!isTrialing && !isExpired) return null;

  const urgent = isExpired || ent.trialDaysLeft <= 1;

  return (
    <motion.button
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => navigate('/pro')}
      className={`w-full glass p-3.5 flex items-center gap-3 text-left ${className ?? ''} ${
        urgent ? 'border border-accent/40' : ''
      }`}
      aria-label={t('View FitFlow Pro plans')}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
        urgent ? 'bg-accent text-bg' : 'bg-accent/12 border border-accent/25 text-accent'
      }`}>
        {isExpired ? <Crown size={16} /> : <Clock size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium">
          {isExpired
            ? t('Your free trial has ended')
            : ent.trialDaysLeft === 1
              ? t('Last day of your free trial')
              : t('{n} days left in your free trial', { n: ent.trialDaysLeft })}
        </p>
        <p className="text-text-dim text-xs mt-0.5">
          {!purchaseUiAllowed() ? t('See what Pro includes.')
            : isExpired ? t('Subscribe to bring Pro back.') : t('Tap to subscribe and keep Pro.')}
        </p>
      </div>
      <span className="text-eyebrow text-accent shrink-0">Pro →</span>
    </motion.button>
  );
};
