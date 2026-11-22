import { isReservedHandle, RESERVED_BRAND_WORDS, RESERVED_ROUTE_SEGMENTS, RESERVED_WORDS, WATCHED_BRAND_TERMS } from './reserved.ts';

export const HANDLE_FORMAT_ERROR = 'הכתובת חייבת להכיל 3 עד 30 תווים: אותיות באנגלית קטנות, ספרות ומקף בודד, ולהתחיל ולהסתיים באות או בספרה.';
export const HANDLE_RESERVED_ERROR = 'הכתובת הזו שמורה או דומה מדי לשם שמור. נסו כתובת אחרת.';

const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const SKELETON_MIN_CONTAINS = 5;
const CONFUSABLES: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' };

export function normalizeHandle(input: unknown): string {
  return typeof input === 'string' ? input.trim().toLowerCase() : '';
}

export function isHandleFormat(handle: string): boolean {
  return typeof handle === 'string' && HANDLE_PATTERN.test(handle) && !handle.includes('--');
}

/** Look-alike skeleton: two handles that read the same to a person share a skeleton. */
export function handleSkeleton(handle: string): string {
  return handle.replace(/-/g, '').replace(/[0-9]/g, (digit) => CONFUSABLES[digit] ?? digit).replace(/l/g, 'i').replace(/rn/g, 'm').replace(/vv/g, 'w');
  // `1`, `l` and `i` all fold to `i`, so `adm1n`, `xp1ace` and `xpiace` match their originals.
}

const reservedSkeletons = new Set([...RESERVED_ROUTE_SEGMENTS, ...RESERVED_WORDS].map(handleSkeleton));
const brandSkeletons = RESERVED_BRAND_WORDS.map(handleSkeleton).filter((skeleton) => skeleton.length >= SKELETON_MIN_CONTAINS);
const watchedSkeletons = WATCHED_BRAND_TERMS.map((term) => ({ term, skeleton: handleSkeleton(term) }));

export type HandleValidation =
  | { ok: true; handle: string; flags: string[] }
  | { ok: false; code: 'FORMAT' | 'RESERVED'; error: string };

export function validateHandle(input: unknown): HandleValidation {
  const handle = normalizeHandle(input);
  if (!isHandleFormat(handle)) return { ok: false, code: 'FORMAT', error: HANDLE_FORMAT_ERROR };
  const skeleton = handleSkeleton(handle);
  if (isReservedHandle(handle) || reservedSkeletons.has(skeleton) || brandSkeletons.some((brand) => skeleton.includes(brand))) {
    return { ok: false, code: 'RESERVED', error: HANDLE_RESERVED_ERROR };
  }
  const flags = watchedSkeletons
    .filter(({ skeleton: term }) => skeleton === term || (term.length >= SKELETON_MIN_CONTAINS && skeleton.includes(term)))
    .map(({ term }) => `lookalike:${term}`);
  return { ok: true, handle, flags };
}

const HEBREW: Record<string, string> = {
  'א': 'a', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v', 'ז': 'z', 'ח': 'ch', 'ט': 't', 'י': 'y', 'כ': 'k', 'ך': 'k',
  'ל': 'l', 'מ': 'm', 'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's', 'ע': 'a', 'פ': 'p', 'ף': 'p', 'צ': 'tz', 'ץ': 'tz', 'ק': 'k',
  'ר': 'r', 'ש': 'sh', 'ת': 't',
};

/** A suggested handle for a display name (Latin slug or simple Hebrew transliteration), or '' when none is usable. */
export function suggestHandle(displayName: string): string {
  if (typeof displayName !== 'string') return '';
  const latin = displayName
    .replace(/[֑-ׇ]/g, '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[א-ת]/g, (letter) => HEBREW[letter] ?? '');
  let slug = latin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
  slug = slug.replace(/-{2,}/g, '-');
  return validateHandle(slug).ok ? slug : '';
}
