import { ImportError } from '../errors';
import type { XPlaceProfileImport, XPlaceTarget } from '../types';
import { cleanText, isUsableText, metaValues, titleTag, withoutScripts } from './clean';

const HEADLINE_MAX = 140;
const BIO_MAX = 1500;
const SOURCE_TEXT_MAX = 14_000;
const PROFILE_WARNING = 'XPlace מציגה בפומבי רק כותרת, תיאור ותמונה. ניסיון, כישורים והשכלה לא מיובאים; אפשר לצרף את הפרופיל כ־PDF.';

function firstUsable(candidates: string[], max: number, paragraphs = false): string {
  for (const raw of candidates) {
    const value = cleanText(raw, max, { paragraphs });
    if (isUsableText(value)) return value;
  }
  return '';
}

function memberSince(value: string | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return '';
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = year >= 1995 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/**
 * Reads the only parts of an anonymous XPlace profile page that are server-rendered:
 * title, meta description, Open Graph and the schema.org block. Everything else on the page is
 * unrendered AngularJS template and is never read. Photo and logo URLs are not imported.
 */
export function parseXPlaceProfileHtml(html: string, target: Extract<XPlaceTarget, { kind: 'profile' }>): Omit<XPlaceProfileImport, 'fetchedAt'> {
  const page = withoutScripts(String(html ?? ''));
  const title = titleTag(page).replace(/\s*\|\s*XPlace\s*$/i, '');

  const headline = firstUsable([
    ...metaValues(page, 'itemprop', 'name'),
    ...metaValues(page, 'property', 'og:title'),
    title,
  ], HEADLINE_MAX);
  const bio = firstUsable([
    ...metaValues(page, 'itemprop', 'description'),
    ...metaValues(page, 'property', 'og:description'),
    ...metaValues(page, 'name', 'description'),
  ], BIO_MAX, true);
  if (!headline && !bio) throw new ImportError('NOT_ENOUGH_DATA');

  const since = memberSince(metaValues(page, 'itemprop', 'foundingDate')[0]);
  const sourceText = [
    'XPlace profile (public page)',
    `Profile URL: ${target.canonicalUrl}`,
    headline ? `Headline: ${headline}` : '',
    bio ? `Public description: ${bio}` : '',
    since ? `Member since: ${since}` : '',
    'Only the public part of this XPlace profile is available: no skills, experience or education were imported.',
  ].filter(Boolean).join('\n').slice(0, SOURCE_TEXT_MAX);

  return {
    provider: 'xplace',
    url: target.canonicalUrl,
    sourceText,
    profile: { name: '', headline, bio, skills: [], portfolio: '', experience: '', education: '' },
    warnings: [PROFILE_WARNING],
  };
}
