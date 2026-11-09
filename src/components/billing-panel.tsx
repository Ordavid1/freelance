'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
type Status = { available: boolean; autoRenew: boolean; status: string; last4: string | null; paidUntil: number | null; payments: { id: string; amountAgorot: number; paidAt: number; documentNumber: number | null; invoicePending: boolean }[] };
const date = (value: number) => new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium' }).format(value);
export function BillingPanel({ eligible = false, trialEndsAt }: { eligible?: boolean; trialEndsAt?: number | null }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function refresh() {
    const response = await fetch('/api/billing/status', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    setStatus(await response.json());
  }
  useEffect(() => {
    let active = true;
    async function load() {
      const id = new URLSearchParams(window.location.search).get('order');
      if (id) {
        try {
          const response = await fetch('/api/billing/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: id }) });
          if (active) setMessage(response.ok ? 'התשלום אושר והחברות פעילה.' : 'התשלום עדיין לא אושר. אם השלמתם תשלום, רעננו בעוד רגע.');
          if (response.ok) { window.history.replaceState({}, '', '/membership'); window.dispatchEvent(new Event('fz-profile-updated')); }
        } catch { if (active) setMessage('לא ניתן לאמת את התשלום כרגע. נסו לרענן.'); }
      }
      try { if (active) await refresh(); } catch { if (active) setMessage('לא ניתן לטעון את פרטי התשלום. נסו לרענן.'); }
    }
    void load();
    return () => { active = false; };
  }, []);
  async function checkout() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent }) });
      const data = await response.json();
      if (!response.ok) { setMessage(data.error === 'BILLING_IDENTITY_REQUIRED' ? 'נדרשים שם ואימייל בחשבון (עד 50 תווים לכל שדה) לפני התשלום.' : 'לא ניתן לפתוח את התשלום כרגע. נסו שוב.'); return; }
      window.location.assign(data.redirectUrl);
    } catch { setMessage('לא ניתן להתחבר לשירות התשלום. נסו שוב.'); } finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true);
    try {
      const response = await fetch('/api/billing/status', { method: 'DELETE' });
      if (!response.ok) throw new Error();
      await refresh(); setMessage('החידוש האוטומטי בוטל. הגישה נשארת עד סוף התקופה ששולמה.');
    } catch { setMessage('הביטול לא אושר. נסו שוב או פנו אלינו.'); } finally { setBusy(false); }
  }
  const canCheckout = eligible && status?.available === true;
  let checkoutNote = 'פרטי הכרטיס נמסרים ל־Cardcom. חשבונית תישלח באימייל. אפשר לבטל את החידוש כאן בכל עת.';
  if (trialEndsAt) checkoutNote = `ההצטרפות למנוי תיפתח בסיום הניסיון, ב־${date(trialEndsAt)}. עד אז הגשת הצעות בחינם וללא חיוב.`;
  else if (!eligible) checkoutNote = status?.paidUntil && status.paidUntil > Date.now() ? 'אפשר לחדש מנוי לאחר סיום התקופה ששולמה.' : 'אפשר להצטרף לאחר הקמת פרופיל פרילנסר וסיום 14 ימי הניסיון.';
  else if (!status) checkoutNote = message || 'טוענים את אפשרות התשלום…';
  else if (!status.available) checkoutNote = 'התשלום אינו זמין כרגע. לא נוצר חיוב.';
  return <section id="membership-billing" className="trial-status billing-panel" aria-label="תשלומים וחידוש חברות">
    <h2>מנוי ותשלומים</h2>
    <h3>הגשת הצעות לפרויקטים ב־₪19.99 לחודש</h3>
    <p>המחיר כולל מע״מ ככל שחל. החברות מתחדשת אוטומטית מדי חודש לאחר הצטרפות מפורשת. אין חיוב בסיום הניסיון ללא הצטרפות.</p>
    {status?.paidUntil && <p>התקופה ששולמה מסתיימת ב־{date(status.paidUntil)}. {status.autoRenew ? 'החיוב הבא במועד זה.' : 'החידוש האוטומטי כבוי.'}</p>}
    {status?.last4 && <p>כרטיס המסתיים ב־<bdi>{status.last4}</bdi></p>}
    {status?.status === 'past_due' && <p role="alert">החידוש נכשל והחיוב האוטומטי הופסק. אפשר להצטרף מחדש לאחר סיום הגישה ששולמה.</p>}
    {status?.autoRenew ? <><button disabled={busy} onClick={() => void cancel()}>ביטול חידוש אוטומטי</button><small>חיוב שכבר נשלח לסליקה עשוי להסתיים. לבירור או החזר אפשר לפנות דרך <Link href="/terms#updates">פרטי הקשר</Link>.</small></> : <>
      {canCheckout && <label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/> אני מאשר/ת חיוב של ₪19.99 כעת וחידוש אוטומטי חודשי באותו מחיר עד לביטול, לפי <Link href="/terms#payments">תנאי החברות והביטול</Link>.</label>}
      <button disabled={busy || !consent || !canCheckout} aria-describedby="membership-checkout-note" onClick={() => void checkout()}>{busy ? 'פותחים תשלום…' : 'הצטרפות ותשלום מאובטח ב־Cardcom'}</button>
      <p id="membership-checkout-note">{checkoutNote}</p>
    </>}
    {message && <p role="status">{message}</p>}
    {status && <><h3>היסטוריית תשלומים</h3>{status.payments.length ? <ul>{status.payments.map(payment => <li key={payment.id}>{date(payment.paidAt)} · ₪{(payment.amountAgorot / 100).toFixed(2)} · {payment.documentNumber ? `מסמך ${payment.documentNumber} נשלח באימייל` : 'מסמך החשבונית בבדיקה'}</li>)}</ul> : <p>עדיין אין תשלומים בחשבון.</p>}</>}
  </section>;
}
