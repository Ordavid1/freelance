// Validation and building for payloads captured by the browser extension (or pasted by the user).
// EVERYTHING here is untrusted client input: shapes are checked strictly, every string goes through
// cleanText, every list and length is capped, unknown keys are dropped, `ownerSignal` is only echoed.
// Pure and isomorphic (no network, no Firestore): the route adds the session, limiter and publisher lookup.
import { ImportError } from '@/lib/imports/errors';
import type { XPlaceProfileImport, XPlaceProjectImport, XPlaceTarget } from '../types';
import { cleanText, isUsableText } from './clean';
import { normalizeProject, projectDraft, splitSkills, type RawProject } from './project';
import { buildProfileSourceText, SOURCE_TEXT_MAX, type ProfileFacts } from './source-builder';
import { parseXPlaceUrl } from './urls';

export const PROFILE_LIMITS = {
  headline: 140, slogan: 140, location: 80, about: 1500,
  languages: 8, languageName: 60, languageLevel: 60,
  expertise: 40, industry: 80, expertiseName: 120, expertiseDescription: 300,
  employment: 15, period: 40, position: 160, company: 120, employmentDescription: 700,
  education: 10, degree: 160, institution: 160, educationDescription: 500,
  sections: 5, entries: 10, entry: 300,
  links: 10, linkUrl: 300, linkTitle: 120, linkDescription: 300,
} as const;
export const PASTED_TEXT_MAX = 13_000;
/** Raw (pre-clean) input window of the pasted text; keeps the cleaning regexes cheap on hostile input. */
const PASTED_RAW_MAX = 30_000;
const PASTED_MIN = 20;
const OMITTED_WARNING = 'חלק מהתוכן קוצר כדי להתאים לגבול האורך.';
export const PASTED_TEXT_WARNING = 'הטקסט שהודבק נשלח ל־Vertex AI רק בלחיצה על יצירת פרופיל בעזרת AI. הוא עשוי לכלול פרטים שלא רציתם לשתף; ערכו או מחקו לפני כן.';
const SECTION_LABELS = { courses: 'Courses', volunteering: 'Volunteering', military: 'Military service', patents: 'Patents', articles: 'Articles' } as const;
const PROJECT_CATEGORIES_MAX = 40;

type Rec = Record<string, unknown>;
const invalid = () => new ImportError('INVALID_PAYLOAD');

function isRecord(value: unknown): value is Rec {
  return Object.prototype.toString.call(value) === '[object Object]';
}

/** A missing key is empty; a present value must be a string. Cleaned, usable-text filtered, capped. */
function text(source: Rec, key: string, max: number, paragraphs = false): string {
  const value = source[key];
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw invalid();
  const cleaned = cleanText(value.length > max * 4 + 50 ? value.slice(0, max * 4 + 50) : value, max, { paragraphs });
  return isUsableText(cleaned) ? cleaned : '';
}

/** A missing key is an empty list; a present value must be an array of plain objects. Items beyond `max` are ignored. */
function records(source: Rec, key: string, max: number): Rec[] {
  const value = source[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid();
  return value.slice(0, max).map((item) => { if (!isRecord(item)) throw invalid(); return item; });
}

function ownerSignal(source: Rec): boolean | null {
  const value = source.ownerSignal;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') throw invalid();
  return value;
}

function safeLink(value: unknown): string {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw || raw.length > PROFILE_LIMITS.linkUrl || /[\s\u0000-\u001f\u007f]/.test(raw)) return '';
  try {
    const url = new URL(raw);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return '';
    return url.href.length <= PROFILE_LIMITS.linkUrl ? url.href : '';
  } catch { return ''; }
}

