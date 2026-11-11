'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { XPlaceProfileImport } from '@/lib/imports/types';
import { buildXPlaceLaunchUrl } from '@/lib/imports/xplace/handoff';
import { awaitHandoff, HandoffError, requestHandoffPayload } from '@/lib/imports/xplace/handoff-client';
import { XPLACE_ORIGIN } from '@/lib/imports/xplace/urls';
import { postIngest, useExtensionInstalled, type useXPlaceIngest, type XPlaceFlags } from './xplace-handoff';
import styles from './profile-studio.module.css';

const PASTE_MAX = 30_000;
const LAUNCH_TIMEOUT_TEXT = 'לא קיבלנו את הפרופיל. ודאו שאתם מחוברים ל־XPlace ונסו שוב.';

/**
 * The XPlace panel of the profile studio: up to three clearly separated options inside one panel.
 * A: with the extension (open XPlace and import automatically). B: paste text, no extension needed.
 * C: paste a public link (`linkForm`, only passed while the link importer is enabled).
 */
export function XPlaceProfilePanel({ flags, ingest, onImported, linkForm, onClose }: {
  flags: XPlaceFlags;
  ingest: ReturnType<typeof useXPlaceIngest<XPlaceProfileImport>>;
  onImported: (data: XPlaceProfileImport) => void;
  linkForm: ReactNode;
  onClose: () => void;
}) {
  const id = useId();
  const installed = useExtensionInstalled();
  const [launch, setLaunch] = useState<'idle' | 'waiting' | 'error'>('idle');
  const abort = useRef<AbortController | null>(null);
  const [text, setText] = useState('');
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => abort.current?.abort(), []);

  function startLaunch() {
    abort.current?.abort();
    const token = crypto.randomUUID();
    const controller = new AbortController();
    abort.current = controller;
    setLaunch('waiting');
    // The bridge must know the token before XPlace opens; window.open stays synchronous in the click handler.
    const staged = awaitHandoff(token, { signal: controller.signal });
    window.open(buildXPlaceLaunchUrl(token), '_blank', 'noopener');
    staged.then(() => requestHandoffPayload(token)).then((payload) => { setLaunch('idle'); ingest.accept(token, payload); }, (cause) => {
      if (cause instanceof HandoffError && cause.reason === 'cancelled') return;
      if (cause instanceof HandoffError && cause.reason === 'timeout') { setLaunch('error'); return; }
      setLaunch('idle');
      ingest.fail(cause);
    });
  }

  function cancelLaunch() {
    abort.current?.abort();
    setLaunch('idle');
  }

  async function importPasted() {
    if (!owner || busy) return;
    setBusy(true);
    setError('');
    const result = await postIngest<XPlaceProfileImport>({ kind: 'profile-text', text }, true);
    setBusy(false);
    if (!result.ok) { setError(result.status === 401 ? 'החיבור לחשבון פג. התחברו מחדש ונסו שוב.' : result.message); return; }
    onImported(result.data);
    setText('');
    setOwner(false);
  }

  const showExtension = installed === true || (installed === false && Boolean(flags.extensionUrl));
  return <div id="profile-xplace-panel" className={styles.xPanel}>
    {showExtension && <section className={styles.xOption} aria-labelledby={`${id}-ext`}>
      <h4 id={`${id}-ext`}>עם התוסף (מומלץ)</h4>
      {installed ? <>
        <p>פותחים את XPlace בלשונית חדשה, התוסף קורא את הפרופיל שלכם ומחזיר אתכם לכאן. בזמן גלישה ב־<a href={`${XPLACE_ORIGIN}/`} target="_blank" rel="noopener noreferrer" dir="ltr">XPlace</a> תופיע גם הזמנה להעתקת הפרופיל.</p>
        {launch === 'waiting'
          ? <div className={styles.linkFormActions}><p role="status">פתחנו את XPlace בלשונית חדשה. התוסף קורא את הפרופיל שלכם ויחזיר אתכם לכאן.</p><button type="button" onClick={cancelLaunch}>ביטול</button></div>
          : <div className={styles.linkFormActions}><button type="button" className={styles.approveLink} onClick={startLaunch}>פתיחת XPlace וייבוא אוטומטי</button></div>}
        {launch === 'error' && <p role="alert" className={styles.sourceError}>{LAUNCH_TIMEOUT_TEXT}</p>}
      </> : <p>כדי לייבא בלחיצה אחת, <a href={flags.extensionUrl} target="_blank" rel="noopener noreferrer">התקינו את התוסף של Freelance Place ל־Chrome</a> ורעננו את העמוד.</p>}
    </section>}

    <section className={styles.xOption} aria-labelledby={`${id}-paste`}>
      <h4 id={`${id}-paste`}>הדבקת טקסט (בלי תוסף)</h4>
      <div className={styles.linkFormActions}><a className={styles.xLinkButton} href={`${XPLACE_ORIGIN}/il/`} target="_blank" rel="noopener noreferrer">פתיחת XPlace</a></div>
      <ol className={styles.xSteps}>
        <li>היכנסו לפרופיל שלכם ב־XPlace (עדיף דרך ״צפו בפרופיל שלכם כפי שהוא נראה לאחרים״).</li>
        <li>סמנו הכול והעתיקו (Ctrl/⌘ + A, ואז Ctrl/⌘ + C).</li>
        <li>הדביקו כאן.</li>
      </ol>
      <form className={styles.xForm} onSubmit={(event) => { event.preventDefault(); void importPasted(); }}>
        <label htmlFor={`${id}-text`}>טקסט הפרופיל מ־XPlace</label>
        <textarea id={`${id}-text`} className={styles.xTextarea} rows={6} maxLength={PASTE_MAX} value={text} disabled={busy} onChange={(event) => { setText(event.target.value); setError(''); }}/>
        <label className={styles.checkRow}><input type="checkbox" required checked={owner} disabled={busy} onChange={(event) => setOwner(event.target.checked)}/><span>אני הבעלים/ת של הפרופיל הזה ב־XPlace.</span></label>
        <div aria-live="polite">{error && <p role="alert" className={styles.sourceError}>{error}</p>}</div>
        <div className={styles.linkFormActions}><button type="submit" className={styles.approveLink} disabled={busy || !owner || text.trim().length === 0}>{busy ? 'מייבאים…' : 'ייבוא הטקסט'}</button></div>
      </form>
    </section>

    {linkForm && <section className={styles.xOption} aria-label="הדבקת קישור">{linkForm}</section>}
    <div className={styles.linkFormActions}><button type="button" onClick={onClose}>סגירה</button></div>
  </div>;
}
