import React, { useState } from 'react';
import { X, Send, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../hooks/useAuth';
import { createPost } from '../services/dataService';
import { Avatar } from './Avatar';

export const CreatePostModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { user, profile } = useAuth();
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!user || !profile || !content.trim()) return;
    setIsSubmitting(true);
    try {
      await createPost(user.uid, profile.displayName, profile.photoURL, content);
      setContent('');
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}
      />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }}
        transition={{ type: 'spring', damping: 28 }}
        className="relative w-full max-w-lg bg-surface border border-white/[0.06] sm:rounded-3xl rounded-t-3xl p-5 space-y-4"
      >
        <div className="flex justify-between items-center">
          <div>
            <p className="text-eyebrow text-accent">New post</p>
            <h2 className="font-display text-xl font-bold text-white tracking-tight">Share your progress</h2>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-3">
          <Avatar src={profile?.photoURL} name={profile?.displayName} size={40} />
          <textarea
            placeholder="What did you crush today?"
            className="flex-1 glass rounded-2xl p-4 text-white text-sm placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30 resize-none min-h-[120px]"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            autoFocus
          />
        </div>

        <div className="flex justify-end pt-1">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !content.trim()}
            className="btn-3d h-12 px-6 disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <><Send size={14} /> Post</>}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
