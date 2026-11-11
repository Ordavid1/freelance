'use client';
import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { trackEvent } from '@/lib/analytics';
import { parseXPlaceUrl } from '@/lib/imports/xplace/urls';
import type { ProjectImportProvenance, XPlaceProjectImportResponse } from '@/lib/imports/types';
import { useExtensionInstalled, type XPlaceFlags } from './xplace-handoff';
import styles from './xplace-project-import.module.css';

/**
 * Panel at the top of the project composer. With the link importer enabled: the collapsed paste-link form.
 * Otherwise a small hint that points at the browser extension on the XPlace project page.
 */
export function XPlaceProjectImport({ onImported, disabled = false, flags }: { onImported: (result: XPlaceProjectImportResponse) => void; disabled?: boolean; flags: XPlaceFlags }) {
  const enabled = flags.enabled;
  const installed = useExtensionInstalled();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!enabled) return null;
  if (!flags.linkImport) return <section className={styles.panel} aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>יש לכם כבר פרויקט ב־XPlace?</h2>
    <p className={styles.hint}>בעמוד הפרויקט ב־XPlace לחצו על הכפתור של התוסף.</p>
    {installed === false && flags.extensionUrl && <a className={styles.source} href={flags.extensionUrl} target="_blank" rel="noopener noreferrer">התקנת התוסף של Freelance Place ↗</a>}
  </section>;

  async function submit() {
    const target = parseXPlaceUrl(url);
    if (!target || target.kind !== 'project') { setError('הדביקו קישור לפרויקט ציבורי ב־XPlace.'); return; }
    if (!owner) return;
    trackEvent('xplace_project_import_started');
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/integrations/xplace/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim(), attested: true }) });
      const data = await response.json().catch(() => null) as (Partial<XPlaceProjectImportResponse> & { error?: string }) | null;
      if (!response.ok || !data?.draft || !data.publisher) throw new Error(data?.error || 'הייבוא מ־XPlace נכשל. נסו שוב.');
      trackEvent('xplace_project_import_completed');
      onImported(data as XPlaceProjectImportResponse);
      setOpen(false);
      setUrl('');
      setOwner(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'הייבוא מ־XPlace נכשל. נסו שוב.');
    } finally { setBusy(false); }
  }

  return <section className={styles.panel} aria-labelledby={`${id}-title`}>
    <div className={styles.head}>
      <h2 id={`${id}-title`}>יש לכם כבר פרויקט ב־XPlace?</h2>
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={`${id}-form`} disabled={disabled || busy} onClick={() => { setOpen(!open); setError(''); }}>ייבוא מ־XPlace</button>
    </div>
    {open && <form id={`${id}-form`} className={styles.form} onSubmit={(event) => { event.preventDefault(); if (!busy) void submit(); }}>
      <label htmlFor={`${id}-url`}>קישור לפרויקט ב־XPlace</label>
      <input id={`${id}-url`} type="url" dir="ltr" required placeholder="https://www.xplace.com/project?id=…" value={url} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => { setUrl(event.target.value); setError(''); }}/>
      <label className={styles.check}><input type="checkbox" required checked={owner} disabled={busy} onChange={(event) => setOwner(event.target.checked)}/><span>אני הבעלים/ת של הפרויקט הזה ב־XPlace או מורשה/ית לפרסם אותו.</span></label>
      <div aria-live="polite">{error && <p id={`${id}-error`} role="alert" className={styles.error}>{error}</p>}</div>
      <div className={styles.actions}><button type="submit" className={styles.submit} disabled={busy || !owner}>{busy ? 'מייבאים…' : 'ייבוא'}</button></div>
    </form>}
  </section>;
}

export type XPlaceImportState = { result: XPlaceProjectImportResponse; mismatchConfirmed: boolean; createName: string };

export function newImportState(result: XPlaceProjectImportResponse): XPlaceImportState {
  return { result, mismatchConfirmed: false, createName: result.publisher.suggestedName || '' };
}

/** True when the active publisher condition (mismatch ticked, name filled) allows publishing. */
export function importReadyToPublish(state: XPlaceImportState | null) {
  if (!state) return true;
  const { match } = state.result.publisher;
  if (match === 'mismatch') return state.mismatchConfirmed;
  if (match === 'no-profile') return state.createName.trim().length > 0 && state.createName.trim().length <= 200;
  return true;
}

export function buildImportProvenance(state: XPlaceImportState): ProjectImportProvenance {
  const { result } = state;
  const { match, sourceName } = result.publisher;
  return {
    provider: 'xplace', url: result.url, attested: true,
    captured: result.captured ?? 'link', ownerSignal: result.ownerSignal ?? null,
    ...(sourceName ? { publisherNameOnSource: sourceName.slice(0, 200) } : {}),
    ...(match === 'no-profile' ? { createPublisherName: state.createName.trim() } : {}),
    ...(match === 'mismatch' && state.mismatchConfirmed ? { publisherMismatchConfirmed: true } : {}),
  };
}

/** Shown inside the review block: draft notice, source link, warnings and the publisher cross-reference. */
export function XPlaceImportReview({ state, onChange }: { state: XPlaceImportState; onChange: (next: XPlaceImportState) => void }) {
  const id = useId();
  const { result } = state;
  const { match, sourceName, profileName } = result.publisher;
  return <div className={styles.review}>
    <p className={styles.notice} aria-live="polite">הפרויקט יובא כטיוטה. בדקו כל פרט לפני הפרסום.</p>
    <a className={styles.source} href={result.url} target="_blank" rel="noopener noreferrer">מקור: XPlace ↗</a>
    {result.warnings.length > 0 && <ul className={styles.warnings}>{result.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>}
    <div className={styles.publisher} aria-live="polite">
      {result.ownerSignal === true && <p>XPlace זיהתה שהפרויקט הזה שלכם.</p>}
      {match === 'match' && <p>המפרסם ב־XPlace ({sourceName}) תואם לפרופיל המפרסם שלך.</p>}
      {match === 'unknown' && <p>לא זוהה שם מפרסם בדף.</p>}
      {match === 'mismatch' && <>
        <p>המפרסם ב־XPlace ({sourceName}) שונה משם הפרופיל שלך ({profileName}).</p>
        <label className={styles.check}><input type="checkbox" required checked={state.mismatchConfirmed} onChange={(event) => onChange({ ...state, mismatchConfirmed: event.target.checked })}/><span>אני מוסמך/ת לפרסם את הפרויקט הזה בשם המפרסם.</span></label>
      </>}
      {match === 'no-profile' && <>
        <p>עוד אין לכם פרופיל מפרסם. נפתח אותו עכשיו בשם:</p>
        <label className={styles.srOnly} htmlFor={`${id}-name`}>שם המפרסם</label>
        <input id={`${id}-name`} className={styles.nameInput} required maxLength={200} value={state.createName} onChange={(event) => onChange({ ...state, createName: event.target.value })}/>
        <small>אפשר להוסיף טלפון, אימייל ולוגו בפרופיל המפרסם.</small>
      </>}
    </div>
  </div>;
}

/** Message for a 409 ALREADY_IMPORTED answer, linking to the existing project. */
export function AlreadyImportedMessage({ message, slug }: { message: string; slug: string }) {
  return <p className={styles.error} role="alert">{message} <Link href={`/projects/${encodeURIComponent(slug)}`}>פתיחת הפרויקט</Link></p>;
}
