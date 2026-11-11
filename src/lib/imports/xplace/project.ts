import { ImportError } from '../errors';
import type { XPlaceProjectDraft, XPlaceProjectImport, XPlaceTarget } from '../types';
import { cleanText, isUsableText, metaValues, titleTag, withoutScripts } from './clean';

type ProjectTarget = Extract<XPlaceTarget, { kind: 'project' }>;
type Draft = { title: string; description: string; budget: string; deadline: string; skills: string[]; publisherName: string };

/**
 * What every path (server-side link fetch, extension ingest) extracts from an XPlace project before
 * normalisation. Values may still be dirty: `normalizeProject` cleans, caps and formats them.
 */
export type RawProject = {
  title: unknown;
  description: unknown;
  /** Numeric amount (or a numeric string); anything else means no budget. */
  amount: unknown;
  /** ISO date (`yyyy-mm-dd`, optionally followed by a time); anything else means a flexible deadline. */
  dueDate: unknown;
  categories: unknown[];
  publisherName: unknown;
};

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 5000;
const SKILL_MAX = 60;
const SKILLS_MAX = 20;
const PUBLISHER_MAX = 200;
export const PROJECT_LIMITS = { title: TITLE_MAX, description: DESCRIPTION_MAX, publisher: PUBLISHER_MAX, category: 200 } as const;
const FLEXIBLE_DEADLINE = 'גמיש';
const DEFAULT_CATEGORY = 'כללי';
const PARTIAL_WARNING = 'חלק מפרטי הפרויקט לא היו זמינים. בדקו את התיאור לפני הפרסום.';

// ---------- shared formatting ----------

function formatBudget(amount: unknown): string {
  const value = typeof amount === 'string' && /^\d[\d,]*(\.\d+)?$/.test(amount.trim()) ? Number(amount.replace(/,/g, '')) : amount;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 1e12) return '';
  return `₪${String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function realDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1990 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

function isoDeadline(value: unknown): string {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return (match && realDate(Number(match[1]), Number(match[2]), Number(match[3]))) || FLEXIBLE_DEADLINE;
}

/** The `dd/mm/yy(yy)` date shown on the page as an ISO date, or null. */
function displayedDueDate(text: string): string | null {
  const match = /(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/.exec(text);
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return realDate(year, Number(match[2]), Number(match[1])) ? `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : null;
}

export function splitSkills(names: unknown[]): string[] {
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const name of names) {
    for (const part of cleanText(name, 400).split(',')) {
      const skill = cleanText(part, SKILL_MAX);
      const key = skill.toLowerCase();
      if (!skill || !isUsableText(skill) || seen.has(key)) continue;
      seen.add(key);
      skills.push(skill);
      if (skills.length >= SKILLS_MAX) return skills;
    }
  }
  return skills;
}

// ---------- layer 1: embedded Next.js flight payload ----------

