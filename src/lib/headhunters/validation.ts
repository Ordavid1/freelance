import { cleanText } from '../imports/xplace/clean.ts';
import { HEADHUNTER_KINDS, HEADHUNTER_LIMITS } from './constants.ts';
import type { ContactLink, HeadhunterContact, HeadhunterInput, HeadhunterKind } from './types.ts';

export type HeadhunterInputResult =
  | { ok: true; value: HeadhunterInput }
  | { ok: false; code: string; field?: string; error: string };

export const HEADHUNTER_ERRORS = {
  INVALID_BODY: 'פרטי הבקשה לא תקינים.',
  UNKNOWN_FIELD: 'הבקשה כוללת שדה לא מוכר.',
  DISPLAY_NAME_INVALID: 'שם התצוגה חייב להכיל בין 2 ל־60 תווים.',
  KIND_INVALID: 'יש לבחור סוג: סוכנות גיוס או מגייס/ת עצמאי/ת.',
  FIELD_INVALID: 'אחד השדות אינו תקין.',
  FIELD_TOO_LONG: 'אחד השדות ארוך מדי.',
  LINKS_NOT_ALLOWED: 'אי אפשר להוסיף קישורים בטקסט. את הקישורים מוסיפים בשדות אמצעי הקשר.',
  CONTACT_REQUIRED: 'יש למלא לפחות אמצעי קשר אחד.',
  CONTACT_INVALID: 'אחד מאמצעי הקשר אינו תקין.',
  ATTESTATION_REQUIRED: 'יש לאשר שהפרטים נכונים ושאתם מורשים לפעול בשם הסוכנות.',
} as const;

const TOP_KEYS = new Set(['displayName', 'kind', 'city', 'tagline', 'about', 'contact', 'share', 'attested']);
const CONTACT_KEYS = ['email', 'phone', 'whatsapp', 'website', 'linkedin'] as const;
const SHARE_KEYS = ['title', 'description'] as const;
const LINK_PATTERN = /(?:https?:\/\/|www\.)/i;
const EMAIL_PATTERN = /^[a-z0-9._%+-]{1,64}@(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}$/;
const INTERNATIONAL_PREFIX = '972';

type Fail = { ok: false; code: string; field?: string; error: string };
const fail = (code: keyof typeof HEADHUNTER_ERRORS, field?: string): Fail => ({ ok: false, code, ...(field ? { field } : {}), error: HEADHUNTER_ERRORS[code] });
const isPlainObject = (value: unknown): value is Record<string, unknown> => Object.prototype.toString.call(value) === '[object Object]';

type TextOptions = { max: number; min?: number; paragraphs?: boolean };
// Returns the cleaned text, '' when absent, or a failure. cleanText caps at `max + 1` so an over-long value is detected, not silently cut.
function text(value: unknown, field: string, { max, min = 0, paragraphs = false }: TextOptions): string | Fail {
  if (value === undefined || value === null) return min > 0 ? fail('FIELD_INVALID', field) : '';
  if (typeof value !== 'string') return fail('FIELD_INVALID', field);
  const cleaned = cleanText(value, max + 1, { paragraphs });
  if (cleaned.length > max) return fail('FIELD_TOO_LONG', field);
  if (LINK_PATTERN.test(cleaned)) return fail('LINKS_NOT_ALLOWED', field);
  if (cleaned.length < min) return fail('FIELD_INVALID', field);
  return cleaned;
}

function phoneDigits(value: string): string | null {
  const compact = value.replace(/[\s\-.()]/g, '');
  return /^\+?\d{7,15}$/.test(compact) ? compact : null;
}

function whatsappDigits(value: string): string | null {
  const compact = phoneDigits(value);
  if (!compact) return null;
  let digits = compact;
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = INTERNATIONAL_PREFIX + digits.slice(1);
  return /^\d{7,15}$/.test(digits) ? digits : null;
}

function parseHttps(value: string): URL | null {
  if (value.length > HEADHUNTER_LIMITS.url) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || url.href.length > HEADHUNTER_LIMITS.url) return null;
  return url;
}

function contactValue(key: (typeof CONTACT_KEYS)[number], raw: string): string | null {
  const value = raw.trim();
  switch (key) {
    case 'email': {
      const email = value.toLowerCase();
      return email.length <= HEADHUNTER_LIMITS.email && EMAIL_PATTERN.test(email) ? email : null;
    }
    case 'phone': return phoneDigits(value);
    case 'whatsapp': return whatsappDigits(value);
    case 'website': return parseHttps(value)?.href ?? null;
    case 'linkedin': {
      const url = parseHttps(value);
      if (!url) return null;
      const host = url.hostname.toLowerCase();
      if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
      return url.pathname.startsWith('/company/') || url.pathname.startsWith('/in/') ? url.href : null;
    }
  }
}

