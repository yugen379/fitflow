import React, { useState, useEffect } from 'react';
import { X, Send, Loader2, MessageCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../hooks/useAuth';
import { addComment } from '../services/dataService';
import { query, collection, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Post } from '../types';
import { Avatar } from './Avatar';

export const CommentModal: React.FC<{ isOpen: boolean; onClose: () => void; post: Post | null }> = ({ isOpen, onClose, post }) => {
  const { user, profile } = useAuth();
  const [content, setContent] = useState('');
  const [comments, setComments] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!post?.id || !isOpen) return;
    const q = query(
      collection(db, `posts/${post.id}/comments`),
      orderBy('createdAt', 'asc'),
      limit(50),
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      setComments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, [post?.id, isOpen]);

  const handleSubmit = async () => {
    if (!user || !profile || !post?.id || !content.trim()) return;
    setIsSubmitting(true);
    try {
      await addComment(post.id, user.uid, profile.displayName, profile.photoURL, content);
      setContent('');
    } catch (e) { console.error(e); }
    finally { setIsSubmitting(false); }
  };

  if (!isOpen || !post) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}
      />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28 }}
        className="relative w-full max-w-lg bg-surface border border-white/[0.06] sm:rounded-3xl rounded-t-3xl flex flex-col h-[85vh] sm:h-[600px]"
      >
        <div className="flex justify-between items-center p-5 border-b border-white/[0.06]">
          <div>
            <p className="text-eyebrow text-accent">Comments</p>
            <p className="text-sm text-white font-medium mt-0.5">On {post.username}'s post</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-8 h-8 border-2 border-white/10 border-t-accent rounded-full animate-spin" />
            </div>
          ) : comments.length > 0 ? (
            comments.map((comment) => (
              <div key={comment.id} className="flex gap-3">
                <Avatar src={comment.userPhoto} name={comment.username} size={32} />
                <div className="flex-1 space-y-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{comment.username}</span>
                    <span className="text-xs text-text-mute">
                      {comment.createdAt?.toDate?.().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm text-white/85 leading-relaxed break-words">{comment.content}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 opacity-60">
              <MessageCircle size={32} className="text-text-dim/40" />
              <p className="text-sm text-text-dim">Be the first to comment.</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/[0.06] bg-surface-2/50">
          <div className="flex items-center gap-3">
            <Avatar src={profile?.photoURL} name={profile?.displayName} size={32} />
            <div className="flex-1 relative">
              <input
                placeholder="Write a comment…"
                className="w-full glass rounded-xl pl-4 pr-11 h-11 text-sm text-white placeholder:text-text-dim/50 focus:outline-none focus:border-accent/40"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !content.trim()}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-accent text-bg flex items-center justify-center disabled:opacity-30"
                aria-label="Send"
              >
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
