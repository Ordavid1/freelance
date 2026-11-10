'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useState, type ReactNode } from 'react';
import type { MembershipAccess } from '@/lib/membership/state';
import { useViewer } from './viewer-context';
// Billing is only needed on the full membership view, so it loads on demand.
const BillingPanel = dynamic(() => import('./billing-panel').then((module) => module.BillingPanel));

export function useMembership() {
  const { status } = useViewer();
  const [access, setAccess] = useState<MembershipAccess | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  useEffect(() => {
    // Membership is account-only: anonymous visitors never call the endpoint.
    if (status !== 'signed-in') return;
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
  }, [status]);
  if (status === 'anonymous') return { access: null, state: 'signed-out' as const };
  if (status === 'loading') return { access: null, state: 'loading' as const };
  return { access, state };
}
const formatDate = (value: number) => new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short' }).format(value);
export function TrialStatus({ onSetup, full = false }: { onSetup?: () => void; full?: boolean }) {
  const { access, state } = useMembership();
  const [dismissed, setDismissed] = useState(false);
  if (!full && dismissed && access?.state === 'preview') return null;
  // Nothing is announced while the viewer is unknown. The full view keeps its space so the page does not jump.
  if (state === 'loading') return full ? <div className="trial-status-pending" aria-hidden="true" /> : null;
  if (state === 'signed-out') return full ? <section className="trial-status"><h2>חודשיים להתחיל משהו טוב.</h2><p>מקימים פרופיל בקלות ומקבלים הגשת הצעות בחינם לחודשיים. לאחר מכן ₪19.99 לחודש.</p><Link href="/signin">כניסה והקמת פרופיל</Link></section> : null;
  if (state === 'error' || !access) return <p role="alert">לא ניתן לטעון את מצב החברות. נסו לרענן את העמוד.</p>;
  if (access.profileType === 'publisher') return full ? <><section className="trial-status"><h2>פרסום פרויקטים בחינם, תמיד.</h2><p>אפשר לפרסם פרויקטים, לקבל הצעות ולנהל שיחות ללא מנוי וללא מגבלת ניסיון. החברות בתשלום מיועדת להגשת הצעות כפרילנסר/ית בלבד, והיא לא משפיעה על פרסום פרויקטים.</p></section><BillingPanel/></> : null;
  if (access.state === 'legacy') return full ? <section className="trial-status"><h2>הגישה שלך פעילה.</h2><p>החשבון שלך ממשיך לפעול בתנאים הקיימים. אין חיוב פעיל.</p><p>מחיר החברות החדשה: ₪19.99 לחודש.</p></section> : null;
  if (access.state === 'paid') return <><section className="trial-status"><h2>החברות שלך פעילה.</h2><p>אפשר להגיש הצעות עד {formatDate(access.paidUntil!)}.</p>{!full && <Link href="/membership">ניהול החברות והתשלומים</Link>}</section>{full && <BillingPanel/>}</>;
  return <><section className={`trial-status trial-${access.state}`} aria-label="מצב החברות">
    {!full && access.state === 'preview' && <button type="button" className="trial-dismiss" aria-label="הסתרת התזכורת" onClick={() => setDismissed(true)}>×</button>}
    <h2>{access.state === 'preview' ? 'פרופיל קטן. הזדמנויות גדולות.' : access.state === 'trial' ? 'החודשיים שלך כבר כאן.' : 'תקופת הניסיון הסתיימה.'}</h2>
    {access.state === 'preview' ? <><p>הקמת הפרופיל קלה: מחברים מקור קיים או משלימים כמה פרטים. פרסום פרויקט לחיפוש פרילנסרים חינם תמיד.</p><p><strong>חודשיים של הגשת הצעות בחינם</strong> מתחילים אחרי שמירת הפרופיל. לאחר מכן ₪19.99 לחודש.</p>{onSetup ? <button type="button" onClick={onSetup}>נקים את הפרופיל שלי</button> : <Link href="/profile/import">נקים את הפרופיל שלי</Link>}<small>בינתיים אפשר לעיין בפרויקטים ללא התחייבות.</small></> : access.state === 'trial' ? <><p>אפשר להגיש הצעות עד {formatDate(access.trialEndsAt!)}.</p>{full && <p>הניסיון התחיל ב־{formatDate(access.trialStartedAt!)}.</p>}<p>לאחר מכן ₪19.99 לחודש. אין חיוב אוטומטי ללא הצטרפות.</p>{!full && <Link href="/membership#membership-billing">מנוי ותשלומים</Link>}</> : <><p>אפשר להמשיך לעיין בפרויקטים ולערוך את הפרופיל. להגשת הצעות נדרשת חברות ב־₪19.99 לחודש.</p><Link href="/membership">הצטרפות וניהול חברות</Link></>}
  </section>{full && <BillingPanel eligible={access.state === 'expired' || access.state === 'trial'} trialEndsAt={access.state === 'trial' ? access.trialEndsAt : null}/>}</>;
}
export function MemberGate({ children }: { children: ReactNode }) {
  const { access, state } = useMembership();
  if (state === 'loading') return <p role="status">בודקים גישה…</p>;
  if (state === 'signed-out') return <p className="trial-status">כדי להתחיל, <Link href="/signin">נכנסים לחשבון</Link> ומקימים פרופיל בקלות.</p>;
  if (state === 'error') return <p role="alert">לא ניתן לבדוק גישה כרגע. נסו לרענן את העמוד.</p>;
  if (!access?.canUseMarketplace) return <TrialStatus full />;
  return <>{children}</>;
}
