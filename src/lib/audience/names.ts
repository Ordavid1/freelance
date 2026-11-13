// Derives a contact's first and last name from what Google sign-in exposes.
//
// Firebase Auth keeps a single `displayName` per Google account, and the ID token carries only
// the same combined `name` claim. Google's own OpenID profile does separate `given_name` and
// `family_name`, but Firebase returns them only once, in the sign-in result
// (`getAdditionalUserInfo(credential).profile`), and never stores them. So the separate parts
// are captured at sign-in; for accounts that signed in before that, the display name is split.
// Pure module: no server-only imports, shared by the sign-in route and the backfill script.

export type NameSource = 'google-profile' | 'display-name' | 'none';
export type PersonName = { firstName: string; lastName: string; source: NameSource };

const MAX_PART = 100;

// Names reach email templates and a third-party API: drop control and bidi marks, collapse
// whitespace, and remove characters that could be read as markup or template syntax.
export function cleanNamePart(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(/[\p{C}‎‏‪-‮⁦-⁩]/gu, '')
    .replace(/[<>{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PART)
    .trim();
}

// "First [middle...] Last" convention: the first token is the first name, everything after it is
// the last name. A single token is a first name only. Hebrew compound surnames ("בן גוריון") end
// up in lastName, which is the useful outcome for a greeting that only needs the first name.
export function splitDisplayName(displayName: unknown): { firstName: string; lastName: string } {
  const full = cleanNamePart(displayName);
  if (!full) return { firstName: '', lastName: '' };
  const [first, ...rest] = full.split(' ');
  return { firstName: first, lastName: rest.join(' ') };
}

export type NameInput = { givenName?: unknown; familyName?: unknown; displayName?: unknown };

export function deriveName(input: NameInput): PersonName {
  const firstName = cleanNamePart(input.givenName);
  const lastName = cleanNamePart(input.familyName);
  if (firstName) return { firstName, lastName, source: 'google-profile' };
  const split = splitDisplayName(input.displayName);
  if (split.firstName) return { ...split, source: 'display-name' };
  return { firstName: '', lastName: '', source: 'none' };
}

const RANK: Record<NameSource, number> = { none: 0, 'display-name': 1, 'google-profile': 2 };

// A later sign-in with weaker data (for example an older cached client that sends no profile)
// must not replace a name that came from Google's separate fields.
export function preferName(existing: PersonName | null | undefined, incoming: PersonName): PersonName {
  if (!existing || RANK[incoming.source] >= RANK[existing.source]) return incoming.source === 'none' && existing ? existing : incoming;
  return existing;
}
