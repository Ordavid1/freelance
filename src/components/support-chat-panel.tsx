'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { SUPPORT_MAX_TEXT, type SupportMessage, type SupportSession } from '@/lib/support/shared';
import { ChatIcon, SUPPORT_RETURN_KEY } from './support-chat';
import styles from './support-chat.module.css';

type Props = { open: boolean; onClose: () => void; onUnread: (count: number) => void; contactEmail: string };
type SendInput = { id: string; text: string; name: string; email: string; page: string; website: string };
const TOPICS = ['עזרה עם החשבון', 'פרסום פרויקט', 'מנוי ותשלומים'];
const SEEN_KEY = 'fz-support-seen';
const time = (timestamp: number) => new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' }).format(timestamp);
const day = (timestamp: number) => new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long' }).format(timestamp);
function remember(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Private browsing works without storage. */ } }

export default function SupportChatPanel({ open, onClose, onUnread, contactEmail }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [draft, setDraft] = useState('');
  const [website, setWebsite] = useState('');
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [hasConversation, setHasConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const inFlight = useRef(false);
  const initialContact = useRef(false);
  const sendingRef = useRef(false);
  const sendVersion = useRef(0);
  const nearBottom = useRef(true);
  const lastSeen = useRef(0);
  const pendingInputs = useRef(new Map<string, SendInput>());

  useEffect(() => { try { lastSeen.current = Number(localStorage.getItem(SEEN_KEY)) || 0; } catch {} }, []);

  // Native modal behavior keeps focus and the mobile keyboard inside the sheet.
  // Desktop remains nonmodal so visitors can browse alongside their conversation.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const mobile = window.matchMedia('(max-width: 760px)');
    let previousOverflow: string | null = null;
    function update() {
      if (element!.open) element!.close();
      if (previousOverflow !== null) { document.body.style.overflow = previousOverflow; previousOverflow = null; }
      if (!open) return;
      if (mobile.matches) {
        previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        element!.showModal();
      } else element!.show();
    }
    update();
    mobile.addEventListener('change', update);
    return () => {
      mobile.removeEventListener('change', update);
      if (element.open) element.close();
      if (previousOverflow !== null) document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Mobile browsers can resize only their visual viewport when the keyboard opens.
  // Keep the composer above the keyboard without changing the rest of the site's viewport.
  useEffect(() => {
    if (!open || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const element = dialog.current;
    function update() {
      element?.style.setProperty('--chat-viewport-height', `${viewport.height}px`);
      element?.style.setProperty('--chat-viewport-bottom', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
    }
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); };
  }, [open]);

  const sync = useCallback(async () => {
    if (inFlight.current || sendingRef.current) return;
    inFlight.current = true;
    const version = sendVersion.current;
    try {
      const response = await fetch('/api/support', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('SYNC_FAILED');
      const data: SupportSession = await response.json();
      // An older poll must never overwrite a message submitted while it was in flight.
      if (version !== sendVersion.current) return;
      setConfigured(data.configured);
      setHasConversation(data.hasConversation);
      if (!initialContact.current || data.hasConversation) {
        setName(data.contact.name);
        setEmail(data.contact.email);
        initialContact.current = true;
      }
      // Locally failed requests can be retried even if no server reservation was made.
      const remote = data.messages.map((message): SupportMessage => message.sender === 'visitor' && message.delivery === 'pending' ? { ...message, delivery: 'failed' } : message);
      setMessages((current) => [...remote, ...current.filter((message) => pendingInputs.current.has(message.id) && !remote.some((stored) => stored.id === message.id))].sort((a, b) => a.createdAt - b.createdAt));
      if (data.hasConversation) remember(SUPPORT_RETURN_KEY, '1');
      else { try { localStorage.removeItem(SUPPORT_RETURN_KEY); } catch {} }
      setSyncError(false);
    } catch { setSyncError(true); }
    finally { setReady(true); inFlight.current = false; }
  }, []);

  useEffect(() => {
    void sync();
    // No background polling before a conversation exists; pause in hidden tabs.
    if (!hasConversation) return;
    const interval = window.setInterval(() => { if (!document.hidden && navigator.onLine) void sync(); }, open ? 8000 : 45000);
    const refresh = () => { if (!document.hidden) void sync(); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); };
  }, [open, hasConversation, sync]);

  useEffect(() => {
    const replies = messages.filter((message) => message.sender === 'support');
    const newReplies = replies.filter((message) => message.createdAt > lastSeen.current);
    if (open && !document.hidden && nearBottom.current) {
      if (newReplies.length) setAnnouncement('התקבלה תשובה חדשה מהצוות.');
      lastSeen.current = Math.max(lastSeen.current, ...replies.map((reply) => reply.createdAt));
      remember(SEEN_KEY, String(lastSeen.current));
      onUnread(0);
    } else onUnread(newReplies.length);
    if (open && nearBottom.current) thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [messages, open, onUnread]);

  async function send(input: SendInput) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    sendVersion.current++;
    setSending(true);
    setError('');
    nearBottom.current = true;
    pendingInputs.current.set(input.id, input);
    setMessages((current) => current.some((message) => message.id === input.id) ? current.map((message) => message.id === input.id ? { ...message, delivery: 'pending' } : message) : [...current, { id: input.id, sender: 'visitor', text: input.text, createdAt: Date.now(), delivery: 'pending' }]);
    try {
      const response = await fetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(25_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'לא הצלחנו לשלוח את ההודעה. נסו שוב.');
      setMessages((current) => current.map((message) => message.id === input.id ? data.message : message));
      pendingInputs.current.delete(input.id);
      setHasConversation(true);
      remember(SUPPORT_RETURN_KEY, '1');
      setAnnouncement('ההודעה נשלחה לצוות. התשובה תופיע כאן.');
    } catch (cause) {
      setMessages((current) => current.map((message) => message.id === input.id ? { ...message, delivery: 'failed' } : message));
      setError(cause instanceof Error && cause.name !== 'TimeoutError' && cause.name !== 'TypeError' ? cause.message : 'החיבור נקטע. אפשר לנסות שוב; ההודעה לא תישלח פעמיים.');
    } finally { sendingRef.current = false; setSending(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || sending || !configured || !ready) return;
    const input = { id: crypto.randomUUID(), text: draft.trim(), name: name.trim() || 'אורח/ת', email: email.trim().toLowerCase(), page: window.location.pathname, website };
    setDraft('');
    void send(input);
  }
  function retry(message: SupportMessage) {
    const input = pendingInputs.current.get(message.id) || { id: message.id, text: message.text, name: message.retry?.name || name.trim() || 'אורח/ת', email: message.retry?.email || email.trim().toLowerCase(), page: message.retry?.page || window.location.pathname, website: '' };
    void send(input);
  }
  function composerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !window.matchMedia('(max-width: 760px)').matches) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }
  function trackScroll() {
    const element = thread.current;
    if (!element) return;
    nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (nearBottom.current) {
      lastSeen.current = Math.max(lastSeen.current, ...messages.filter((message) => message.sender === 'support').map((message) => message.createdAt));
      remember(SEEN_KEY, String(lastSeen.current));
      onUnread(0);
    }
  }
  const showWelcome = messages.length === 0;
  return <dialog ref={dialog} id="support-chat" className={styles.panel} dir="rtl" aria-labelledby="support-chat-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
    <div className={styles.panelInner}>
      <header className={styles.panelHeader}>
        <span className={styles.teamAvatar}><ChatIcon /><span /></span>
        <div><h2 id="support-chat-title">הצוות של Freelance Place</h2><p>אנשים אמיתיים, בצד השני.</p></div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="מזעור שיחת התמיכה"><ChatIcon close /></button>
      </header>
      <div className={styles.thread} ref={thread} onScroll={trackScroll} role="log" aria-label="שיחת התמיכה" aria-live="polite" aria-relevant="additions text">
        {showWelcome ? <div className={styles.welcome}>
          <span className={styles.eyebrow} lang="en" dir="ltr">A LITTLE HELP. A REAL CONNECTION.</span>
          <div className={styles.welcomeTitle}><h3>יש שאלה?<br />בואו נדבר<span>.</span></h3><span className={styles.welcomeArt} aria-hidden="true"><ChatIcon /><i>✦</i></span></div>
          <p>מפרויקט ראשון ועד הפרטים הקטנים.<br />אנחנו כאן כדי לעזור להתקדם.</p>
          <div className={styles.greeting}><span aria-hidden="true">✦</span><p>היי, טוב שאתם כאן 👋<br />ספרו לנו במה אפשר לעזור.</p></div>
          <div className={styles.topics} aria-label="נושאים נפוצים">{TOPICS.map((topic) => <button type="button" key={topic} onClick={() => { setDraft(`היי, אשמח לעזרה בנושא ${topic}. `); textarea.current?.focus(); }}><span>{topic}</span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M11 11 5 5m0 5V5h5" /></svg></button>)}</div>
        </div> : <>
          <div className={styles.threadIntro}>השיחה שלכם עם הצוות <span>✦</span></div>
          {messages.map((message, index) => <div key={message.id}>
            {(index === 0 || day(message.createdAt) !== day(messages[index - 1].createdAt)) && <div className={styles.dateDivider}>{day(message.createdAt)}</div>}
            <div className={`${styles.messageRow} ${message.sender === 'visitor' ? styles.visitor : styles.support}`}>
              {message.sender === 'support' && <span className={styles.replyAvatar} aria-hidden="true">✦</span>}
              <div className={styles.messageContent}><span className={styles.senderName}>{message.sender === 'visitor' ? 'אתם' : 'צוות Freelance Place'}</span><p dir="auto">{message.text}</p><span className={styles.messageMeta}><time dateTime={new Date(message.createdAt).toISOString()}>{time(message.createdAt)}</time>{message.sender === 'visitor' && <>{message.delivery === 'pending' ? <span>בשליחה…</span> : message.delivery === 'failed' ? <button type="button" onClick={() => retry(message)} disabled={sending}>לא נשלח · ניסיון נוסף ↻</button> : <span>נשלח לצוות <span aria-hidden="true">✓</span></span>}</>}</span></div>
            </div>
          </div>)}
          <p className={styles.replyNote}>התשובה תופיע כאן. אפשר לחזור לשיחה באותו דפדפן.</p>
        </>}
      </div>
      <div className={styles.composerArea}>
        {!ready && <p className={styles.connectionState} role="status"><span className={styles.loadingDots}><i /><i /><i /></span> מחברים את השיחה…</p>}
        {syncError && <p className={styles.connectionState} role="status">החיבור לשיחה נקטע. <button type="button" onClick={() => void sync()}>ניסיון נוסף ↻</button> · <a href={`mailto:${contactEmail}`}>פנייה במייל</a></p>}
        {ready && !configured && !syncError && <p className={styles.connectionState}>כרגע אפשר לדבר איתנו במייל. <a href={`mailto:${contactEmail}`}>לכתיבת הודעה ↗</a></p>}
        {error && <p className={styles.error} role="alert">{error} <a href={`mailto:${contactEmail}`}>פנייה במייל ↗</a></p>}
        <form onSubmit={submit}>
          {!hasConversation && <div className={styles.contactFields}>
            <label>איך קוראים לכם? <span>(לא חובה)</span><input value={name} onChange={(event) => setName(event.target.value)} name="support-name" autoComplete="name" placeholder="השם שלכם" maxLength={80} disabled={sending} /></label>
            <label>מייל לחזרה<input value={email} onChange={(event) => setEmail(event.target.value)} name="support-email" autoComplete="email" type="email" dir="ltr" placeholder="you@example.com" required maxLength={254} disabled={sending} /></label>
          </div>}
          <div className={styles.honeypot} aria-hidden="true"><label>Website<input name="website" value={website} onChange={(event) => setWebsite(event.target.value)} autoComplete="off" tabIndex={-1} /></label></div>
          <div className={styles.composer}>
            <textarea ref={textarea} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={composerKey} placeholder={hasConversation ? 'ממשיכים את השיחה…' : 'מה תרצו לשאול?'} aria-label="הודעה לצוות התמיכה" maxLength={SUPPORT_MAX_TEXT} rows={2} required dir="auto" />
            <button type="submit" className={styles.send} disabled={!draft.trim() || sending || !configured || !ready || syncError} aria-label={sending ? 'שולחים הודעה' : 'שליחת הודעה'}>{sending ? <span className={styles.spinner} /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m20 4-7 16-3-7-7-3 17-6ZM10 13l10-9" /></svg>}</button>
          </div>
          {draft.length > 3500 && <span className={styles.charCount}>{draft.length.toLocaleString('he-IL')} / 4,000</span>}
        </form>
        <div className={styles.panelFooter}><span><span aria-hidden="true">◇</span> השיחה פרטית. אנחנו כאן בשבילכם.</span><Link href="/privacy">פרטיות</Link></div>
      </div>
      <span className={styles.srOnly} role="status">{announcement}</span>
    </div>
  </dialog>;
}
