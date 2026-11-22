// What the owner of a headhunter record sees (pure): the stored record minus internal review data, plus progress.
import { HEADHUNTER_FAST_TRACK_HOURS, HEADHUNTER_MIN_PROJECTS } from './constants.ts';
import { progressLabel, remainingLabel } from './presentation.ts';
import { headhunterPublicState } from './state.ts';
import { trialHoursLeft, trialPhase } from './trial.ts';
import type { HeadhunterRecord } from './types.ts';
import { minisiteUrl } from './urls.ts';

export function ownerView(record: HeadhunterRecord, context: { accountActive: boolean; now?: number }) {
  const now = context.now ?? Date.now();
  const published = Math.max(0, Math.floor(record.counters?.published) || 0);
  const eligible = record.eligibleAt !== undefined && record.eligibleAt !== null;
  const trialEndsAt = typeof record.trialEndsAt === 'number' ? record.trialEndsAt : null;
  const phase = trialPhase({ status: record.status, fastTrack: record.fastTrack, eligible, trialEndsAt }, now);
  const state = headhunterPublicState({ status: record.status, eligible, accountActive: context.accountActive, openProjects: 0, trialRunning: phase === 'running' });
  const reason = record.status === 'rejected' ? record.rejectedReason : record.status === 'suspended' ? record.suspendedReason : record.reviewReason;
  return {
    status: record.status,
    displayName: record.displayName,
    handle: record.handle,
    kind: record.kind,
    ...(record.city ? { city: record.city } : {}),
    ...(record.tagline ? { tagline: record.tagline } : {}),
    ...(record.about ? { about: record.about } : {}),
    contact: record.contact,
    ...(record.share ? { share: record.share } : {}),
    progress: { published, required: HEADHUNTER_MIN_PROJECTS, eligible, label: progressLabel(published), remaining: remainingLabel(published) },
    live: state.live,
    /** The "live now" option: `phase` is none (standard), waiting, running, expired or met; `endsAt` is epoch ms once approved. */
    trial: { fastTrack: record.fastTrack === true, phase, hours: HEADHUNTER_FAST_TRACK_HOURS, endsAt: trialEndsAt, hoursLeft: phase === 'running' ? trialHoursLeft(trialEndsAt, now) : 0 },
    publicUrl: state.live ? minisiteUrl(record.handle) : null,
    ...(reason ? { reason } : {}),
    version: record.version,
  };
}
