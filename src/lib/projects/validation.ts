import { parseXPlaceUrl } from '../imports/xplace/urls.ts';
import type { ImportCapture, ProjectImportProvenance, XPlaceTarget } from '../imports/types.ts';
import { cleanText } from '../imports/xplace/clean.ts';
import { projectSkills } from './skills.ts';
// Shared project-input validation (no server-only imports so scripts can use it).
export type ProjectInput = { title: string; category: string; description: string; budget: string; deadline: string; skills: string[] };
export type ProjectInputResult = { ok: true; value: ProjectInput } | { ok: false; error: string };

export const PROJECT_CONTENT_ERROR = 'נדרשת כותרת ותיאור מלא של הפרויקט.';
export const PROJECT_DETAILS_ERROR = 'פרטי הפרויקט לא תקינים.';

export function validateProjectInput(body: unknown): ProjectInputResult {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : null;
  if (!input || typeof input.title !== 'string' || input.title.trim().length < 5 || input.title.length > 120 || typeof input.description !== 'string' || input.description.trim().length < 20 || input.description.length > 5000) {
    return { ok: false, error: PROJECT_CONTENT_ERROR };
  }
  if (typeof input.category !== 'string' || typeof input.budget !== 'string' || input.budget.length > 100 || typeof input.deadline !== 'string' || input.deadline.length > 100 || !Array.isArray(input.skills) || input.skills.length > 20 || input.skills.some((skill) => typeof skill !== 'string' || skill.length > 60)) {
    return { ok: false, error: PROJECT_DETAILS_ERROR };
  }
  return {
    ok: true,
    value: {
      title: input.title.trim(),
      category: input.category.trim().slice(0, 80),
      description: input.description.trim(),
      budget: input.budget.trim(),
      deadline: input.deadline.trim(),
      skills: projectSkills({ title: input.title as string, description: input.description as string, skills: input.skills as string[] }),
    },
  };
}

export type ImportProvenanceResult =
  | { ok: true; value: { provenance: ProjectImportProvenance & { captured: ImportCapture; ownerSignal: boolean | null }; target: Extract<XPlaceTarget, { kind: 'project' }> } }
  | { ok: false; code: 'ATTESTATION_REQUIRED' | 'INVALID_IMPORT'; error: string };

const IMPORT_KEYS = new Set(['provider', 'url', 'attested', 'publisherNameOnSource', 'createPublisherName', 'publisherMismatchConfirmed', 'captured', 'ownerSignal']);
const IMPORT_NAME_MAX = 200;
export const IMPORT_INVALID_ERROR = 'פרטי הייבוא לא תקינים.';
export const IMPORT_ATTESTATION_ERROR = 'יש לאשר שהפרויקט שלכם או שאתם מורשים לפרסם אותו.';

/** Strict check of the optional `import` object sent with a project publish request. */
export function validateImportProvenance(input: unknown): ImportProvenanceResult {
  const invalid = { ok: false, code: 'INVALID_IMPORT', error: IMPORT_INVALID_ERROR } as const;
  // Plain objects only (a realm-independent check, so arrays, dates and class instances are refused).
  if (Object.prototype.toString.call(input) !== '[object Object]') return invalid;
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some((key) => !IMPORT_KEYS.has(key))) return invalid;
  if (data.provider !== 'xplace') return invalid;
  if (data.attested !== true) return { ok: false, code: 'ATTESTATION_REQUIRED', error: IMPORT_ATTESTATION_ERROR };
  const target = parseXPlaceUrl(data.url);
  if (!target || target.kind !== 'project') return invalid;
  const names: Record<'publisherNameOnSource' | 'createPublisherName', string | undefined> = { publisherNameOnSource: undefined, createPublisherName: undefined };
  for (const key of ['publisherNameOnSource', 'createPublisherName'] as const) {
    const value = data[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim().length > IMPORT_NAME_MAX) return invalid;
    // Server-side cleaning: control and bidi characters and markup removed; a created publisher name needs 2+ characters.
    const cleaned = cleanText(value, IMPORT_NAME_MAX);
    names[key] = key === 'createPublisherName' && cleaned.length < 2 ? '' : cleaned;
  }
  if (data.publisherMismatchConfirmed !== undefined && typeof data.publisherMismatchConfirmed !== 'boolean') return invalid;
  if (data.captured !== undefined && data.captured !== 'extension' && data.captured !== 'link') return invalid;
  if (data.ownerSignal !== undefined && data.ownerSignal !== null && typeof data.ownerSignal !== 'boolean') return invalid;
  const provenance: ProjectImportProvenance & { captured: ImportCapture; ownerSignal: boolean | null } = {
    provider: 'xplace', url: target.canonicalUrl, attested: true,
    captured: data.captured === 'extension' ? 'extension' : 'link',
    ownerSignal: typeof data.ownerSignal === 'boolean' ? data.ownerSignal : null,
    ...(names.publisherNameOnSource !== undefined ? { publisherNameOnSource: names.publisherNameOnSource } : {}),
    ...(names.createPublisherName !== undefined ? { createPublisherName: names.createPublisherName } : {}),
    ...(data.publisherMismatchConfirmed !== undefined ? { publisherMismatchConfirmed: data.publisherMismatchConfirmed } : {}),
  };
  return { ok: true, value: { provenance, target } };
}
