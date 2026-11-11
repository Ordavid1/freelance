'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useViewer } from './viewer-context';
import Link from 'next/link';
import { useViewMode } from './view-mode';
import { ProfileStudio } from './profile-studio';
import { HANDOFF_PATHS } from '@/lib/imports/xplace/handoff';
import { nextForPage, signInHref } from '@/lib/auth/safe-next';
export function ProfileSetup() {
  const { mode: role, setMode: setRole } = useViewMode();
  const viewer = useViewer();
  const sessionState = viewer.status === 'signed-in' ? 'signed-in' : viewer.status === 'anonymous' ? 'signed-out' : 'loading';
  const userId = viewer.user?.uid || '';
  // Carry the path and the XPlace hand-off query through sign-in (the token survives the detour).
  const [signInNext, setSignInNext] = useState<string>(HANDOFF_PATHS.profile);
  useEffect(() => { setSignInNext(nextForPage(HANDOFF_PATHS.profile, window.location.search)); }, []);
  if (sessionState === 'loading') return <p role="status">בודקים את החיבור לחשבון…</p>;
  if (sessionState === 'signed-out') return <section className="signin-panel"><h2>מתחברים כדי לבנות את הפרופיל שלך</h2><p>יש להתחבר לחשבון Freelance Place לפני חיבור חשבונות מקצועיים, העלאת מסמכים ושמירת הפרופיל. אם החיבור הקודם פג, התחברו מחדש.</p><Link className="button button-dark" href={signInHref(signInNext)}>התחברות או פתיחת חשבון</Link></section>;
  return <div><div className="role-choice" aria-label="תצוגת הפרופיל"><button type="button" aria-pressed={role === 'freelancer'} className={role === 'freelancer' ? 'selected' : ''} onClick={() => setRole('freelancer')}>אני פרילנסר/ית</button><button type="button" aria-pressed={role === 'publisher'} className={role === 'publisher' ? 'selected' : ''} onClick={() => setRole('publisher')}>אני מחפש/ת פרילנסר</button></div>{role === 'publisher' ? <PublisherProfileSetup /> : <ProfileStudio key={userId} userId={userId} />}</div>;
}
function PublisherProfileSetup() {
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState(''); const [website, setWebsite] = useState(''); const [logo, setLogo] = useState(''); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  useEffect(() => { let active = true; void fetch('/api/marketplace/profile', { cache: 'no-store' }).then(r => r.json()).then(data => { if (active) { setName(data.profile?.name || ''); setPhone(data.profile?.phone || ''); setEmail(data.profile?.email || ''); setWebsite(data.profile?.website || ''); setLogo(data.profile?.logo || ''); } }).catch(() => {}); return () => { active = false; }; }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/marketplace/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { name, phone, email, website, logo } }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      window.dispatchEvent(new CustomEvent('fz-profile-updated'));
      setNotice(data.access?.state === 'trial' ? 'הפרופיל מוכן. חודשיים של פעילות מלאה התחילו!' : 'הפרופיל נשמר.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'לא הצלחנו לשמור. נסו שוב.'); } finally { setBusy(false); }
  }
  return <form className="publisher-setup" onSubmit={save}><h2>שם אחד, ואפשר להתחיל.</h2><p>הקמת פרופיל למפרסמי פרויקטים פשוטה במיוחד. איך תרצו להופיע בפני הפרילנסרים?</p><div className="publisher-fields"><label>שם או שם העסק<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} autoComplete="organization" /></label><label>טלפון<input type="tel" maxLength={40} value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" /></label><label>כתובת אימייל<input type="email" maxLength={200} value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label><label>אתר אישי<input type="url" maxLength={200} value={website} onChange={e => setWebsite(e.target.value)} autoComplete="url" dir="ltr" /></label><label className="publisher-logo">לוגו אישי<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 1_400_000) { setNotice('גודל הלוגו יכול להיות עד 1.4MB.'); event.target.value = ''; return; } const reader = new FileReader(); reader.onload = () => setLogo(typeof reader.result === 'string' ? reader.result : ''); reader.readAsDataURL(file); }} /><small>PNG, JPG, WebP או SVG · עד 1.4MB</small>{logo && <span className="logo-preview"><img src={logo} alt="תצוגה מקדימה של הלוגו"/><button type="button" onClick={() => setLogo('')}>הסרת הלוגו</button></span>}</label></div><button className="publisher-save" type="submit" disabled={busy || !name.trim()}>{busy ? 'שומרים…' : 'שמירת הפרופיל והמשך'}</button><p role="status">{notice}</p></form>;
}
