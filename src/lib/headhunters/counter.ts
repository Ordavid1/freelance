// Pure rules for the published-project counter, shared by the project-create transaction, the
// reconcile tool and the application flow. The caller turns the plan into Firestore writes.
import { isEligible, needsReReview } from './counting.ts';
import type { HeadhunterStatus } from './types.ts';

export const REVIEW_REASON_BELOW_FLOOR = 'below-review-floor';
export const REVIEW_REASON_DISPLAY_NAME = 'display-name-changed';
export const REVIEW_REASON_FLAGGED_HANDLE = 'flagged-handle';

export type CounterInput = { status: unknown; published: number; hasEligibleAt: boolean };
export type CounterPlan = {
  published: number;
  /** `eligibleAt` must be set now (first time the threshold is reached). */
  setEligibleAt: boolean;
  /** The status after the change, only when it differs from the current one. */
  status?: HeadhunterStatus;
  reviewReason?: string;
  statusChanged: boolean;
  becameEligible: boolean;
};

/**
 * What a new published count means for a record. The unlock is sticky: `eligibleAt` is set once and
 * never cleared. A draft that is eligible becomes a review request (`pending`); an approved record whose
 * count fell under the review floor goes back to `pending`.
 */
export function planCounter(current: CounterInput, nextPublished: number): CounterPlan {
  const published = Math.max(0, Math.floor(nextPublished) || 0);
  const setEligibleAt = !current.hasEligibleAt && isEligible(published);
  const eligible = current.hasEligibleAt || setEligibleAt;
  let status: HeadhunterStatus | undefined;
  let reviewReason: string | undefined;
  if (current.status === 'draft' && eligible) status = 'pending';
  else if (current.status === 'approved' && needsReReview(published)) { status = 'pending'; reviewReason = REVIEW_REASON_BELOW_FLOOR; }
  return { published, setEligibleAt, ...(status ? { status } : {}), ...(reviewReason ? { reviewReason } : {}), statusChanged: Boolean(status), becameEligible: setEligibleAt };
}
