/**
 * Toast rendering, split out from the provider.
 *
 * The provider itself is mounted at the app root, so anything it imports
 * statically lands on the boot path. This file is the only reason the animation
 * library was there — ~42 kB gzipped, to animate a component that by definition
 * is not on screen when the app starts.
 *
 * Splitting it means the provider stays weightless and the library is fetched
 * the first time a toast actually appears, with the enter *and* exit animations
 * fully intact.
 */

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface Props {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const ToastViewport: React.FC<Props> = ({ toasts, onDismiss }) => (
  <AnimatePresence>
    {toasts.map((toast) => {
      const Icon = toast.variant === 'success' ? CheckCircle : toast.variant === 'error' ? AlertCircle : Info;
      const accentClass =
        toast.variant === 'success'
          ? 'text-accent border-accent/25'
          : toast.variant === 'error'
            ? 'text-accent-2 border-accent-2/25'
            : 'text-accent-3 border-accent-3/25';
      return (
        <motion.div
          key={toast.id}
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.96 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          className={`pointer-events-auto flex items-center gap-3 pl-4 pr-2 py-2.5 rounded-2xl border w-full max-w-sm glass ${accentClass}`}
        >
          <Icon size={16} />
          <p className="flex-1 text-sm font-medium text-white leading-snug">{toast.message}</p>
          <button
            onClick={() => onDismiss(toast.id)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-text-dim hover:text-white transition-colors"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </motion.div>
      );
    })}
  </AnimatePresence>
);

export default ToastViewport;
