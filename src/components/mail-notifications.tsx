'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { MailPreferences as Preferences } from '@/lib/notifications/preferences';
import { useViewMode } from './view-mode';
import { useViewer } from './viewer-context';
import { MailTagGallery } from './mail-tag-gallery';

const defaults: Preferences = { enabled: false, interval: 'daily', tags: [], minBudget: '' };
const suggestions = ['עיצוב גרפי', 'פיתוח אתרים', 'UX/UI', 'קופירייטינג', 'וידאו ואנימציה'];

export function MailNotifications() {
  const viewer = useViewer();
  const {mode}=useViewMode();
  const [eligible, setEligible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(false);
  const [profileTags, setProfileTags] = useState<string[]>([]);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const [tag, setTag] = useState('');
  const tagInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let active = true;
    setEligible(false); setLoading(true); setStatus(''); setTag(''); setLoadError('');
    if (viewer.status !== 'signed-in') { setLoading(false); return; }
    fetch('/api/marketplace/mail-preferences', { cache: 'no-store' }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'לא ניתן לטעון העדפות מייל.');
      if (!active) return;
      setEligible(data.eligible === true); setAvailable(data.available === true);
      if (data.eligible) { setPreferences({ ...data.preferences, interval: 'daily' }); setProfileTags(data.profileTags || []); }
    }).catch(error => { if (active) setLoadError(error instanceof Error ? error.message : 'לא ניתן לטעון העדפות מייל.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [viewer.status, viewer.user?.uid, retry]);
  function update(patch: Partial<Preferences>) { setPreferences(current => ({ ...current, ...patch })); setStatus(''); }
  function toggleTag(value: string) {
    update({ tags: preferences.tags.includes(value) ? preferences.tags.filter(item => item !== value) : [...preferences.tags, value] });
  }
  function addTag() {
    const value = tag.trim();
    if (value && !preferences.tags.includes(value)) update({ tags: [...preferences.tags, value] });
    setTag('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const pendingTag = tag.trim();
    const next = pendingTag && !preferences.tags.includes(pendingTag) ? { ...preferences, tags: [...preferences.tags, pendingTag] } : preferences;
    setBusy(true); setStatus('');
    try {
      const response = await fetch('/api/marketplace/mail-preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'לא ניתן לשמור העדפות.');
      setPreferences(data.preferences); setTag(''); setStatus(next.enabled ? 'ההעדפות נשמרו. עדכונים יישלחו למייל המאומת בחשבון.' : 'עדכוני הפרויקטים במייל כבויים.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'לא ניתן לשמור העדפות.'); }
    finally { setBusy(false); }
  }
  if (loading || viewer.status !== 'signed-in') return null;
  if (loadError) return <div className="mail-notifications" role="alert">{loadError} <button type="button" onClick={() => setRetry(value => value + 1)}>ניסיון נוסף</button></div>;
  if (!eligible || mode === 'publisher') return null;
  return <form className="mail-notifications" onSubmit={save} aria-labelledby="mail-notifications-title">
    <div className="mail-notifications-heading">
      <span className="mail-notifications-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg></span>
      <div><h2 id="mail-notifications-title">עדכוני פרויקטים במייל</h2></div>
      <label className="mail-switch"><input type="checkbox" disabled={busy || (!available && !preferences.enabled)} checked={preferences.enabled} onChange={event => update({ enabled: event.target.checked })}/><span aria-hidden="true"/><span className="mail-switch-label">{preferences.enabled ? 'פעיל' : 'כבוי'}</span><span className="sr-only">התראות על פרויקטים במייל</span></label>
    </div>
    <fieldset className="mail-settings" disabled={!preferences.enabled || busy}>
      <legend>העדפות עדכון</legend>
      <div className="mail-compact-fields">
        <label className="mail-field-label" htmlFor="mail-interval">תדירות<select id="mail-interval" value={preferences.interval} onChange={() => update({ interval: 'daily' })}><option value="daily">סיכום יומי</option><option value="project" disabled>על כל פרויקט — בקרוב</option></select></label>
        <div className="mail-compact-tags">
          <label className="mail-field-label" htmlFor="mail-tag">תגיות</label>
          <div className="mail-tag-input">
            <input ref={tagInput} id="mail-tag" value={tag} maxLength={60} placeholder="כל התגיות · הוספת תגית" onChange={event => setTag(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }}/>
            <button type="button" disabled={!tag.trim() || !preferences.enabled} onClick={addTag}>הוספה</button>
          </div>
          <MailTagGallery tags={[...new Set([...profileTags, ...preferences.tags, ...suggestions])]} selected={preferences.tags} onPick={value => { setTag(value); setStatus(''); tagInput.current?.focus({ preventScroll: true }); }} onRemove={toggleTag}/>
        </div>
        <div><label className="mail-field-label" htmlFor="mail-budget">תקציב מינימלי</label><div className="mail-budget-input"><input id="mail-budget" type="number" min="0" max="100000000" step="1" inputMode="numeric" placeholder="ללא הגבלה" value={preferences.minBudget} onChange={event => update({ minBudget: event.target.value })}/><span aria-hidden="true">₪</span></div></div>
      </div>
    </fieldset>
    <div className="mail-footer"><p>{available ? 'למייל המאומת בחשבון · סיכום יומי מ־08:00 UTC' : 'שליחת עדכונים אינה זמינה כרגע.'}</p><button type="submit" className="button button-dark" disabled={busy}> {busy ? 'שומרים…' : 'שמירת העדפות'}</button></div>
    {status && <p className="mail-save-status" role="status">{status}</p>}
  </form>;
}
