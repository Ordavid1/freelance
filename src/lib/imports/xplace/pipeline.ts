import 'server-only';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { firestore } from '@/lib/db/firestore';
import { ImportError, importErrorResponse } from '@/lib/imports/errors';
import { isXPlaceImportEnabled, isXPlaceLinkImportEnabled } from '@/lib/imports/flag';
import type { XPlaceProjectImport, XPlaceProjectImportResponse } from '../types';
import { matchPublisher } from './publisher-match';

export type ImportUser = { uid: string; email: string | null; name: string | null };

/** Thrown by a route's `run` step to answer with a specific response (and log status) instead of an ImportError. */
export class ImportAbort extends Error {
  readonly response: Response;
  readonly status: string;
  constructor(response: Response, status: string) {
    super(status);
    this.name = 'ImportAbort';
    this.response = response;
    this.status = status;
  }
}

export type ImportRouteSpec<T> = {
  kind: 'project' | 'ingest';
  /** `link`: the server fetches a pasted public link (needs the link flag). `ingest`: payload captured by the extension, no network. */
  source: 'link' | 'ingest';
  /**
   * Validates the body after the attestation check and before the limiter. Throws ImportError.
   * `canonicalUrl` is only hashed for the log line.
   */
  prepare: (body: Record<string, unknown>) => { canonicalUrl: string; input: T; /** URL string hashed for the log line; defaults to `canonicalUrl`. For link imports it is the URL the fetch layer hashes, so a fetch and its import correlate. */ logUrl?: string; kind?: 'profile' | 'project' | 'profile-text' };
  /** The work behind the limiter. Throws ImportError or ImportAbort; the returned value is the JSON body. */
  run: (input: T, user: ImportUser) => Promise<unknown>;
};

const noStore = { 'Cache-Control': 'no-store' };

/** The route's feature flag, as the policy layer's `gate`: the link route needs its own flag on top of the master one. */
export function importGate(source: ImportRouteSpec<unknown>['source']): { ok: true } | { ok: false; response: Response } {
  const enabled = source === 'link' ? isXPlaceLinkImportEnabled() : isXPlaceImportEnabled();
  return enabled ? { ok: true } : { ok: false, response: importErrorResponse(new ImportError('IMPORT_DISABLED')) };
}

/** What the policy layer hands over once flag, origin, session, account state and body are settled. */
export type ImportRouteContext = {
  user: ImportUser;
  body: Record<string, unknown>;
  /** Spends the operation's budgets (per-account limit, site-wide budget); returns the response to send when one is exhausted. */
  charge: () => Promise<Response | null>;
};

/**
 * The shared pipeline of every XPlace import route. The request policy layer has already run, in its fixed
 * order: flag -> same origin -> session -> account state -> JSON body. This adds the import's own steps:
 * attestation -> validation -> budgets -> work. The budgets are spent last on purpose, so a request that is
 * rejected as invalid never uses the per-account limit or the site-wide budget.
 * Every outcome is one `xplace_import` JSON log line (URL hash only; never the raw URL or the user id).
 */
export async function handleImportRoute<T>({ user, body, charge }: ImportRouteContext, spec: ImportRouteSpec<T>): Promise<Response> {
  if (body.attested !== true) return importErrorResponse(new ImportError('ATTESTATION_REQUIRED'));

  let prepared: ReturnType<ImportRouteSpec<T>['prepare']>;
  try {
    prepared = spec.prepare(body);
  } catch (error) {
    return importErrorResponse(error instanceof ImportError ? error : new ImportError('INVALID_PAYLOAD'));
  }
  const limited = await charge();
  if (limited) return limited;

  const startedAt = Date.now();
  const urlSha256 = createHash('sha256').update(prepared.logUrl ?? prepared.canonicalUrl).digest('hex');
  const log = (status: string) => console.info(JSON.stringify({
    severity: status === 'success' ? 'INFO' : 'WARNING', event: 'xplace_import', kind: prepared.kind ?? spec.kind, source: spec.source, status,
    durationMs: Date.now() - startedAt, urlSha256,
  }));
  try {
    const result = await spec.run(prepared.input, user);
    log('success');
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    if (error instanceof ImportAbort) {
      log(error.status);
      return error.response;
    }
    const failure = error instanceof ImportError ? error : new ImportError(spec.source === 'link' ? 'UPSTREAM_UNAVAILABLE' : 'INVALID_PAYLOAD');
    log(failure.code);
    return importErrorResponse(failure);
  }
}

/**
 * Publisher cross-reference shared by the link and the ingest project routes: compares the publisher
 * shown on XPlace with the user's publisher profile name. The result only decides which confirmation
 * the publish step asks for; it is never proof of identity.
 */
export async function withPublisherCrossReference(result: XPlaceProjectImport, user: ImportUser): Promise<XPlaceProjectImportResponse> {
  let profileName = '';
  try {
    const snapshot = await firestore().collection('profiles').doc(user.uid).get();
    const name = snapshot.exists ? snapshot.get('name') : '';
    profileName = typeof name === 'string' ? name.trim() : '';
  } catch {
    throw new ImportAbort(
      NextResponse.json({ error: 'לא הצלחנו לבדוק את פרופיל המפרסם. נסו שוב.' }, { status: 503, headers: noStore }),
      'profile_unavailable');
  }
  const { publisherName, ...rest } = result;
  return {
    ...rest,
    publisher: {
      sourceName: publisherName,
      match: matchPublisher(publisherName, profileName),
      profileName,
      suggestedName: publisherName || user.name || user.email?.split('@')[0] || '',
    },
  };
}
