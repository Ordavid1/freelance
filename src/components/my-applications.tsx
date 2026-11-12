'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useViewer } from './viewer-context';
type Application = { id: string; conversationId: string; projectSlug: string; projectTitle: string; amount: number; pricingType: string; delivery: string; message: string; status: string; isDemo?: boolean; privateFromPublic?: boolean };
export function MyApplications({ revision = 0 }: { revision?: number }) {
  const { status } = useViewer();
  const [items, setItems] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (status !== 'signed-in') return;
    let active = true;
    setLoading(true);
    fetch('/api/marketplace/proposals', { cache: 'no-store' }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (active) { setItems(data.proposals || []); setError(''); }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'לא ניתן לטעון הצעות.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, status]);
  async function withdraw(id: string) {
    setBusy(id); setError('');
    try {
      const response = await fetch('/api/marketplace/proposals', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proposalId: id }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setItems(old => old.map(item => item.id === id ? { ...item, status: 'withdrawn' } : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ביטול ההצעה נכשל.'); }
    finally { setBusy(null); }
  }
  if (status !== 'signed-in') return null;
  return <section className="my-applications" aria-label="הפרויקטים שהגשתי אליהם הצעה">
    <header className="applications-heading"><h2>הנה הפרוייקטים שהצעת עליהם</h2><p>ההצעות ששלחת והשיחות עם המפרסמים, במקום אחד.</p></header>
    {error && <p className="error-text" role="alert">{error}</p>}
    {loading ? <p role="status">טוענים את ההצעות שלך…</p> : !error && !items.length ? <div className="studio-project empty-state"><strong>כאן יופיע החיבור הבא שלך</strong>אחרי שליחת הצעה לפרויקט, אפשר לעקוב אחריה ולנהל את השיחה כאן.</div> : items.map(item => <article className="studio-project application-card" key={item.id}>
      <div className="application-badges"><span className="application-status">{item.isDemo ? 'הצעת בדיקה · לא נשלחה' : item.status === 'withdrawn' ? 'ההצעה בוטלה' : 'ההצעה נשלחה'}</span>{item.privateFromPublic && <span className="application-privacy-badge">פרטי למפרסם/ת</span>}</div>
      <h2><Link href={`/projects/${encodeURIComponent(item.projectSlug)}`}>{item.projectTitle}</Link></h2>
      <h4 className="application-offer-label">ההצעה ששלחת</h4><p className="application-message">{item.message}</p>
      <p><strong>{new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(item.amount)}</strong> · {item.pricingType === 'hourly' ? 'לשעה' : 'מחיר קבוע'} · {item.delivery}</p>
      {item.isDemo ? <p>ההצעה הזו נשמרה רק בחשבון שלך כדי לבדוק את טופס ההגשה. היא לא נשלחה למפרסם/ת.</p> : <div className="application-actions"><Link className="button-outline" href={`/messages?conversation=${encodeURIComponent(item.conversationId)}`}>הודעה למפרסם/ת</Link>{item.status === 'submitted' && <button disabled={busy === item.id} onClick={() => void withdraw(item.id)}>{busy === item.id ? 'מבטלים…' : 'ביטול ההצעה'}</button>}</div>}
    </article>)}
  </section>;
}
