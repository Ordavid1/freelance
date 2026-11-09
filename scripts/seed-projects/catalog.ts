// Pure logic of the seed import tool: argument parsing, catalog validation and
// content lint, and plan computation. No Firestore or server-only imports, so it
// can be unit-tested and reused by the CLI.
import { validateProjectInput } from '../../src/lib/projects/validation.ts';

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,60}$/;
export const BATCH_PATTERN = /^[a-z0-9][a-z0-9._-]{2,79}$/;
export const MAX_CATALOG_SIZE = 400;
export const CONTENT_FIELDS = ['title', 'category', 'description', 'budget', 'deadline', 'clientName', 'skills', 'owner'] as const;
const INPUT_KEYS = ['title', 'category', 'description', 'budget', 'deadline', 'clientName', 'skills', 'persona'];
const ENTRY_KEYS = new Set<string>(['slug', ...INPUT_KEYS]);

export type CatalogEntry = {
  slug: string; title: string; category: string; description: string; budget: string; deadline: string; clientName: string; persona: string; skills: string[];
};
export type ContentFields = Omit<CatalogEntry, 'slug' | 'persona'> & { owner: { kind: 'ai-agent'; name: string; persona: string } };
export type CatalogResult = { ok: true; batch: string; entries: CatalogEntry[] } | { ok: false; errors: string[] };

export type CliOptions = { catalog: string; project?: string; commit: boolean; retire: boolean };
export type ArgsResult = { ok: true; options: CliOptions } | { ok: false; error: string };

export type PlanAction = 'create' | 'update' | 'unchanged' | 'skip';
export type PlanItem = { action: PlanAction; id: string; slug: string; changed: string[]; reason?: string };
export type ExistingDoc = Record<string, unknown> | null | undefined;

export function seedDocId(slug: string) { return `seed-${slug}`; }

export function parseArgs(argv: string[]): ArgsResult {
  const options: CliOptions = { catalog: '', commit: false, retire: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--commit') options.commit = true;
    else if (arg === '--retire') options.retire = true;
    else if (arg === '--catalog' || arg === '--project') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) return { ok: false, error: `${arg} requires a value.` };
      if (arg === '--catalog') options.catalog = value; else options.project = value;
      index += 1;
    } else return { ok: false, error: `Unknown argument: ${arg}` };
  }
  if (!options.catalog) return { ok: false, error: '--catalog <file> is required.' };
  if (options.commit && !options.project) return { ok: false, error: '--commit requires an explicit --project <gcp-project-id>.' };
  return { ok: true, options };
}

// Text is split into tokens of letters (Unicode-aware) and each token is compared as a
// whole word against the forbidden terms. Hebrew tokens may carry up to three one-letter
// prefixes (ה ו ב ל מ ש כ), so "ההדגמה" and "לדמו" are caught while "דמויות" (characters) is not.
const FORBIDDEN_TERMS = ['הדגמה', 'הדגמות', 'דמו', 'סינתטי', 'סינתטית', 'סינתטיים', 'demo', 'demos', 'synthetic', 'mock', 'mocks', 'placeholder', 'placeholders'];
export function findForbiddenTerm(text: string): string | null {
  for (const token of text.toLowerCase().match(/\p{L}+/gu) || []) {
    const candidates = /[\u0590-\u05FF]/u.test(token) ? [token, ...[1, 2, 3].filter((n) => n < token.length && /^[הובלמשכ]+$/u.test(token.slice(0, n))).map((n) => token.slice(n))] : [token];
    const hit = FORBIDDEN_TERMS.find((term) => candidates.includes(term));
    if (hit) return hit;
  }
  return null;
}

