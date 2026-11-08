'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { ProfileStudio } from './profile-studio';
export function ProfileSetup({ initialRole = 'freelancer' }: { initialRole?: 'freelancer' | 'publisher' }) {
  const [role, setRole] = useState(initialRole);
  return <div><div className="role-choice" aria-label="סוג הפרופיל"><button type="button" aria-pressed={role === 'freelancer'} className={role === 'freelancer' ? 'selected' : ''} onClick={() => setRole('freelancer')}>אני פרילנסר/ית</button><button type="button" aria-pressed={role === 'publisher'} className={role === 'publisher' ? 'selected' : ''} onClick={() => setRole('publisher')}>אני מחפש/ת פרילנסר</button></div>{role === 'publisher' ? <PublisherProfileSetup /> : <ProfileStudio />}</div>;
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
      setNotice(data.access?.state === 'trial' ? 'הפרופיל מוכן. 14 ימי הפעילות המלאה שלך התחילו!' : 'הפרופיל נשמר.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'לא הצלחנו לשמור. נסו שוב.'); } finally { setBusy(false); }
  }
  return <form className="publisher-setup" onSubmit={save}><h2>שם אחד, ואפשר להתחיל.</h2><p>הקמת פרופיל למפרסמי פרויקטים פשוטה במיוחד. איך תרצו להופיע בפני הפרילנסרים?</p><label>שם או שם העסק<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} autoComplete="organization" /></label><button type="submit" disabled={busy || !name.trim()}>{busy ? 'שומרים…' : 'שמירת הפרופיל והמשך'}</button><p role="status">{notice}</p></form>;
}
