import React, { useState } from 'react';
import { X, Flag, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

const REASONS = [
  'Spam or misleading',
  'Harassment or bullying',
  'Hate speech',
  'Nudity or sexual content',
  'Violence or dangerous acts',
  'Self-harm',
  'Other',
];

export const ReportModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void> | void;
  targetLabel?: string;
}> = ({ isOpen, onClose, onSubmit, targetLabel }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      await onSubmit(selected);
      setSelected(null);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}
      />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28 }}
        className="relative w-full max-w-lg bg-surface border border-white/[0.06] sm:rounded-3xl rounded-t-3xl flex flex-col"
      >
        <div className="flex justify-between items-center p-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <Flag size={16} className="text-accent-2" />
            <div>
              <p className="text-eyebrow text-accent-2">Report</p>
              <p className="text-sm text-white font-medium mt-0.5">
                {targetLabel ? `Why are you reporting ${targetLabel}?` : 'Why are you reporting this?'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-2">
          {REASONS.map((reason) => (
            <button
              key={reason}
              onClick={() => setSelected(reason)}
              className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-colors border ${
                selected === reason
                  ? 'bg-accent-2/10 border-accent-2/40 text-white'
                  : 'bg-white/[0.02] border-white/[0.06] text-text-dim hover:text-white'
              }`}
            >
              {reason}
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-white/[0.06]">
          <p className="text-xs text-text-mute mb-3 leading-relaxed">
            Reports are sent to our team for review. Thanks for helping keep FitFlow safe.
          </p>
          <button
            onClick={handleSubmit}
            disabled={!selected || submitting}
            className="w-full h-12 rounded-xl bg-accent-2 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-30"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Flag size={16} />}
            Submit report
          </button>
        </div>
      </motion.div>
    </div>
  );
};