export function validateHeadhunterInput(body: unknown, options: { requireAttestation?: boolean } = {}): HeadhunterInputResult {
  if (!isPlainObject(body)) return fail('INVALID_BODY');
  if (Object.keys(body).some((key) => !TOP_KEYS.has(key))) return fail('UNKNOWN_FIELD');

  const displayName = text(body.displayName, 'displayName', { max: HEADHUNTER_LIMITS.displayName.max, min: HEADHUNTER_LIMITS.displayName.min });
  if (typeof displayName !== 'string') return displayName.code === 'FIELD_INVALID' ? fail('DISPLAY_NAME_INVALID', 'displayName') : displayName;
  if (!(HEADHUNTER_KINDS as readonly unknown[]).includes(body.kind)) return fail('KIND_INVALID', 'kind');

  const city = text(body.city, 'city', { max: HEADHUNTER_LIMITS.city });
  if (typeof city !== 'string') return city;
  const tagline = text(body.tagline, 'tagline', { max: HEADHUNTER_LIMITS.tagline });
  if (typeof tagline !== 'string') return tagline;
  const about = text(body.about, 'about', { max: HEADHUNTER_LIMITS.about, paragraphs: true });
  if (typeof about !== 'string') return about;

  let share: { title?: string; description?: string } | undefined;
  if (body.share !== undefined && body.share !== null) {
    if (!isPlainObject(body.share) || Object.keys(body.share).some((key) => !(SHARE_KEYS as readonly string[]).includes(key))) return fail('FIELD_INVALID', 'share');
    const title = text(body.share.title, 'share.title', { max: HEADHUNTER_LIMITS.shareTitle });
    if (typeof title !== 'string') return title;
    const description = text(body.share.description, 'share.description', { max: HEADHUNTER_LIMITS.shareDescription });
    if (typeof description !== 'string') return description;
    if (title || description) share = { ...(title ? { title } : {}), ...(description ? { description } : {}) };
  }

  if (body.contact !== undefined && !isPlainObject(body.contact)) return fail('CONTACT_INVALID', 'contact');
  const rawContact = (body.contact ?? {}) as Record<string, unknown>;
  if (Object.keys(rawContact).some((key) => !(CONTACT_KEYS as readonly string[]).includes(key))) return fail('CONTACT_INVALID', 'contact');
  const contact: HeadhunterContact = {};
  for (const key of CONTACT_KEYS) {
    const raw = rawContact[key];
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) continue;
    if (typeof raw !== 'string') return fail('CONTACT_INVALID', `contact.${key}`);
    const value = contactValue(key, raw);
    if (!value) return fail('CONTACT_INVALID', `contact.${key}`);
    contact[key] = value;
  }
  if (Object.keys(contact).length === 0) return fail('CONTACT_REQUIRED', 'contact');

  if (options.requireAttestation && body.attested !== true) return fail('ATTESTATION_REQUIRED', 'attested');

  return {
    ok: true,
    value: {
      displayName,
      kind: body.kind as HeadhunterKind,
      ...(city ? { city } : {}),
      ...(tagline ? { tagline } : {}),
      ...(about ? { about } : {}),
      contact,
      ...(share ? { share } : {}),
    },
  };
}

function websiteLabel(href: string) {
  try {
    const url = new URL(href);
    return `${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return href;
  }
}

/** Public contact links in a fixed order, built from stored (normalised) values. */
export function contactLinks(contact: HeadhunterContact): ContactLink[] {
  const links: ContactLink[] = [];
  if (contact.email) links.push({ kind: 'email', href: `mailto:${contact.email}`, label: contact.email });
  if (contact.phone) links.push({ kind: 'phone', href: `tel:${contact.phone}`, label: contact.phone });
  if (contact.whatsapp) links.push({ kind: 'whatsapp', href: `https://wa.me/${contact.whatsapp}`, label: 'וואטסאפ' });
  if (contact.website) links.push({ kind: 'website', href: contact.website, label: websiteLabel(contact.website) });
  if (contact.linkedin) links.push({ kind: 'linkedin', href: contact.linkedin, label: 'LinkedIn' });
  return links;
}
