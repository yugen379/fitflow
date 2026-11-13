/**
 * Capacity for every function, in one place, so nothing runs on a default nobody
 * chose. `npm run proof:backend` fails if an exported function has no maxInstances.
 *
 *   concurrency   requests one server instance handles at once
 *   maxInstances  the most instances it can scale to; beyond concurrency ×
 *                 maxInstances, Cloud Run queues briefly and then refuses
 *
 * These are starting values, not measured ones: they need a load test on a test
 * copy of the backend before they can be trusted. Actually reaching a high
 * maxInstances also depends on the project's Cloud Run quota.
 */

// Handles base64 photos, so memory must cover `concurrency` of them at once. The
// timeout is a little past the app's own 25 s abort, so no slot outlives its caller.
export const AI_PROXY = {
  cpu: 1, memory: "1GiB", concurrency: 40, maxInstances: 100, timeoutSeconds: 30,
} as const;

// Short database work the user is waiting on.
export const INTERACTIVE = {
  cpu: 1, memory: "256MiB", concurrency: 80, maxInstances: 100, timeoutSeconds: 30,
} as const;

// Payment calls and webhooks. Providers retry a refusal, but a refused webhook
// delays someone's subscription, so these stay small and unshared.
export const PAYMENTS = {
  cpu: 1, memory: "256MiB", concurrency: 40, maxInstances: 50, timeoutSeconds: 60,
} as const;

// Walks everything a user owns, so it is slow and memory-hungry but rare.
export const ACCOUNT_DELETION = {
  cpu: 1, memory: "512MiB", concurrency: 10, maxInstances: 20, timeoutSeconds: 300,
} as const;

// Fires on every user write, including step syncs, so it is the busiest trigger.
export const USER_TRIGGER = {
  cpu: 1, memory: "256MiB", concurrency: 80, maxInstances: 100, timeoutSeconds: 60,
} as const;

// Fires on every like, comment and counter change: two small counts and at most
// one write each.
export const POST_TRIGGER = {
  cpu: 1, memory: "256MiB", concurrency: 80, maxInstances: 50, timeoutSeconds: 60,
} as const;

// One at a time: a slow run can't overlap the next one and double-send.
export const SCHEDULED_JOB = {
  memory: "512MiB", concurrency: 1, maxInstances: 1, timeoutSeconds: 540,
} as const;

export const SCHEDULED_RECAP = {
  memory: "512MiB", concurrency: 1, maxInstances: 1, timeoutSeconds: 1800,
} as const;
