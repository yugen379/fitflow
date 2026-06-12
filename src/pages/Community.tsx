import React, { useEffect, useState } from 'react';
import { Heart, MessageCircle, Share2, MoreHorizontal, Plus, Trophy } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { likePost } from '../services/dataService';
import { Post } from '../types';
import { useAuth } from '../hooks/useAuth';
import { query, collection, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Logo } from '../components/Logo';
import { CreatePostModal } from '../components/CreatePostModal';
import { EditPostModal } from '../components/EditPostModal';
import { CommentModal } from '../components/CommentModal';
import { Avatar } from '../components/Avatar';
import { useToast } from '../hooks/useToast';
import { haptic } from '../lib/haptics';

export const Community: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [commentingPost, setCommentingPost] = useState<Post | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'Feed' | 'Ranks'>('Feed');

  useEffect(() => {
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));
    const uQ = query(collection(db, 'users'), orderBy('points', 'desc'), limit(10));
    
    const unsubPosts = onSnapshot(q, (snap) => {
      setPosts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post)));
      setLoading(false);
    });

    const unsubUsers = onSnapshot(uQ, (snap) => {
      setLeaderboard(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubPosts();
      unsubUsers();
    };
  }, []);

  const handleLike = async (postId: string) => {
    if (!user) return;
    await likePost(postId, user.uid);
  };

  const handleShare = async (post: Post) => {
    haptic('light');
    const text = `${post.username} on FitFlow:\n${post.content || ''}`.trim();
    const url = typeof window !== 'undefined' ? window.location.origin : 'https://gen-lang-client-0893216108.web.app';
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try { await (navigator as any).share({ title: 'FitFlow post', text, url }); return; }
      catch { /* user cancelled — fall through */ }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      showToast('Post copied to clipboard', 'success');
    } catch {
      showToast('Could not share', 'error');
    }
  };

  return (
    <div className="pb-24 pt-4 bg-bg min-h-screen">
      <header className="px-4 space-y-4 mb-5">
        <div className="flex justify-between items-center pt-2">
          <div>
            <p className="text-eyebrow text-accent">Community</p>
            <h1 className="font-display text-3xl font-bold text-white tracking-tight leading-tight mt-1">Feed</h1>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setIsPostModalOpen(true)}
            className="w-11 h-11 bg-accent text-bg rounded-2xl flex items-center justify-center shadow-[0_12px_32px_-8px_rgba(198,255,61,0.5)]"
            aria-label="New post"
          >
            <Plus size={20} strokeWidth={2.5} />
          </motion.button>
        </div>

        <div className="flex bg-surface rounded-xl p-1 border border-white/[0.06]">
          {(['Feed', 'Ranks'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all ${activeTab === tab ? 'bg-accent text-bg' : 'text-text-dim hover:text-white'}`}
            >
              {tab === 'Feed' ? 'Feed' : 'Leaderboard'}
            </button>
          ))}
        </div>
      </header>

      <AnimatePresence mode="wait">
        {activeTab === 'Feed' ? (
          <motion.div 
            key="feed"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="space-y-6"
          >
            {loading ? (
              <div className="flex justify-center p-10">
                <div className="w-8 h-8 border-2 border-white/10 border-t-accent rounded-full animate-spin" />
              </div>
            ) : posts.length > 0 ? (
              posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onLike={() => handleLike(post.id!)}
                  onEdit={() => setEditingPost(post)}
                  onComment={() => setCommentingPost(post)}
                  onShare={() => handleShare(post)}
                  isOwnPost={user?.uid === post.userId}
                />
              ))
            ) : (
              <div className="text-center p-12 space-y-3">
                <div className="text-4xl opacity-70">🌵</div>
                <p className="text-text-dim text-sm">Feed is empty. Be the first to post.</p>
                <button onClick={() => setIsPostModalOpen(true)} className="btn-primary mt-2 px-4 py-2 text-xs">
                  Create post
                </button>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div 
            key="ranks"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-6 space-y-3"
          >
            {leaderboard.map((u, i) => (
              <div key={u.id} className="glass flex items-center justify-between p-4 relative overflow-hidden">
                <div className="flex items-center gap-3 z-10">
                  <div className={`num w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                    i === 0 ? 'bg-accent text-bg' :
                    i === 1 ? 'bg-white/[0.08] text-white' :
                    i === 2 ? 'bg-accent-2/15 text-accent-2' :
                    'bg-surface border border-white/[0.06] text-text-dim'
                  }`}>
                    {i + 1}
                  </div>
                  <div className="w-9 h-9 rounded-full border border-white/10 overflow-hidden">
                    <Avatar src={u.photoURL} name={u.displayName} size={36} />
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm">{u.displayName}</p>
                    <p className="num text-xs text-text-dim mt-0.5">🔥 {u.streak || 0} day streak</p>
                  </div>
                </div>
                <div className="text-right z-10">
                  <p className="num font-display text-base font-bold text-white leading-none">{u.points || 0}</p>
                  <p className="text-xs text-accent font-medium mt-1">XP</p>
                </div>
                {i === 0 && (
                  <Trophy size={48} className="absolute top-0 right-0 p-2 text-accent opacity-15" />
                )}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <CreatePostModal isOpen={isPostModalOpen} onClose={() => setIsPostModalOpen(false)} />
      <EditPostModal 
        isOpen={!!editingPost} 
        onClose={() => setEditingPost(null)} 
        post={editingPost} 
      />
      <CommentModal 
        isOpen={!!commentingPost}
        onClose={() => setCommentingPost(null)}
        post={commentingPost}
      />
    </div>
  );
};

const PostCard: React.FC<{
  post: Post,
  onLike: () => void,
  onEdit: () => void,
  onComment: () => void,
  onShare: () => void,
  isOwnPost: boolean
}> = ({ post, onLike, onEdit, onComment, onShare, isOwnPost }) => (
  <motion.div 
    initial={{ opacity: 0, y: 10 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    className="bg-bg border-y border-[#222] overflow-hidden"
  >
    <div className="px-4 py-3 flex justify-between items-center">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-soft to-accent p-[2px]">
          <div className="w-full h-full rounded-full bg-bg overflow-hidden">
            <Avatar src={post.userPhoto} name={post.username} size={36} />
          </div>
        </div>
        <div>
          <h4 className="text-white font-medium text-sm">{post.username}</h4>
          <span className="text-text-dim text-xs">
             {post.createdAt?.toDate ? post.createdAt.toDate().toLocaleDateString() : 'Just now'}
          </span>
        </div>
      </div>
      {isOwnPost && (
        <button onClick={onEdit} className="w-9 h-9 rounded-xl text-text-dim hover:text-white transition-colors flex items-center justify-center" aria-label="More">
          <MoreHorizontal size={18} />
        </button>
      )}
    </div>

    {post.mediaUrl && (
      <div className="aspect-video w-full bg-surface">
        <img src={post.mediaUrl} className="w-full h-full object-cover" alt="Post content" />
      </div>
    )}

    <div className="px-4 pt-3 pb-4 space-y-3">
      {post.content && <p className="text-white text-sm leading-relaxed">{post.content}</p>}

      <div className="flex items-center gap-5 pt-1">
        <button
          onClick={onLike}
          className="flex items-center gap-1.5 text-text-dim hover:text-accent transition-colors"
        >
          <Heart size={18} className={post.likesCount > 0 ? 'text-accent fill-accent' : ''} />
          <span className="num text-xs font-medium">{post.likesCount}</span>
        </button>
        <button
          onClick={onComment}
          className="flex items-center gap-1.5 text-text-dim hover:text-white transition-colors"
        >
          <MessageCircle size={18} />
          <span className="num text-xs font-medium">{post.commentsCount}</span>
        </button>
        <button onClick={onShare} className="text-text-dim hover:text-white transition-colors ml-auto" aria-label="Share">
          <Share2 size={18} />
        </button>
      </div>
    </div>
  </motion.div>
);
