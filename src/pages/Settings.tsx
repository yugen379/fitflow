import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft, Globe, Ruler, Bell, Shield, FileText, Download, Trash2,
  LogOut, ChevronRight, X, Loader2, Mail, Camera, Mic, Check, Sparkles, Crown,
} from 'lucide-react';
import { PermissionsPrompt } from '../components/PermissionsPrompt';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { allFeaturesFree, getEntitlement } from '../lib/billing';
import { openBillingPortal, isPortalConfigured } from '../services/stripeService';
import { db, auth, requestNotificationPermission } from '../lib/firebase';
import {
  doc, updateDoc, deleteDoc, serverTimestamp,
  collection, query, where, getDocs, writeBatch,
} from 'firebase/firestore';
import { deleteUser } from 'firebase/auth';
import { cn } from '../lib/utils';

const TZ_OFFSET_HOURS = -new Date().getTimezoneOffset() / 60;

export const Settings: React.FC = () => {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const { showToast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [camStatus, setCamStatus] = useState<'idle' | 'granted' | 'denied' | 'checking'>('idle');
  const [micStatus, setMicStatus] = useState<'idle' | 'granted' | 'denied' | 'checking'>('idle');
  const [permsPromptOpen, setPermsPromptOpen] = useState(false);
  const [managingBilling, setManagingBilling] = useState(false);

  const ent = getEntitlement(profile);
  const billingLabel = allFeaturesFree()
    ? 'FitFlow Pro · free during launch'
    : ent.source === 'paid'
      ? `Pro · ${ent.plan === 'yearly' ? 'Yearly' : 'Monthly'}${ent.cancelAtPeriodEnd ? ' · cancels at period end' : ''}`
      : ent.source === 'trial'
        ? `Free trial · ${ent.trialDaysLeft} ${ent.trialDaysLeft === 1 ? 'day' : 'days'} left`
        : ent.status === 'expired'
          ? 'Trial ended · subscribe to unlock Pro'
          : 'Free plan';

  const manageBilling = async () => {
    if (ent.source !== 'paid') { navigate('/pro'); return; }
    if (!isPortalConfigured()) { showToast('Subscription management is being set up.', 'info'); return; }
    setManagingBilling(true);
    const result = await openBillingPortal();
    setManagingBilling(false);
    if (!result.ok) showToast(result.reason || 'Could not open billing portal', 'error');
  };

  const testCamera = async () => {
    setCamStatus('checking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      stream.getTracks().forEach(t => t.stop());
      setCamStatus('granted');
      showToast('Camera works');
    } catch (e: any) {
      setCamStatus('denied');
      showToast(
        e?.name === 'NotAllowedError'
          ? 'Camera blocked — tap the site lock icon in the address bar to allow it'
          : 'Camera unavailable on this device',
        'error',
      );
    }
  };
  const testMic = async () => {
    setMicStatus('checking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setMicStatus('granted');
      showToast('Mic works');
    } catch {
      setMicStatus('denied');
      showToast('Mic blocked or unavailable', 'error');
    }
  };

  const toggleNotifications = async () => {
    if (!profile?.uid) return;
    // Already enabled → can't un-grant browser permission, so disable in-app only.
    if (profile.notificationsEnabled) {
      try {
        await updateDoc(doc(db, 'users', profile.uid), { notificationsEnabled: false, updatedAt: serverTimestamp() });
        showToast('Push notifications disabled');
      } catch { showToast('Failed to save', 'error'); }
      return;
    }
    // Not enabled → request browser permission and persist FCM token.
    if (typeof Notification === 'undefined') {
      showToast('Notifications not supported in this browser', 'info');
      return;
    }
    if (Notification.permission === 'denied') {
      showToast('Allow notifications in your browser settings, then try again.', 'info');
      return;
    }
    const token = await requestNotificationPermission(profile.uid);
    if (token) showToast('Push notifications enabled');
    else showToast('Notifications not enabled', 'info');
  };

  const setUnit = async (u: 'kg' | 'lbs') => {
    if (!profile?.uid) return;
    try {
      await updateDoc(doc(db, 'users', profile.uid), { weightUnit: u, updatedAt: serverTimestamp() });
      showToast(`Units set to ${u}`);
    } catch { showToast('Failed to save', 'error'); }
  };

  const setTzOffset = async () => {
    if (!profile?.uid) return;
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        tzOffsetHours: TZ_OFFSET_HOURS,
        tzId: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      showToast('Timezone synced');
    } catch { showToast('Failed to save', 'error'); }
  };

  const exportData = async () => {
    if (!profile?.uid) return;
    setExporting(true);
    try {
      const collectionsToExport = [
        'meals', 'workouts', 'water_logs', 'sleep_logs', 'wellness_logs',
        'weight_history', 'body_metrics', 'activity_routes', 'notifications',
      ];
      const data: Record<string, any[]> = { user: [profile] };
      for (const c of collectionsToExport) {
        try {
          const snap = await getDocs(query(collection(db, c), where('userId', '==', profile.uid)));
          data[c] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch { data[c] = []; }
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fitflow-${profile.uid}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Data exported');
    } catch {
      showToast('Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    if (!profile?.uid || !auth.currentUser) return;
    setDeleting(true);
    try {
      const collectionsToWipe = [
        'meals', 'workouts', 'water_logs', 'sleep_logs', 'wellness_logs',
        'weight_history', 'body_metrics', 'activity_routes', 'notifications',
        'posts', 'comments',
      ];
      for (const c of collectionsToWipe) {
        try {
          const snap = await getDocs(query(collection(db, c), where('userId', '==', profile.uid)));
          if (snap.empty) continue;
          const batch = writeBatch(db);
          snap.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
        } catch { /* continue */ }
      }
      try { await deleteDoc(doc(db, 'users', profile.uid)); } catch { /* permission */ }
      try { await deleteUser(auth.currentUser); } catch (e: any) {
        if (e?.code === 'auth/requires-recent-login') {
          showToast('Please sign in again, then re-try delete', 'error');
          await signOut();
          return;
        }
        throw e;
      }
      showToast('Account deleted');
      navigate('/');
    } catch {
      showToast('Delete failed. Try signing out and back in first.', 'error');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const unit = profile?.weightUnit || 'kg';

  return (
    <div className="pb-28 pt-4 px-4 min-h-screen space-y-5">
      <header className="flex items-center gap-3 pt-2">
        <button onClick={() => navigate('/profile')} className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white" aria-label="Back">
          <ChevronLeft size={18} />
        </button>
        <div>
          <p className="text-eyebrow text-accent">Settings</p>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight leading-tight">Preferences</h1>
        </div>
      </header>

      <Section title="Subscription">
        <button onClick={manageBilling} disabled={managingBilling} className="w-full text-left">
          <Row icon={Crown} label="FitFlow Pro" sub={billingLabel}>
            {managingBilling
              ? <Loader2 size={16} className="text-text-dim animate-spin" />
              : <span className="text-xs font-semibold text-accent">
                  {ent.source === 'paid' ? 'Manage' : 'View plans'}
                </span>}
          </Row>
        </button>
      </Section>

      <Section title="Nutrition">
        <button onClick={() => navigate('/nutrition-goals')} className="w-full text-left">
          <Row icon={Ruler} label="Macro targets" sub="Calories, macro split, goal-by-day scheduling">
            <ChevronRight size={16} className="text-text-dim" />
          </Row>
        </button>
      </Section>

      <Section title="Display">
        <Row icon={Ruler} label="Weight units">
          <div className="flex bg-surface rounded-xl p-1 border border-white/[0.06]">
            {(['kg', 'lbs'] as const).map(u => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all', unit === u ? 'bg-accent text-bg' : 'text-text-dim')}
              >
                {u}
              </button>
            ))}
          </div>
        </Row>
        <Row icon={Globe} label="Timezone" sub={Intl.DateTimeFormat().resolvedOptions().timeZone}>
          <button onClick={setTzOffset} className="text-xs font-semibold text-accent">Sync now</button>
        </Row>
      </Section>

      <Section title="Notifications">
        <button onClick={toggleNotifications} className="w-full text-left">
          <Row
            icon={Bell}
            label="Push notifications"
            sub={profile?.notificationsEnabled ? 'Enabled — tap to disable' : 'Disabled — tap to enable'}
          >
            <div className={cn(
              'w-11 h-6 rounded-full p-0.5 transition-colors',
              profile?.notificationsEnabled ? 'bg-accent' : 'bg-white/[0.1]',
            )}>
              <div className={cn(
                'w-5 h-5 rounded-full bg-white shadow-sm transition-transform',
                profile?.notificationsEnabled ? 'translate-x-5' : 'translate-x-0',
              )} />
            </div>
          </Row>
        </button>
      </Section>

      <Section title="Device permissions">
        <button onClick={() => setPermsPromptOpen(true)} className="w-full text-left">
          <Row icon={Sparkles} label="Allow everything" sub="One tap to grant camera, mic, and notifications in sequence">
            <span className="text-xs font-semibold text-accent">Open</span>
          </Row>
        </button>
        <button onClick={testCamera} className="w-full text-left">
          <Row
            icon={Camera}
            label="Camera"
            sub={
              camStatus === 'granted' ? 'Allowed — tap to re-test'
              : camStatus === 'denied' ? 'Blocked — see browser site settings'
              : camStatus === 'checking' ? 'Requesting…'
              : 'Used by barcode scanner, meal photos, AI form check'
            }
          >
            {camStatus === 'granted' ? <Check size={16} className="text-accent" />
              : camStatus === 'checking' ? <Loader2 className="animate-spin text-text-dim" size={16} />
              : <span className="text-xs font-semibold text-accent">{camStatus === 'denied' ? 'Retry' : 'Allow'}</span>}
          </Row>
        </button>
        <button onClick={testMic} className="w-full text-left">
          <Row
            icon={Mic}
            label="Microphone"
            sub={
              micStatus === 'granted' ? 'Allowed — tap to re-test'
              : micStatus === 'denied' ? 'Blocked — see browser site settings'
              : micStatus === 'checking' ? 'Requesting…'
              : 'Used by voice questions to AI Coach'
            }
          >
            {micStatus === 'granted' ? <Check size={16} className="text-accent" />
              : micStatus === 'checking' ? <Loader2 className="animate-spin text-text-dim" size={16} />
              : <span className="text-xs font-semibold text-accent">{micStatus === 'denied' ? 'Retry' : 'Allow'}</span>}
          </Row>
        </button>
      </Section>

      <Section title="Your data">
        <button
          onClick={exportData}
          disabled={exporting}
          className="w-full text-left disabled:opacity-50"
        >
          <Row icon={Download} label="Export my data" sub="Download everything as JSON">
            {exporting ? <Loader2 className="animate-spin text-text-dim" size={16} /> : <ChevronRight size={16} className="text-text-dim" />}
          </Row>
        </button>
        <button
          onClick={() => setConfirmDelete(true)}
          className="w-full text-left"
        >
          <Row icon={Trash2} label="Delete account" sub="Permanently remove everything" danger>
            <ChevronRight size={16} className="text-accent-2" />
          </Row>
        </button>
      </Section>

      <Section title="Legal">
        <button onClick={() => navigate('/privacy')} className="w-full text-left">
          <Row icon={Shield} label="Privacy policy">
            <ChevronRight size={16} className="text-text-dim" />
          </Row>
        </button>
        <button onClick={() => navigate('/terms')} className="w-full text-left">
          <Row icon={FileText} label="Terms of service">
            <ChevronRight size={16} className="text-text-dim" />
          </Row>
        </button>
        <a href="mailto:fitflow2000@gmail.com" className="block">
          <Row icon={Mail} label="Contact support" sub="fitflow2000@gmail.com">
            <ChevronRight size={16} className="text-text-dim" />
          </Row>
        </a>
      </Section>

      <button
        onClick={signOut}
        className="w-full glass h-12 flex items-center justify-center gap-2 text-accent-2 font-semibold"
      >
        <LogOut size={16} />
        Sign out
      </button>

      <p className="text-center text-xs text-text-mute pt-2">
        FitFlow · v1.0.0
      </p>

      <PermissionsPrompt
        open={permsPromptOpen}
        uid={profile?.uid}
        onClose={() => setPermsPromptOpen(false)}
        onComplete={(r) => {
          if (r.camera === 'granted') setCamStatus('granted');
          if (r.camera === 'denied') setCamStatus('denied');
          if (r.mic === 'granted') setMicStatus('granted');
          if (r.mic === 'denied') setMicStatus('denied');
        }}
      />

      <AnimatePresence>
        {confirmDelete && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setConfirmDelete(false)}
            />
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
              className="relative bg-surface border border-white/[0.06] rounded-3xl p-6 max-w-sm w-full space-y-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent-2/12 border border-accent-2/25 flex items-center justify-center shrink-0">
                  <Trash2 className="text-accent-2" size={18} />
                </div>
                <div>
                  <h3 className="font-display text-xl font-bold text-white">Delete your account?</h3>
                  <p className="text-sm text-text-dim mt-1 leading-relaxed">
                    This permanently removes your profile, workouts, meals, posts, and all data. Cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setConfirmDelete(false)} className="btn-ghost h-12 flex-1">Cancel</button>
                <button
                  onClick={deleteAccount}
                  disabled={deleting}
                  className="h-12 flex-1 bg-accent-2 text-white font-semibold rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="animate-spin" size={16} /> : 'Delete'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-2">
    <h3 className="text-eyebrow text-text-dim px-1">{title}</h3>
    <div className="glass overflow-hidden divide-y divide-white/[0.04]">{children}</div>
  </div>
);

const Row: React.FC<{ icon: any; label: string; sub?: string; danger?: boolean; children?: React.ReactNode }> = ({ icon: Icon, label, sub, danger, children }) => (
  <div className="flex items-center justify-between gap-3 px-4 py-3.5">
    <div className="flex items-center gap-3 min-w-0">
      <div className={cn(
        'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
        danger ? 'bg-accent-2/10 text-accent-2' : 'bg-white/[0.04] text-white/80',
      )}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className={cn('font-medium text-sm', danger ? 'text-accent-2' : 'text-white')}>{label}</p>
        {sub && <p className="text-xs text-text-dim truncate">{sub}</p>}
      </div>
    </div>
    {children}
  </div>
);
