'use client';
import { useEffect, useRef, useState } from 'react';
import { trackEvent } from '@/lib/analytics';
import { useExtensionInstalled, useXPlaceFlags } from './xplace-handoff';
import { canInstallExtension } from '@/lib/imports/xplace/handoff-client';
import styles from './extension-announcement.module.css';

const DISMISSED_KEY = 'fp-extension-announcement-v1';

function readDismissed(): boolean {
  try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
}

/**
 * Top-of-page announcement of the Chrome extension, shown to every desktop visitor until they close it or already have
 * the extension. Phones and tablets never see it: they cannot install extensions, and on a small screen the bar pushes
 * the page itself below the fold. It renders nothing unless the server reports the importer enabled with a Web Store
 * URL, so a dark deployment never advertises a link that does not exist. The dismissal lives in this browser only.
 */
export function ExtensionAnnouncement() {
  const flags = useXPlaceFlags();
  const installed = useExtensionInstalled();
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [installable, setInstallable] = useState(false);
  useEffect(() => { setDismissed(readDismissed()); setInstallable(canInstallExtension()); }, []);

  const visible = installable && dismissed === false && installed === false && flags.enabled && Boolean(flags.extensionUrl);
  useEffect(() => { if (visible) trackEvent('extension_announcement_shown'); }, [visible]);
  // Viewport-sized layouts (the workspace, an open conversation) subtract this so the bar never pushes them off screen.
  const barRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const bar = barRef.current;
    if (!visible || !bar) { root.style.removeProperty('--announcement-height'); return; }
    const sync = () => root.style.setProperty('--announcement-height', `${bar.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(bar);
    return () => { observer.disconnect(); root.style.removeProperty('--announcement-height'); };
  }, [visible]);
  if (!visible) return null;

  function close() {
    try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* the bar just returns next visit */ }
    setDismissed(true);
    trackEvent('extension_announcement_dismissed');
  }

  return <aside ref={barRef} className={styles.bar} aria-label="הודעה על התוסף ל־Chrome">
    <p className={styles.text}><strong>חדש: התוסף של Freelance Place ל־Chrome.</strong> עוברים מ־XPlace בלחיצה אחת: הפרופיל והפרויקטים שלכם מגיעים אלינו, בלי להקליד מחדש.</p>
    <a className={styles.cta} href={flags.extensionUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent('extension_announcement_install_clicked')}>הורדת התוסף</a>
    <button type="button" className={styles.close} aria-label="סגירת ההודעה" onClick={close}>×</button>
  </aside>;
}
