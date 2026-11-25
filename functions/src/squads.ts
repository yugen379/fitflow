/**
 * Squads — private groups of 2–10 friends with a weekly challenge.
 *
 * Every change to a squad's MEMBERSHIP goes through these callables; the rules
 * refuse all client writes to squads/{id}. Why not let rules validate a
 * self-add with the right code?
 *   • A rule can only check a code it can read. Either the code sits on the
 *     squad doc (then the rule must let non-members read it — or a get() by
 *     code id must be allowed, and that is a 32^6 namespace anyone can sweep
 *     with no rate limit), or it isn't checkable at all.
 *   • Rules cannot rate-limit. A function can: 10 join attempts per user per
 *     hour, failures included, kept in Firestore so it holds across instances.
 *   • Owner hand-over (longest-standing member), deleting the squad when the
 *     last member leaves, and cleaning a leaver's weekly numbers are
 *     multi-document transactions that rules can't express safely.
 * So: membership is server-owned; members only ever write their OWN weekly
 * numbers doc, which the rules validate field by field.
 *
 * Data:
 *   squads/{id}                 name, ownerId, memberIds[], members{uid:{name,photoURL,joinedAt}},
 *                               tz, metric, goal, code, createdAt, updatedAt
 *   squads/{id}/weekly/{wk}_{uid}  written by that member (rules)
 *   squad_codes/{code}          {squadId} — server only, no client access
 *   squad_join_limits/{uid}     {times[]} — server only
 */
import { randomInt } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, DocumentReference } from "firebase-admin/firestore";
import { INTERACTIVE } from "./capacity";
import { db } from "./db";
import {
  GOAL_LIMITS, SQUADS_PER_USER, SQUAD_MAX_MEMBERS, SquadMetric,
  cleanDisplayName, cleanPhotoURL, generateCode, isSquadMetric, isValidTimeZone,
  nextOwner, normalizeCode, sanitizeGoal, sanitizeSquadName, takeAttempt,
} from "./squadCore";

type Member = { name: string; photoURL: string; joinedAt: number };
type Squad = {
  name: string; ownerId: string; memberIds: string[]; members: Record<string, Member>;
  tz: string; metric: SquadMetric; goal: number; code: string;
};

const requireUid = (request: { auth?: { uid: string } }): string => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required");
  return uid;
};

const squadIdOf = (v: unknown): string => {
  if (typeof v !== "string" || !/^[A-Za-z0-9]{10,40}$/.test(v)) {
    throw new HttpsError("invalid-argument", "Unknown squad");
  }
  return v;
};

/** Name + photo only — the rest of the profile never leaves the server. */
const memberCard = async (uid: string, now: number): Promise<Member> => {
  const pub = await db.doc(`public_profiles/${uid}`).get();
  let d = pub.exists ? pub.data() : undefined;
  if (!d) d = (await db.doc(`users/${uid}`).get()).data();
  return { name: cleanDisplayName(d?.displayName), photoURL: cleanPhotoURL(d?.photoURL), joinedAt: now };
};

const squadsOf = async (uid: string) =>
  db.collection("squads").where("memberIds", "array-contains", uid).limit(SQUADS_PER_USER + 1).get();

const deleteWeekly = async (squadRef: DocumentReference, uid?: string) => {
  const col = squadRef.collection("weekly");
  const snap = uid ? await col.where("uid", "==", uid).get() : await col.get();
  for (let i = 0; i < snap.docs.length; i += 450) {
    const b = db.batch();
    snap.docs.slice(i, i + 450).forEach((d) => b.delete(d.ref));
    await b.commit();
  }
};

