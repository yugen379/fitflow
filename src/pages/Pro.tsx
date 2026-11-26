import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Check, Sparkles, Zap, TrendingUp, Crown, Settings as SettingsIcon, MessageCircle, Box, Target, Snowflake } from 'lucide-react';
import { LogoMark } from '../components/Logo';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { startCheckout, syncSubscription, isStripeConfigured, openBillingPortal, isPortalConfigured } from '../services/stripeService';
import { isNativeApp } from '../lib/firebase';
import {
  isPlayBillingConfigured, configurePlayBilling, startPlayPurchase,
  restorePlayPurchases, openPlaySubscriptions, purchaseUiAllowed,
  getPlayPlanPrices, StorePlanPrice,
} from '../services/playBillingService';
import { allFeaturesFree, getEntitlement, TRIAL_DAYS } from '../lib/billing';
import { msg, t, tDyn } from '../i18n/i18n';

/**
 * Put elements into a translated sentence at its {placeholders}, so the whole
 * sentence is one translation and each language can order it its own way.
 */
const splice = (text: string, parts: Record<string, React.ReactNode>) =>
  text.split(/(\{\w+\})/).map((piece, i) => {
    const key = /^\{(\w+)\}$/.exec(piece)?.[1];
    return <React.Fragment key={i}>{key && key in parts ? parts[key] : piece}</React.Fragment>;
  });

// Only what Pro actually unlocks (src/lib/features.ts, NutritionGoals, the
// server AI limits in functions/src/aiGuard.ts). Meal scan, form check, label
// scan, barcode, GPS and Health Connect are FREE for everyone and must never be
// listed here: selling a free feature is a refund and a 1-star review.
const FEATURES = [
  { icon: MessageCircle, title: msg('Unlimited AI Coach chat'), sub: msg('It knows your food, training and sleep. Free accounts get 3 questions a day') },
  { icon: Sparkles, title: msg('AI weekly recap'), sub: msg('A written read on your week, every Sunday, from your own numbers') },
  { icon: TrendingUp, title: msg('Your full history'), sub: msg('Every week, month and year of progress. Free shows the last 7 days') },
  { icon: Box, title: msg('3D form lab'), sub: msg('Watch any exercise in 3D and see which muscles it works') },
  { icon: Target, title: msg('Macros by the gram + training-day targets'), sub: msg('Exact protein, carb and fat grams; more on training days, less on rest days') },
  { icon: Zap, title: msg('More AI every day'), sub: msg('300 AI requests a day instead of 50, and an hour of live form check instead of 10 minutes') },
  { icon: Snowflake, title: msg('Unlimited streak freezes'), sub: msg('Miss a day without losing your streak. Free accounts get 1 a month') },
];

// USD fallbacks shown until live store prices load. Keep in sync with the
// server-enforced Stripe prices (STRIPE_PRICE_BY_PLAN in functions/src/index.ts).
const USD_MONTHLY = 4.99;
const USD_YEARLY = 60.10;

const PLANS = [
  { id: 'monthly' as const, label: msg('Monthly') },
  { id: 'yearly' as const, label: msg('Yearly') },
];

