// Shared contracts for link importers (XPlace is the first provider).
// Isomorphic: this module must stay free of `server-only` and Node-only imports so
// client components can use the types and the URL parser with the exact code the
// server runs.

export type ImportProvider = 'xplace';

/** `extension`: captured by the browser extension on the user's own page. `link`: a pasted public link read by the server. */
export type ImportCapture = 'extension' | 'link';

/** A recognised, canonicalised XPlace page. A project's `fetchUrl` is the only URL the server ever requests; profiles are never fetched (they arrive through the extension or pasted text). */
export type XPlaceTarget =
  | { kind: 'profile'; slug: string; canonicalUrl: string }
  | { kind: 'project'; projectId: string; canonicalUrl: string; fetchUrl: string };

export type XPlaceImportErrorCode =
  | 'IMPORT_DISABLED'
  | 'INVALID_URL'
  | 'ATTESTATION_REQUIRED'
  | 'INVALID_PAYLOAD'
  | 'NOT_FOUND'
  | 'NOT_ENOUGH_DATA'
  | 'UPSTREAM_UNAVAILABLE'
  | 'RATE_LIMITED';

/** Error body of every XPlace import route: Hebrew `error`, always `Cache-Control: no-store`. */
export type XPlaceImportError = { code: XPlaceImportErrorCode; error: string };

/** Same shape as the Dribbble import so the profile studio can treat all sources alike. */
export type XPlaceProfileImport = {
  provider: 'xplace';
  /** Canonical profile URL. */
  url: string;
  /** Labelled plain text for profile generation, at most 14 000 characters. */
  sourceText: string;
  profile: {
    name: string;
    headline: string;
    bio: string;
    skills: string[];
    portfolio: string;
    experience: string;
    education: string;
  };
  fetchedAt: string;
  /** Hebrew, user-facing notes (for example, that only the public part of the profile is available). */
  warnings: string[];
  /** How the data reached us; absent on link imports (treated as `link`). */
  captured?: ImportCapture;
  /** Echo of the extension's ownership flag (provenance only, never proof). Extension captures only. */
  ownerSignal?: boolean | null;
  /** Entry counts for the source card. Extension captures only. */
  counts?: { expertise: number; employment: number; education: number };
};

export type XPlaceProjectDraft = {
  title: string;
  description: string;
  /** Always the neutral default; the publisher picks the category in the review step. */
  category: string;
  /** `₪5,000` when XPlace shows an amount, otherwise an empty string. */
  budget: string;
  /** Project due date as dd/mm/yyyy, otherwise `גמיש`. Never the proposal-expiry date. */
  deadline: string;
  skills: string[];
};

/**
 * Result of comparing the publisher shown on XPlace with the user's publisher profile name.
 * `no-profile`: the user has no publisher profile name yet. `unknown`: the XPlace page shows no publisher name.
 */
export type PublisherMatch = 'match' | 'mismatch' | 'unknown' | 'no-profile';

export type XPlaceProjectImportResponse = {
  provider: 'xplace';
  /** Canonical, user-facing project URL (`/il/job-bids/<id>`). */
  url: string;
  externalId: string;
  draft: XPlaceProjectDraft;
  /** True when only truncated meta data was available (the description may be incomplete). */
  partial: boolean;
  publisher: {
    /** Company display name read from the XPlace page; empty when the page does not show one. */
    sourceName: string;
    match: PublisherMatch;
    /** The user's current publisher profile name; empty when there is none. */
    profileName: string;
    /** Prefill for creating a publisher profile: source name, else the account name. */
    suggestedName: string;
  };
  fetchedAt: string;
  warnings: string[];
  /** How the data reached us; absent on link imports (treated as `link`). */
  captured?: ImportCapture;
  /** Echo of the extension's ownership flag (provenance only, never proof). Extension captures only. */
  ownerSignal?: boolean | null;
};

// ---------------------------------------------------------------------------------------------
// Payloads captured by the browser extension from the user's own XPlace page.
// They are untrusted client input: the ingest routes validate the shape, clean every string,
// cap every list and rebuild the import objects above from them. Nothing here may carry
// contact details, other people's data or anything outside the allowlisted page sections.
// ---------------------------------------------------------------------------------------------

export type XPlaceCapturedProfile = {
  kind: 'profile';
  /** Page URL; the server accepts only what `parseXPlaceUrl` recognises as a profile and stores the canonical form. */
  url: string;
  /** XPlace's own "the viewer owns this page" flag (inline script variable); null when it could not be read. */
  ownerSignal: boolean | null;
  headline: string;
  slogan: string;
  location: string;
  about: string;
  languages: { name: string; level: string }[];
  /** "תחומי התמחות" entries: industry group heading, the category/tags line, free-text description. Never rates. */
  expertise: { industry: string; name: string; description: string }[];
  employment: { period: string; position: string; company: string; description: string }[];
  education: { period: string; degree: string; institution: string; description: string }[];
  /** Sections whose entry layout is not modelled: one plain-text entry per list item. */
  otherSections: { section: 'courses' | 'volunteering' | 'military' | 'patents' | 'articles'; entries: string[] }[];
  links: { url: string; title: string; description: string }[];
};

export type XPlaceCapturedProject = {
  kind: 'project';
  url: string;
  ownerSignal: boolean | null;
  projectId: string;
  title: string;
  description: string;
  /** Numeric budget when XPlace gives one. */
  amount: number | null;
  /** Project due date as an ISO date, or null when flexible. Never the proposal-expiry date. */
  dueDate: string | null;
  categories: string[];
  /** Company display name only; never a person's name, phone number or logo. */
  publisherName: string;
};

/** Profile text the user copied from their own XPlace page and pasted into the profile studio (no extension). */
export type XPlacePastedProfile = { kind: 'profile-text'; text: string };

export type XPlaceCapturedPayload = XPlaceCapturedProfile | XPlaceCapturedProject | XPlacePastedProfile;

/** What the importer core returns; the API route adds the publisher cross-reference on top. */
export type XPlaceProjectImport = Omit<XPlaceProjectImportResponse, 'publisher'> & { publisherName: string };

/** Optional provenance sent with `POST /api/marketplace/projects` when the draft came from an import. */
export type ProjectImportProvenance = {
  provider: 'xplace';
  url: string;
  attested: true;
  publisherNameOnSource?: string;
  createPublisherName?: string;
  publisherMismatchConfirmed?: boolean;
  /** Defaults to `link` when omitted. */
  captured?: ImportCapture;
  /** The extension's ownership flag as reported by the client: provenance only, never proof. Defaults to null. */
  ownerSignal?: boolean | null;
};

/** Stored on the project document as `importSource`; never exposed by `toPublicProject`. */
export type ProjectImportSource = {
  provider: 'xplace';
  /** `xplace:project:<id>`, unique per owner. */
  key: string;
  url: string;
  externalId: string;
  publisherNameOnSource: string;
  publisherMatch: 'match' | 'unknown' | 'mismatch-confirmed' | 'created';
  captured: ImportCapture;
  ownerSignal: boolean | null;
  importedAt: unknown;
};
