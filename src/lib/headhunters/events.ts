// Headhunter lifecycle hook, called by the moderation route after a decision is committed.
// It never throws, so it cannot change the outcome of the request that triggered it.
//
// Work that reacts to a decision plugs in here: the approval email to the headhunter (work package 6) and the
// IndexNow ping of the minisite URL (work package 5). Cache invalidation is not done here; the data layer does it.
import type { ModerationAction } from './moderation.ts';

export type HeadhunterDecisionEvent = { uid: string; action: ModerationAction; handle: string; displayName: string; reason?: string };

export function onHeadhunterDecision(event: HeadhunterDecisionEvent): void {
  try {
    void event;
  } catch (error) {
    console.warn('Headhunter event failed', { error: error instanceof Error ? error.name : 'Error' });
  }
}
