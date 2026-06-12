import React, { useState, useEffect } from 'react';
import { X, Save, Loader2, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { updatePost, deletePost } from '../services/dataService';
import { Post } from '../types';
import { Avatar } from './Avatar';

export const EditPostModal: React.FC<{ isOpen: boolean; onClose: () => void; post: Post | null }> = ({ isOpen, onClose, post }) => {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => { if (post) setContent(post.content || ''); }, [post]);

  const handleSubmit = async () => {
    if (!post?.id || !content.trim()) return;
    setIsSubmitting(true);
    try {
      await updatePost(post.id, content);
      onClose();
    } catch (e) { console.error(e); }
    finally { setIsSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!post?.id || !window.confirm('Delete this post? This cannot be undone.')) return;
    setIsDeleting(true);
    try {
      await deletePost(post.id);
      onClose();
    } catch (e) {
      console.error(e);
      setIsDeleting(false);
    }
  };

  if (!isOpen || !post) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}
      />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28 }}
        className="relative w-full max-w-lg bg-surface border border-white/[0.06] sm:rounded-3xl rounded-t-3xl p-5 space-y-4"
      >
        <div className="flex justify-between items-center">
          <h2 className="font-display text-xl font-bold text-white tracking-tight">Edit post</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="w-9 h-9 rounded-xl bg-accent-2/10 text-accent-2 hover:bg-accent-2/20 transition-colors flex items-center justify-center disabled:opacity-50"
              aria-label="Delete"
            >
              <Trash2 size={16} />
            </button>
            <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <Avatar src={post.userPhoto} name={post.username} size={40} />
          <textarea
            placeholder="Edit your post…"
            className="flex-1 glass rounded-2xl p-4 text-white text-sm placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30 resize-none min-h-[140px]"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !content.trim()}
            className="btn-3d h-12 px-6 disabled:opacity-50"
          >
            {isSubmitting || isDeleting ? <Loader2 className="animate-spin" size={16} /> : <><Save size={14} /> Save</>}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