const fmtDate = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export const Pro: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [plan, setPlan] = useState<'monthly' | 'yearly'>('monthly');
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

  // Paid but the profile still says free (missed webhook): ask the server to
  // check with Stripe / Play directly. Runs on open, and again after checkout.
  useEffect(() => {
    if (!profile?.uid || isPaid) return;
    void syncSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid]);

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
  const monthlyUsd = storePrices?.monthly?.price || USD_MONTHLY;
  const yearlyUsd = storePrices?.yearly?.price || USD_YEARLY;
  // Honest math only: the save line and "Best value" badge appear ONLY when the
  // yearly plan really is cheaper per month than paying monthly.
  const yearlySavePct = Math.round((1 - yearlyUsd / 12 / monthlyUsd) * 100);

  const priceFor = (id: 'monthly' | 'yearly') => {
    if (id === 'monthly') {
      const p = storePrices?.monthly?.priceString ?? `$${USD_MONTHLY.toFixed(2)}`;
      return { big: p, suffix: t('/month'), sub: t('{price} billed monthly', { price: p }) };
    }
    const sp = storePrices?.yearly;
    const perMo = sp?.perMonthString ?? `$${(USD_YEARLY / 12).toFixed(2)}`;
    return {
      big: sp?.priceString ?? `$${USD_YEARLY.toFixed(2)}`,
      suffix: t('/year'),
      sub: yearlySavePct > 0
        ? t('≈ {price}/mo · save {pct}%', { price: perMo, pct: yearlySavePct })
        : t('≈ {price}/mo · one payment a year', { price: perMo }),
    };
  };

  const subscribe = async () => {
    if (allFree) {
      showToast(t('All features are free right now — enjoy.'), 'success');
      navigate('/');
      return;
    }
    if (!billingReady) {
      showToast(t('Billing is being configured — try again shortly.'), 'info');
      return;
    }
    setStarting(true);
    if (playReady) {
      const result = await startPlayPurchase(profile!.uid, plan);
      setStarting(false);
      if (result.ok) {
        showToast(t('Subscribed to FitFlow Pro — unlocking…'), 'success');
        // Don't wait on the webhook: confirm with the server now, retry once.
        void syncSubscription().then((ok) => { if (!ok) setTimeout(() => void syncSubscription(), 4000); });
        // The RevenueCat webhook flips subscriptionType server-side; the profile
        // listener picks it up within a moment.
      } else if (result.reason !== 'cancelled') {
        showToast(result.reason || t('Purchase failed'), 'error');
      }
      return;
    }
    const result = await startCheckout(plan);
    setStarting(false);
    if (!result.ok) showToast(result.reason || t('Could not start checkout'), 'error');
  };

  const restore = async () => {
    setRestoring(true);
    const result = await restorePlayPurchases(profile!.uid);
    setRestoring(false);
    showToast(
      result.ok ? (result.pro ? t('Purchases restored — Pro is active.') : t('No previous purchase found.'))
        : (result.reason || t('Could not restore')),
      result.ok && result.pro ? 'success' : 'info',
    );
  };

  const manage = async () => {
    if (playReady) { await openPlaySubscriptions(); return; }
    if (!isPortalConfigured()) {
      showToast(t('Subscription management is being set up — try again shortly.'), 'info');
      return;
    }
    setManaging(true);
    const result = await openBillingPortal();
    setManaging(false);
    if (!result.ok) showToast(result.reason || t('Could not open billing portal'), 'error');
  };

  // Headline + subcopy by state
  const headline = allFree
    ? splice(t('You have {pro}'), { pro: <span className="gradient-text-accent">FitFlow Pro</span> })
    : isPaid
      ? splice(t("You're on {pro}"), { pro: <span className="gradient-text-accent">FitFlow Pro</span> })
      : isTrialing
        ? splice(ent.trialDaysLeft === 1 ? t('{n} day left in your trial') : t('{n} days left in your trial'), {
            n: <span className="gradient-text-accent">{ent.trialDaysLeft}</span>,
          })
        : splice(t('Unlock {pro}'), { pro: <span className="gradient-text-accent">FitFlow Pro</span> });

  const subcopy = allFree
    ? t('Every Pro feature is unlocked while we’re in launch. No payment, no trial countdown. Train.')
    : isPaid
      ? t('Thanks for going Pro. The full AI coach, native wearable sync, and unlimited everything are yours.')
      : isTrialing
        ? t('You’re on a free {n}-day trial with everything unlocked — no card needed.', { n: TRIAL_DAYS })
          + (showPurchaseUi ? ` ${t('Subscribe any time to keep Pro after it ends.')}` : '')
        : ent.status === 'expired'
          ? t('Your free trial has ended.')
            + (showPurchaseUi ? ` ${t('Subscribe to bring back the full AI coach, Meal Scan, and advanced analytics.')}` : '')
          : t('The full AI coach, your whole history and the 3D form lab. Cancel anytime.');

  return (
    <div className="pb-28 pt-4 px-5 min-h-screen relative overflow-hidden">
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-accent/10 blur-[160px] rounded-full pointer-events-none" />

      <header className="relative flex items-center justify-between mb-6">
        <button onClick={() => navigate(-1)} className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white" aria-label={t('Back')}>
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
              <p className="text-eyebrow text-accent">{ent.plan === 'yearly' ? t('Yearly plan') : t('Monthly plan')}</p>
              <p className="text-white text-sm font-medium mt-0.5">
                {ent.cancelAtPeriodEnd
                  ? t('Access until {date}', { date: fmtDate(ent.renewsAt) })
                  : ent.renewsAt ? t('Renews {date}', { date: fmtDate(ent.renewsAt) }) : t('Active')}
              </p>
            </div>
            <span className="flex items-center gap-1 bg-accent/15 border border-accent/30 text-accent text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full shrink-0">
              <Check size={10} /> {t('Subscribed')}
            </span>
          </div>
          {showPurchaseUi ? (
            <button onClick={manage} disabled={managing} className="btn-3d w-full h-12 disabled:opacity-60">
              <SettingsIcon size={14} />
              {managing ? t('Opening…') : t('Manage subscription')}
            </button>
          ) : (
            <p className="text-xs text-text-dim">{t('Manage your subscription from the FitFlow web app.')}</p>
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
            <p className="text-eyebrow text-accent">{t('Launch perk')}</p>
            <p className="text-white text-sm font-medium mt-0.5">{t('All Pro features are free during launch.')}</p>
          </div>
        </div>
      )}

      {/* Plan picker — shown when not already paid, not in launch mode, and purchasable */}
      {!allFree && !isPaid && showPurchaseUi && (
        <div className="glass p-2 grid grid-cols-2 gap-2 mb-5">
          {PLANS.map(p => {
            const active = plan === p.id;
            const d = priceFor(p.id);
            const badge = p.id === 'yearly' && yearlySavePct > 0 ? t('Best value') : null;
            return (
              <button
                key={p.id}
                onClick={() => setPlan(p.id)}
                className={`relative p-4 rounded-2xl text-left transition-all overflow-hidden ${active ? 'bg-accent/15 border border-accent/40' : 'bg-transparent border border-transparent'}`}
              >
                {badge && (
                  <span className="absolute -top-2 right-3 bg-accent text-bg text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {badge}
                  </span>
                )}
                <p className={`text-xs font-medium ${active ? 'text-accent' : 'text-text-dim'}`}>{tDyn(p.label)}</p>
                <p className="num font-display text-2xl font-bold text-white mt-1 leading-none flex items-baseline flex-wrap gap-x-1">
                  <span>{d.big}</span>
                  <span className="text-sm text-text-dim font-medium">{d.suffix}</span>
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
                <p className="text-white font-medium text-sm">{tDyn(f.title)}</p>
                <Check size={14} className="text-accent shrink-0" />
              </div>
              <p className="text-xs text-text-dim mt-0.5 leading-relaxed">{tDyn(f.sub)}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Primary CTA */}
      {allFree ? (
        <button onClick={() => navigate('/')} className="btn-3d w-full h-14">{t('Continue training')}</button>
      ) : isPaid ? (
        <div className="w-full h-14 rounded-2xl bg-accent/15 border border-accent/30 flex items-center justify-center gap-2 text-accent font-bold">
          <Check size={18} /> {t('Subscribed to FitFlow Pro')}
        </div>
      ) : !showPurchaseUi ? (
        <p className="text-center text-xs text-text-mute leading-relaxed">
          {isTrialing
            ? (ent.trialDaysLeft === 1
              ? t('Your trial keeps everything unlocked for 1 more day.')
              : t('Your trial keeps everything unlocked for {n} more days.', { n: ent.trialDaysLeft }))
            : t('Subscriptions are coming to Google Play soon — your progress and data are all set for when they arrive.')}
        </p>
      ) : (
        <>
          <button onClick={subscribe} disabled={starting} className="btn-3d w-full h-14 disabled:opacity-60">
            {starting ? t('Opening checkout…')
              : isTrialing ? (plan === 'yearly'
                ? t('Subscribe — {price}/yr', { price: priceFor(plan).big })
                : t('Subscribe — {price}/mo', { price: priceFor(plan).big }))
              : t('Subscribe to FitFlow Pro')}
          </button>
          <p className="text-center text-xs text-text-mute mt-3 leading-relaxed">
            {isTrialing
              ? (ent.trialDaysLeft === 1
                ? t('Your trial keeps everything unlocked for 1 more day.')
                : t('Your trial keeps everything unlocked for {n} more days.', { n: ent.trialDaysLeft }))
              : t('{n}-day free trial included with every new account — no card needed.', { n: TRIAL_DAYS })}
            {' '}
            {plan === 'yearly'
              ? t('Billed {price}/year. Cancel anytime.', { price: priceFor(plan).big })
              : t('Billed {price}/month. Cancel anytime.', { price: priceFor(plan).big })}
          </p>
          {playReady && (
            <button
              onClick={restore}
              disabled={restoring}
              className="block mx-auto mt-3 text-xs text-text-dim hover:text-white underline underline-offset-2 disabled:opacity-50"
            >
              {restoring ? t('Restoring…') : t('Restore purchases')}
            </button>
          )}
        </>
      )}
    </div>
  );
};
