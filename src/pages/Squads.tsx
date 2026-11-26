import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Users, Plus, KeyRound, Share2, Crown, Pencil, LogOut, X, Loader2, Check } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { cn } from '../lib/utils';
import { safeUnsubscribe } from '../lib/firestore';
import { Avatar } from '../components/Avatar';
import {
  GOAL_LIMITS, METRIC_LABEL, SQUAD_MAX_MEMBERS, SQUAD_METRICS, SquadMetric,
  formatResetIn, normalizeCode, progressPct, rankMembers, sanitizeGoal, sanitizeSquadName, squadTotal, weekRange,
} from '../lib/squadUtils';
import {
  Squad, SquadWeek, createSquad, joinSquad, leaveSquad, publishMyWeek, removeMember, renameSquad,
  setChallenge, squadErrorMessage, watchMySquads, watchSquad, watchWeek,
} from '../services/squadService';

const fmt = (n: number) => n.toLocaleString();

/** A confirmation sheet. Destructive actions never happen on one tap. */
const Confirm: React.FC<{
  title: string; body: string; action: string; busy: boolean; onCancel: () => void; onConfirm: () => void;
}> = ({ title, body, action, busy, onCancel, onConfirm }) => (
  <div className="fixed inset-0 z-[80] bg-black/70 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="glass w-full max-w-sm p-5 space-y-4">
      <div>
        <h3 className="font-display text-lg font-bold text-white">{title}</h3>
        <p className="text-sm text-text-dim mt-1 break-words">{body}</p>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} disabled={busy} className="flex-1 h-11 rounded-xl bg-surface border border-white/[0.08] text-sm font-semibold text-white">Cancel</button>
        <button onClick={onConfirm} disabled={busy} className="flex-1 h-11 rounded-xl bg-red-500/90 text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60">
          {busy && <Loader2 size={14} className="animate-spin" />}{action}
        </button>
      </div>
    </div>
  </div>
);

const MetricChips: React.FC<{ value: SquadMetric; onChange: (m: SquadMetric) => void }> = ({ value, onChange }) => (
  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Weekly metric">
    {SQUAD_METRICS.map((m) => (
      <button key={m} type="button" role="radio" aria-checked={value === m} onClick={() => onChange(m)}
        className={cn('h-10 rounded-xl text-xs font-semibold border transition-all px-1 truncate',
          value === m ? 'bg-accent text-bg border-accent' : 'bg-surface text-text-dim border-white/[0.06]')}>
        {METRIC_LABEL[m]}
      </button>
    ))}
  </div>
);

