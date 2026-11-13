import styles from './xplace-handoff.module.css';

/**
 * Shown wherever a signed-out visitor is asked to sign in while an XPlace extension import is waiting in the
 * extension (the token travels in `?xplace=` and survives the sign-in via `next`). Tells them nothing is lost.
 */
export function PendingImportNotice() {
  return <div className={styles.notice} role="status"><p>הנתונים מ־XPlace מחכים בתוסף. אחרי ההתחברות נחזיר אתכם לכאן והייבוא יימשך אוטומטית.</p></div>;
}
