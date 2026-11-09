'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const platforms = ['Behance', 'Website'] as const;
type SocialProvider = 'github' | 'linkedin';
type Profile = { name: string; headline: string; bio: string; skills: string[]; portfolio: string; experience: string; education: string };
type SocialSource = { provider: SocialProvider; sourceText: string; profile: Partial<Profile>; url: string; connectionId: string };
type DribbbleSource = { provider: 'dribbble'; sourceText: string; profile: Partial<Profile>; url: string };
type StoredSource = { id: string; name: string; size: number };
const blank: Profile = { name: '', headline: '', bio: '', skills: [], portfolio: '', experience: '', education: '' };
const providerLabels: Record<SocialProvider, string> = { github: 'GitHub', linkedin: 'LinkedIn' };
const DRIBBBLE_DRAFT_KEY = 'fz-dribbble-oauth-draft';

export function ProfileStudio() {
  const [files, setFiles] = useState<StoredSource[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [source, setSource] = useState<string | null>(null);
  const [socialSources, setSocialSources] = useState<Partial<Record<SocialProvider, SocialSource>>>({});
  const [connecting, setConnecting] = useState<SocialProvider | 'dribbble' | null>(null);
  const [dribbbleSource, setDribbbleSource] = useState<DribbbleSource | null>(null);
  const [profile, setProfile] = useState<Profile>(blank);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [consent, setConsent] = useState(false);
  const [tag, setTag] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const dribbbleResult = query.get('dribbble');
    let restoredProfile = false;
    if (dribbbleResult) {
      try {
        const saved = sessionStorage.getItem(DRIBBBLE_DRAFT_KEY);
        if (saved) {
          const draft = JSON.parse(saved) as { links?: unknown; profile?: unknown; tag?: unknown; consent?: unknown };
          if (draft.links && typeof draft.links === 'object' && !Array.isArray(draft.links)) setLinks(draft.links as Record<string, string>);
          if (draft.profile && typeof draft.profile === 'object' && !Array.isArray(draft.profile)) {
            setProfile({ ...blank, ...(draft.profile as Partial<Profile>) });
            restoredProfile = true;
          }
          if (typeof draft.tag === 'string') setTag(draft.tag);
          if (typeof draft.consent === 'boolean') setConsent(draft.consent);
        }
      } catch { /* Ignore invalid temporary editor state. */ }
      finally { sessionStorage.removeItem(DRIBBBLE_DRAFT_KEY); }
    }
    const resultMessages: Record<string, string> = {
      connected: 'פרופיל Dribbble והעבודות הציבוריות נטענו. לחצו Generate כדי לשלב אותם בפרופיל.',
      denied: 'חיבור Dribbble בוטל. אפשר לנסות שוב בכל עת.',
      failed: 'לא הצלחנו לייבא את Dribbble. בדקו את הגדרות החיבור ונסו שוב.',
      unconfigured: 'חיבור Dribbble עדיין לא הוגדר בסביבת השרת.',
      'state-error': 'בקשת החיבור ל־Dribbble פגה או לא התאימה. התחילו את החיבור מחדש.',
    };
    if (dribbbleResult && resultMessages[dribbbleResult]) {
      setNotice(resultMessages[dribbbleResult]);
      query.delete('dribbble');
      const suffix = query.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${suffix ? `?${suffix}` : ''}${window.location.hash}`);
    }
    refreshFiles();
    if (!restoredProfile) fetch('/api/marketplace/profile', { cache: 'no-store' }).then(async (response) => {
      if (response.ok) {
        const data = await response.json();
        if (data.profile) setProfile({ ...blank, ...data.profile });
      }
    }).catch(() => {});
    fetch('/api/integrations/dribbble', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { import?: DribbbleSource | null };
      setDribbbleSource(data.import || null);
    }).catch(() => {});
    fetch('/api/integrations/nango/connections', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { connections?: { provider: SocialProvider; connectionId: string }[] };
      await Promise.all((data.connections || []).map(async ({ provider, connectionId }) => {
        const imported = await fetch('/api/integrations/nango/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, connectionId }),
        }).then(async (result) => {
          const payload = await result.json();
          if (!result.ok) throw new Error(payload.error);
          return payload as SocialSource;
        });
        setSocialSources((current) => ({ ...current, [provider]: { ...imported, connectionId } }));
      }));
    }).catch(() => {});
  }, []);

  async function refreshFiles() {
    const response = await fetch('/api/uploads/profile-source', { cache: 'no-store' }).catch(() => null);
    if (!response?.ok) return;
    const data = await response.json() as { sources?: StoredSource[] };
    setFiles(data.sources || []);
  }

  async function addFiles(incoming: File[]) {
    if (incoming.some((file) => file.size > 8 * 1024 * 1024 || !/\.(pdf|txt|md)$/i.test(file.name))) {
      setNotice('אפשר להוסיף PDF, TXT או MD, עד 8MB לקובץ.');
      return;
    }
    if (incoming.length + files.length > 5) { setNotice('אפשר לשמור עד 5 מסמכים בפרופיל.'); return; }
    setUploading(true);
    setNotice('');
    try {
      for (const file of incoming) {
        const form = new FormData();
        form.set('file', file);
        const response = await fetch('/api/uploads/profile-source', { method: 'POST', body: form });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'שמירת המסמך נכשלה.');
      }
      await refreshFiles();
      setNotice('המסמכים נשמרו באופן פרטי בחשבון שלך.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'שמירת המסמך נכשלה.');
    } finally { setUploading(false); }
  }

  async function deleteFile(id: string) {
    const response = await fetch(`/api/uploads/profile-source?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    if (!response?.ok) { setNotice('לא הצלחנו למחוק את המסמך.'); return; }
    setFiles((current) => current.filter((file) => file.id !== id));
    setNotice('המסמך נמחק מהחשבון שלך.');
  }

  async function connectSocial(provider: SocialProvider) {
    setConnecting(provider);
    setNotice('');
    try {
      const sessionResponse = await fetch('/api/integrations/nango/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }),
      });
      const session = await sessionResponse.json();
      if (!sessionResponse.ok) throw new Error(session.error || 'לא הצלחנו להתחיל את החיבור.');

      const { default: Nango } = await import('@nangohq/frontend');
      const nango = new Nango();
      let finished = false;
      const connect = nango.openConnectUI({
        sessionToken: session.token,
        lang: 'he',
        themeOverride: 'light',
        onEvent: async (event) => {
          if (event.type === 'error') {
            setNotice(`חיבור ${providerLabels[provider]} נכשל. ${event.payload.errorMessage}`);
            setConnecting(null);
          }
          if (event.type === 'close' && !finished) setConnecting(null);
          if (event.type === 'connect' && !finished) {
            finished = true;
            try {
              const importResponse = await fetch('/api/integrations/nango/import', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, connectionId: event.payload.connectionId }),
              });
              const imported = await importResponse.json();
              if (!importResponse.ok) throw new Error(imported.error || 'החיבור הצליח, אבל ייבוא המידע נכשל.');
              setSocialSources((current) => ({ ...current, [provider]: { ...imported, connectionId: event.payload.connectionId } }));
              setNotice(`פרטי ${providerLabels[provider]} נטענו. לחצו Generate כדי לשלב אותם בפרופיל.`);
            } catch (error) {
              setNotice(error instanceof Error ? error.message : `ייבוא ${providerLabels[provider]} נכשל.`);
            } finally {
              setConnecting(null);
              connect.close();
            }
          }
        },
      });
    } catch (error) {
      setConnecting(null);
      setNotice(error instanceof Error ? error.message : `לא הצלחנו לחבר את ${providerLabels[provider]}.`);
    }
  }

  function connectDribbble() {
    try {
      sessionStorage.setItem(DRIBBBLE_DRAFT_KEY, JSON.stringify({ links, profile, tag, consent }));
    } catch { /* OAuth can continue when browser storage is unavailable. */ }
    setConnecting('dribbble');
    setNotice('מעבירים אותך ל־Dribbble לאישור קריאת פרטי הפרופיל והעבודות הציבוריות.');
    window.location.assign('/api/integrations/dribbble/connect');
  }

  async function disconnectSocial(provider: SocialProvider) {
    const connection = socialSources[provider];
    if (!connection) return;
    const response = await fetch(`/api/integrations/nango/connections?provider=${provider}&connectionId=${encodeURIComponent(connection.connectionId)}`, { method: 'DELETE' }).catch(() => null);
    if (!response?.ok) { setNotice('לא הצלחנו לנתק את החשבון. נסו שוב.'); return; }
    setSocialSources((current) => { const next = { ...current }; delete next[provider]; return next; });
    setNotice(`חיבור ${providerLabels[provider]} נותק. אפשר לבטל הרשאה גם בהגדרות הספק; מידע שכבר נשמר בפרופיל לא נמחק.`);
  }

  async function removeDribbbleImport() {
    const response = await fetch('/api/integrations/dribbble', { method: 'DELETE' }).catch(() => null);
    if (!response?.ok) { setNotice('לא הצלחנו להסיר את ייבוא Dribbble. נסו שוב.'); return; }
    setDribbbleSource(null);
    setNotice('המידע שיובא מ־Dribbble הוסר. לביטול הרשאת האפליקציה, בקרו בהגדרות החשבון ב־Dribbble.');
  }

  async function generate() {
    setBusy(true);
    setNotice('');
    try {
      const form = new FormData();
      form.set('sourceIds', JSON.stringify(files.map((file) => file.id)));
      form.set('urls', Object.values(links).filter(Boolean).join('\n'));
      const importedSources: { provider: SocialProvider | 'dribbble'; sourceText: string }[] = Object.values(socialSources)
        .filter((item): item is SocialSource => Boolean(item))
        .map(({ provider, sourceText }) => ({ provider, sourceText }));
      if (dribbbleSource) importedSources.push({ provider: 'dribbble', sourceText: dribbbleSource.sourceText });
      form.set('socialSources', JSON.stringify(importedSources));
      const response = await fetch('/api/ai/profile', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setProfile({ ...blank, ...data });
      setNotice(data.demo ? 'המידע מוכן, אבל Vertex AI עדיין לא הוגדר ליצירת טיוטה.' : 'הטיוטה מוכנה לבדיקה. השלימו או תקנו כל פרט לפני שמירה.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'היצירה נכשלה.');
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/marketplace/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { ...profile, profileType: 'freelancer' } }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      window.dispatchEvent(new CustomEvent('fz-profile-updated', { detail: profile }));
      setNotice(data.access?.state === 'trial' ? 'הפרופיל נשמר ותקופת הניסיון שלך פעילה. תאריך הסיום מופיע בחברות שלך.' : 'הפרופיל נשמר. להפעלת הניסיון השלימו שם, משפט על עצמכם וכישור אחד.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'שמירת הפרופיל נכשלה.');
    } finally {
      setBusy(false);
    }
  }

  const hasSources = files.length > 0 || Object.values(links).some(Boolean) || Object.keys(socialSources).length > 0 || Boolean(dribbbleSource);

  return <section className="profile-studio">
    <h1>הסיפור המקצועי שלך.</h1>
    <p>קל להקים פרופיל: מחברים אתר או מוסיפים מסמך, ואנחנו עוזרים למלא את הפרטים. אפשר גם למלא לבד.</p>
    <div className="source-workbench">
      <h2>המקורות שלך</h2>
      <p className="legal-inline-notice">בחירה או גרירה של קובץ שומרת אותו באופן פרטי בחשבון מיד. יצירת טיוטה ב־AI היא פעולה נפרדת: לאחר האישור נשלח את המקורות שנבחרו ל־Google Vertex AI. אפשר לערוך פרופיל ידנית ולמחוק מסמכים בעורך. <Link href="/privacy#uploads">פרטי העיבוד, השמירה וזכויותיכם</Link>.</p>
      <label className="profile-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); }}>
        <span>↥</span><strong>גררו לכאן את העבודה שלכם</strong><small>קורות חיים, תיק עבודות או מסמך מקצועי</small>
        <input type="file" multiple accept=".pdf,.txt,.md" disabled={uploading} onChange={(event) => { void addFiles(Array.from(event.target.files || [])); event.currentTarget.value = ''; }}/>
        <small>עד 5 קבצים · 8MB לקובץ · PDF / TXT / MD</small>
      </label>
      {files.map((file) => <div className="source-file" key={file.id}>{file.name}<button type="button" onClick={() => void deleteFile(file.id)} aria-label={`מחיקת ${file.name}`}>×</button></div>)}
      {uploading && <small role="status">שומרים מסמך באופן פרטי…</small>}

      <h3>חיבור לפרופילים המקצועיים</h3>
      <div className="social-sources">
        {(['linkedin', 'github'] as const).map((provider) => <button type="button" key={provider} className={socialSources[provider] ? 'linked' : ''} disabled={connecting !== null} onClick={() => connectSocial(provider)}>
          {connecting === provider ? 'מתחברים…' : `${providerLabels[provider]}${socialSources[provider] ? ' ✓' : ' ＋'}`}
        </button>)}
        <button type="button" className={dribbbleSource ? 'linked' : ''} disabled={connecting !== null} onClick={connectDribbble}>
          {connecting === 'dribbble' ? 'מתחברים…' : `Dribbble${dribbbleSource ? ' ✓' : ' ＋'}`}
        </button>
        {platforms.map((platform) => <button type="button" key={platform} className={links[platform] ? 'linked' : ''} onClick={() => setSource(source === platform ? null : platform)}>{platform}{links[platform] ? ' ✓' : ' ＋'}</button>)}
      </div>
      {source && <label className="source-url">קישור ציבורי ל־{source}<input type="url" dir="ltr" placeholder="https://" value={links[source] || ''} onChange={(event) => setLinks({ ...links, [source]: event.target.value })}/></label>}
      {(['linkedin', 'github'] as const).filter((provider) => socialSources[provider]).map((provider) => {
        const imported = socialSources[provider]!;
        return <article className="source-file social-import-card" key={provider}>
          <span><strong>{providerLabels[provider]} מחובר</strong><small>{imported.profile.name || imported.url || 'פרטי הפרופיל ייכללו ביצירה'}</small></span>
          {imported.url && <a href={imported.url} target="_blank" rel="noreferrer">פתיחה ↗</a>}
          <button type="button" onClick={() => void disconnectSocial(provider)} aria-label={`ניתוק ${providerLabels[provider]}`}>ניתוק</button>
        </article>;
      })}
      {dribbbleSource && <article className="source-file social-import-card" key="dribbble">
        <span><strong>Dribbble יובא</strong><small>{dribbbleSource.profile.name || dribbbleSource.url || 'פרטי הפרופיל והעבודות ייכללו ביצירה'}</small></span>
        {dribbbleSource.url && <a href={dribbbleSource.url} target="_blank" rel="noreferrer">פתיחה ↗</a>}
        <button type="button" onClick={() => void removeDribbbleImport()} aria-label="הסרת ייבוא Dribbble">הסרת ייבוא</button>
      </article>}
      <small>GitHub ו־LinkedIn יתחברו בחלון מאובטח. אפשר להסיר את הייבוא בכל עת לפני יצירת הפרופיל.</small>
      <small>Dribbble מייבא פרופיל ועבודות שפורסמו בלבד. הסרת המידע מכאן אינה מבטלת את הרשאת Dribbble. <a href="https://dribbble.com/account/applications" target="_blank" rel="noreferrer">ניהול הרשאות ב־Dribbble ↗</a></small>
      <label className="source-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/>מאשר/ת לשלוח את המסמכים, הקישורים והמידע המיובא שנבחרו ל־Google Vertex AI ליצירת טיוטה, כמפורט במדיניות הפרטיות.</label>
      <button type="button" className="generate-profile" disabled={busy || !consent || !hasSources} onClick={generate}>{busy ? 'יוצרים את הפרופיל…' : '✦ Generate'}</button>
    </div>
    <p role="status">{notice}</p>
    <div className="profile-template">
      <h2>הפרופיל שלך <small>הכול ניתן לעריכה</small></h2>
      {([['name', 'שם'], ['headline', 'Tagline · במשפט אחד'], ['bio', 'Summary · הסיפור שלך'], ['portfolio', 'תיק עבודות וקישורי מדיה'], ['experience', 'ניסיון תעסוקתי'], ['education', 'השכלה וקורסים']] as const).map(([key, label]) => <label key={key}>{label}<textarea rows={key === 'name' || key === 'headline' ? 1 : 3} value={profile[key]} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} placeholder="המידע מהמקורות יופיע כאן. אפשר גם לכתוב בעצמך."/></label>)}
      <h3>תגיות מקצועיות</h3><p>התגיות עוזרות למצוא פרויקטים ולהציג אותך ללקוחות מתאימים.</p>
      <div className="studio-tags">{profile.skills.map((skill, index) => <button type="button" key={`${skill}-${index}`} onClick={() => setProfile({ ...profile, skills: profile.skills.filter((_, i) => i !== index) })} aria-label={`הסרת ${skill}`}>{skill} ×</button>)}</div>
      <form className="tag-entry" onSubmit={(event) => { event.preventDefault(); if (tag.trim() && !profile.skills.includes(tag.trim())) setProfile({ ...profile, skills: [...profile.skills, tag.trim()] }); setTag(''); }}><input aria-label="תגית חדשה" value={tag} onChange={(event) => setTag(event.target.value)} placeholder="הוספת כישור"/><button>＋</button></form>
      <button type="button" className="generate-profile" onClick={saveProfile} disabled={busy}>שמירת הפרופיל</button>
    </div>
  </section>;
}
