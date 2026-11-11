import { profileIsComplete } from '../membership/state.ts';
import { projectMatchesSkills } from '../projects/skills.ts';
import { isDiscoverableProject } from '../seo/publication.ts';

export type MailPreferences = { enabled: boolean; interval: 'project' | 'daily'; tags: string[]; minBudget: string };
export function eligibleProfile(profile: Record<string, unknown> | undefined): boolean {
  return !!profile && profileIsComplete(profile);
}
export function profileTags(profile: Record<string, unknown>): string[] {
  return Array.isArray(profile.skills) ? profile.skills.filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim()) : [];
}
export function defaultPreferences(profile: Record<string, unknown>): MailPreferences {
  return { enabled: false, interval: 'daily', tags: profileTags(profile), minBudget: '' };
}
export function parsePreferences(value: unknown): MailPreferences | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.enabled !== 'boolean' || !['project', 'daily'].includes(String(v.interval)) || !Array.isArray(v.tags) || v.tags.length > 50 || v.tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 60) || typeof v.minBudget !== 'string' || (v.minBudget !== '' && (!/^\d{1,9}$/.test(v.minBudget) || Number(v.minBudget) > 100_000_000))) return null;
  return { enabled: v.enabled, interval: v.interval as MailPreferences['interval'], tags: [...new Set(v.tags.map(t => (t as string).trim()))], minBudget: v.minBudget };
}
// Only a numeric lower bound is safe to compare. Unknown/negotiable budgets never pass an amount filter.
export function budgetFloor(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/₪|ILS|NIS|ש״ח|ש"ח/gi, '').trim();
  if (!/^\d[\d,]*(?:\.\d+)?(?:\s*[-–—]\s*\d[\d,]*(?:\.\d+)?)?\s*\+?$/.test(clean)) return null;
  return Number(clean.match(/^[\d,.]+/)![0].replaceAll(',', ''));
}
export function matchesProject(project: Record<string, unknown>, uid: string, prefs: MailPreferences): boolean {
  if (!isDiscoverableProject(project) || project.ownerUid === uid) return false;
  if (prefs.minBudget && (budgetFloor(project.budget) ?? -1) < Number(prefs.minBudget)) return false;
  return prefs.tags.length === 0 || projectMatchesSkills({ title: String(project.title || ''), description: String(project.description || ''), skills: Array.isArray(project.skills) ? project.skills.filter((v): v is string => typeof v === 'string') : [] }, prefs.tags);
}
export function dailyDue(now: number, lastDaily: string | undefined): boolean {
  const date = new Date(now);
  return date.getUTCHours() >= 8 && lastDaily !== date.toISOString().slice(0, 10);
}