// ── List: my squads + create + join ─────────────────────────────────────────
const SquadList: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [squads, setSquads] = useState<Squad[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'none' | 'create' | 'join'>('none');
  const [name, setName] = useState('');
  const [metric, setMetric] = useState<SquadMetric>('steps');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!profile?.uid) return;
    setError(null);
    const unsub = watchMySquads(profile.uid, setSquads, () => setError("Couldn't load your squads."));
    return () => safeUnsubscribe(unsub);
  }, [profile?.uid, retry]);

  const cleanName = sanitizeSquadName(name);
  const cleanCode = normalizeCode(code);

  const onCreate = async () => {
    if (!cleanName || busy) return;
    setBusy(true);
    try {
      const r = await createSquad({ name: cleanName, metric });
      showToast('Squad created. Share the code!', 'success');
      navigate(`/squads/${r.squadId}`);
    } catch (e) {
      showToast(squadErrorMessage(e), 'error');
    } finally { setBusy(false); }
  };
  const onJoin = async () => {
    if (!cleanCode || busy) return;
    setBusy(true);
    try {
      const r = await joinSquad(cleanCode);
      showToast(r.already ? `You're already in ${r.name}` : `Joined ${r.name}`, 'success');
      navigate(`/squads/${r.squadId}`);
    } catch (e) {
      showToast(squadErrorMessage(e), 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="pb-28 pt-4 px-4 bg-bg min-h-screen overflow-x-hidden">
      <header className="flex items-center gap-3 mb-5 pt-2">
        <button onClick={() => navigate('/challenges')} className="w-10 h-10 shrink-0 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white" aria-label="Back"><ChevronLeft size={18} /></button>
        <div className="min-w-0">
          <p className="text-eyebrow text-accent">Compete with friends</p>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight leading-tight">Squads</h1>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <button onClick={() => setMode(mode === 'create' ? 'none' : 'create')} aria-expanded={mode === 'create'}
          className={cn('h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 border', mode === 'create' ? 'bg-accent text-bg border-accent' : 'glass text-white border-white/[0.06]')}>
          <Plus size={16} /> Create squad
        </button>
        <button onClick={() => setMode(mode === 'join' ? 'none' : 'join')} aria-expanded={mode === 'join'}
          className={cn('h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 border', mode === 'join' ? 'bg-accent text-bg border-accent' : 'glass text-white border-white/[0.06]')}>
          <KeyRound size={16} /> Join with code
        </button>
      </div>

      {mode === 'create' && (
        <form className="glass p-4 space-y-3 mb-4" onSubmit={(e) => { e.preventDefault(); void onCreate(); }}>
          <label className="block">
            <span className="text-xs text-text-dim">Squad name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Squad name"
              className="mt-1 w-full h-11 rounded-xl bg-surface border border-white/[0.08] px-3 text-white text-sm outline-none focus:border-accent" />
          </label>
          {name.trim() && !cleanName && <p className="text-xs text-red-400">2–30 characters.</p>}
          <div>
            <span className="text-xs text-text-dim">Weekly challenge</span>
            <div className="mt-1"><MetricChips value={metric} onChange={setMetric} /></div>
          </div>
          <button type="submit" disabled={!cleanName || busy} className="btn-3d w-full h-12 flex items-center justify-center gap-2 disabled:opacity-50">
            {busy && <Loader2 size={16} className="animate-spin" />} Create
          </button>
        </form>
      )}

      {mode === 'join' && (
        <form className="glass p-4 space-y-3 mb-4" onSubmit={(e) => { e.preventDefault(); void onJoin(); }}>
          <label className="block">
            <span className="text-xs text-text-dim">Invite code from a friend</span>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={9} placeholder="Invite code"
              autoCapitalize="characters" autoComplete="off" spellCheck={false}
              className="mt-1 w-full h-11 rounded-xl bg-surface border border-white/[0.08] px-3 text-white text-lg tracking-[0.3em] font-mono outline-none focus:border-accent" />
          </label>
          <button type="submit" disabled={!cleanCode || busy} className="btn-3d w-full h-12 flex items-center justify-center gap-2 disabled:opacity-50">
            {busy && <Loader2 size={16} className="animate-spin" />} Join
          </button>
        </form>
      )}

      {error ? (
        <div className="glass p-6 text-center space-y-3">
          <p className="text-sm text-text-dim">{error}</p>
          <button onClick={() => setRetry((n) => n + 1)} className="text-sm font-semibold text-accent">Try again</button>
        </div>
      ) : squads === null ? (
        <div className="space-y-3" aria-label="Loading squads">
          {[0, 1].map((i) => <div key={i} className="glass h-20 shimmer" />)}
        </div>
      ) : squads.length === 0 ? (
        <div className="glass p-6 text-center space-y-2">
          <Users className="mx-auto text-accent" size={28} />
          <p className="text-sm font-semibold text-white">No squads yet</p>
          <p className="text-xs text-text-dim">Start one and share the code, or join a friend's. Up to {SQUAD_MAX_MEMBERS} people, a fresh challenge every Monday.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {squads.map((s) => (
            <button key={s.id} onClick={() => navigate(`/squads/${s.id}`)} aria-label={`Open ${s.name}`}
              className="glass w-full p-4 flex items-center justify-between gap-3 text-left">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{s.name}</p>
                <p className="text-xs text-text-dim mt-0.5">{s.memberIds.length} member{s.memberIds.length === 1 ? '' : 's'} · {METRIC_LABEL[s.metric]}</p>
              </div>
              {s.ownerId === profile?.uid && <Crown size={16} className="text-accent shrink-0" aria-label="You own this squad" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Detail: leaderboard, code, owner tools ──────────────────────────────────
const SquadDetail: React.FC<{ squadId: string }> = ({ squadId }) => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const uid = profile?.uid;
  const [squad, setSquad] = useState<Squad | null | undefined>(undefined);
  const [weeks, setWeeks] = useState<SquadWeek[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [confirm, setConfirm] = useState<null | { kind: 'leave' } | { kind: 'remove'; uid: string; name: string }>(null);
  const [busy, setBusy] = useState(false);
  // Leaving revokes read access to this squad. Its listeners are closed FIRST:
  // a listener denied mid-flight tripped a Firestore SDK internal assertion
  // (ca9) and the page never got back to the squad list.
  const [leaving, setLeaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState(false);
  const [metric, setMetric] = useState<SquadMetric>('steps');
  const [goal, setGoal] = useState('');

  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(t); }, []);

  useEffect(() => {
    if (leaving) return;
    const unsub = watchSquad(squadId, setSquad, () => setError("This squad isn't available. You may have left it."));
    return () => safeUnsubscribe(unsub);
  }, [squadId, leaving]);

  const tz = squad?.tz;
  const range = useMemo(() => (tz ? weekRange(now, tz) : null), [tz, now]);
  const weekKey = range?.key;

  useEffect(() => {
    if (!weekKey || !squad?.id || leaving) return;
    const unsub = watchWeek(squad.id, weekKey, setWeeks, () => setError("Couldn't load this week's numbers."));
    return () => safeUnsubscribe(unsub);
  }, [squad?.id, weekKey, leaving]);

  // Publish my own numbers as soon as the board opens.
  useEffect(() => {
    if (!uid || !squad?.id || !tz) return;
    publishMyWeek(uid, { id: squad.id, tz }).catch(() => { /* the board still shows everyone else */ });
  }, [uid, squad?.id, tz]);

  if (error || squad === null) {
    return (
      <div className="pb-28 pt-4 px-4 bg-bg min-h-screen">
        <button onClick={() => navigate('/squads')} className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim mb-5" aria-label="Back"><ChevronLeft size={18} /></button>
        <div className="glass p-6 text-center text-sm text-text-dim">{error || "This squad no longer exists."}</div>
      </div>
    );
  }
  if (squad === undefined) {
    return (
      <div className="pb-28 pt-4 px-4 bg-bg min-h-screen space-y-3" aria-label="Loading squad">
        <div className="glass h-16 shimmer" /><div className="glass h-32 shimmer" /><div className="glass h-48 shimmer" />
      </div>
    );
  }

  const isOwner = squad.ownerId === uid;
  const byUid = new Map((weeks || []).map((w) => [w.uid, w]));
  const ranked = rankMembers(squad.memberIds.map((m) => ({
    uid: m, name: squad.members[m]?.name || 'Athlete', value: Number(byUid.get(m)?.[squad.metric]) || 0,
  })));
  const total = squadTotal(ranked);
  const pct = progressPct(total, squad.goal);

  const share = async () => {
    const text = `Join my FitFlow squad "${squad.name}" with code ${squad.code}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'FitFlow squad', text }); return; }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
    }
    try { await navigator.clipboard.writeText(squad.code); showToast('Code copied', 'success'); }
    catch { showToast(`Your code is ${squad.code}`, 'info'); }
  };

  const run = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true);
    try { await fn(); showToast(ok, 'success'); after?.(); }
    catch (e) { showToast(squadErrorMessage(e), 'error'); }
    finally { setBusy(false); setConfirm(null); }
  };

  const cleanNew = sanitizeSquadName(newName);
  const cleanGoal = sanitizeGoal(metric, goal);

  return (
    <div className="pb-28 pt-4 px-4 bg-bg min-h-screen overflow-x-hidden">
      <header className="flex items-center gap-3 mb-5 pt-2">
        <button onClick={() => navigate('/squads')} className="w-10 h-10 shrink-0 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white" aria-label="Back"><ChevronLeft size={18} /></button>
        {renaming ? (
          <form className="flex-1 flex gap-2 min-w-0" onSubmit={(e) => { e.preventDefault(); if (cleanNew) void run(() => renameSquad(squad.id, cleanNew), 'Renamed', () => setRenaming(false)); }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} aria-label="New squad name" autoFocus
              className="flex-1 min-w-0 h-10 rounded-xl bg-surface border border-white/[0.08] px-3 text-white text-sm outline-none focus:border-accent" />
            <button type="submit" disabled={!cleanNew || busy} className="w-10 h-10 shrink-0 rounded-xl bg-accent text-bg flex items-center justify-center disabled:opacity-50" aria-label="Save name"><Check size={16} /></button>
            <button type="button" onClick={() => setRenaming(false)} className="w-10 h-10 shrink-0 glass rounded-xl flex items-center justify-center text-text-dim" aria-label="Cancel rename"><X size={16} /></button>
          </form>
        ) : (
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <div className="min-w-0">
              <p className="text-eyebrow text-accent">Squad · {squad.memberIds.length}/{SQUAD_MAX_MEMBERS}</p>
              <h1 className="font-display text-2xl font-bold text-white tracking-tight leading-tight truncate">{squad.name}</h1>
            </div>
            {isOwner && (
              <button onClick={() => { setNewName(squad.name); setRenaming(true); }} className="w-9 h-9 shrink-0 glass rounded-xl flex items-center justify-center text-text-dim" aria-label="Rename squad"><Pencil size={14} /></button>
            )}
          </div>
        )}
      </header>

      <div className="glass p-4 mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-text-dim">Invite code</p>
          <p className="font-mono text-2xl font-bold tracking-[0.25em] text-white" data-testid="squad-code">{squad.code}</p>
        </div>
        <button onClick={() => void share()} className="h-11 px-4 shrink-0 rounded-xl bg-accent text-bg text-sm font-semibold flex items-center gap-2" aria-label="Share invite code">
          <Share2 size={16} /> Share
        </button>
      </div>

      <div className="glass p-4 mb-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-text-dim">This week · {METRIC_LABEL[squad.metric]}</p>
            <p className="num text-white text-lg font-bold"><span data-testid="squad-total">{fmt(total)}</span> <span className="text-text-dim text-sm font-medium">/ {fmt(squad.goal)}</span></p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-text-dim">Resets in</p>
            <p className="num text-sm text-white font-semibold">{range ? formatResetIn(range.end.getTime() - now.getTime()) : '—'}</p>
          </div>
        </div>
        <div className="h-2.5 rounded-full bg-white/[0.06] overflow-hidden" role="progressbar" aria-label="Squad goal progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-text-dim">{pct >= 100 ? 'Goal smashed. Keep going!' : `${pct}% of the squad goal`}</p>
        {isOwner && !editing && (
          <button onClick={() => { setMetric(squad.metric); setGoal(String(squad.goal)); setEditing(true); }} className="text-xs font-semibold text-accent">Change challenge</button>
        )}
        {isOwner && editing && (
          <form className="space-y-2 pt-1" onSubmit={(e) => { e.preventDefault(); if (cleanGoal) void run(() => setChallenge(squad.id, metric, cleanGoal), 'Challenge updated', () => setEditing(false)); }}>
            <MetricChips value={metric} onChange={(m) => { setMetric(m); setGoal(String(GOAL_LIMITS[m].def)); }} />
            <label className="block">
              <span className="text-xs text-text-dim">Squad goal ({fmt(GOAL_LIMITS[metric].min)}–{fmt(GOAL_LIMITS[metric].max)})</span>
              <input value={goal} onChange={(e) => setGoal(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" aria-label="Squad goal"
                className="mt-1 w-full h-10 rounded-xl bg-surface border border-white/[0.08] px-3 text-white text-sm outline-none focus:border-accent" />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(false)} className="flex-1 h-10 rounded-xl bg-surface border border-white/[0.08] text-sm text-white">Cancel</button>
              <button type="submit" disabled={!cleanGoal || busy} className="flex-1 h-10 rounded-xl bg-accent text-bg text-sm font-semibold disabled:opacity-50">Save</button>
            </div>
          </form>
        )}
      </div>

      <h3 className="font-display text-lg font-bold text-white tracking-tight px-1 mb-2">Leaderboard</h3>
      <div className="glass p-3 space-y-1 mb-6" aria-label="Squad leaderboard">
        {weeks === null ? (
          [0, 1, 2].map((i) => <div key={i} className="h-11 rounded-xl bg-white/[0.04] shimmer" />)
        ) : (
          ranked.map((r) => {
            const me = r.uid === uid;
            const m = squad.members[r.uid];
            return (
              <div key={r.uid} data-testid="squad-row" data-uid={r.uid}
                className={cn('flex items-center justify-between gap-2 rounded-xl px-2 py-2', me && 'bg-accent/8 border border-accent/20')}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={cn('num text-sm font-semibold w-6 shrink-0 text-center', r.rank === 1 ? 'text-accent' : 'text-text-dim')}>
                    {r.rank}{r.tied ? '=' : ''}
                  </span>
                  <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-surface"><Avatar src={m?.photoURL} name={r.name} size={32} /></div>
                  <p className="text-sm font-medium text-white truncate min-w-0">
                    {r.name}
                    {me && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-accent font-bold">you</span>}
                    {r.uid === squad.ownerId && <Crown size={11} className="inline ml-1 text-accent" aria-label="owner" />}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="num text-sm text-white font-semibold" data-testid="squad-value">{fmt(r.value)}</span>
                  {isOwner && !me && (
                    <button onClick={() => setConfirm({ kind: 'remove', uid: r.uid, name: r.name })} aria-label={`Remove ${r.name}`}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-text-dim hover:text-red-400"><X size={14} /></button>
                  )}
                </div>
              </div>
            );
          })
        )}
        {weeks !== null && squad.memberIds.length < 2 && (
          <p className="text-xs text-text-dim text-center py-2">Share the code. A squad needs at least 2 people to compete.</p>
        )}
      </div>

      <button onClick={() => setConfirm({ kind: 'leave' })} className="w-full h-11 rounded-xl border border-red-500/30 text-red-400 text-sm font-semibold flex items-center justify-center gap-2">
        <LogOut size={15} /> Leave squad
      </button>

      {confirm?.kind === 'leave' && (
        <Confirm title="Leave squad?" busy={busy} action="Leave"
          body={squad.memberIds.length === 1 ? 'You are the last member, so the squad will be deleted.'
            : isOwner ? 'Ownership passes to the longest-standing member. Your numbers leave with you.' : 'Your numbers leave with you. You can rejoin with the code.'}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setLeaving(true); // closes the listeners (effect cleanup) before access is revoked
            void run(
              () => new Promise((r) => setTimeout(r, 0)).then(() => leaveSquad(squad.id)).catch((e) => { setLeaving(false); throw e; }),
              'You left the squad',
              () => navigate('/squads', { replace: true }),
            );
          }} />
      )}
      {confirm?.kind === 'remove' && (
        <Confirm title={`Remove ${confirm.name}?`} busy={busy} action="Remove"
          body="They leave the squad and their numbers are removed. They could rejoin later if someone shares the code with them again."
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run(() => removeMember(squad.id, confirm.uid), `${confirm.name} removed`)} />
      )}
    </div>
  );
};

export const Squads: React.FC = () => {
  const { squadId } = useParams();
  return squadId ? <SquadDetail key={squadId} squadId={squadId} /> : <SquadList />;
};