// ── create ───────────────────────────────────────────────────────────────────
export const createSquad = onCall(INTERACTIVE, async (request) => {
  const uid = requireUid(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const name = sanitizeSquadName(data.name);
  if (!name) throw new HttpsError("invalid-argument", "Name must be 2–30 characters");
  const metric: SquadMetric = isSquadMetric(data.metric) ? data.metric : "steps";
  const goal = data.goal === undefined ? GOAL_LIMITS[metric].def : sanitizeGoal(metric, data.goal);
  if (goal === null) throw new HttpsError("invalid-argument", "Goal out of range");
  const tz = isValidTimeZone(data.tz) ? data.tz : "UTC";

  if ((await squadsOf(uid)).size >= SQUADS_PER_USER) {
    throw new HttpsError("failed-precondition", `You can be in at most ${SQUADS_PER_USER} squads`);
  }
  const now = Date.now();
  const me = await memberCard(uid, now);
  const ref = db.collection("squads").doc();

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateCode(randomInt);
    const codeRef = db.doc(`squad_codes/${code}`);
    const ok = await db.runTransaction(async (tx) => {
      if ((await tx.get(codeRef)).exists) return false;
      tx.create(codeRef, { squadId: ref.id, createdAt: FieldValue.serverTimestamp() });
      tx.create(ref, {
        name, ownerId: uid, memberIds: [uid], members: { [uid]: me },
        tz, metric, goal, code,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (ok) return { squadId: ref.id, code };
  }
  throw new HttpsError("unavailable", "Could not allocate a code, try again");
});

// ── join ─────────────────────────────────────────────────────────────────────
export const joinSquad = onCall(INTERACTIVE, async (request) => {
  const uid = requireUid(request);
  const now = Date.now();

  // Rate limit FIRST and count every attempt, right or wrong: that is what
  // makes guessing codes pointless (10 guesses an hour in a ~1e9 space).
  const limitRef = db.doc(`squad_join_limits/${uid}`);
  const allowed = await db.runTransaction(async (tx) => {
    const s = await tx.get(limitRef);
    const r = takeAttempt(s.data()?.times, now);
    if (r.allowed) tx.set(limitRef, { times: r.times });
    return r.allowed;
  });
  if (!allowed) throw new HttpsError("resource-exhausted", "Too many join attempts, try again later");

  const code = normalizeCode((request.data as Record<string, unknown> | null)?.code);
  if (!code) throw new HttpsError("invalid-argument", "Codes are 6 letters and numbers");
  const codeSnap = await db.doc(`squad_codes/${code}`).get();
  const squadId = codeSnap.data()?.squadId;
  if (!squadId) throw new HttpsError("not-found", "No squad has that code");

  if ((await squadsOf(uid)).size >= SQUADS_PER_USER) {
    throw new HttpsError("failed-precondition", `You can be in at most ${SQUADS_PER_USER} squads`);
  }
  const card = await memberCard(uid, now);
  const ref = db.doc(`squads/${squadId}`);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError("not-found", "No squad has that code");
    const sq = s.data() as Squad;
    if (sq.code !== code) throw new HttpsError("not-found", "No squad has that code");
    if (sq.memberIds.includes(uid)) return { squadId, name: sq.name, already: true };
    if (sq.memberIds.length >= SQUAD_MAX_MEMBERS) {
      throw new HttpsError("failed-precondition", `This squad is full (${SQUAD_MAX_MEMBERS} max)`);
    }
    tx.update(ref, {
      memberIds: FieldValue.arrayUnion(uid),
      [`members.${uid}`]: card,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { squadId, name: sq.name, already: false };
  });
});

// ── leave / remove (shared) ──────────────────────────────────────────────────
/** Take `who` out of a squad: hand over ownership or delete the squad as needed. */
const removeMember = async (squadId: string, who: string, actor: string, mustBeOwner: boolean) => {
  const ref = db.doc(`squads/${squadId}`);
  const outcome = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError("not-found", "Unknown squad");
    const sq = s.data() as Squad;
    if (!sq.memberIds.includes(actor)) throw new HttpsError("not-found", "Unknown squad");
    if (mustBeOwner && sq.ownerId !== actor) throw new HttpsError("permission-denied", "Only the owner can do that");
    if (!sq.memberIds.includes(who)) throw new HttpsError("not-found", "Not a member");
    const remaining = sq.memberIds.filter((m) => m !== who);
    if (!remaining.length) {
      tx.delete(ref);
      tx.delete(db.doc(`squad_codes/${sq.code}`));
      return "deleted" as const;
    }
    const update: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
      memberIds: FieldValue.arrayRemove(who),
      [`members.${who}`]: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (sq.ownerId === who) update.ownerId = nextOwner(sq.members, who);
    tx.update(ref, update);
    return "removed" as const;
  });
  // A leaver's numbers go with them (members must not keep seeing them).
  await deleteWeekly(ref, outcome === "deleted" ? undefined : who);
  return outcome;
};

export const leaveSquad = onCall(INTERACTIVE, async (request) => {
  const uid = requireUid(request);
  const squadId = squadIdOf((request.data as Record<string, unknown> | null)?.squadId);
  return { result: await removeMember(squadId, uid, uid, false) };
});

// ── owner actions ────────────────────────────────────────────────────────────
export const manageSquad = onCall(INTERACTIVE, async (request) => {
  const uid = requireUid(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const squadId = squadIdOf(data.squadId);

  if (data.action === "remove") {
    const who = data.memberUid;
    if (typeof who !== "string" || !who || who.length > 128) throw new HttpsError("invalid-argument", "Who?");
    if (who === uid) throw new HttpsError("invalid-argument", "Use leave to remove yourself");
    return { result: await removeMember(squadId, who, uid, true) };
  }

  const ref = db.doc(`squads/${squadId}`);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError("not-found", "Unknown squad");
    const sq = s.data() as Squad;
    if (!sq.memberIds.includes(uid)) throw new HttpsError("not-found", "Unknown squad");
    if (sq.ownerId !== uid) throw new HttpsError("permission-denied", "Only the owner can do that");

    if (data.action === "rename") {
      const name = sanitizeSquadName(data.name);
      if (!name) throw new HttpsError("invalid-argument", "Name must be 2–30 characters");
      tx.update(ref, { name, updatedAt: FieldValue.serverTimestamp() });
      return { result: "renamed", name };
    }
    if (data.action === "challenge") {
      if (!isSquadMetric(data.metric)) throw new HttpsError("invalid-argument", "Unknown metric");
      const goal = sanitizeGoal(data.metric, data.goal ?? GOAL_LIMITS[data.metric].def);
      if (goal === null) throw new HttpsError("invalid-argument", "Goal out of range");
      tx.update(ref, { metric: data.metric, goal, updatedAt: FieldValue.serverTimestamp() });
      return { result: "updated", metric: data.metric, goal };
    }
    throw new HttpsError("invalid-argument", "Unknown action");
  });
});

/** Account deletion: leave every squad (ownership passes on as usual). */
export const removeUserFromAllSquads = async (uid: string): Promise<void> => {
  const snap = await squadsOf(uid);
  for (const d of snap.docs) {
    await removeMember(d.id, uid, uid, false).catch((e) => console.error("squad leave on delete failed", d.id, e));
  }
};
