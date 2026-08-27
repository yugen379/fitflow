/**
 * Durable queue for writes that could not reach Firestore.
 *
 * This existed but never actually delivered anything, in two compounding ways —
 * both of which lost user data permanently and silently:
 *
 *   1. **It only replayed on the `online` event.** A write that failed while the
 *      device was ONLINE (a transient error, a rules rejection, a stalled
 *      Firestore cache) queued and then sat there forever, because `online`
 *      never fires if you never went offline. A user's workout was queued and
 *      never seen again.
 *
 *   2. **The replay deleted what it failed to send.** It retried through
 *      `logWorkout`, which re-queues on failure — and then the loop overwrote
 *      the whole stored queue with its own `remaining` list, discarding the item
 *      the retry had just put back. A failed retry destroyed the record.
 *
 * Now: replay runs on startup, on reconnect and when the tab is brought forward;
 * retries go through the direct write path so nothing re-queues underneath us;
 * and anything that fails stays in the queue with an attempt count.
 */

import { get, set } from 'idb-keyval';

import { logMeal, logWorkout } from './dataService';

const OFFLINE_QUEUE_KEY = 'offline_sync_queue';

/**
 * Give up after this many failures.
 *
 * A permanently invalid record (one the rules will never accept) must not be
 * retried forever on every launch, but the ceiling is high enough that a run of
 * transient failures cannot discard real data.
 */
const MAX_ATTEMPTS = 25;

export interface OfflineAction {
  type: 'logMeal' | 'logWorkout';
  payload: any;
  userId: string;
  /** Epoch ms the action was first queued. */
  queuedAt?: number;
  /** How many delivery attempts have failed. */
  attempts?: number;
}

const readQueue = async (): Promise<OfflineAction[]> => {
  try {
    return (await get<OfflineAction[]>(OFFLINE_QUEUE_KEY)) || [];
  } catch {
    // No IndexedDB (private mode, blocked storage). Nothing to replay.
    return [];
  }
};

const writeQueue = async (queue: OfflineAction[]): Promise<void> => {
  try {
    await set(OFFLINE_QUEUE_KEY, queue);
  } catch {
    // If we cannot persist the queue there is nothing better to do; the items
    // already delivered are safe on the server.
  }
};

/**
 * Serialises every read-modify-write of the queue.
 *
 * Two `addToOfflineQueue` calls that overlap — a user logging a meal and a
 * workout in quick succession while offline, or a log landing while the replay
 * below is mid-flight — both read the same array, both push their own item, and
 * the second write clobbers the first. One of the two records is gone, silently,
 * with no error anywhere. Every mutation now queues behind the previous one.
 */
let mutationChain: Promise<unknown> = Promise.resolve();

const mutate = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = mutationChain.then(fn, fn);
  // Keep the chain alive even if this link rejects, or one failure would wedge
  // every future queue operation.
  mutationChain = next.catch(() => {});
  return next;
};

export const addToOfflineQueue = async (action: OfflineAction) =>
  mutate(async () => {
    const queue = await readQueue();
    queue.push({ ...action, queuedAt: action.queuedAt ?? Date.now(), attempts: action.attempts ?? 0 });
    await writeQueue(queue);
  });

/** How many writes are still waiting, for the UI to be honest about it. */
export const pendingOfflineCount = async (): Promise<number> => (await readQueue()).length;

let syncing = false;

export const syncOfflineQueue = async (): Promise<{ sent: number; failed: number }> => {
  // Re-entrancy guard: startup, `online` and `visibilitychange` can all fire at
  // once, and two replays racing would deliver duplicates.
  //
  // The flag MUST be claimed synchronously, before the first `await`. It used to
  // be set after `await readQueue()`, so two callers both read `syncing === false`,
  // both suspended on the same await, and both replayed the SAME queue — every
  // item delivered twice. A duplicated meal or workout is worse than a delayed
  // one, and this is the exact failure the guard was written to stop.
  if (syncing) return { sent: 0, failed: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { sent: 0, failed: 0 };
  syncing = true;

  const remaining: OfflineAction[] = [];
  let sent = 0;
  let queue: OfflineAction[] = [];

  try {
    queue = await readQueue();
    if (queue.length === 0) return { sent: 0, failed: 0 };
    // Captured as a NUMBER, now, rather than read off `queue` after the replay.
    // IndexedDB structured-clones on read so `queue` is our own copy, but the
    // correctness of the merge below must not rest on the storage layer's copy
    // semantics — an in-memory or mocked backing store that hands back a live
    // reference would see this length grow under us and silently drop every
    // item queued during the replay.
    const snapshotLength = queue.length;
    for (const action of queue) {
      try {
        // `queueOnFailure: false` — the retry must THROW rather than quietly
        // re-queueing the item we are already holding.
        if (action.type === 'logMeal') {
          await logMeal(action.userId, action.payload, { queueOnFailure: false });
        } else if (action.type === 'logWorkout') {
          await logWorkout(action.userId, action.payload, { queueOnFailure: false });
        }
        sent += 1;
      } catch (error) {
        const attempts = (action.attempts ?? 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          console.error('Dropping offline action after repeated failures:', action, error);
        } else {
          // KEPT, not dropped. This is the line whose absence lost data.
          remaining.push({ ...action, attempts });
        }
      }
    }
    // Re-read before overwriting. A failed write that queued WHILE this replay
    // was in flight is sitting in storage right now, appended after the snapshot
    // we started from — and blindly writing `remaining` would delete it. The
    // queue is append-only apart from this function, so everything past the
    // snapshot length is new and must be preserved.
    await mutate(async () => {
      const latest = await readQueue();
      await writeQueue([...remaining, ...latest.slice(snapshotLength)]);
    });
  } finally {
    syncing = false;
  }

  return { sent, failed: remaining.length };
};

/**
 * Wire the replay triggers. Called once from the app entry.
 *
 * Startup is the important one: a queue built up in a previous session used to
 * need an offline→online transition to ever be delivered, which for most users
 * never came.
 */
let wired = false;

export const startOfflineSync = (): void => {
  if (typeof window === 'undefined') return;
  // Idempotent. The doc comment says "called once from the app entry", but the
  // actual caller is a ProtectedRoute effect — and there is one ProtectedRoute
  // per route, so every navigation mounted a fresh one and added another pair of
  // listeners that nothing ever removed. Replay is still triggered on each call.
  void syncOfflineQueue();
  if (wired) return;
  wired = true;
  window.addEventListener('online', () => void syncOfflineQueue());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncOfflineQueue();
  });
};
