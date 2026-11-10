'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './billing-panel.module.css';
type Payment = { id: string; amountAgorot: number; paidAt: number; documentNumber: number | null; invoiceAvailable?: boolean; invoicePending: boolean; renewal?: boolean };
type Status = { available: boolean; autoRenew: boolean; status: string; last4: string | null; cardExpiry?: string | null; cardUpdatedAt?: number | null; paidUntil: number | null; nextChargeAt?: number | null; historyAvailable?: boolean; payments: Payment[] };
const date = (value: number) => new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium' }).format(value);
const shekels = (agorot: number) => `₪${(agorot / 100).toFixed(2)}`;
const STATUS_LABEL: Record<string, { text: string; tone: 'good' | 'calm' | 'warn' | 'muted' }> = {
  active: { text: 'פעיל', tone: 'good' },
  trialing: { text: 'בתקופת ניסיון', tone: 'calm' },
  cancelled: { text: 'החידוש בוטל', tone: 'muted' },
  past_due: { text: 'החיוב נכשל', tone: 'warn' },
};
async function post(url: string, payload?: unknown) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  return { response, data: await response.json().catch(() => ({})) };
}
export function BillingPanel({ eligible = false, trialEndsAt }: { eligible?: boolean; trialEndsAt?: number | null }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<'checkout' | 'card' | 'cancel' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  async function refresh() {
    setLoadState('loading');
    try {
      const response = await fetch('/api/billing/status', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      setStatus(await response.json());
      setLoadState('ready');
    } catch (error) {
      setLoadState('error');
      throw error;
    }
  }
  useEffect(() => {
    let active = true;
    async function load() {
      const id = new URLSearchParams(window.location.search).get('order');
      if (id) {
        try {
          const { response, data } = await post('/api/billing/confirm', { orderId: id });
          let text = 'האישור עדיין לא התקבל. אם השלמתם את הטופס, רעננו בעוד רגע.';
          if (response.ok) text = 'cardUpdated' in data ? data.cardUpdated ? 'הכרטיס החדש אומת ונשמר. החיובים הבאים יבוצעו בו.' : 'הכרטיס לא הוחלף כי החידוש האוטומטי כבוי.' : data.setup ? 'הכרטיס נשמר והמנוי הוגדר. החיוב הראשון יהיה בסיום הניסיון.' : 'התשלום אושר והחברות פעילה.';
          if (active) setMessage({ text, tone: response.ok ? 'ok' : 'error' });
          if (response.ok) { window.history.replaceState({}, '', '/membership#membership-billing'); window.dispatchEvent(new Event('fz-profile-updated')); }
        } catch { if (active) setMessage({ text: 'לא ניתן לאמת את הפעולה כרגע. נסו לרענן.', tone: 'error' }); }
      }
      try { if (active) await refresh(); } catch { /* The retry state explains a failed status request. */ }
    }
    void load();
    return () => { active = false; };
  }, []);
  async function openHostedForm(kind: 'checkout' | 'card') {
    setBusy(kind); setMessage(null);
    try {
      const { response, data } = kind === 'checkout' ? await post('/api/billing/checkout', { consent }) : await post('/api/billing/card');
      if (!response.ok) {
        const text = data.error === 'BILLING_IDENTITY_REQUIRED' ? 'נדרשים שם ואימייל בחשבון (עד 50 תווים לכל שדה) לפני התשלום.'
          : data.error === 'RENEWAL_IN_PROGRESS' ? 'חיוב חודשי מתבצע כרגע. נסו שוב בעוד כמה דקות.'
          : kind === 'card' ? 'לא ניתן לפתוח את החלפת הכרטיס כרגע. הכרטיס הנוכחי נשאר שמור.' : 'לא ניתן לפתוח את התשלום כרגע. נסו שוב.';
        setMessage({ text, tone: 'error' });
        setBusy(null);
        return;
      }
      window.location.assign(data.redirectUrl);
    } catch { setMessage({ text: 'לא ניתן להתחבר לשירות התשלום. נסו שוב.', tone: 'error' }); setBusy(null); }
  }
  async function cancel() {
    setBusy('cancel');
    try {
      const response = await fetch('/api/billing/status', { method: 'DELETE' });
      if (!response.ok) throw new Error();
      setStatus(current => current ? { ...current, autoRenew: false, status: 'cancelled' } : current);
      setMessage({ text: status?.status === 'trialing' ? 'המנוי בוטל. לא יבוצע חיוב בסיום הניסיון.' : 'החידוש האוטומטי בוטל. הגישה נשארת עד סוף התקופה ששולמה.', tone: 'ok' });
      setConfirmCancel(false);
      await refresh().catch(() => {});
    } catch { setMessage({ text: 'הביטול לא אושר. נסו שוב או פנו אלינו.', tone: 'error' }); } finally { setBusy(null); }
  }

  const subscribed = status?.autoRenew === true;
  const canCheckout = eligible && loadState === 'ready' && status?.available === true;
  const badge = status && status.status !== 'none' ? STATUS_LABEL[status.status] : null;
  let checkoutNote = 'פרטי הכרטיס נמסרים ל־Cardcom בלבד. חשבונית תישלח באימייל. אפשר לבטל את החידוש כאן בכל עת.';
  if (loadState === 'error') checkoutNote = 'לא ניתן לבדוק את זמינות התשלום כרגע. נסו לטעון שוב.';
  else if (loadState === 'loading') checkoutNote = 'טוענים את אפשרות התשלום…';
  else if (eligible && !status?.available) checkoutNote = 'התשלום אינו זמין כרגע. לא נוצר חיוב.';
  else if (trialEndsAt) checkoutNote = `החיוב הראשון של ₪19.99 יהיה ב־${date(trialEndsAt)}, לאחר סיום הניסיון. אימות הכרטיס עשוי ליצור תפיסת מסגרת זמנית של ₪1 שמשתחררת, ללא חיוב בפועל.`;
  else if (!eligible) checkoutNote = status?.paidUntil && status.paidUntil > Date.now() ? 'אפשר לחדש מנוי לאחר סיום התקופה ששולמה.' : 'אפשר להצטרף לאחר הקמת פרופיל פרילנסר וסיום חודשיים הניסיון.';

  return <section id="membership-billing" className={styles.panel} aria-label="מנוי ותשלומים">
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>מנוי ותשלומים</p>
        <h2 className={styles.title}>הגשת הצעות לפרויקטים</h2>
      </div>
      <div className={styles.price}><b>₪19.99</b><span>לחודש</span></div>
    </header>
    <p className={styles.free}><b aria-hidden="true">✓</b>פרסום פרויקטים חינם תמיד, ללא קשר למנוי. המנוי נדרש רק להגשת הצעות כפרילנסר/ית.</p>
    {badge && <p className={styles.badge} data-tone={badge.tone}><i aria-hidden="true"/>{badge.text}</p>}

    {message && <p className={styles.message} data-tone={message.tone} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    {loadState === 'loading' && !status && <div className={styles.skeleton} role="status" aria-label="טוענים פרטי מנוי ותשלומים"><span/><span/><span/></div>}
    {loadState === 'error' && <div className={styles.message} data-tone="error" role="alert"><span>לא ניתן לטעון את פרטי התשלום כרגע.</span><button className={styles.link} onClick={() => { void refresh().catch(() => {}); }}>טעינה מחדש</button></div>}

    {status && (subscribed || status.paidUntil || status.status === 'past_due') && <dl className={styles.facts}>
      {status.status === 'trialing' && status.nextChargeAt && <div><dt>חיוב ראשון</dt><dd>{date(status.nextChargeAt)}</dd></div>}
      {status.status !== 'trialing' && subscribed && status.nextChargeAt && <div><dt>החיוב הבא</dt><dd>{date(status.nextChargeAt)}</dd></div>}
      {status.paidUntil && <div><dt>{subscribed ? 'שולם עד' : 'גישה עד'}</dt><dd>{date(status.paidUntil)}</dd></div>}
      <div><dt>חידוש אוטומטי</dt><dd>{subscribed ? 'פעיל' : 'כבוי'}</dd></div>
    </dl>}
    {status?.status === 'past_due' && <p className={styles.message} data-tone="error" role="alert">החידוש נכשל והחיוב האוטומטי הופסק. אפשר להצטרף מחדש לאחר סיום הגישה ששולמה.</p>}

    {subscribed && status?.last4 && <section className={styles.block} aria-labelledby="billing-card-title">
      <h3 id="billing-card-title">אמצעי תשלום</h3>
      <div className={styles.method}>
        <div className={styles.card} aria-label={`כרטיס המסתיים ב־${status.last4}`}>
          <span className={styles.chip} aria-hidden="true"/>
          <bdi className={styles.digits}>•••• {status.last4}</bdi>
          {status.cardExpiry && <small>תוקף <bdi>{status.cardExpiry}</bdi></small>}
        </div>
        <div className={styles.methodText}>
          <strong>כרטיס שמור לחידוש החודשי</strong>
          <p>{status.cardUpdatedAt ? `עודכן ב־${date(status.cardUpdatedAt)}. ` : ''}בהחלפה, הכרטיס הנוכחי נשאר שמור עד שהכרטיס החדש מאומת ב־Cardcom. האימות עשוי ליצור תפיסת מסגרת זמנית של ₪1 שמשתחררת.</p>
          <button className={styles.secondary} disabled={busy !== null || !status.available} aria-busy={busy === 'card'} onClick={() => void openHostedForm('card')}>{busy === 'card' ? 'פותחים טופס מאובטח…' : 'החלפת כרטיס'}</button>
        </div>
      </div>
    </section>}

    {status && !subscribed && <section className={styles.block} aria-labelledby="billing-join-title">
      <h3 id="billing-join-title">{trialEndsAt ? 'הפעלת מנוי בתקופת הניסיון' : 'הצטרפות לחברות'}</h3>
      <p className={styles.note}>המחיר כולל מע״מ ככל שחל. החברות מתחדשת אוטומטית מדי חודש לאחר הצטרפות מפורשת. אין חיוב בסיום הניסיון ללא הצטרפות.</p>
      {canCheckout && <label className={styles.consent}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/><span>{trialEndsAt ? `אני מאשר/ת שמירת כרטיס וחיוב חודשי של ₪19.99 החל מ־${date(trialEndsAt)}, ללא חיוב לפני סיום הניסיון, עד לביטול. ` : 'אני מאשר/ת חיוב של ₪19.99 כעת וחידוש אוטומטי חודשי באותו מחיר עד לביטול. '}לפי <Link href="/terms#payments">תנאי החברות והביטול</Link>.</span></label>}
      <button className={styles.primary} disabled={busy !== null || !consent || !canCheckout} aria-busy={busy === 'checkout'} aria-describedby="membership-checkout-note" onClick={() => void openHostedForm('checkout')}>{busy === 'checkout' ? 'פותחים תשלום…' : trialEndsAt ? 'הפעלת מנוי — החיוב הראשון בסיום הניסיון' : 'הצטרפות ותשלום מאובטח ב־Cardcom'}</button>
      <p id="membership-checkout-note" className={styles.note}>{checkoutNote}</p>
    </section>}

    {status && <section className={styles.block} aria-labelledby="billing-history-title">
      <h3 id="billing-history-title">תשלומים אחרונים</h3>
      {status.historyAvailable === false ? <p className={styles.note}>היסטוריית התשלומים אינה זמינה כרגע. אפשר עדיין לנהל את המנוי.</p>
        : status.payments.length ? <ul className={styles.history}>{status.payments.map(payment => <li key={payment.id}>
          <span className={styles.when}><strong>{date(payment.paidAt)}</strong><small>{payment.renewal === false ? 'הצטרפות' : 'חידוש חודשי'}</small></span>
          <bdi className={styles.amount}>{shekels(payment.amountAgorot)}</bdi>
          {payment.invoiceAvailable ? <a className={styles.invoice} href={`/api/billing/invoice?order=${encodeURIComponent(payment.id)}`} target="_blank" rel="noopener noreferrer">חשבונית{payment.documentNumber ? <> <bdi>#{payment.documentNumber}</bdi></> : null}<span aria-hidden="true"> ↗</span></a>
            : <span className={styles.pending}>{payment.documentNumber ? `מסמך ${payment.documentNumber} נשלח באימייל` : 'החשבונית בהפקה'}</span>}
        </li>)}</ul>
        : <p className={styles.empty}>עדיין אין תשלומים בחשבון.{status.status === 'trialing' && status.nextChargeAt ? ` החיוב הראשון יופיע כאן אחרי ${date(status.nextChargeAt)}.` : ''}</p>}
    </section>}

    {subscribed && <footer className={styles.footer}>
      {confirmCancel ? <div className={styles.confirm} role="group" aria-label="אישור ביטול">
        <p>{status?.status === 'trialing' ? 'לבטל את המנוי? הכרטיס יימחק ולא יבוצע חיוב בסיום הניסיון.' : 'לבטל את החידוש האוטומטי? הגישה נשארת עד סוף התקופה ששולמה.'}</p>
        <div><button className={styles.danger} disabled={busy !== null} aria-busy={busy === 'cancel'} onClick={() => void cancel()}>{busy === 'cancel' ? 'מבטלים…' : 'כן, לבטל'}</button><button className={styles.link} disabled={busy !== null} onClick={() => setConfirmCancel(false)}>השארת המנוי</button></div>
      </div> : <button className={styles.link} disabled={busy !== null} onClick={() => setConfirmCancel(true)}>ביטול חידוש אוטומטי</button>}
      <small>חיוב שכבר נשלח לסליקה עשוי להסתיים. לבירור או החזר אפשר לפנות דרך <Link href="/terms#updates">פרטי הקשר</Link>.</small>
    </footer>}
  </section>;
}
