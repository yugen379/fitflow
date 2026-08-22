/**
 * Light / dark toggle, sized and shaped to sit beside the notification bell in
 * the Home header.
 *
 * It cycles light -> dark -> system rather than flipping between two states,
 * because 'system' is a real preference: it is the default, and a two-way
 * switch would give a user who wanted to go back to following their phone no
 * way to say so.
 *
 * The icon crossfades and rotates through `AnimatePresence` keyed on the
 * current mode, which matches how the rest of the header animates, and the
 * whole control is a single 44px hit target (the platform minimum) rather than
 * the visual 38px circle.
 */

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Monitor, Moon, Sun } from 'lucide-react';

import { cn } from '../../lib/utils';
import { haptic } from '../../lib/haptics';
import { useTheme } from '../../hooks/useTheme';

const LABELS = {
  light: 'Light mode',
  dark: 'Dark mode',
  system: 'Match system',
} as const;

const NEXT = {
  light: 'dark',
  dark: 'system',
  system: 'light',
} as const;

export const ThemeToggle: React.FC<{ className?: string }> = ({ className }) => {
  const { choice, cycle } = useTheme();
  const Icon = choice === 'light' ? Sun : choice === 'dark' ? Moon : Monitor;

  return (
    <button
      type="button"
      onClick={() => {
        void haptic('selection');
        cycle();
      }}
      // The control announces what it IS, and the title says what tapping does.
      aria-label={`Theme: ${LABELS[choice]}. Switch to ${LABELS[NEXT[choice]]}.`}
      title={LABELS[choice]}
      className={cn(
        'relative w-11 h-11 rounded-2xl flex items-center justify-center shrink-0',
        'bg-white/[0.04] border border-white/[0.07] text-text-dim',
        'active:scale-95 transition-transform duration-150',
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={choice}
          initial={{ opacity: 0, rotate: -70, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 70, scale: 0.6 }}
          transition={{ type: 'spring', stiffness: 420, damping: 28 }}
          className="absolute inset-0 flex items-center justify-center"
        >
          <Icon size={18} aria-hidden="true" />
        </motion.span>
      </AnimatePresence>
    </button>
  );
};

export default ThemeToggle;