/** Decodes every `self.__next_f.push([1,"..."])` string literal and concatenates the text. */
function flightText(html: string): string {
  let text = '';
  for (const match of html.matchAll(/self\.__next_f\.push\(\[\s*\d+\s*,\s*("(?:[^"\\]|\\[\s\S])*")\s*\]\)/g)) {
    try {
      const chunk: unknown = JSON.parse(match[1]);
      if (typeof chunk === 'string') text += chunk;
    } catch { /* truncated or malformed chunk: skip it */ }
  }
  return text;
}

/** Returns the balanced `{...}` starting at `start`, honouring JSON strings and escapes. */
function balancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * The one place draft fields are produced: cleaning, length caps, budget, deadline and skills.
 * Used by the link path and by the extension ingest path, so both give identical drafts.
 * Returns null when there is no usable title and description.
 */
export function normalizeProject(raw: RawProject): Draft | null {
  const title = cleanText(raw.title, TITLE_MAX);
  const description = cleanText(raw.description, DESCRIPTION_MAX, { paragraphs: true });
  if (!isUsableText(title) || !isUsableText(description)) return null;
  return {
    title, description,
    skills: splitSkills(Array.isArray(raw.categories) ? raw.categories : []),
    publisherName: cleanText(raw.publisherName, PUBLISHER_MAX),
    budget: formatBudget(raw.amount),
    deadline: isoDeadline(raw.dueDate),
  };
}

/** The draft fields of a normalised project, without the publisher. */
export function projectDraft(draft: Draft): XPlaceProjectDraft {
  return { title: draft.title, description: draft.description, category: DEFAULT_CATEGORY, budget: draft.budget, deadline: draft.deadline, skills: draft.skills };
}

/**
 * Data minimisation: this is the only place project JSON is read, and it reads an allowlist
 * of fields. Everything else in the object (user and company contact data, logos, bids) is
 * never touched.
 */
function draftFromProject(project: Record<string, unknown>, target: ProjectTarget): Draft | null {
  if (String(project.projectId) !== target.projectId) return null;
  const categories = Array.isArray(project.projectCategories) ? project.projectCategories : [];
  const company = asRecord(project.companyDto);
  return normalizeProject({
    title: project.title, description: project.description, amount: project.amount, dueDate: project.projectDueDate,
    categories: categories.map((item) => {
      const category = asRecord(item);
      return category ? (cleanText(category.nameHe, 200) || cleanText(category.nameEn, 200)) : '';
    }),
    publisherName: company ? (cleanText(company.companyNameHe, PUBLISHER_MAX) || cleanText(company.companyNameEn, PUBLISHER_MAX)) : '',
  });
}

function fromFlight(html: string, target: ProjectTarget): Draft | null {
  const text = flightText(html);
  const marker = '"project":{';
  for (let at = text.indexOf(marker); at !== -1; at = text.indexOf(marker, at + marker.length)) {
    const raw = balancedObject(text, at + marker.length - 1);
    if (!raw) continue;
    try {
      const record = asRecord(JSON.parse(raw));
      const draft = record && draftFromProject(record, target);
      if (draft) return draft;
    } catch { /* not valid JSON: try the next occurrence, then the HTML layer */ }
  }
  return null;
}

// ---------- layer 2: label-driven HTML ----------

function pageIdMatches(page: string, target: ProjectTarget): boolean {
  const url = metaValues(page, 'property', 'og:url')[0];
  if (!url) return true;
  const id = /[?&]id=(\d+)/.exec(url)?.[1] ?? /job-bids\/(\d+)/.exec(url)?.[1];
  return !id || id === target.projectId;
}

function fromHtml(page: string): Draft | null {
  const title = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(page)?.[1];
  const description = /<h3\b[^>]*>\s*פרטי הפרויקט\s*<\/h3\s*>\s*<p\b[^>]*>([\s\S]*?)<\/p\s*>/i.exec(page)?.[1];
  const list = /<ul\b[^>]*class="[^"]*expertise-viewer_categoriesListWrap[^"]*"[^>]*>([\s\S]*?)<\/ul\s*>/i.exec(page)?.[1] ?? '';
  const names = [...list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)].map((item) => cleanText(item[1], 200));
  const labelled = (label: string) => cleanText(
    new RegExp(`<b\\b[^>]*>\\s*${label}\\s*<\\/b\\s*>([\\s\\S]*?)<\\/span\\s*>`, 'i').exec(page)?.[1], 120);
  const amount = /\d[\d,]*/.exec(labelled('תקציב הפרויקט'))?.[0].replace(/,/g, '');
  return normalizeProject({
    title, description, categories: names, publisherName: '',
    amount: amount ? Number(amount) : 0,
    dueDate: displayedDueDate(labelled('תאריך היעד')),
  });
}

// ---------- layer 3: meta tags ----------

function fromMeta(page: string): Draft | null {
  const strip = (value: string) => value.replace(/^\s*פרויקט\s*:\s*/, '').replace(/\s*\|\s*XPlace\s*$/i, '');
  const pick = (values: string[], max: number, paragraphs: boolean) => {
    for (const raw of values) {
      const value = cleanText(raw, max, { paragraphs });
      if (isUsableText(value)) return value;
    }
    return '';
  };
  const title = pick([...metaValues(page, 'property', 'og:title'), titleTag(page)].map(strip), TITLE_MAX, false);
  const description = pick([...metaValues(page, 'property', 'og:description'), ...metaValues(page, 'name', 'description')], DESCRIPTION_MAX, true);
  if (!title || !description) return null;
  return normalizeProject({ title, description, amount: null, dueDate: null, categories: [], publisherName: '' });
}

/**
 * Parses the anonymous `xplace.com/project?id=<id>` page. Layers, first usable wins:
 * embedded flight JSON, label-driven HTML, then Open Graph meta (marked partial).
 */
export function parseXPlaceProjectHtml(html: string, target: ProjectTarget): Omit<XPlaceProjectImport, 'fetchedAt'> {
  const source = String(html ?? '');
  const page = withoutScripts(source);

  let draft = fromFlight(source, target);
  let partial = false;
  if (!draft && pageIdMatches(page, target)) draft = fromHtml(page);
  if (!draft && pageIdMatches(page, target)) { draft = fromMeta(page); partial = Boolean(draft); }
  if (!draft) throw new ImportError('NOT_ENOUGH_DATA');

  return {
    provider: 'xplace',
    url: target.canonicalUrl,
    externalId: target.projectId,
    draft: projectDraft(draft),
    partial,
    warnings: partial ? [PARTIAL_WARNING] : [],
    publisherName: draft.publisherName,
  };
}
