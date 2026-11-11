import 'server-only';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';
import { enforceActionLimit } from '@/lib/security/rate-limit';
import { readJsonBody } from '@/lib/security/request-body';
import { ImportError, importErrorResponse } from '@/lib/imports/errors';
import { isXPlaceImportEnabled, isXPlaceLinkImportEnabled } from '@/lib/imports/flag';
import type { XPlaceProjectImport, XPlaceProjectImportResponse } from '../types';
import { matchPublisher } from './publisher-match';

export type ImportUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
type LimitAction = 'import.xplace' | 'import.xplace.ingest';

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
  kind: 'profile' | 'project' | 'ingest';
  /** `link`: the server fetches a pasted public link (needs the link flag). `ingest`: payload captured by the extension, no network. */
  source: 'link' | 'ingest';
  maxBodyBytes: number;
  action: LimitAction;
  /** Hebrew 401 message. */
  unauthenticatedMessage: string;
  /**
   * Validates the body after the attestation check and before the limiter. Throws ImportError.
   * `canonicalUrl` is only hashed for the log line.
   */
  prepare: (body: Record<string, unknown>) => { canonicalUrl: string; input: T; /** URL string hashed for the log line; defaults to `canonicalUrl`. For link imports it is the URL the fetch layer hashes, so a fetch and its import correlate. */ logUrl?: string; kind?: 'profile' | 'project' | 'profile-text' };
  /** The work behind the limiter. Throws ImportError or ImportAbort; the returned value is the JSON body. */
  run: (input: T, user: ImportUser) => Promise<unknown>;
};

const noStore = { 'Cache-Control': 'no-store' };

/**
 * The shared request pipeline of every XPlace import route, in one fixed order:
 * flag(s) -> same origin -> session -> JSON body -> attestation -> validation -> per-account limiter -> work.
 * Every outcome is one `xplace_import` JSON log line (URL hash only; never the raw URL or the user id).
 */
export async function handleImportRoute<T>(request: Request, spec: ImportRouteSpec<T>): Promise<Response> {
  const enabled = spec.source === 'link' ? isXPlaceLinkImportEnabled() : isXPlaceImportEnabled();
  if (!enabled) return importErrorResponse(new ImportError('IMPORT_DISABLED'));
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: spec.unauthenticatedMessage }, { status: 401 });
  const parsedBody = await readJsonBody(request, spec.maxBodyBytes);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.value;
  if (body.attested !== true) return importErrorResponse(new ImportError('ATTESTATION_REQUIRED'));

  let prepared: ReturnType<ImportRouteSpec<T>['prepare']>;
  try {
    prepared = spec.prepare(body);
  } catch (error) {
    return importErrorResponse(error instanceof ImportError ? error : new ImportError('INVALID_PAYLOAD'));
  }
  const limited = await enforceActionLimit(user.uid, spec.action);
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
