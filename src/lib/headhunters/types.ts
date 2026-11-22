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
  counters: { published: number };
  eligibleAt?: unknown;
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
  pointsTo?: string;
  createdAt?: unknown;
  retiredAt?: unknown;
};

/** The only headhunter data ever attached to a public project. */
export type PublicHeadhunterTag = { name: string; handle: string };

export type ContactLink = { kind: keyof HeadhunterContact; href: string; label: string };
