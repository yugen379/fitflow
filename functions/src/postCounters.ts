/**
 * Like and comment totals that cannot be forged.
 *
 * Released apps change `likesCount` / `commentsCount` on a post themselves, one
 * step at a time, and the rules have to keep allowing that or likes stop
 * working on every installed copy. But a step-at-a-time rule only limits the
 * size of each write, not how many there are: any signed-in account could send
 * +1 a thousand times, or -1 until a rival's post showed nothing.
 *
 * So the numbers are no longer taken on trust. Whenever a like or comment is
 * added or removed, or a post's counters change, the real documents under the
 * post are counted and the true totals are written back. A like is one document
 * per user (the rules enforce that), so the count is the number of people.
 *
 * It settles on its own: the write-back fires the post trigger once more, that
 * run finds the totals already right, and stops.
 */
import { onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import type { CollectionReference } from "firebase-admin/firestore";
import { db, DATABASE_ID } from "./db";
import { POST_TRIGGER } from "./capacity";

// Must match the database's region: see DATABASE_REGION in index.ts.
const REGION = "asia-southeast1";
const TRIGGER = { ...POST_TRIGGER, database: DATABASE_ID, region: REGION } as const;

/** Past this many, the fallback count stops; the aggregate has no such limit. */
const FALLBACK_COUNT_LIMIT = 5000;

const countOf = async (col: CollectionReference): Promise<number> => {
  try {
    return (await col.count().get()).data().count;
  } catch (e) {
    // The emulator cannot tell us whether the Enterprise database accepts this
    // aggregate, so a refusal falls back to counting ids rather than leaving a
    // forged number in place.
    console.error("count() failed, counting documents instead", e);
    return (await col.select().limit(FALLBACK_COUNT_LIMIT).get()).size;
  }
};

/** Set a post's counters to the number of like / comment documents under it. */
export const reconcilePost = async (postId: string): Promise<"missing" | "ok" | "fixed"> => {
  const ref = db.doc(`posts/${postId}`);
  const snap = await ref.get();
  if (!snap.exists) return "missing";
  const [likes, comments] = await Promise.all([
    countOf(ref.collection("likes")),
    countOf(ref.collection("comments")),
  ]);
  const data = snap.data() as Record<string, unknown>;
  if (data.likesCount === likes && data.commentsCount === comments) return "ok";
  // update(), not set(): if the post was deleted while we counted, this fails
  // instead of bringing back a post with nothing in it but two numbers.
  await ref.update({ likesCount: likes, commentsCount: comments });
  return "fixed";
};

const run = async (postId: string): Promise<void> => {
  try {
    await reconcilePost(postId);
  } catch (e) {
    console.error("post counter reconcile failed for", postId, e);
  }
};

export const onPostLikeWritten = onDocumentWritten(
  { ...TRIGGER, document: "posts/{postId}/likes/{uid}" },
  (event) => run(event.params.postId),
);

export const onPostCommentWritten = onDocumentWritten(
  { ...TRIGGER, document: "posts/{postId}/comments/{commentId}" },
  async (event) => {
    // An edited comment changes no total.
    if (event.data?.before?.exists && event.data?.after?.exists) return;
    await run(event.params.postId);
  },
);

export const onPostCountersChanged = onDocumentUpdated(
  { ...TRIGGER, document: "posts/{postId}" },
  async (event) => {
    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const after = event.data?.after?.data() as Record<string, unknown> | undefined;
    if (!before || !after) return;
    // Editing the text of a post is not a reason to count anything.
    if (before.likesCount === after.likesCount && before.commentsCount === after.commentsCount) return;
    await run(event.params.postId);
  },
);
