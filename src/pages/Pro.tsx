import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Check, Sparkles, Zap, Camera, Heart, TrendingUp, Bell, Crown, Settings as SettingsIcon } from 'lucide-react';
import { LogoMark } from '../components/Logo';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { startCheckout, isStripeConfigured, openBillingPortal, isPortalConfigured } from '../services/stripeService';
import { isNativeApp } from '../lib/firebase';
import {
  isPlayBillingConfigured, configurePlayBilling, startPlayPurchase,
  restorePlayPurchases, openPlaySubscriptions, purchaseUiAllowed,
  getPlayPlanPrices, StorePlanPrice,
} from '../services/playBillingService';
import { allFeaturesFree, getEntitlement, TRIAL_DAYS } from '../lib/billing';

const FEATURES = [
  { icon: Camera, title: 'Meal Scan AI + unlimited Form Check', sub: 'Snap a plate to log it; live Gemini Vision form scoring' },
  { icon: Sparkles, title: 'AI weekly recap & meal plans', sub: 'Personalized coach summary every Sunday' },
  { icon: Heart, title: 'Health Connect & HealthKit', sub: 'Native wearable sync with HR, sleep, exercise' },
  { icon: TrendingUp, title: 'Macros by the gram + advanced analytics', sub: 'Exact protein/fat/carb targets, plateau detection' },
  { icon: Bell, title: 'Goal-by-day scheduling + smart reminders', sub: 'Higher carbs on training days, learns when you train' },
  { icon: Zap, title: 'Priority AI', sub: 'Faster Gemini responses, voice coaching during workouts' },
];

const PLANS = [
  { id: 'monthly' as const, label: 'Monthly' },
  { id: 'yearly' as const, label: 'Yearly', badge: 'Best value' },
];

