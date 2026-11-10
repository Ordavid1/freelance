'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useViewer } from './viewer-context';
import Link from 'next/link';
import { ProfileStudio } from './profile-studio';
export function ProfileSetup({ initialRole = 'freelancer' }: { initialRole?: 'freelancer' | 'publisher' }) {
  const [role, setRole] = useState(initialRole);
  const viewer = useViewer();
  const sessionState = viewer.status === 'signed-in' ? 'signed-in' : viewer.status === 'anonymous' ? 'signed-out' : 'loading';
  const userId = viewer.user?.uid || '';
  if (sessionState === 'loading') return <p role="status">בודקים את החיבור לחשבון…</p>;
  if (sessionState === 'signed-out') return <section className="signin-panel"><h2>מתחברים כדי לבנות את הפרופיל שלך</h2><p>יש להתחבר לחשבון Freelance Place לפני חיבור חשבונות מקצועיים, העלאת מסמכים ושמירת הפרופיל. אם החיבור הקודם פג, התחברו מחדש.</p><Link className="button button-dark" href="/signin?next=%2Fprofile%2Fimport">התחברות או פתיחת חשבון</Link></section>;
  return <div><div className="role-choice" aria-label="סוג הפרופיל"><button type="button" aria-pressed={role === 'freelancer'} className={role === 'freelancer' ? 'selected' : ''} onClick={() => setRole('freelancer')}>אני פרילנסר/ית</button><button type="button" aria-pressed={role === 'publisher'} className={role === 'publisher' ? 'selected' : ''} onClick={() => setRole('publisher')}>אני מחפש/ת פרילנסר</button></div>{role === 'publisher' ? <PublisherProfileSetup /> : <ProfileStudio key={userId} userId={userId} />}</div>;
}
function PublisherProfileSetup() {
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  useEffect(() => { let active = true; void fetch('/api/marketplace/profile', { cache: 'no-store' }).then(r => r.json()).then(data => { if (active) setName(data.profile?.name || ''); }).catch(() => {}); return () => { active = false; }; }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/marketplace/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { profileType: 'publisher', name } }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      window.dispatchEvent(new CustomEvent('fz-profile-updated'));
      setNotice(data.access?.state === 'trial' ? 'הפרופיל מוכן. חודשיים של פעילות מלאה התחילו!' : 'הפרופיל נשמר.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'לא הצלחנו לשמור. נסו שוב.'); } finally { setBusy(false); }
  }
  return <form className="publisher-setup" onSubmit={save}><h2>שם אחד, ואפשר להתחיל.</h2><p>הקמת פרופיל למפרסמי פרויקטים פשוטה במיוחד. איך תרצו להופיע בפני הפרילנסרים?</p><label>שם או שם העסק<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} autoComplete="organization" /></label><button type="submit" disabled={busy || !name.trim()}>{busy ? 'שומרים…' : 'שמירת הפרופיל והמשך'}</button><p role="status">{notice}</p></form>;
}
