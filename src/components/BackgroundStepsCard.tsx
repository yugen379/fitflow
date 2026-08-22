/**
 * The background-counting control.
 *
 * Counting steps while the app is closed needs three separate grants that fail
 * independently, so this shows them as three separate rows rather than one
 * "enable" button that silently half-works:
 *
 *   1. Physical activity — required. Nothing counts without it.
 *   2. Notifications — the ongoing notification. Optional; counting works
 *      without it, the user just cannot see that it is on.
 *   3. Unrestricted battery — optional on paper, decisive in practice. This is
 *      the one that decides whether counting survives overnight on Xiaomi,
 *      Samsung and Huawei builds, whose power managers kill even foreground
 *      services. It is shown as a warning only AFTER counting is on, because
 *      before that it is noise.
 *
 * Each row states what it is for and what breaks without it. A permission
 * prompt with no stated reason is the fastest way to get denied.
 */

import React from 'react';
import { motion } from 'motion/react';
import { Activity, BatteryCharging, Bell, Check, Footprints, Power } from 'lucide-react';

import { cn } from '../lib/utils';
import { haptic } from '../lib/haptics';
import { SPRING } from '../lib/motion';
import type { BackgroundStepsStatus } from '../lib/backgroundSteps';

export interface BackgroundStepsCardProps {
  status: BackgroundStepsStatus | null;
  countsInBackground: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onRequestNotifications: () => void;
  onOpenBatterySettings: () => void;
  className?: string;
}

const Row: React.FC<{
  icon: React.ReactNode;
  title: string;
  detail: string;
  done: boolean;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ icon, title, detail, done, actionLabel, onAction }) => (
  <div className="flex items-start gap-3 py-3">
    <span
      className={cn(
        'w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5',
        done ? 'bg-accent/12 border border-accent/30 text-accent' : 'bg-white/[0.04] border border-white/[0.08] text-text-mute',
      )}
    >
      {done ? <Check size={15} aria-hidden="true" /> : icon}
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-white leading-tight">{title}</p>
      <p className="text-[11px] text-text-dim mt-1 leading-relaxed">{detail}</p>
    </div>
    {!done && actionLabel && onAction ? (
      <button
        type="button"
        onClick={() => {
          void haptic('selection');
          onAction();
        }}
        className="shrink-0 h-9 px-3 rounded-xl bg-accent/12 border border-accent/30 text-accent text-[11px] font-semibold active:scale-95 transition-transform"
      >
        {actionLabel}
      </button>
    ) : null}
  </div>
);

export const BackgroundStepsCard: React.FC<BackgroundStepsCardProps> = ({
  status,
  countsInBackground,
  onEnable,
  onDisable,
  onRequestNotifications,
  onOpenBatterySettings,
  className,
}) => {
  // Not an Android build, or a phone with no step-counter core. Say so plainly
  // rather than offering a switch that cannot do anything.
  if (!status || !status.sensorAvailable) {
    return (
      <section className={cn('glass-spatial p-5', className)} aria-labelledby="bg-steps-heading">
        <p className="text-eyebrow text-accent inline-flex items-center gap-1.5">
          <Footprints size={12} aria-hidden="true" />
          Background counting
        </p>
        <h2 id="bg-steps-heading" className="font-display text-base font-semibold text-white mt-1">
          Not available on this device
        </h2>
        <p className="text-[11px] text-text-mute mt-2 leading-relaxed">
          {status
            ? 'This phone has no hardware step-counter sensor, so FitFlow can only count while it is open and on screen.'
            : 'Counting with the app closed needs the FitFlow Android app. In a browser, steps are only counted while this tab is open.'}
        </p>
      </section>
    );
  }

  const activityGranted = status.activityRecognition === 'granted';
  const activityDenied = status.activityRecognition === 'denied';

  return (
    <section className={cn('glass-spatial p-5', className)} aria-labelledby="bg-steps-heading">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-eyebrow text-accent inline-flex items-center gap-1.5">
            <Footprints size={12} aria-hidden="true" />
            Background counting
          </p>
          <h2 id="bg-steps-heading" className="font-display text-base font-semibold text-white mt-1 leading-tight">
            {countsInBackground ? 'Counting, even when FitFlow is closed' : 'Count steps with the app closed'}
          </h2>
        </div>

        {/* State is carried by colour AND by the label, never by colour alone. */}
        <motion.span
          layout
          transition={SPRING.snap}
          className={cn(
            'shrink-0 text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 rounded-full border',
            countsInBackground
              ? 'bg-accent/12 border-accent/30 text-accent'
              : 'bg-white/[0.04] border-white/[0.08] text-text-mute',
          )}
        >
          {countsInBackground ? 'On' : 'Off'}
        </motion.span>
      </div>

      <div className="mt-2 divide-y divide-white/[0.06]">
        <Row
          icon={<Activity size={15} />}
          title="Physical activity"
          detail={
            activityDenied
              ? 'Denied. Android will not ask again — turn on Physical activity for FitFlow in Settings › Apps › FitFlow › Permissions.'
              : 'Required. Lets FitFlow read the phone’s step sensor. Without it nothing is counted at all.'
          }
          done={activityGranted}
          actionLabel={activityDenied ? undefined : 'Allow'}
          onAction={activityDenied ? undefined : onEnable}
        />

        <Row
          icon={<Bell size={15} />}
          title="Ongoing notification"
          detail="Android requires a visible notification while an app counts in the background. Counting still works without it — you just won’t see that it’s running."
          done={status.notifications === 'granted'}
          actionLabel="Allow"
          onAction={onRequestNotifications}
        />

        {countsInBackground ? (
          <Row
            icon={<BatteryCharging size={15} />}
            title="Unrestricted battery"
            detail={
              status.batteryOptimizationExempt
                ? 'FitFlow is exempt from battery optimisation, so counting keeps running overnight.'
                : 'Strongly recommended. Some phones stop background apps after a few hours, which silently stops your step count. Set FitFlow to Unrestricted.'
            }
            done={status.batteryOptimizationExempt}
            actionLabel="Open settings"
            onAction={onOpenBatterySettings}
          />
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => {
          void haptic('medium');
          if (countsInBackground) onDisable();
          else onEnable();
        }}
        disabled={activityDenied && !countsInBackground}
        className={cn(
          'mt-4 w-full h-12 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-transform inline-flex items-center justify-center gap-2',
          countsInBackground
            ? 'bg-white/[0.04] border border-white/[0.08] text-text-dim'
            : 'bg-accent text-[#04060A]',
          activityDenied && !countsInBackground ? 'opacity-40' : '',
        )}
      >
        <Power size={15} aria-hidden="true" />
        {countsInBackground ? 'Turn off background counting' : 'Turn on background counting'}
      </button>

      <p className="text-[11px] text-text-mute mt-3 leading-relaxed">
        FitFlow uses your phone’s own low-power step sensor. It does not need Health Connect, a Google account or a
        wearable. Steps taken between a phone restart and FitFlow starting up again are the only ones it cannot see.
      </p>
    </section>
  );
};

export default BackgroundStepsCard;
