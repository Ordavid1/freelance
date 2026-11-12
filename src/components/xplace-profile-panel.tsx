'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { XPlaceProfileImport } from '@/lib/imports/types';
import { buildXPlaceLaunchUrl } from '@/lib/imports/xplace/handoff';
import { awaitHandoff, HandoffError, requestHandoffPayload } from '@/lib/imports/xplace/handoff-client';
import { resolveXPlaceProfileUrl, XPLACE_ORIGIN } from '@/lib/imports/xplace/urls';
import { postIngest, useExtensionInstalled, type useXPlaceIngest, type XPlaceFlags } from './xplace-handoff';
import styles from './profile-studio.module.css';

const PASTE_MAX = 30_000;
const LAUNCH_TIMEOUT_TEXT = 'לא קיבלנו את הפרופיל. ודאו שאתם מחוברים ל־XPlace ונסו שוב.';

/**
 * The XPlace panel of the profile studio: up to two clearly separated options inside one panel.
 * A: with the extension (open XPlace and import automatically). B: paste text, no extension needed.
 * There is deliberately no profile-link option: XPlace serves anonymous visitors only a summary, so a profile is
 * read in the user's own browser (extension or pasted text) or attached as a PDF document.
 */
export function XPlaceProfilePanel({ flags, ingest, onImported, onClose }: {
  flags: XPlaceFlags;
  ingest: ReturnType<typeof useXPlaceIngest<XPlaceProfileImport>>;
  onImported: (data: XPlaceProfileImport) => void;
  onClose: () => void;
}) {
  const id = useId();
  const installed = useExtensionInstalled();
  const [launch, setLaunch] = useState<'idle' | 'waiting' | 'error'>('idle');
  const abort = useRef<AbortController | null>(null);
  const [handle, setHandle] = useState('');
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

  // The button's href is only ever the helper's canonical URL, never raw user text.
  const profileUrl = resolveXPlaceProfileUrl(handle);
  const handleInvalid = handle.trim() !== '' && profileUrl === null;
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
      <ol className={styles.xSteps}>
        <li>
          הזינו את שם המשתמש שלכם ב־XPlace ופתחו את הפרופיל.
          <div className={styles.xHandle}>
            <label htmlFor={`${id}-handle`}>שם המשתמש ב־XPlace</label>
            <input id={`${id}-handle`} type="text" dir="ltr" placeholder="your-name" autoComplete="off" autoCapitalize="off" spellCheck={false} value={handle} aria-invalid={handleInvalid} aria-describedby={handleInvalid ? `${id}-handle-hint ${id}-handle-error` : `${id}-handle-hint`} onChange={(event) => setHandle(event.target.value)}/>
            <small id={`${id}-handle-hint`}>החלק האחרון בכתובת הפרופיל: <bdi dir="ltr">xplace.com/il/u/…</bdi></small>
            {handleInvalid && <p id={`${id}-handle-error`} role="alert" className={styles.sourceError}>שם המשתמש אינו תקין. הזינו את החלק שאחרי <bdi dir="ltr">/il/u/</bdi> בכתובת הפרופיל.</p>}
            <div className={styles.linkFormActions}><a className={styles.xLinkButton} href={profileUrl ?? `${XPLACE_ORIGIN}/il/`} target="_blank" rel="noopener noreferrer">פתיחת XPlace</a></div>
          </div>
        </li>
        <li>בעמוד הפרופיל גררו את העכבר מהמילה ״אודותינו״ ועד השדה האחרון בפרופיל, והעתיקו (<bdi dir="ltr">Ctrl/⌘ + C</bdi>).</li>
        <li>הדביקו כאן ולחצו על ״הוסף כמקור מידע״.</li>
      </ol>
      <p className={styles.xWarn}>הבחירה בגרירה כוללת רק את חלק הפרופיל. אם נכללו בה ביקורות לקוחות עם שמות, מחקו אותן לפני ההדבקה.</p>
      <form className={styles.xForm} onSubmit={(event) => { event.preventDefault(); void importPasted(); }}>
        <label htmlFor={`${id}-text`}>טקסט הפרופיל מ־XPlace</label>
        <textarea id={`${id}-text`} className={styles.xTextarea} rows={6} maxLength={PASTE_MAX} value={text} disabled={busy} onChange={(event) => { setText(event.target.value); setError(''); }}/>
        <label className={styles.checkRow}><input type="checkbox" required checked={owner} disabled={busy} onChange={(event) => setOwner(event.target.checked)}/><span>אני הבעלים/ת של הפרופיל הזה ב־XPlace.</span></label>
        <div aria-live="polite">{error && <p role="alert" className={styles.sourceError}>{error}</p>}</div>
        <div className={styles.linkFormActions}><button type="submit" className={styles.approveLink} disabled={busy || !owner || text.trim().length === 0}>{busy ? 'מוסיפים…' : 'הוסף כמקור מידע'}</button></div>
      </form>
      <p className={styles.xAlt}>אפשר גם לשמור את עמוד הפרופיל כ־PDF (הדפסה ← שמירה כ־PDF) ולצרף אותו כמסמך באזור ״גררו לכאן את העבודה שלכם״. יצירת הפרופיל בעזרת AI בונה את הפרופיל רק מפרטי הפרופיל המקצועיים שבו.</p>
    </section>

    <div className={styles.linkFormActions}><button type="button" onClick={onClose}>סגירה</button></div>
  </div>;
}
