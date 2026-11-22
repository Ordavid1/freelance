import type { HEADHUNTER_KINDS, HEADHUNTER_STATUSES } from './constants.ts';

export type HeadhunterStatus = (typeof HEADHUNTER_STATUSES)[number];
export type HeadhunterKind = (typeof HEADHUNTER_KINDS)[number];

/** Normalised values, as stored. */
export type HeadhunterContact = { email?: string; phone?: string; whatsapp?: string; website?: string; linkedin?: string };

export type HeadhunterInput = {
  displayName: string;
  kind: HeadhunterKind;
  city?: string;
  tagline?: string;
  about?: string;
  contact: HeadhunterContact;
  share?: { title?: string; description?: string };
  /** Chosen at apply time only: the page goes live on approval and has HEADHUNTER_FAST_TRACK_HOURS to reach the threshold. */
  fastTrack?: boolean;
};

/** The Firestore document `headhunters/{ownerUid}`. Timestamps are `unknown` here (a Firestore Timestamp on the server). */
export type HeadhunterRecord = {
  ownerUid: string;
  status: HeadhunterStatus;
  displayName: string;
  handle: string;
  kind: HeadhunterKind;
  city?: string;
  tagline?: string;
  about?: string;
  contact: HeadhunterContact;
  /** Storage object path. */
  logo?: string;
  share?: { title?: string; description?: string; /** Storage object path. */ image?: string };
  counters: { published: number; lastProjectAt?: unknown };
  /** Moderator review flags, e.g. `lookalike:google` (set from the handle check; never a rejection). */
  flags?: string[];
  /** Why the record is waiting for a (new) review or needs changes: shown to the owner. */
  reviewReason?: string;
  eligibleAt?: unknown;
  /** Fast-track only (see HeadhunterInput.fastTrack). */
  fastTrack?: boolean;
  /** Set once, at the first approval of a fast-track record: approvedAt + HEADHUNTER_FAST_TRACK_HOURS. */
  trialEndsAt?: unknown;
  approvedAt?: unknown;
  approvedBy?: string;
  rejectedReason?: string;
  suspendedReason?: string;
  renamedAt?: unknown;
  attestedAt?: unknown;
  version: number;
  createdAt?: unknown;
  updatedAt?: unknown;
};

/** The document `handles/{handle}`. */
export type HandleRecord = {
  handle: string;
  ownerUid: string;
  state: 'active' | 'retired';
  /** `handleSkeleton(handle)`: lets one single-field query find look-alike claims. */
  skeleton: string;
  pointsTo?: string;
  createdAt?: unknown;
  retiredAt?: unknown;
};

/** The only headhunter data ever attached to a public project. */
export type PublicHeadhunterTag = { name: string; handle: string };

export type ContactLink = { kind: keyof HeadhunterContact; href: string; label: string };
