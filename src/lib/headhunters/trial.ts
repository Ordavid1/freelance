// The "live now" (fast-track) trial window and the visibility rule it feeds (pure: no server-only imports).
//
// A page is public when  approved AND ( eligible  OR  trial running ).
//   eligible      = the published-project threshold was reached once (`eligibleAt`, sticky): the standard rule.
//   trial running = fastTrack AND now < trialEndsAt, where trialEndsAt = first approval + HEADHUNTER_FAST_TRACK_HOURS.
// Nothing is deleted or rewritten when the window closes: the check is evaluated on every read against the clock, so an
// expired page simply stops being served and comes back by itself the moment the threshold is reached.
import { HEADHUNTER_FAST_TRACK_HOURS } from './constants.ts';

const HOUR_MS = 60 * 60 * 1000;

/** The end of the trial window for an approval at `approvedAtMs`. */
export function trialEndsAtFrom(approvedAtMs: number): number {
  return approvedAtMs + HEADHUNTER_FAST_TRACK_HOURS * HOUR_MS;
}

export type TrialPhase =
  /** Not a fast-track record: the standard rule only. */
  | 'none'
  /** Fast-track, not approved yet: the clock has not started. */
  | 'waiting'
  /** Approved, below the threshold, inside the window: public, noindex. */
  | 'running'
  /** Approved, below the threshold, window closed: not public. */
  | 'expired'
  /** The threshold was reached: the standard rule applies and the window no longer matters. */
  | 'met';

export type TrialInput = { status: unknown; fastTrack: unknown; eligible: boolean; trialEndsAt: number | null | undefined };

/** Where a record is in the trial at `nowMs`. A missing end time on an approved fast-track record counts as expired (fails closed). */
export function trialPhase(input: TrialInput, nowMs: number): TrialPhase {
  if (input.fastTrack !== true) return 'none';
  if (input.eligible) return 'met';
  if (input.status !== 'approved') return 'waiting';
  return typeof input.trialEndsAt === 'number' && Number.isFinite(input.trialEndsAt) && nowMs < input.trialEndsAt ? 'running' : 'expired';
}

export const isTrialRunning = (input: TrialInput, nowMs: number) => trialPhase(input, nowMs) === 'running';

/** Whole hours left, rounded up (1 while any time is left), 0 when closed. */
export function trialHoursLeft(trialEndsAt: number | null | undefined, nowMs: number): number {
  if (typeof trialEndsAt !== 'number' || !Number.isFinite(trialEndsAt) || nowMs >= trialEndsAt) return 0;
  return Math.ceil((trialEndsAt - nowMs) / HOUR_MS);
}