function profileFacts(payload: Rec, url: string): ProfileFacts {
  const L = PROFILE_LIMITS;
  const sections: ProfileFacts['otherSections'] = [];
  for (const section of records(payload, 'otherSections', L.sections)) {
    const name = section.section;
    if (typeof name !== 'string' || !Object.hasOwn(SECTION_LABELS, name) || sections.some((s) => s.section === SECTION_LABELS[name as keyof typeof SECTION_LABELS])) continue;
    const raw = section.entries;
    if (raw !== undefined && !Array.isArray(raw)) throw invalid();
    const entries = (raw as unknown[] | undefined ?? []).slice(0, L.entries).map((entry) => {
      if (typeof entry !== 'string') throw invalid();
      return cleanText(entry.slice(0, L.entry * 4), L.entry);
    }).filter(isUsableText);
    if (entries.length) sections.push({ section: SECTION_LABELS[name as keyof typeof SECTION_LABELS], entries });
  }
  return {
    url,
    headline: text(payload, 'headline', L.headline), slogan: text(payload, 'slogan', L.slogan),
    location: text(payload, 'location', L.location), about: text(payload, 'about', L.about, true),
    languages: records(payload, 'languages', L.languages).map((l) => ({ name: text(l, 'name', L.languageName), level: text(l, 'level', L.languageLevel) })).filter((l) => l.name),
    expertise: records(payload, 'expertise', L.expertise).map((e) => ({ industry: text(e, 'industry', L.industry), name: text(e, 'name', L.expertiseName), description: text(e, 'description', L.expertiseDescription, true) })).filter((e) => e.name || e.industry || e.description),
    employment: records(payload, 'employment', L.employment).map((e) => ({ period: text(e, 'period', L.period), position: text(e, 'position', L.position), company: text(e, 'company', L.company), description: text(e, 'description', L.employmentDescription, true) })).filter((e) => e.position || e.company || e.description),
    education: records(payload, 'education', L.education).map((e) => ({ period: text(e, 'period', L.period), degree: text(e, 'degree', L.degree), institution: text(e, 'institution', L.institution), description: text(e, 'description', L.educationDescription, true) })).filter((e) => e.degree || e.institution || e.description),
    otherSections: sections,
    links: records(payload, 'links', L.links).map((l) => ({ url: safeLink(l.url), title: text(l, 'title', L.linkTitle), description: text(l, 'description', L.linkDescription) })).filter((l) => l.url),
  };
}

export type ValidatedIngest =
  | { kind: 'profile'; canonicalUrl: string; ownerSignal: boolean | null; facts: ProfileFacts }
  | { kind: 'profile-text'; canonicalUrl: string; text: string }
  | { kind: 'project'; canonicalUrl: string; ownerSignal: boolean | null; target: Extract<XPlaceTarget, { kind: 'project' }>; raw: RawProject };

/** Stable string hashed for the log line of pasted text (there is no URL). */
export const PASTED_LOG_KEY = 'xplace:profile-text';

/**
 * Strict validation and cleaning of `body.payload`. Throws ImportError: INVALID_URL when the page URL is not a
 * profile (or project) URL of the declared kind, INVALID_PAYLOAD for every other shape problem. Dispatches on `kind`.
 */
export function validateIngestPayload(payload: unknown): ValidatedIngest {
  if (!isRecord(payload)) throw invalid();
  if (payload.kind === 'profile-text') {
    if (typeof payload.text !== 'string') throw invalid();
    const cleaned = cleanText(payload.text.slice(0, PASTED_RAW_MAX), PASTED_TEXT_MAX, { paragraphs: true });
    return { kind: 'profile-text', canonicalUrl: PASTED_LOG_KEY, text: cleaned };
  }
  if (payload.kind !== 'profile' && payload.kind !== 'project') throw invalid();
  const target = parseXPlaceUrl(payload.url);
  if (!target || target.kind !== payload.kind) throw new ImportError('INVALID_URL');
  const signal = ownerSignal(payload);
  if (target.kind === 'profile') return { kind: 'profile', canonicalUrl: target.canonicalUrl, ownerSignal: signal, facts: profileFacts(payload, target.canonicalUrl) };

  const id = payload.projectId;
  if (typeof id !== 'string' && typeof id !== 'number') throw invalid();
  if (String(id) !== target.projectId) throw invalid();
  const amount = payload.amount;
  if (amount !== undefined && amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount))) throw invalid();
  const due = payload.dueDate;
  if (due !== undefined && due !== null && typeof due !== 'string') throw invalid();
  const categories = payload.categories;
  if (categories !== undefined && categories !== null && !Array.isArray(categories)) throw invalid();
  const pre = (key: string, max: number) => {
    const value = payload[key];
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') throw invalid();
    return value.slice(0, max * 4 + 50);
  };
  return {
    kind: 'project', canonicalUrl: target.canonicalUrl, ownerSignal: signal, target,
    raw: {
      title: pre('title', 120), description: pre('description', 5000), amount: amount ?? null, dueDate: due ?? null,
      categories: ((categories as unknown[] | undefined) ?? []).slice(0, PROJECT_CATEGORIES_MAX).map((item) => { if (typeof item !== 'string') throw invalid(); return item.slice(0, 800); }),
      publisherName: pre('publisherName', 200),
    },
  };
}

