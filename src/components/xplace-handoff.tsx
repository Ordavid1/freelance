'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { nextForPage, signInHref } from '@/lib/auth/safe-next';
import type { XPlaceProfileImport, XPlaceProjectImportResponse } from '@/lib/imports/types';
import { HANDOFF_PATHS, HANDOFF_QUERY_PARAM } from '@/lib/imports/xplace/handoff';
import { clearHandoff, dropHandoffParam, HandoffError, isExtensionInstalled, requestHandoffPayload, takeHandoffToken } from '@/lib/imports/xplace/handoff-client';
import styles from './xplace-handoff.module.css';

export type XPlaceFlags = { loaded: boolean; enabled: boolean; linkImport: boolean; extensionUrl: string };
const DARK: XPlaceFlags = { loaded: false, enabled: false, linkImport: false, extensionUrl: '' };

/** The importer ships dark: nothing renders unless the server reports it enabled. */
export function useXPlaceFlags(): XPlaceFlags {
  const [flags, setFlags] = useState<XPlaceFlags>(DARK);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/integrations/xplace', { cache: 'no-store' })
      .then(async (response) => {
        const data = response.ok ? await response.json() as { enabled?: unknown; linkImport?: unknown; extensionUrl?: unknown } : null;
        const enabled = data?.enabled === true;
        if (!cancelled) setFlags({ loaded: true, enabled, linkImport: enabled && data?.linkImport === true, extensionUrl: enabled && typeof data?.extensionUrl === 'string' ? data.extensionUrl : '' });
      })
      .catch(() => { if (!cancelled) setFlags({ ...DARK, loaded: true }); });
    return () => { cancelled = true; };
  }, []);
  return flags;
}

/** null while detecting. */
export function useExtensionInstalled(): boolean | null {
  const [installed, setInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void isExtensionInstalled().then((value) => { if (!cancelled) setInstalled(value); });
    return () => { cancelled = true; };
  }, []);
  return installed;
}

export type IngestResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** POST /api/integrations/xplace/ingest. `payload` is whatever the extension captured (or the pasted text). */
export async function postIngest<T>(payload: unknown, attested: boolean): Promise<IngestResult<T>> {
  try {
    const response = await fetch('/api/integrations/xplace/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload, attested }) });
    const data = await response.json().catch(() => null) as (Record<string, unknown> & { error?: string }) | null;
    if (!response.ok || !data) return { ok: false, status: response.status, message: (typeof data?.error === 'string' && data.error) || 'הייבוא מ־XPlace נכשל. נסו שוב.' };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, message: 'הייבוא מ־XPlace נכשל. בדקו את החיבור ונסו שוב.' };
  }
}

export const HANDOFF_MESSAGES = {
  timeout: 'לא קיבלנו מידע מהתוסף. ודאו שהתוסף מותקן ופעיל, ואז התחילו מחדש מתוך XPlace.',
  expired: 'הקישור מהתוסף פג תוקף. התחילו מחדש מתוך XPlace.',
  invalid: 'המידע שנקלט מהתוסף אינו תקין. התחילו מחדש מתוך XPlace.',
} as const;

type Kind = 'profile' | 'project';
export type HandoffPhase =
  | { name: 'idle' }
  | { name: 'reading' }
  | { name: 'attest'; token: string; payload: Record<string, unknown> }
  | { name: 'importing'; ownerDetected: boolean }
  | { name: 'done' }
  | { name: 'error'; message: string }
  | { name: 'signin' }
  | { name: 'wrong-kind'; token: string; actual: Kind };

const OWNER_TEXT: Record<Kind, string> = { profile: 'XPlace זיהתה שהפרופיל הזה שלכם.', project: 'XPlace זיהתה שהפרויקט הזה שלכם.' };

/**
 * State machine shared by every extension hand-off on a page: check the payload kind, apply the attestation rule
 * (auto-true only when XPlace's own `ownerSignal === true`, otherwise a required checkbox), call the ingest API,
 * then clear the token in the extension and drop it from the address bar.
 */
