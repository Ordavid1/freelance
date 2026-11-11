// Beta: two-month (60-day) freelancer trial.
export const TRIAL_MS = 60 * 24 * 60 * 60 * 1000;
export type MembershipAccess = { state: 'legacy' | 'preview' | 'trial' | 'paid' | 'expired'; paidUntil: number | null; trialStartedAt: number | null; trialEndsAt: number | null; canUseMarketplace: boolean; canStartTrial: boolean };
export function accessFromRecord(record: { state?: unknown; trialStartedAt?: number | null; trialEndsAt?: number | null; paidUntil?: number | null }, now = Date.now()): MembershipAccess {
  const start = record.trialStartedAt ?? null;
  const end = record.trialEndsAt ?? null;
  const paidUntil = typeof record.paidUntil === 'number' && Number.isFinite(record.paidUntil) ? record.paidUntil : null;
  const state = paidUntil !== null && paidUntil > now ? 'paid' : record.state === 'legacy' ? 'legacy' : record.state === 'trial' ? (typeof start === 'number' && typeof end === 'number' && Number.isFinite(start) && Number.isFinite(end) && end > start && end > now ? 'trial' : 'expired') : 'preview';
  return { state, paidUntil, trialStartedAt: start, trialEndsAt: end, canUseMarketplace: state === 'paid' || state === 'legacy' || state === 'trial', canStartTrial: state === 'preview' };
}
export function profileIsComplete(profile: Record<string, unknown>): boolean {
  const text = (key: string) => typeof profile[key] === 'string' && (profile[key] as string).trim().length > 0;
  return Boolean(text('name') && (text('headline') || text('bio')) && Array.isArray(profile.skills) && profile.skills.some(skill => typeof skill === 'string' && skill.trim()));
}

// Completed freelancer details unlock a trial regardless of which view was last used.
export function shouldStartFreelancerTrial(profile: Record<string, unknown>, membership: Record<string, unknown>, _previousProfile: Record<string, unknown> = {}): boolean {
  return profileIsComplete(profile) && membership.state === 'preview';
}
