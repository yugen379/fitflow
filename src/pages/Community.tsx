import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Heart, MessageCircle, Share2, MoreHorizontal, Plus, Trophy, Flag, Ban } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { likePost, blockUser, reportContent } from '../services/dataService';
import { Post } from '../types';
import { useAuth } from '../hooks/useAuth';
import { LoadingBar } from '../components/LoadingBar';
import { query, collection, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db, safeUnsubscribe } from '../lib/firestore';
import { Logo } from '../components/Logo';
import { CreatePostModal } from '../components/CreatePostModal';
import { EditPostModal } from '../components/EditPostModal';
import { CommentModal } from '../components/CommentModal';
import { ReportModal } from '../components/ReportModal';
import { Avatar } from '../components/Avatar';
import { useToast } from '../hooks/useToast';
import { haptic } from '../lib/haptics';
import { t } from '../i18n/i18n';

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
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [reportTarget, setReportTarget] = useState<Post | null>(null);

  // Subscribe only once signed in, and again if the user changes. On a cold
  // start (deep link / reload straight into /community) these listeners used
  // to open before auth was restored; Firestore refused them, a refused
  // listener never recovers, and the feed sat on "Loading feed" forever.
  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));
    // Leaderboards read the public mirror. /users carries health, contact and
    // billing data and is owner-only.
    const uQ = query(collection(db, 'public_profiles'), orderBy('points', 'desc'), limit(10));

    const unsubPosts = onSnapshot(q, (snap) => {
      setPosts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post)));
      setLoading(false);
    }, () => setLoading(false));

    const unsubUsers = onSnapshot(uQ, (snap) => {
      setLeaderboard(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, () => { /* leaderboard is optional */ });

    return () => {
      safeUnsubscribe(unsubPosts);
      safeUnsubscribe(unsubUsers);
    };
  }, [uid]);

  // Subscribe to the people this user has blocked, so their content disappears.
  useEffect(() => {
    if (!user) { setBlockedIds(new Set()); return; }
    const unsub = onSnapshot(collection(db, `users/${user.uid}/blocks`), (snap) => {
      setBlockedIds(new Set(snap.docs.map(d => d.id)));
    });
    return () => safeUnsubscribe(unsub);
  }, [user]);

  const visiblePosts = useMemo(
    () => posts.filter(p => !blockedIds.has(p.userId)),
    [posts, blockedIds],
  );

  const handleLike = async (postId: string) => {
    if (!user) return;
    await likePost(postId, user.uid);
  };

  const handleBlock = async (post: Post) => {
    if (!user) return;
    if (!window.confirm(t("Block {name}? You won't see their posts or comments anymore.", { name: post.username }))) return;
    haptic('medium');
    await blockUser(user.uid, post.userId);
    showToast(t('Blocked {name}', { name: post.username }), 'success');
  };

  const handleSubmitReport = async (reason: string) => {
    if (!user || !reportTarget?.id) return;
    await reportContent({
      reporterId: user.uid,
      targetType: 'post',
      targetId: reportTarget.id,
      reportedUserId: reportTarget.userId,
      reason,
    });
    showToast(t('Report submitted. Thank you.'), 'success');
  };

  const handleShare = async (post: Post) => {
    haptic('light');
    const text = `${t('{name} on FitFlow:', { name: post.username })}\n${post.content || ''}`.trim();
    const url = typeof window !== 'undefined' ? window.location.origin : 'https://gen-lang-client-0893216108.web.app';
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try { await (navigator as any).share({ title: t('FitFlow post'), text, url }); return; }
      catch { /* user cancelled — fall through */ }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      showToast(t('Post copied to clipboard'), 'success');
    } catch {
      showToast(t('Could not share'), 'error');
    }
  };

  return (
    <div className="pb-24 pt-4 bg-bg min-h-screen">
      <header className="px-4 space-y-4 mb-5">
        <div className="flex justify-between items-center pt-2">
          <div>
            <p className="text-eyebrow text-accent">{t('Community')}</p>
            <h1 className="font-display text-3xl font-bold text-white tracking-tight leading-tight mt-1">{t('Feed')}</h1>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setIsPostModalOpen(true)}
            className="w-11 h-11 bg-accent text-bg rounded-2xl flex items-center justify-center shadow-[0_12px_32px_-8px_rgba(198,255,61,0.5)]"
            aria-label={t('New post')}
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
              {tab === 'Feed' ? t('Feed') : t('Leaderboard')}
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
              <div className="p-10">
                <LoadingBar label={t('Loading feed')} />
              </div>
            ) : visiblePosts.length > 0 ? (
              visiblePosts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onLike={() => handleLike(post.id!)}
                  onEdit={() => setEditingPost(post)}
                  onComment={() => setCommentingPost(post)}
                  onShare={() => handleShare(post)}
                  onReport={() => setReportTarget(post)}
                  onBlock={() => handleBlock(post)}
                  isOwnPost={user?.uid === post.userId}
                />
              ))
            ) : (
              <div className="text-center p-12 space-y-3">
                <div className="text-4xl opacity-70">🌵</div>
                <p className="text-text-dim text-sm">{t('Feed is empty. Be the first to post.')}</p>
                <button onClick={() => setIsPostModalOpen(true)} className="btn-primary mt-2 px-4 py-2 text-xs">
                  {t('Create post')}
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
                    <p className="num text-xs text-text-dim mt-0.5">🔥 {t('{n} day streak', { n: u.streak || 0 })}</p>
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
      <ReportModal
        isOpen={!!reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmit={handleSubmitReport}
        targetLabel={reportTarget ? t("{name}'s post", { name: reportTarget.username }) : undefined}
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
  onReport: () => void,
  onBlock: () => void,
  isOwnPost: boolean
}> = ({ post, onLike, onEdit, onComment, onShare, onReport, onBlock, isOwnPost }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  return (
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
             {post.createdAt?.toDate ? post.createdAt.toDate().toLocaleDateString() : t('Just now')}
          </span>
        </div>
      </div>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => isOwnPost ? onEdit() : setMenuOpen(o => !o)}
          className="w-9 h-9 rounded-xl text-text-dim hover:text-white transition-colors flex items-center justify-center"
          aria-label={t('More options')}
        >
          <MoreHorizontal size={18} />
        </button>
        {!isOwnPost && menuOpen && (
          <div className="absolute right-0 top-10 z-20 w-44 bg-surface-2 border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden py-1">
            <button
              onClick={() => { setMenuOpen(false); onReport(); }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-white hover:bg-white/[0.05] transition-colors"
            >
              <Flag size={15} className="text-accent-2" /> {t('Report post')}
            </button>
            <button
              onClick={() => { setMenuOpen(false); onBlock(); }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-white hover:bg-white/[0.05] transition-colors"
            >
              <Ban size={15} className="text-accent-2" /> {t('Block {name}', { name: post.username })}
            </button>
          </div>
        )}
      </div>
    </div>

    {post.mediaUrl && (
      <div className="aspect-video w-full bg-surface">
        <img src={post.mediaUrl} className="w-full h-full object-cover" alt={t('Post content')} />
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
        <button onClick={onShare} className="text-text-dim hover:text-white transition-colors ml-auto" aria-label={t('Share')}>
          <Share2 size={18} />
        </button>
      </div>
    </div>
  </motion.div>
  );
};