const fmtDate = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export const Pro: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [plan, setPlan] = useState<'monthly' | 'yearly'>('yearly');
  const [starting, setStarting] = useState(false);
  const [managing, setManaging] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // Live, localized prices from Google Play (what the purchase sheet charges).
  // Null on web / until loaded — the USD Stripe prices are the fallback.
  const [storePrices, setStorePrices] = useState<{ monthly?: StorePlanPrice; yearly?: StorePlanPrice } | null>(null);

  // Android sells Pro through Google Play Billing once RevenueCat is wired up
  // (required for Play Store distribution). Until then the sideloaded GitHub
  // APK falls back to Stripe Checkout in the external browser, while the Play
  // Store build (VITE_PLAY_STORE_BUILD) shows no purchase UI at all — Play
  // policy forbids external checkout. Web always uses Stripe.
  const native = isNativeApp();
  const allFree = allFeaturesFree();
  const playReady = native && isPlayBillingConfigured();
  // Hide plans/pricing/CTA entirely when the only path would be external checkout.
  const showPurchaseUi = purchaseUiAllowed();
  const billingReady = playReady || (showPurchaseUi && isStripeConfigured());
  const ent = getEntitlement(profile);
  const isPaid = ent.isPro && ent.source === 'paid';
  const isTrialing = ent.isPro && ent.source === 'trial';

  // Configure RevenueCat up front on Android so the purchase sheet opens
  // instantly, and pull the real Play prices so the cards show exactly what
  // the sheet will charge (right period, right currency).
  useEffect(() => {
    if (!native || !profile?.uid) return;
    configurePlayBilling(profile.uid);
    getPlayPlanPrices(profile.uid).then(p => { if (p) setStorePrices(p); });
  }, [native, profile?.uid]);

  // Per-card display: Play prices when available, USD Stripe prices otherwise.
  // Yearly leads with the YEARLY total (the sheet charges that), per-month as a footnote.
  const priceFor = (id: 'monthly' | 'yearly') => {
    if (id === 'monthly') {
      const p = storePrices?.monthly?.priceString ?? '$17.99';
      return { big: p, suffix: '/month', sub: `${p} billed monthly` };
    }
    const sp = storePrices?.yearly;
    const perMo = sp?.perMonthString ?? '$4.99';
    const m = storePrices?.monthly?.price;
    const save = m && sp?.price ? Math.max(0, Math.round((1 - sp.price / 12 / m) * 100)) : 72;
    return { big: sp?.priceString ?? '$59.88', suffix: '/year', sub: `≈ ${perMo}/mo · save ${save}%` };
  };

  const subscribe = async () => {
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
    if (playReady) {
      const result = await startPlayPurchase(profile!.uid, plan);
      setStarting(false);
      if (result.ok) {
        showToast('Purchase complete — unlocking Pro…', 'success');
        // The RevenueCat webhook flips subscriptionType server-side; the profile
        // listener picks it up within a moment.
      } else if (result.reason !== 'cancelled') {
        showToast(result.reason || 'Purchase failed', 'error');
      }
      return;
    }
    const result = await startCheckout(plan);
    setStarting(false);
    if (!result.ok) showToast(result.reason || 'Could not start checkout', 'error');
  };

  const restore = async () => {
    setRestoring(true);
    const result = await restorePlayPurchases(profile!.uid);
    setRestoring(false);
    showToast(
      result.ok ? (result.pro ? 'Purchases restored — Pro is active.' : 'No previous purchase found.')
        : (result.reason || 'Could not restore'),
      result.ok && result.pro ? 'success' : 'info',
    );
  };

  const manage = async () => {
    if (playReady) { await openPlaySubscriptions(); return; }
    if (!isPortalConfigured()) {
      showToast('Subscription management is being set up — try again shortly.', 'info');
      return;
    }
    setManaging(true);
    const result = await openBillingPortal();
    setManaging(false);
    if (!result.ok) showToast(result.reason || 'Could not open billing portal', 'error');
  };

  // Headline + subcopy by state
  const headline = allFree
    ? <>You have <span className="gradient-text-accent">FitFlow Pro</span></>
    : isPaid
      ? <>You're on <span className="gradient-text-accent">FitFlow Pro</span></>
      : isTrialing
        ? <><span className="gradient-text-accent">{ent.trialDaysLeft}</span> {ent.trialDaysLeft === 1 ? 'day' : 'days'} left in your trial</>
        : <>Unlock <span className="gradient-text-accent">FitFlow Pro</span></>;

  const subcopy = allFree
    ? 'Every Pro feature is unlocked while we’re in launch. No payment, no trial countdown. Train.'
    : isPaid
      ? 'Thanks for going Pro. The full AI coach, native wearable sync, and unlimited everything are yours.'
      : isTrialing
        ? `You’re on a free ${TRIAL_DAYS}-day trial with everything unlocked — no card needed.${showPurchaseUi ? ' Subscribe any time to keep Pro after it ends.' : ''}`
        : ent.status === 'expired'
          ? `Your free trial has ended.${showPurchaseUi ? ' Subscribe to bring back the full AI coach, Meal Scan, and advanced analytics.' : ''}`
          : 'The full AI coach. Native wearable sync. Unlimited everything. Built to make every other fitness app obsolete.';

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
        <h1 className="font-display text-4xl font-bold text-white tracking-tight leading-[1.05]">{headline}</h1>
        <p className="text-text-dim text-base mt-3 max-w-sm leading-relaxed">{subcopy}</p>
      </div>

      {/* Paid state — manage subscription */}
      {!allFree && isPaid && (
        <div className="glass p-4 mb-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0">
              <Crown size={16} />
            </div>
            <div className="flex-1">
              <p className="text-eyebrow text-accent">{ent.plan === 'yearly' ? 'Yearly plan' : 'Monthly plan'}</p>
              <p className="text-white text-sm font-medium mt-0.5">
                {ent.cancelAtPeriodEnd
                  ? `Access until ${fmtDate(ent.renewsAt)}`
                  : ent.renewsAt ? `Renews ${fmtDate(ent.renewsAt)}` : 'Active'}
              </p>
            </div>
          </div>
          {showPurchaseUi ? (
            <button onClick={manage} disabled={managing} className="btn-3d w-full h-12 disabled:opacity-60">
              <SettingsIcon size={14} />
              {managing ? 'Opening…' : 'Manage subscription'}
            </button>
          ) : (
            <p className="text-xs text-text-dim">Manage your subscription from the FitFlow web app.</p>
          )}
        </div>
      )}

      {/* Launch giveaway state */}
      {allFree && (
        <div className="glass p-4 mb-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0">
            <Check size={16} />
          </div>
          <div className="flex-1">
            <p className="text-eyebrow text-accent">Launch perk</p>
            <p className="text-white text-sm font-medium mt-0.5">All Pro features are free during launch.</p>
          </div>
        </div>
      )}

      {/* Plan picker — shown when not already paid, not in launch mode, and purchasable */}
      {!allFree && !isPaid && showPurchaseUi && (
        <div className="glass p-2 grid grid-cols-2 gap-2 mb-5">
          {PLANS.map(p => {
            const active = plan === p.id;
            const d = priceFor(p.id);
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
                <p className="num font-display text-2xl font-bold text-white mt-1 leading-none">
                  {d.big}
                  <span className="text-sm text-text-dim font-medium ml-1">{d.suffix}</span>
                </p>
                <p className="text-xs text-text-dim mt-2">{d.sub}</p>
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

      {/* Primary CTA */}
      {allFree ? (
        <button onClick={() => navigate('/')} className="btn-3d w-full h-14">Continue training</button>
      ) : isPaid ? null : !showPurchaseUi ? (
        <p className="text-center text-xs text-text-mute leading-relaxed">
          {isTrialing
            ? `Your trial keeps everything unlocked for ${ent.trialDaysLeft} more ${ent.trialDaysLeft === 1 ? 'day' : 'days'}.`
            : 'Subscriptions are coming to Google Play soon — your progress and data are all set for when they arrive.'}
        </p>
      ) : (
        <>
          <button onClick={subscribe} disabled={starting} className="btn-3d w-full h-14 disabled:opacity-60">
            {starting ? 'Opening checkout…'
              : isTrialing ? `Subscribe — ${priceFor(plan).big}${plan === 'yearly' ? '/yr' : '/mo'}`
              : 'Subscribe to FitFlow Pro'}
          </button>
          <p className="text-center text-xs text-text-mute mt-3 leading-relaxed">
            {isTrialing
              ? `Your trial keeps everything unlocked for ${ent.trialDaysLeft} more ${ent.trialDaysLeft === 1 ? 'day' : 'days'}. `
              : `${TRIAL_DAYS}-day free trial included with every new account — no card needed. `}
            Billed {priceFor(plan).big}{plan === 'yearly' ? '/year' : '/month'}. Cancel anytime.
          </p>
          {playReady && (
            <button
              onClick={restore}
              disabled={restoring}
              className="block mx-auto mt-3 text-xs text-text-dim hover:text-white underline underline-offset-2 disabled:opacity-50"
            >
              {restoring ? 'Restoring…' : 'Restore purchases'}
            </button>
          )}
        </>
      )}
    </div>
  );
};
