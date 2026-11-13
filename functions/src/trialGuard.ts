/**
 * The free trial can only start once per account.
 *
 * The rules pin `trialStartedAt` to the server clock when a profile is created,
 * and never let a client change it afterwards. What they could not stop is the
 * owner DELETING their profile document and creating it again: a fresh create,
 * a fresh server timestamp, a fresh trial, as often as they liked. Deleting has
 * to stay allowed, because released apps erase the profile that way when an
 * account is deleted.
 *
 * The sign-in account itself has a creation time that no client can touch. A
 * profile whose trial claims to start well after its account was created is a
 * re-created profile, so its trial clock is put back to the account's creation.
 * A real first sign-up creates the profile seconds after the account, far
 * inside the slack, and is left alone.
 */

/** Longest honest gap between creating an account and creating its profile. */
export const TRIAL_SLACK_MS = 60 * 60 * 1000;

/**
 * The trial start a newly created profile should have, or null to leave it.
 *
 * @param trialStartedMs what the new profile says (null when it has no trial)
 * @param accountCreatedMs when the sign-in account was created (null if unknown)
 */
export const correctedTrialStart = (
  trialStartedMs: number | null,
  accountCreatedMs: number | null,
): number | null => {
  if (trialStartedMs == null || accountCreatedMs == null) return null;
  if (!Number.isFinite(trialStartedMs) || !Number.isFinite(accountCreatedMs)) return null;
  if (trialStartedMs <= accountCreatedMs + TRIAL_SLACK_MS) return null;
  return accountCreatedMs;
};
