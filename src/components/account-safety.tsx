'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useViewer } from './viewer-context';
import './account-safety.css';

export function AccountSafetyNotice() {
  const viewer = useViewer();
  const [restricted, setRestricted] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (viewer.status !== 'signed-in') { setRestricted(false); return; }
    fetch('/api/marketplace/safety', { cache: 'no-store' }).then(async response => response.ok ? response.json() : null).then(data => { if (active) setRestricted(data?.state === 'restricted' || data?.state === 'suspended'); }).catch(() => {});
    return () => { active = false; };
  }, [viewer.status]);
  async function appeal(event: FormEvent) {
    event.preventDefault(); setBusy(true); setFeedback('');
    try {
      const response = await fetch('/api/marketplace/appeals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setFeedback(`הבקשה התקבלה. מספר הפנייה: ${data.id}`); setOpen(false); setMessage('');
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'לא ניתן לשלוח בקשה כרגע.'); }
    finally { setBusy(false); }
  }
  if (!restricted) return null;
  return <aside className="account-safety" aria-label="מצב החשבון"><strong>חלק מפעולות החשבון הוגבלו</strong><p>פרסום ושליחת הודעות אינם זמינים כרגע. פרטי החברות, ביטול החידוש והמידע הקיים נשארים נגישים בהתאם להרשאות.</p><div className="safety-actions"><button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>בקשה לבדיקה נוספת</button><Link href="/membership">ניהול חברות</Link></div>{open && <form onSubmit={appeal}><label>מה תרצו שנבדוק?<textarea required minLength={10} maxLength={3000} value={message} onChange={e => setMessage(e.target.value)} /></label><small>אין לשלוח סיסמאות או פרטי כרטיס.</small><button disabled={busy}>{busy ? 'שולחים…' : 'שליחת בקשה'}</button></form>}{feedback && <p role="status">{feedback}</p>}</aside>;
}
export function ContactControls({ conversationId, onCanContact }: { conversationId: string; onCanContact: (allowed: boolean) => void }) {
  const [state, setState] = useState<{ blockedByMe: boolean; canContact: boolean } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  async function load() {
    setError('');
    const response = await fetch(`/api/marketplace/safety?conversationId=${encodeURIComponent(conversationId)}`, { cache: 'no-store' });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    setState(data); onCanContact(data.canContact === true);
  }
  useEffect(() => {
    let active = true; setState(null); setError(''); onCanContact(false);
    fetch(`/api/marketplace/safety?conversationId=${encodeURIComponent(conversationId)}`, { cache: 'no-store' }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; }).then(data => { if (active) { setState(data); onCanContact(data.canContact === true); } }).catch(() => { if (active) setError('לא ניתן לבדוק את אפשרות יצירת הקשר. נסו שוב.'); });
    return () => { active = false; };
  }, [conversationId, onCanContact]);
  async function change() {
    if (!state) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/marketplace/safety', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, blocked: !state.blockedByMe }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      onCanContact(false); await load(); dialog.current?.close();
    } catch (error) { setError(error instanceof Error ? error.message : 'עדכון החסימה נכשל.'); }
    finally { setBusy(false); }
  }
  return <div className="contact-safety">{state && <button className="safety-secondary" type="button" disabled={busy} onClick={() => dialog.current?.showModal()}>{state.blockedByMe ? 'הסרת החסימה שלי' : 'חסימת קשר'}</button>}{state && !state.canContact && <p role="status">לא ניתן לשלוח הודעות בקשר זה כרגע. השיחה הקיימת נשמרת לעיון.</p>}{error && <p role="alert">{error} <button type="button" onClick={() => { void load().catch(() => setError('הבדיקה נכשלה. נסו שוב בהמשך.')); }}>ניסיון נוסף</button></p>}<dialog ref={dialog} aria-labelledby="block-title"><h3 id="block-title">{state?.blockedByMe ? 'להסיר את החסימה שלך?' : 'לחסום את הקשר?'}</h3><p>{state?.blockedByMe ? 'הודעות יתאפשרו אם אין הגבלה נוספת על הקשר או על החשבונות.' : 'לא תוכלו לשלוח הודעות או הצעות חדשות זה לזו. השיחה הקיימת תישמר לעיון. חסימה אינה מבטלת הסכם או תשלום.'}</p><div className="safety-actions"><button type="button" disabled={busy} onClick={() => dialog.current?.close()}>חזרה לשיחה</button><button type="button" disabled={busy} onClick={() => void change()}>{busy ? 'מעדכנים…' : state?.blockedByMe ? 'אישור הסרת החסימה' : 'אישור חסימה'}</button></div>{error && <p role="alert">{error}</p>}</dialog></div>;
}
