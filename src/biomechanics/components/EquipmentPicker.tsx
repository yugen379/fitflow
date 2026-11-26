/**
 * Equipment picker.
 *
 * Changing the implement is not cosmetic: grip width feeds the FK solver as a
 * shoulder-abduction bias, so the avatar's arm path and the bar-path trace both
 * change when you switch from a barbell to dumbbells.
 */

import React from 'react';
import { Cable, Cog, Dumbbell, PersonStanding, Weight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { haptic } from '../../lib/haptics';
import { useUnits } from '../../hooks/useUnits';
import { t, tDyn } from '../../i18n/i18n';
import { cn } from '../../lib/utils';
import { EQUIPMENT, resolveEquipment } from '../motions';
import { selectActiveClip, selectEquipment } from '../selectors';
import { useAppDispatch, useAppSelector } from '../store';
import type { EquipmentId } from '../types';
import { equipmentChanged } from '../workoutSlice';

const ICONS: Record<EquipmentId, LucideIcon> = {
  barbell: Weight,
  dumbbell: Dumbbell,
  cable: Cable,
  bodyweight: PersonStanding,
  kettlebell: Weight,
  band: Cable,
  machine: Cog,
};

export const EquipmentPicker: React.FC<{ className?: string }> = ({ className }) => {
  const dispatch = useAppDispatch();
  const clip = useAppSelector(selectActiveClip);
  const sessionEquipment = useAppSelector(selectEquipment);
  // A generated clip may not support the session's implement (a push-up has
  // no barbell); show what is actually rendered.
  const active = resolveEquipment(clip, sessionEquipment);
  const units = useUnits();

  // Only offer what the movement can actually be performed with.
  const options = clip.equipment;

  return (
    <div className={cn('glass p-4 space-y-3', className)}>
      <div>
        <p className="text-eyebrow text-accent">{t('Equipment')}</p>
        <p className="text-white font-semibold text-sm mt-0.5">{tDyn(EQUIPMENT[active].label)}</p>
      </div>

      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('Equipment')}>
        {options.map((id) => {
          const Icon = ICONS[id];
          const selected = id === active;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                haptic('selection');
                dispatch(equipmentChanged(id));
              }}
              className={cn(
                'h-[4.5rem] rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-colors duration-150 active:scale-[0.97]',
                selected
                  ? 'bg-accent/10 border-accent/30 text-accent'
                  : 'bg-white/[0.02] border-white/[0.06] text-text-dim',
              )}
            >
              <Icon size={19} aria-hidden="true" />
              <span className="text-[11px] font-medium">{tDyn(EQUIPMENT[id].label)}</span>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-text-mute leading-relaxed">
        {t('Grip width {width} — this drives the shoulder abduction the model solves for, so the arm path changes with the implement.', { width: units.formatShortLength(EQUIPMENT[active].gripHalfWidth * 200) })}
      </p>
    </div>
  );
};
