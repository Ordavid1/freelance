import { isListableProject, isSyntheticProject } from '../seo/publication.ts';
import { HEADHUNTER_MIN_DESCRIPTION, HEADHUNTER_MIN_PROJECTS, HEADHUNTER_REVIEW_FLOOR } from './constants.ts';

export type CountableProject = {
  id?: string; status?: unknown; visibility?: unknown; title?: unknown; description?: unknown; sample?: unknown; unreal?: unknown;
  owner?: { kind?: unknown } | null; importSource?: { key?: unknown } | null;
};

/** True when a project of the headhunter counts toward the unlock threshold. */
export function countsTowardHeadhunter(record: CountableProject): boolean {
  return (record.status === 'open' || record.status === 'closed')
    && isListableProject(record)
    && !isSyntheticProject(record)
    && typeof record.description === 'string'
    && record.description.trim().length >= HEADHUNTER_MIN_DESCRIPTION;
}

/** Normalised title and description (letters and digits only), used to spot near-duplicates. */
export function projectFingerprint(record: CountableProject): string {
  const text = `${typeof record.title === 'string' ? record.title : ''} ${typeof record.description === 'string' ? record.description : ''}`;
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 400).trim();
}

export function countPublishedProjects(records: Iterable<CountableProject>): { count: number; countedIds: string[]; duplicateIds: string[]; skippedIds: string[] } {
  const countedIds: string[] = [];
  const duplicateIds: string[] = [];
  const skippedIds: string[] = [];
  const keys = new Set<string>();
  const fingerprints = new Set<string>();
  let index = 0;
  for (const record of records) {
    const id = typeof record.id === 'string' && record.id ? record.id : `#${index}`;
    index += 1;
    if (!countsTowardHeadhunter(record)) { skippedIds.push(id); continue; }
    const key = typeof record.importSource?.key === 'string' && record.importSource.key ? record.importSource.key : '';
    const fingerprint = projectFingerprint(record);
    if ((key && keys.has(key)) || fingerprints.has(fingerprint)) { duplicateIds.push(id); continue; }
    if (key) keys.add(key);
    fingerprints.add(fingerprint);
    countedIds.push(id);
  }
  return { count: countedIds.length, countedIds, duplicateIds, skippedIds };
}

export function isEligible(published: number): boolean {
  return published >= HEADHUNTER_MIN_PROJECTS;
}

export function needsReReview(published: number): boolean {
  return published < HEADHUNTER_REVIEW_FLOOR;
}