const entryLine = (period: string, parts: string[]) => [period, parts.filter(Boolean).join(', ')].filter(Boolean).join(' · ');

export function buildProfileImport(valid: Extract<ValidatedIngest, { kind: 'profile' }>, now: Date = new Date()): XPlaceProfileImport {
  const f = valid.facts;
  const empty = !(f.headline || f.slogan || f.about || f.languages.length || f.expertise.length || f.employment.length || f.education.length || f.otherSections.length || f.links.length);
  if (empty) throw new ImportError('NOT_ENOUGH_DATA');
  const { text: sourceText, omitted } = buildProfileSourceText(f, SOURCE_TEXT_MAX);
  return {
    provider: 'xplace',
    url: valid.canonicalUrl,
    sourceText,
    profile: {
      name: '',
      headline: f.headline,
      bio: f.about,
      skills: splitSkills(f.expertise.map((e) => e.name)),
      portfolio: f.links.map((l) => (l.title ? `${l.title}: ${l.url}` : l.url)).join('\n'),
      experience: f.employment.map((e) => entryLine(e.period, [e.position, e.company])).filter(Boolean).join('\n'),
      education: f.education.map((e) => entryLine(e.period, [e.degree, e.institution])).filter(Boolean).join('\n'),
    },
    fetchedAt: now.toISOString(),
    warnings: omitted ? [OMITTED_WARNING] : [],
    captured: 'extension',
    ownerSignal: valid.ownerSignal,
    counts: { expertise: f.expertise.length, employment: f.employment.length, education: f.education.length },
  };
}

/** Pasted profile text: nothing is guessed from it, the whole cleaned text is the source. */
export function buildPastedProfileImport(valid: Extract<ValidatedIngest, { kind: 'profile-text' }>, now: Date = new Date()): XPlaceProfileImport {
  if (valid.text.length < PASTED_MIN) throw new ImportError('NOT_ENOUGH_DATA');
  return {
    provider: 'xplace',
    url: '',
    sourceText: `XPlace profile (text pasted by the user)\n${valid.text}`.slice(0, SOURCE_TEXT_MAX),
    profile: { name: '', headline: '', bio: '', skills: [], portfolio: '', experience: '', education: '' },
    fetchedAt: now.toISOString(),
    warnings: [PASTED_TEXT_WARNING],
  };
}

export function buildProjectImport(valid: Extract<ValidatedIngest, { kind: 'project' }>, now: Date = new Date()): XPlaceProjectImport {
  const draft = normalizeProject(valid.raw);
  if (!draft) throw new ImportError('NOT_ENOUGH_DATA');
  return {
    provider: 'xplace',
    url: valid.target.canonicalUrl,
    externalId: valid.target.projectId,
    draft: projectDraft(draft),
    partial: false,
    warnings: [],
    publisherName: draft.publisherName,
    fetchedAt: now.toISOString(),
    captured: 'extension',
    ownerSignal: valid.ownerSignal,
  };
}
