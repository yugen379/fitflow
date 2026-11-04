/**
 * Account deletion — the server-side cascade behind Settings → Delete account.
 *
 * Two bugs made this a deletion that never happened (fixed in v1.6.2):
 *
 * 1. It was written as a v1 callable, `(data, context) => context.auth`. The
 *    root `firebase-functions` import is v2 since v6, which calls handlers as
 *    `(request, response)`. `context` was the streaming response proxy, which
 *    has no `.auth`, so EVERY caller got "unauthenticated". The app read that
 *    as "sign in again", signed the user out and stopped — on every attempt.
 *
 * 2. Even with auth working it left data behind: step history (step_days) was
 *    not in the list; comments and likes live under posts/{id}/… but were
 *    searched for in a top-level collection that does not exist; and the
 *    weekly-recap range was `>= uid_` AND `< uid_`, which matches nothing.
 */
import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { DocumentReference, FieldPath } from "firebase-admin/firestore";
import { db } from "./db";

/** Top-level collections whose documents carry the owner in `userId`. */
export const USER_COLLECTIONS = [
  "meals", "workouts", "water_logs", "sleep_logs", "wellness_logs",
  "weight_history", "body_metrics", "activity_routes", "notifications",
  "activity_days", "streak_freezes", "workout_plans", "step_days",
];

const deleteRefs = async (refs: DocumentReference[]) => {
  // Firestore batches cap at 500 writes.
  for (let i = 0; i < refs.length; i += 450) {
    const batch = db.batch();
    refs.slice(i, i + 450).forEach((r) => batch.delete(r));
    await batch.commit();
  }
};

/**
 * Remove a reply/like from someone else's post and keep that post's counter
 * honest. Counters never go below zero.
 */
const removeFromPost = async (
  ref: DocumentReference,
  counter: "commentsCount" | "likesCount",
) => {
  const postRef = ref.parent.parent;
  await db.runTransaction(async (tx) => {
    const post = postRef ? await tx.get(postRef) : null;
    if (post?.exists) {
      const n = Number(post.data()?.[counter]) || 0;
      tx.update(postRef!, { [counter]: Math.max(0, n - 1) });
    }
    tx.delete(ref);
  });
};

/** Erase everything FitFlow stores about `uid`. Idempotent. */
export const deleteUserData = async (uid: string): Promise<void> => {
  for (const c of USER_COLLECTIONS) {
    const snap = await db.collection(c).where("userId", "==", uid).get();
    if (!snap.empty) await deleteRefs(snap.docs.map((d) => d.ref));
  }

  // The user's own posts, WITH everyone's comments and likes under them.
  const posts = await db.collection("posts").where("userId", "==", uid).get();
  for (const p of posts.docs) await db.recursiveDelete(p.ref);

  // The user's comments and likes on other people's posts.
  const comments = await db.collectionGroup("comments").where("userId", "==", uid).get();
  for (const c of comments.docs) await removeFromPost(c.ref, "commentsCount");
  const likes = await db.collectionGroup("likes").where("userId", "==", uid).get();
  for (const l of likes.docs) await removeFromPost(l.ref, "likesCount");

  // Follow edges stored on the OTHER side. The user's own following/followers
  // lists go with the recursive delete of their user doc below.
  const userRef = db.doc(`users/${uid}`);
  const [following, followers] = await Promise.all([
    userRef.collection("following").get(),
    userRef.collection("followers").get(),
  ]);
  await deleteRefs([
    ...following.docs.map((d) => db.doc(`users/${d.id}/followers/${uid}`)),
    ...followers.docs.map((d) => db.doc(`users/${d.id}/following/${uid}`)),
  ]);

  // Docs keyed by uid rather than a userId field.
  await db.doc(`meal_plans/${uid}`).delete();
  const recaps = await db.collection("weekly_recaps")
    .where(FieldPath.documentId(), ">=", `${uid}_`)
    .where(FieldPath.documentId(), "<=", `${uid}_`) // upper bound is "<uid>_" + U+F8FF: every id starting "<uid>_"
    .get();
  if (!recaps.empty) await deleteRefs(recaps.docs.map((d) => d.ref));

  // The user doc and every subcollection (progression, blocks, following,
  // followers, xp_awards, xp_days). The public mirror is removed explicitly
  // rather than left to the syncPublicProfile trigger.
  await db.recursiveDelete(userRef);
  await db.doc(`public_profiles/${uid}`).delete();
};

export const deleteAccount = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required");
  try {
    await deleteUserData(uid);
  } catch (err) {
    console.error("deleteAccount: data cascade failed for", uid, err);
    // Keep the sign-in so the user can retry; the cascade is idempotent.
    throw new HttpsError("internal", "Could not delete all data — please try again");
  }
  try {
    await admin.auth().deleteUser(uid);
  } catch (err: any) {
    if (err?.code !== "auth/user-not-found") {
      console.error("deleteAccount: auth delete failed for", uid, err);
      throw new HttpsError("internal", "Data deleted, but the sign-in could not be removed — please try again");
    }
  }
  return { deleted: true };
});