export function useXPlaceIngest<T extends XPlaceProfileImport | XPlaceProjectImportResponse>(kind: Kind, onImported: (data: T) => void) {
  const [phase, setPhase] = useState<HandoffPhase>({ name: 'idle' });
  const onImportedRef = useRef(onImported);
  const phaseRef = useRef<HandoffPhase>(phase);
  useEffect(() => { onImportedRef.current = onImported; phaseRef.current = phase; });

  const run = useCallback(async (token: string, payload: Record<string, unknown>, attested: boolean) => {
    setPhase({ name: 'importing', ownerDetected: payload.ownerSignal === true });
    const result = await postIngest<T>(payload, attested);
    if (!result.ok) { setPhase(result.status === 401 ? { name: 'signin' } : { name: 'error', message: result.message }); return; }
    onImportedRef.current(result.data);
    clearHandoff(token);
    dropHandoffParam();
    setPhase({ name: 'done' });
  }, []);

  const accept = useCallback((token: string, payload: unknown) => {
    const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
    const actual = record?.kind;
    if (actual !== 'profile' && actual !== 'project') { setPhase({ name: 'error', message: HANDOFF_MESSAGES.invalid }); return; }
    if (actual !== kind) { setPhase({ name: 'wrong-kind', token, actual }); return; }
    if (record!.ownerSignal === true) void run(token, record!, true);
    else setPhase({ name: 'attest', token, payload: record! });
  }, [kind, run]);

  const confirm = useCallback(() => {
    const current = phaseRef.current;
    if (current.name === 'attest') void run(current.token, current.payload, true);
  }, [run]);

  const fail = useCallback((error: unknown) => {
    const reason = error instanceof HandoffError ? error.reason : 'unavailable';
    if (reason === 'cancelled') { setPhase({ name: 'idle' }); return; }
    setPhase({ name: 'error', message: reason === 'timeout' ? HANDOFF_MESSAGES.timeout : reason === 'expired' ? HANDOFF_MESSAGES.expired : HANDOFF_MESSAGES.invalid });
  }, []);

  return { phase, setPhase, accept, confirm, fail };
}

/**
 * Automatic hand-off on page load: when `?xplace=<token>` is present, reads the payload from the extension's bridge
 * and feeds it to the ingest flow. `signedIn` is null while the session is unknown; a signed-out viewer is sent to
 * sign-in with the full path and query preserved. Runs at most once per mount.
 */
export function useAutoHandoff(ingest: ReturnType<typeof useXPlaceIngest>, flags: XPlaceFlags, signedIn: boolean | null) {
  const started = useRef(false);
  const { setPhase, accept, fail } = ingest;
  useEffect(() => {
    if (started.current || !flags.loaded || signedIn === null) return;
    started.current = true;
    const token = takeHandoffToken();
    if (!token || !flags.enabled) return;
    if (!signedIn) { setPhase({ name: 'signin' }); return; }
    setPhase({ name: 'reading' });
    requestHandoffPayload(token).then((payload) => accept(token, payload), fail);
  }, [flags.loaded, flags.enabled, signedIn, setPhase, accept, fail]);
}

/** Sign-in link for the current page; the query string (with the hand-off token) survives the detour. */
function currentSignInHref(): string {
  if (typeof window === 'undefined') return signInHref(HANDOFF_PATHS.profile);
  return signInHref(nextForPage(window.location.pathname, window.location.search));
}

const WRONG_KIND = {
  project: { text: 'התוסף שלח פרויקט, לא פרופיל.', href: HANDOFF_PATHS.project, label: 'המשיכו לפרסום הפרויקט' },
  profile: { text: 'התוסף שלח פרופיל, לא פרויקט.', href: HANDOFF_PATHS.profile, label: 'המשיכו להקמת הפרופיל' },
} as const;

/** Renders the current phase of a hand-off. Renders nothing while idle or done. */
export function HandoffNotice({ phase, kind, onConfirm }: { phase: HandoffPhase; kind: Kind; onConfirm: () => void }) {
  const [owner, setOwner] = useState(false);
  if (phase.name === 'idle' || phase.name === 'done') return null;
  if (phase.name === 'reading') return <div className={styles.notice} role="status"><p>קוראים את המידע מהתוסף…</p></div>;
  if (phase.name === 'importing') return <div className={styles.notice} role="status">{phase.ownerDetected && <p className={styles.owner}>{OWNER_TEXT[kind]}</p>}<p>מייבאים…</p></div>;
  if (phase.name === 'error') return <div className={styles.notice}><p role="alert" className={styles.error}>{phase.message}</p></div>;
  if (phase.name === 'signin') return <div className={styles.notice}><p>כדי להשלים את הייבוא מ־XPlace יש להתחבר ל־Freelance Place. הנתונים מחכים לכם בתוסף.</p><div className={styles.actions}><a className={styles.link} href={currentSignInHref()}>התחברות</a></div></div>;
  if (phase.name === 'wrong-kind') {
    const info = WRONG_KIND[phase.actual];
    return <div className={styles.notice}><p role="alert">{info.text}</p><div className={styles.actions}><Link className={styles.link} href={`${info.href}?${HANDOFF_QUERY_PARAM}=${phase.token}`}>{info.label}</Link></div></div>;
  }
  return <div className={styles.notice}>
    <label className={styles.check}><input type="checkbox" checked={owner} onChange={(event) => setOwner(event.target.checked)}/><span>{kind === 'profile' ? 'אני הבעלים/ת של הפרופיל הזה ב־XPlace.' : 'אני הבעלים/ת של הפרויקט הזה ב־XPlace או מורשה/ית לפרסם אותו.'}</span></label>
    <div className={styles.actions}><button type="button" className={styles.button} disabled={!owner} onClick={onConfirm}>המשך לייבוא</button></div>
  </div>;
}
