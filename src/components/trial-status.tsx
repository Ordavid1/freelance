'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { MembershipAccess } from '@/lib/membership/state';

export function useMembership() {
  const [access, setAccess] = useState<MembershipAccess | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch('/api/marketplace/access', { cache: 'no-store' });
        if (!active) return;
        if (response.status === 401) { setAccess(null); setState('signed-out'); return; }
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (active) { setAccess(data); setState('ready'); }
      } catch { if (active) setState('error'); }
    }
    void refresh();
    const onRefresh = () => void refresh();
    window.addEventListener('fz-profile-updated', onRefresh);
    window.addEventListener('focus', onRefresh);
    const interval = window.setInterval(onRefresh, 30000);
    return () => { active = false; clearInterval(interval); window.removeEventListener('fz-profile-updated', onRefresh); window.removeEventListener('focus', onRefresh); };
  }, []);
  return { access, state };
}
const formatDate = (value: number) => new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short' }).format(value);
export function TrialStatus({ onSetup, full = false }: { onSetup?: () => void; full?: boolean }) {
  const { access, state } = useMembership();
  const [dismissed, setDismissed] = useState(false);
  if (!full && dismissed && access?.state === 'preview') return null;
  if (state === 'loading') return <p role="status">טוענים את מצב החברות…</p>;
  if (state === 'signed-out') return full ? <section className="trial-status"><h2>14 ימים להתחיל משהו טוב.</h2><p>מקימים פרופיל בקלות ומקבלים פעילות מלאה בחינם לשבועיים. לאחר מכן ₪19.99 לחודש.</p><Link href="/signin">כניסה והקמת פרופיל</Link></section> : null;
  if (state === 'error' || !access) return <p role="alert">לא ניתן לטעון את מצב החברות. נסו לרענן את העמוד.</p>;
  if (access.state === 'legacy') return full ? <section className="trial-status"><h2>הגישה שלך פעילה.</h2><p>החשבון שלך ממשיך לפעול בתנאים הקיימים. אין חיוב פעיל.</p><p>מחיר החברות החדשה: ₪19.99 לחודש.</p></section> : null;
  return <section className={`trial-status trial-${access.state}`} aria-label="מצב החברות">
    {!full && access.state === 'preview' && <button type="button" className="trial-dismiss" aria-label="הסתרת התזכורת" onClick={() => setDismissed(true)}>×</button>}
    <h2>{access.state === 'preview' ? 'פרופיל קטן. הזדמנויות גדולות.' : access.state === 'trial' ? 'השבועיים שלך כבר כאן.' : 'תקופת הניסיון הסתיימה.'}</h2>
    {access.state === 'preview' ? <><p>הקמת הפרופיל קלה: מחברים מקור קיים או משלימים כמה פרטים. למחפשי פרילנסר מספיק לאשר שם או שם עסק.</p><p><strong>14 ימי פעילות מלאה בחינם</strong> מתחילים אחרי שמירת הפרופיל. לאחר מכן ₪19.99 לחודש.</p>{onSetup ? <button type="button" onClick={onSetup}>נקים את הפרופיל שלי</button> : <Link href="/profile/import">נקים את הפרופיל שלי</Link>}<small>בינתיים אפשר לעיין בפרויקטים ללא התחייבות.</small></> : access.state === 'trial' ? <><p>יש לך גישה מלאה עד {formatDate(access.trialEndsAt!)}.</p>{full && <p>הניסיון התחיל ב־{formatDate(access.trialStartedAt!)}.</p>}<p>לאחר מכן ₪19.99 לחודש. אין חיוב אוטומטי.</p></> : <><p>אפשר להמשיך לעיין בפרויקטים ולערוך את הפרופיל. לפעילות מלאה נדרשת חברות ב־₪19.99 לחודש.</p><p>אפשרות התשלום עדיין אינה זמינה. נציג כאן את ההצטרפות כשהיא תהיה מוכנה.</p></>}
  </section>;
}
export function MemberGate({ children }: { children: ReactNode }) {
  const { access, state } = useMembership();
  if (state === 'loading') return <p role="status">בודקים גישה…</p>;
  if (state === 'signed-out') return <p className="trial-status">כדי להתחיל, <Link href="/signin">נכנסים לחשבון</Link> ומקימים פרופיל בקלות.</p>;
  if (state === 'error') return <p role="alert">לא ניתן לבדוק גישה כרגע. נסו לרענן את העמוד.</p>;
  if (!access?.canUseMarketplace) return <TrialStatus full />;
  return <>{children}</>;
}