export function validateCatalog(input: unknown): CatalogResult {
  const errors: string[] = [];
  const root = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null;
  if (!root) return { ok: false, errors: ['Catalog must be a JSON object.'] };
  const batch = typeof root.batch === 'string' ? root.batch.trim() : '';
  if (!BATCH_PATTERN.test(batch)) errors.push('batch must match ' + BATCH_PATTERN.source);
  if (!Array.isArray(root.projects) || root.projects.length === 0) return { ok: false, errors: [...errors, 'projects must be a non-empty array.'] };
  if (root.projects.length > MAX_CATALOG_SIZE) errors.push(`projects may hold at most ${MAX_CATALOG_SIZE} entries.`);
  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];
  root.projects.forEach((raw: unknown, index: number) => {
    const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    const label = `projects[${index}]${row && typeof row.slug === 'string' ? ` (${row.slug})` : ''}`;
    if (!row) { errors.push(`${label}: must be an object.`); return; }
    const before = errors.length;
    for (const key of Object.keys(row)) if (!ENTRY_KEYS.has(key)) errors.push(`${label}: unknown field "${key}".`);
    const slug = typeof row.slug === 'string' ? row.slug : '';
    if (!SLUG_PATTERN.test(slug)) errors.push(`${label}: slug must match ${SLUG_PATTERN.source}`);
    else if (seen.has(slug)) errors.push(`${label}: duplicate slug.`);
    else seen.add(slug);
    const checked = validateProjectInput(row);
    if (!checked.ok) errors.push(`${label}: ${checked.error}`);
    for (const field of ['category', 'budget', 'deadline'] as const) {
      if (typeof row[field] !== 'string' || !row[field].trim()) errors.push(`${label}: ${field} is required.`);
    }
    const clientName = typeof row.clientName === 'string' ? row.clientName.trim() : '';
    if (clientName.length < 2 || clientName.length > 80) errors.push(`${label}: clientName must be 2..80 characters.`);
    const persona = typeof row.persona === 'string' ? row.persona.trim() : '';
    if (persona.length < 5 || persona.length > 200) errors.push(`${label}: persona (one-line bio) must be 5..200 characters.`);
    const texts = [row.persona, row.title, row.category, row.description, row.budget, row.deadline, row.clientName, ...(Array.isArray(row.skills) ? row.skills : [])];
    for (const text of texts) {
      if (typeof text !== 'string') continue;
      const term = findForbiddenTerm(text);
      if (term) { errors.push(`${label}: text contains forbidden term "${term}".`); break; }
    }
    if (errors.length === before && checked.ok) entries.push({ slug, ...checked.value, clientName, persona });
  });
  return errors.length ? { ok: false, errors } : { ok: true, batch, entries };
}

export function contentFields(entry: CatalogEntry): ContentFields {
  return { title: entry.title, category: entry.category, description: entry.description, budget: entry.budget, deadline: entry.deadline, clientName: entry.clientName, skills: [...entry.skills], owner: { kind: 'ai-agent', name: entry.clientName, persona: entry.persona } };
}

// Fields of a new record, without timestamps (the CLI adds server timestamps).
export function buildCreateFields(entry: CatalogEntry, batch: string) {
  // `unreal: true` and `seed.purgeAfter` make seeded records easy to find and remove later
  // (query `unreal == true`, or `seed.purgeAfter` before today); they are never shown in the UI.
  const purgeAfter = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { ...contentFields(entry), status: 'open', visibility: 'public', sample: true, unreal: true, proposals: 0, seed: { batch, catalogSlug: entry.slug, purgeAfter } };
}

// Deep comparison independent of object key order (Firestore does not preserve it).
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : 1).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
function sameValue(left: unknown, right: unknown) { return canonical(left) === canonical(right); }

function hasSeedMarker(data: Record<string, unknown>, batch: string, slug: string) {
  const seed = data.seed && typeof data.seed === 'object' ? data.seed as Record<string, unknown> : null;
  return seed?.batch === batch && seed.catalogSlug === slug;
}

// Fields to patch on an existing seed record: changed content, plus the invariants
// that keep it an honest sample. createdAt and proposals are never touched.
export function diffSeedRecord(entry: CatalogEntry, data: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  const content = contentFields(entry);
  for (const field of CONTENT_FIELDS) if (!sameValue(data[field], content[field])) patch[field] = content[field];
  if (data.sample !== true) patch.sample = true;
  if (data.visibility !== 'public') patch.visibility = 'public';
  return patch;
}

export function planSeed(entries: CatalogEntry[], batch: string, existing: Map<string, ExistingDoc>): PlanItem[] {
  return entries.map((entry) => {
    const id = seedDocId(entry.slug);
    const data = existing.get(id);
    if (!data) return { action: 'create', id, slug: entry.slug, changed: [] };
    if (!hasSeedMarker(data, batch, entry.slug)) return { action: 'skip', id, slug: entry.slug, changed: [], reason: 'document exists without a matching seed marker; left untouched' };
    const changed = Object.keys(diffSeedRecord(entry, data));
    return changed.length ? { action: 'update', id, slug: entry.slug, changed } : { action: 'unchanged', id, slug: entry.slug, changed: [] };
  });
}

// Retire plan for the documents returned by a `seed.batch == batch` query.
export function planRetire(docs: { id: string; data: Record<string, unknown> }[], batch: string): PlanItem[] {
  return docs.map(({ id, data }) => {
    const seed = data.seed && typeof data.seed === 'object' ? data.seed as Record<string, unknown> : null;
    const slug = typeof seed?.catalogSlug === 'string' ? seed.catalogSlug : id;
    if (seed?.batch !== batch || data.sample !== true || !id.startsWith('seed-')) return { action: 'skip', id, slug, changed: [], reason: 'not a seed record of this batch' };
    return data.status === 'archived' ? { action: 'unchanged', id, slug, changed: [] } : { action: 'update', id, slug, changed: ['status'] };
  });
}

export function summarize(items: PlanItem[]) {
  const counts: Record<PlanAction, number> = { create: 0, update: 0, unchanged: 0, skip: 0 };
  for (const item of items) counts[item.action] += 1;
  return counts;
}
