# Badges, saved sessions & query indexes — scope record

Three connected repairs to the reward system and the data underneath it.

Proof gates:

```bash
npm run proof:badges     # 59 checks — pure logic, badge reachability, plan/workout split, index coverage
npm run proof:retention  # 27 checks — the one streak the whole app reads
npm run lint             # tsc --noEmit
npm run build
```

---

## 1. Ten badges nobody could ever earn

`ALL_BADGES` declares 22 badges. The Profile gallery renders every one of them
with its requirement text, so all 22 read as goals. Ten had **no awarding path
anywhere in the app** — no sequence of user actions could unlock them:

| Badge | Requirement | Now awarded from |
|---|---|---|
| `social_butterfly` | Post to community | `dataService.createPost` |
| `challenge_accepted` | Join a challenge | `Challenges.handleJoin` |
| `week_warrior` | 5 workouts in 7 days | `dataService.logWorkout` |
| `macro_master` | 7-day macro logging streak | `dataService.logMeal` |
| `sleep_master` | Log 8h sleep ×3 | `Wellness.logWellness` |
| `wellness_zen` | Mood + stress 3 days running | `Wellness.logWellness` |
| `streak_3` / `streak_7` / `streak_30` | 3 / 7 / 30-day streak | `analyticsService.recordActiveDay` |
| `comeback_kid` | Log after 7 days away | `analyticsService.recordActiveDay` |

Every check opens with a single-document read of the user's earned set, so once
a badge is won its query never runs again. All are fire-and-forget: a badge
lookup must never delay or break the log that triggered it.

**Regression guard.** `proof:badges` Part B parses `ALL_BADGES` out of the
source, strips comments, and fails if any badge id is unreachable or any
exported `check*` function loses its last call site. A new badge is covered the
moment it is declared. Verified to fail on both injected regressions (a
commented-out call site, and a removed index) before being trusted.

---

## 2. A built session is not a completed one

The exercise-library builder wrote its stack straight into `workouts` — the
collection that means *a session you finished*. Nothing ever read it back, so
the plan was write-only, while every consumer of `workouts` counted it as
training that had happened:

- the streak heat-map lit a square for it,
- the weekly recap added its duration and calories to the totals,
- challenge progress (workouts / minutes / calories) advanced,
- `week_warrior` counted it toward 5 sessions in 7 days,
- the "you haven't trained in N days" nudge was suppressed by it.

Assembling six exercises credited a full session nobody had performed, in an app
whose whole promise is an honest record. The toast said "saved to plan"; there
was no plan.

Plans now live in `workout_plans` (`src/services/workoutPlanService.ts`), are
listed in the Library under **Your sessions**, and are handed to the Workout page
to start a real timed session. The plan's own sets/reps/weight seed the inputs;
measured progression overrides them when there is history to measure.

The failure toast no longer claims "will retry from offline queue" while queueing
nothing — a failed save says so.

New surface: `workout_plans` rules (owner-scoped, `isValidWorkoutPlan`), a
`userId + createdAt` index, and inclusion in the account-deletion sweep in
`functions/src/index.ts`.

---

## 3. Composite indexes the code requires

`firestore.indexes.json` declared **one** index. The app issues fourteen distinct
composite query shapes — every `userId ==` plus a range or order on `timestamp`
needs one. A missing composite index makes Firestore throw `failed-precondition`,
and every call site here swallows errors, so the feature does not error: it
silently never works, forever.

Whatever exists in the console, the file is what a deploy reconciles against and
what a fresh environment gets. All fourteen are now declared, plus
`sleep_logs (userId, hours)` for Sleep Master and `workout_plans (userId,
createdAt)`. `proof:badges` Part B asserts each required shape is present.

---

## 4. Files

| Change | File |
|---|---|
| Pure badge logic, Firebase-free and unit-testable | `src/services/badgeUtils.ts` |
| Badge I/O + awarding | `src/services/badgeService.ts` |
| Badge triggers on the central write paths | `src/services/dataService.ts` |
| Streak + comeback badge triggers | `src/services/analyticsService.ts` |
| Saved plans | `src/services/workoutPlanService.ts` |
| Builder saves a plan; "Your sessions" list | `src/pages/Library.tsx` |
| Starts a handed-over plan | `src/pages/Workout.tsx` |
| Wellness + challenge triggers | `src/pages/Wellness.tsx`, `src/pages/Challenges.tsx` |
| Rules, indexes, account deletion | `firestore.rules`, `firestore.indexes.json`, `functions/src/index.ts` |
| Proof harness | `scripts/badges-proof.mjs` |
