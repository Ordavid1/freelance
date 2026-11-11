// Compares the publisher shown on an imported project page with the publisher profile name of
// the importing user. Pure and isomorphic; the result only decides which confirmation the
// publish step asks for, it is never a proof of identity.
import type { PublisherMatch } from '../types';

const LEGAL_SUFFIXES = new Set(['בעמ', 'ltd', 'limited', 'inc', 'llc', 'corp', 'co', 'company', 'gmbh']);
const MIN_CONTAINED_CHARS = 3;

function normalize(value: string): string[] {
  return value.normalize('NFKC').toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'״׳’“”`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token && !LEGAL_SUFFIXES.has(token));
}

/** The whole name plus its `|`, `/`, `•` and spaced-dash separated parts ("Osys | אוסיס פתרונות תוכנה"). */
function candidates(sourceName: string): string[][] {
  const parts = sourceName.split(/\||\/|•|\s[-–—]\s/);
  return [sourceName, ...parts].map(normalize).filter((tokens) => tokens.length > 0);
}

function sameName(left: string[], right: string[]): boolean {
  const a = new Set(left); const b = new Set(right);
  if (a.size === b.size && [...a].every((token) => b.has(token))) return true;
  const [shorter, longer] = a.size <= b.size ? [a, b] : [b, a];
  return [...shorter].join('').length >= MIN_CONTAINED_CHARS && [...shorter].every((token) => longer.has(token));
}

export function matchPublisher(sourceName: string, profileName: string): PublisherMatch {
  const profile = normalize(profileName || '');
  if (!profile.length) return 'no-profile';
  const options = candidates(sourceName || '');
  if (!options.length) return 'unknown';
  return options.some((option) => sameName(option, profile)) ? 'match' : 'mismatch';
}
