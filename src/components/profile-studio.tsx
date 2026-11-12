'use client';
import { trackEvent } from '@/lib/analytics';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { XPlaceProfileImport } from '@/lib/imports/types';
import { PlatformIcon, SourceCheck } from './profile-source-icons';
import { HandoffNotice, useAutoHandoff, useXPlaceFlags, useXPlaceIngest } from './xplace-handoff';
import { XPlaceProfilePanel } from './xplace-profile-panel';
import styles from './profile-studio.module.css';
import '@/app/profile-entry-editor.css';

const platforms = ['Behance', 'Website'] as const;
type LinkPlatform = typeof platforms[number];
type SocialProvider = 'github' | 'linkedin';
type Profile = { name: string; headline: string; bio: string; skills: string[]; portfolio: string; experience: string; education: string; website?: string; avatar?: string };
type SocialSource = { provider: SocialProvider; sourceText: string; profile: Partial<Profile>; url: string; connectionId: string };
type DribbbleSource = { provider: 'dribbble'; sourceText: string; profile: Partial<Profile>; url: string };
type XPlaceSource = Pick<XPlaceProfileImport, 'provider' | 'sourceText' | 'profile' | 'url' | 'warnings' | 'counts' | 'ownerSignal'>;
type StoredSource = { id: string; name: string; size: number };
const blank: Profile = { name: '', headline: '', bio: '', skills: [], portfolio: '', experience: '', education: '' };
const providerLabels: Record<SocialProvider, string> = { github: 'GitHub', linkedin: 'LinkedIn' };
const DRIBBBLE_DRAFT_KEY = 'fz-dribbble-oauth-draft';
const XPLACE_IMPORT_KEY = 'fz-xplace-import';

function splitEntries(value: string) {
  return value.split(/\r?\n/).map((entry) => entry.trim().replace(/^[•▪*-]\s*/, '')).filter(Boolean);
}

function PortfolioLine({ entry, index, onChange, onRemove }: { entry: string; index: number; onChange: (value: string) => void; onRemove: () => void }) {
  const url = entry.match(/https?:\/\/[^\s)]+/i)?.[0];
  const title = url ? entry.replace(url, '').replace(/[|:–—-]\s*$/, '').trim() || new URL(url).hostname : entry;
  return <div className="profile-entry-pill portfolio-entry-pill">
    <span className="profile-entry-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
    {url ? <a className="portfolio-preview" href={url} target="_blank" rel="noopener noreferrer" aria-label={`פתיחת ${title} בכרטיסייה חדשה`}>
      <img src={`https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url)}&sz=128`} alt="" loading="lazy" />
      <span><strong>{title}</strong><small dir="ltr">{new URL(url).hostname}</small></span><b aria-hidden="true">↗</b>
    </a> : <textarea aria-label={`תיק עבודות, פריט ${index + 1}`} rows={1} value={entry} onChange={(event) => onChange(event.target.value)} />}
    <button className="profile-entry-remove" type="button" onClick={onRemove} aria-label={`הסרת פריט ${index + 1}`}>×</button>
  </div>;
}

function ProfileEntryEditor({ title, value, onChange, placeholder }: { title: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const entries = splitEntries(value);
  const update = (index: number, text: string) => onChange(entries.map((entry, i) => i === index ? text : entry).join('\n'));
  const remove = (index: number) => onChange(entries.filter((_, i) => i !== index).join('\n'));
  return <section className="profile-entry-group" aria-label={title}>
    <div className="profile-entry-heading">{title}<small>{entries.length} פריטים</small></div>
    <div className="profile-entry-list">{entries.length ? entries.map((entry, index) => title.startsWith('תיק עבודות') ? <PortfolioLine key={`${index}-${entry.slice(0, 24)}`} entry={entry} index={index} onChange={(text) => update(index, text)} onRemove={() => remove(index)}/> : <div className="profile-entry-pill" key={`${index}-${entry.slice(0, 24)}`}>
      <span className="profile-entry-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <textarea aria-label={`${title}, פריט ${index + 1}`} rows={1} value={entry} onChange={(event) => update(index, event.target.value)} placeholder={placeholder}/>
      <button className="profile-entry-remove" type="button" onClick={() => remove(index)} aria-label={`הסרת פריט ${index + 1}`}>×</button>
    </div>) : <div className="profile-entry-empty">עדיין אין פריטים. אפשר להוסיף כאן מידע או ליצור טיוטה מהמקורות.</div>}</div>
    <form className="profile-entry-add" onSubmit={(event) => { event.preventDefault(); const text = draft.trim(); if (text) { onChange([...entries, text].join('\n')); setDraft(''); } }}>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`הוספת פריט ל${title}`} placeholder={`הוספת ${title.toLowerCase()}…`}/>
      <button type="submit" disabled={!draft.trim()} aria-label={`הוספת פריט ל${title}`}>＋</button>
    </form>
  </section>;
}

export function ProfileStudio({ userId }: { userId: string }) {
  const [files, setFiles] = useState<StoredSource[]>([]);
  const [links, setLinks] = useState<Partial<Record<LinkPlatform, string>>>({});
  const [linkDrafts, setLinkDrafts] = useState<Partial<Record<LinkPlatform, string>>>({});
  const [source, setSource] = useState<LinkPlatform | null>(null);
  const [linkError, setLinkError] = useState('');
  const [socialConnections, setSocialConnections] = useState<Partial<Record<SocialProvider, string>>>({});
  const [socialSources, setSocialSources] = useState<Partial<Record<SocialProvider, SocialSource>>>({});
  const [importing, setImporting] = useState<Partial<Record<SocialProvider, boolean>>>({});
  const [importErrors, setImportErrors] = useState<Partial<Record<SocialProvider, string>>>({});
  const [connecting, setConnecting] = useState<SocialProvider | 'dribbble' | null>(null);
  const [dribbbleSource, setDribbbleSource] = useState<DribbbleSource | null>(null);
  const xplaceFlags = useXPlaceFlags();
  const [xplaceSource, setXplaceSource] = useState<XPlaceSource | null>(null);
  const [xplaceOpen, setXplaceOpen] = useState(false);
  const [profile, setProfile] = useState<Profile>(blank);
  const [avatarDragOver, setAvatarDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [tag, setTag] = useState('');
  const [uploading, setUploading] = useState(false);
  const [fileLoadError, setFileLoadError] = useState('');
  const restoredDraft = useRef(false);
  const importRequests = useRef<Partial<Record<SocialProvider, number>>>({});
  const approvedLinksKey = `fz-profile-approved-links:${userId}`;
  const xplaceKey = `${XPLACE_IMPORT_KEY}:${userId}`;
  const dribbbleDraftKey = `${DRIBBBLE_DRAFT_KEY}:${userId}`;

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(approvedLinksKey) || '{}') as Partial<Record<LinkPlatform, unknown>>;
      setLinks(Object.fromEntries(platforms.flatMap((platform) => typeof saved[platform] === 'string' ? [[platform, saved[platform]]] : [])));
    } catch { /* Approved links can still be added when browser storage is unavailable. */ }
    try {
      const saved = JSON.parse(sessionStorage.getItem(xplaceKey) || 'null') as Partial<XPlaceSource> | null;
      if (saved && saved.provider === 'xplace' && typeof saved.sourceText === 'string' && saved.sourceText && typeof saved.url === 'string') {
        setXplaceSource({ provider: 'xplace', sourceText: saved.sourceText, url: saved.url, profile: saved.profile && typeof saved.profile === 'object' ? saved.profile : {} as XPlaceSource['profile'], warnings: Array.isArray(saved.warnings) ? saved.warnings.filter((w): w is string => typeof w === 'string') : [], ...(saved.counts && typeof saved.counts === 'object' ? { counts: saved.counts } : {}), ...(typeof saved.ownerSignal === 'boolean' ? { ownerSignal: saved.ownerSignal } : {}) });
      }
    } catch { /* The import can be repeated when browser storage is unavailable. */ }
    const query = new URLSearchParams(window.location.search);
    const dribbbleResult = query.get('dribbble');
    if (dribbbleResult) {
      try {
        const saved = sessionStorage.getItem(dribbbleDraftKey);
        if (saved) {
          const draft = JSON.parse(saved) as { links?: unknown; linkDrafts?: unknown; source?: unknown; profile?: unknown; tag?: unknown };
          if (draft.links && typeof draft.links === 'object' && !Array.isArray(draft.links)) setLinks(draft.links as Partial<Record<LinkPlatform, string>>);
          if (draft.linkDrafts && typeof draft.linkDrafts === 'object' && !Array.isArray(draft.linkDrafts)) setLinkDrafts(draft.linkDrafts as Partial<Record<LinkPlatform, string>>);
          if (draft.source === 'Website' || draft.source === 'Behance') setSource(draft.source);
          if (draft.profile && typeof draft.profile === 'object' && !Array.isArray(draft.profile)) {
            setProfile({ ...blank, ...(draft.profile as Partial<Profile>) });
            restoredDraft.current = true;
          }
          if (typeof draft.tag === 'string') setTag(draft.tag);
        }
      } catch { /* Ignore invalid temporary editor state. */ }
      finally { sessionStorage.removeItem(dribbbleDraftKey); }
    }
    const resultMessages: Record<string, string> = {
      connected: 'פרופיל Dribbble והעבודות הציבוריות נטענו. לחצו על יצירת פרופיל בעזרת AI כדי לשלב אותם בפרופיל.',
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
    if (!restoredDraft.current) fetch('/api/marketplace/profile', { cache: 'no-store' }).then(async (response) => {
      if (response.ok) {
        const data = await response.json();
        if (data.profile) {
          const website = data.profile.website || (data.profile.portfolio?.match(/https?:\/\/[^\s)]+/g) || []).find((url: string) => !/github\.com|linkedin\.com|dribbble\.com/i.test(url)) || '';
          setProfile({ ...blank, ...data.profile, website, portfolio: website });
          if (website) setLinks((current) => ({ ...current, Website: website }));
        }
      }
    }).catch(() => {});
    fetch('/api/integrations/dribbble', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error('לא הצלחנו לטעון את ייבוא Dribbble. אפשר לנסות לרענן את העמוד.');
      const data = await response.json() as { import?: DribbbleSource | null };
      setDribbbleSource(data.import || null);
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'טעינת ייבוא Dribbble נכשלה.'));
    fetch('/api/integrations/nango/connections', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error('לא הצלחנו לבדוק חיבורים קיימים. רעננו את העמוד ונסו שוב.');
      const data = await response.json() as { connections?: { provider: SocialProvider; connectionId: string }[] };
      const connections = (data.connections || []).filter(({ provider, connectionId }) => ['github', 'linkedin'].includes(provider) && typeof connectionId === 'string');
      setSocialConnections(Object.fromEntries(connections.map(({ provider, connectionId }) => [provider, connectionId])));
      await Promise.all(connections.map(({ provider, connectionId }) => importSocialSource(provider, connectionId)));
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'בדיקת החיבורים נכשלה.'));
  }, [userId]);

  async function refreshFiles() {
    const response = await fetch('/api/uploads/profile-source', { cache: 'no-store' }).catch(() => null);
    if (!response?.ok) { setFileLoadError('לא הצלחנו לטעון את המסמכים השמורים. אפשר להמשיך עם קישורים או חיבורים ולנסות שוב.'); return; }
    const data = await response.json() as { sources?: StoredSource[] };
    setFiles(data.sources || []);
    setFileLoadError('');
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

  async function importSocialSource(provider: SocialProvider, connectionId: string) {
    const requestId = (importRequests.current[provider] || 0) + 1;
    importRequests.current[provider] = requestId;
    setImporting((current) => ({ ...current, [provider]: true }));
    setImportErrors((current) => ({ ...current, [provider]: '' }));
    try {
      const response = await fetch('/api/integrations/nango/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, connectionId }),
      });
      const imported = await response.json();
      if (!response.ok) throw new Error(imported.error || 'החיבור אושר, אבל ייבוא פרטי הפרופיל נכשל.');
      if (importRequests.current[provider] !== requestId) return false;
      setSocialSources((current) => ({ ...current, [provider]: { ...imported, connectionId } }));
      return true;
    } catch (error) {
      if (importRequests.current[provider] === requestId) {
        setSocialSources((current) => { const next = { ...current }; delete next[provider]; return next; });
        setImportErrors((current) => ({ ...current, [provider]: error instanceof Error ? error.message : 'ייבוא פרטי הפרופיל נכשל.' }));
      }
      return false;
    } finally {
      if (importRequests.current[provider] === requestId) setImporting((current) => ({ ...current, [provider]: false }));
    }
  }

  function editLink(platform: LinkPlatform) {
    setSource(platform);
    setLinkDrafts((current) => ({ ...current, [platform]: current[platform] ?? links[platform] ?? '' }));
    setLinkError('');
  }

  function approveLink() {
    if (!source) return;
    try {
      const url = new URL((linkDrafts[source] || '').trim());
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) throw new Error('הוסיפו כתובת אתר ציבורית שמתחילה ב־https://.');
      if (source === 'Behance' && url.hostname !== 'behance.net' && !url.hostname.endsWith('.behance.net')) throw new Error('הוסיפו קישור לפרופיל או לפרויקט ציבורי ב־Behance.');
      const nextLinks = { ...links, [source]: url.href };
      setLinks(nextLinks);
      if (source === 'Website') setProfile((current) => ({ ...current, website: url.href, portfolio: url.href }));
      try { sessionStorage.setItem(approvedLinksKey, JSON.stringify(nextLinks)); } catch { /* The approved link remains available in the current editor. */ }
      setLinkDrafts((current) => ({ ...current, [source]: url.href }));
      setNotice(`הקישור ל־${source} אושר ונוסף למקורות. הוא ייקרא בלחיצה על יצירת פרופיל בעזרת AI.`);
      setSource(null);
      setLinkError('');
    } catch (error) {
      setLinkError(error instanceof TypeError ? 'הוסיפו כתובת אתר מלאה שמתחילה ב־https://.' : error instanceof Error ? error.message : 'הכתובת אינה תקינה.');
    }
  }

  function removeLink(platform: LinkPlatform) {
    const nextLinks = { ...links };
    delete nextLinks[platform];
    if (platform === 'Website') setProfile((current) => ({ ...current, website: '', portfolio: '' }));
    setLinks(nextLinks);
    try { sessionStorage.setItem(approvedLinksKey, JSON.stringify(nextLinks)); } catch { /* Removal still applies to the current editor. */ }
    setLinkDrafts((current) => { const next = { ...current }; delete next[platform]; return next; });
    if (source === platform) setSource(null);
    setNotice(`הקישור ל־${platform} הוסר מהמקורות.`);
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
            const connectionId = event.payload.connectionId;
            setSocialConnections((current) => ({ ...current, [provider]: connectionId }));
            connect.close();
            try {
              const loaded = await importSocialSource(provider, connectionId);
              setNotice(loaded ? `פרטי ${providerLabels[provider]} נטענו. לחצו על יצירת פרופיל בעזרת AI כדי לשלב אותם בפרופיל.` : `${providerLabels[provider]} מחובר. ייבוא פרטי הפרופיל לא הושלם; אפשר לנסות שוב בכרטיס החיבור.`);
            } finally {
              setConnecting(null);
            }
          }
        },
      });
    } catch (error) {
      setConnecting(null);
      setNotice(error instanceof Error ? error.message : `לא הצלחנו לחבר את ${providerLabels[provider]}.`);
    }
  }

  function persistXPlace(next: XPlaceSource | null) {
    try { if (next) sessionStorage.setItem(xplaceKey, JSON.stringify(next)); else sessionStorage.removeItem(xplaceKey); } catch { /* The import stays in the current editor. */ }
  }

  // Every XPlace path (extension hand-off, launch, pasted text) ends here.
  function applyXPlaceImport(data: XPlaceProfileImport) {
    const imported: XPlaceSource = {
      provider: 'xplace', sourceText: data.sourceText, profile: data.profile, url: data.url, warnings: data.warnings,
      ...(data.counts ? { counts: data.counts } : {}), ...(typeof data.ownerSignal === 'boolean' ? { ownerSignal: data.ownerSignal } : {}),
    };
    setXplaceSource(imported);
    persistXPlace(imported);
    trackEvent('xplace_profile_import_completed');
    setXplaceOpen(false);
    setNotice('פרטי XPlace נטענו. לחצו על יצירת פרופיל בעזרת AI כדי לשלב אותם בפרופיל.');
  }
  const xplaceIngest = useXPlaceIngest<XPlaceProfileImport>('profile', applyXPlaceImport);
  useAutoHandoff(xplaceIngest, xplaceFlags, true);

  function removeXPlaceImport() {
    setXplaceSource(null);
    persistXPlace(null);
    setNotice('המידע שיובא מ־XPlace הוסר מהמקורות.');
  }

  function connectDribbble() {
    try {
      sessionStorage.setItem(dribbbleDraftKey, JSON.stringify({ links, linkDrafts, source, profile, tag }));
    } catch { /* OAuth can continue when browser storage is unavailable. */ }
    setConnecting('dribbble');
    setNotice('מעבירים אותך ל־Dribbble לאישור קריאת פרטי הפרופיל והעבודות הציבוריות.');
    window.location.assign('/api/integrations/dribbble/connect');
  }

  async function disconnectSocial(provider: SocialProvider) {
    const connectionId = socialConnections[provider];
    if (!connectionId) return;
    const response = await fetch(`/api/integrations/nango/connections?provider=${provider}&connectionId=${encodeURIComponent(connectionId)}`, { method: 'DELETE' }).catch(() => null);
    if (!response?.ok) { setNotice('לא הצלחנו לנתק את החשבון. נסו שוב.'); return; }
    importRequests.current[provider] = (importRequests.current[provider] || 0) + 1;
    setSocialSources((current) => { const next = { ...current }; delete next[provider]; return next; });
    setSocialConnections((current) => { const next = { ...current }; delete next[provider]; return next; });
    setImportErrors((current) => { const next = { ...current }; delete next[provider]; return next; });
    setImporting((current) => ({ ...current, [provider]: false }));
    setNotice(`חיבור ${providerLabels[provider]} נותק. אפשר לבטל הרשאה גם בהגדרות הספק; מידע שכבר נשמר בפרופיל לא נמחק.`);
  }

  async function removeDribbbleImport() {
    const response = await fetch('/api/integrations/dribbble', { method: 'DELETE' }).catch(() => null);
    if (!response?.ok) { setNotice('לא הצלחנו להסיר את ייבוא Dribbble. נסו שוב.'); return; }
    setDribbbleSource(null);
    setNotice('המידע שיובא מ־Dribbble הוסר. לביטול הרשאת האפליקציה, בקרו בהגדרות החשבון ב־Dribbble.');
  }

  async function generate() {
    trackEvent('profile_generation_started');
    setBusy(true);
    setNotice('');
    try {
      const form = new FormData();
      form.set('sourceIds', JSON.stringify(files.map((file) => file.id)));
      form.set('urls', Object.values(links).filter(Boolean).join('\n'));
      const importedSources: { provider: SocialProvider | 'dribbble' | 'xplace'; sourceText: string }[] = Object.values(socialSources)
        .filter((item): item is SocialSource => Boolean(item))
        .map(({ provider, sourceText }) => ({ provider, sourceText }));
      if (xplaceSource) importedSources.push({ provider: 'xplace', sourceText: xplaceSource.sourceText });
      if (dribbbleSource) importedSources.push({ provider: 'dribbble', sourceText: dribbbleSource.sourceText });
      form.set('socialSources', JSON.stringify(importedSources));
      const response = await fetch('/api/ai/profile', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      trackEvent(data.demo ? 'profile_generation_demo' : 'profile_generation_completed');
      setProfile({ ...blank, ...data, website: links.Website || '', portfolio: links.Website || '' });
      setNotice(data.demo ? 'המידע מוכן, אבל Vertex AI עדיין לא הוגדר ליצירת טיוטה.' : ['הטיוטה מוכנה לבדיקה. השלימו או תקנו כל פרט לפני שמירה.', ...(Array.isArray(data.warnings) ? data.warnings : [])].join(' '));
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
      const response = await fetch('/api/marketplace/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: profile }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      trackEvent('profile_saved');
      window.dispatchEvent(new CustomEvent('fz-profile-updated', { detail: profile }));
      setNotice(data.access?.state === 'trial' ? 'הפרופיל נשמר ותקופת הניסיון שלך פעילה. תאריך הסיום מופיע בחברות שלך.' : 'הפרופיל נשמר. להפעלת הניסיון השלימו שם, משפט על עצמכם וכישור אחד.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'שמירת הפרופיל נכשלה.');
    } finally {
      setBusy(false);
    }
  }

  function loadAvatar(file?: File) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(file.type)) { setNotice('נא לבחור תמונת PNG, JPG, WebP או AVIF.'); return; }
    if (file.size > 1_400_000) { setNotice('גודל התמונה יכול להיות עד 1.4MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => setProfile(current => ({ ...current, avatar: typeof reader.result === 'string' ? reader.result : current.avatar }));
    reader.onerror = () => setNotice('לא הצלחנו לטעון את התמונה. נסו שוב.');
    reader.readAsDataURL(file);
  }

  const hasPendingImport = Object.values(importing).some(Boolean);
  const hasSources = files.length > 0 || Object.values(links).some(Boolean) || Object.keys(socialSources).length > 0 || Boolean(dribbbleSource) || Boolean(xplaceSource);

  return <section className={`profile-studio ${styles.studio}`}>
    <h1>הסיפור המקצועי שלך.</h1>
    <p>קל להקים פרופיל: מחברים אתר או מוסיפים מסמך, ואנחנו עוזרים למלא את הפרטים. אפשר גם למלא לבד.</p>
    <div className="source-workbench">
      <h2>המקורות שלך</h2>
      <p className="legal-inline-notice">בחירה או גרירה של קובץ שומרת אותו באופן פרטי בחשבון מיד. יצירת טיוטה ב־AI היא פעולה נפרדת: רק בלחיצה על ״יצירת פרופיל בעזרת AI״ נשלח את המקורות שנבחרו ל־Google Vertex AI. אפשר לערוך פרופיל ידנית ולמחוק מסמכים בעורך. <Link href="/privacy#uploads">פרטי העיבוד, השמירה וזכויותיכם</Link>.</p>
      <label className="profile-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); }}>
        <span>↥</span><strong>גררו לכאן את העבודה שלכם</strong>
        <input className={styles.fileInput} aria-label="בחירת מסמכי פרופיל" type="file" multiple accept=".pdf,.txt,.md" disabled={uploading} onChange={(event) => { void addFiles(Array.from(event.target.files || [])); event.currentTarget.value = ''; }}/>
        <small>עד 5 קבצים · 8MB לקובץ · PDF / TXT / MD</small>
      </label>
      {files.map((file) => <div className="source-file" key={file.id}>{file.name}<button type="button" onClick={() => void deleteFile(file.id)} aria-label={`מחיקת ${file.name}`}>×</button></div>)}
      {uploading && <small role="status">שומרים מסמך באופן פרטי…</small>}
      {fileLoadError && <p className={styles.sourceError} role="status">{fileLoadError} <button type="button" onClick={() => void refreshFiles()}>ניסיון נוסף</button></p>}

      <h3>חיבור לפרופילים המקצועיים</h3>
      <div className={`social-sources ${styles.platformButtons}`}>
        {(['linkedin', 'github'] as const).map((provider) => <button type="button" key={provider} className={`${styles.platformButton} ${socialConnections[provider] ? styles.platformButtonConnected : ''}`} aria-pressed={Boolean(socialConnections[provider])} aria-label={`${providerLabels[provider]}${socialConnections[provider] ? ' מחובר' : ' — חיבור חשבון'}`} disabled={connecting !== null} onClick={() => socialConnections[provider] ? document.getElementById(`profile-source-${provider}`)?.focus() : void connectSocial(provider)}>
          <PlatformIcon platform={provider} /><span dir="ltr">{providerLabels[provider]}</span>
          {socialConnections[provider] ? <SourceCheck /> : <span className={styles.addMark} aria-hidden="true">＋</span>}
          {connecting === provider && <span className={styles.connectingText}>מתחברים…</span>}
        </button>)}
        <button type="button" className={`${styles.platformButton} ${dribbbleSource ? styles.platformButtonConnected : ''}`} aria-pressed={Boolean(dribbbleSource)} aria-label={`Dribbble${dribbbleSource ? ' מחובר' : ' — חיבור חשבון'}`} disabled={connecting !== null} onClick={() => dribbbleSource ? document.getElementById('profile-source-dribbble')?.focus() : connectDribbble()}>
          <PlatformIcon platform="dribbble" /><span dir="ltr">Dribbble</span>{dribbbleSource ? <SourceCheck /> : <span className={styles.addMark} aria-hidden="true">＋</span>}
          {connecting === 'dribbble' && <span className={styles.connectingText}>מתחברים…</span>}
        </button>
        {xplaceFlags.enabled && <button type="button" className={`${styles.platformButton} ${xplaceSource ? styles.platformButtonConnected : ''}`} aria-pressed={Boolean(xplaceSource)} aria-expanded={xplaceOpen} aria-controls="profile-xplace-panel" onClick={() => setXplaceOpen(!xplaceOpen)}>
          <PlatformIcon platform="xplace" /><span dir="ltr">XPlace</span>{xplaceSource ? <SourceCheck /> : <span className={styles.addMark} aria-hidden="true">＋</span>}
        </button>}
        {platforms.map((platform) => <button type="button" key={platform} className={`${styles.platformButton} ${links[platform] ? styles.platformButtonConnected : ''}`} aria-pressed={Boolean(links[platform])} aria-expanded={source === platform} onClick={() => source === platform ? setSource(null) : editLink(platform)}><PlatformIcon platform={platform} /><span dir="ltr">{platform}</span>{links[platform] ? <SourceCheck /> : <span className={styles.addMark} aria-hidden="true">＋</span>}</button>)}
      </div>
      {source && <form className={styles.linkForm} onSubmit={(event) => { event.preventDefault(); approveLink(); }}>
        <label htmlFor="profile-source-url">קישור ציבורי ל־{source}</label>
        <input id="profile-source-url" type="url" dir="ltr" placeholder={source === 'Behance' ? 'https://www.behance.net/your-profile' : 'https://your-website.com'} required value={linkDrafts[source] || ''} aria-describedby={linkError ? 'profile-source-url-error' : 'profile-source-url-hint'} aria-invalid={Boolean(linkError)} onChange={(event) => { setLinkDrafts({ ...linkDrafts, [source]: event.target.value }); setLinkError(''); }}/>
        <small id="profile-source-url-hint">אשרו את הקישור כדי להוסיף אותו למקורות ליצירת הפרופיל.</small>
        {linkError && <p id="profile-source-url-error" role="alert" className={styles.sourceError}>{linkError}</p>}
        <div className={styles.linkFormActions}><button type="submit" className={styles.approveLink}>אישור הקישור</button><button type="button" onClick={() => { setSource(null); setLinkError(''); }}>ביטול</button></div>
      </form>}
      <HandoffNotice phase={xplaceIngest.phase} kind="profile" onConfirm={xplaceIngest.confirm}/>
      {xplaceFlags.enabled && xplaceOpen && <XPlaceProfilePanel flags={xplaceFlags} ingest={xplaceIngest} onImported={applyXPlaceImport} onClose={() => setXplaceOpen(false)}/>}
      <div className={styles.sourceCards}>
      {platforms.filter((platform) => links[platform]).map((platform) => <article className={styles.sourceCard} key={platform}>
        <PlatformIcon platform={platform} /><div className={styles.sourceDetails}><strong>{platform} נוסף <SourceCheck /></strong><a href={links[platform]} target="_blank" rel="noreferrer" dir="ltr">{links[platform]}</a><small>הקישור אושר ליצירת הפרופיל</small></div>
        <div className={styles.sourceActions}><button type="button" onClick={() => editLink(platform)}>עריכה</button><button type="button" onClick={() => removeLink(platform)} aria-label={`הסרת קישור ${platform}`}>הסרה</button></div>
      </article>)}
      {(['linkedin', 'github'] as const).filter((provider) => socialConnections[provider]).map((provider) => {
        const imported = socialSources[provider];
        return <article className={styles.sourceCard} key={provider} id={`profile-source-${provider}`} tabIndex={-1}>
          <PlatformIcon platform={provider} /><div className={styles.sourceDetails}><strong>{providerLabels[provider]} מחובר <SourceCheck /></strong><small>{importing[provider] ? 'מייבאים את פרטי הפרופיל…' : imported ? imported.profile.name || 'פרטי הפרופיל ייכללו ביצירה' : 'ההרשאה לחשבון התקבלה'}</small>{imported?.url && <a href={imported.url} target="_blank" rel="noreferrer">פתיחת הפרופיל ↗</a>}{importErrors[provider] && <p className={styles.sourceError} role="status">{importErrors[provider]}</p>}</div>
          <div className={styles.sourceActions}><button type="button" disabled={Boolean(importing[provider])} onClick={() => void importSocialSource(provider, socialConnections[provider]!)}>{importErrors[provider] ? 'ניסיון ייבוא נוסף' : 'רענון פרטים'}</button><button type="button" disabled={Boolean(importing[provider])} onClick={() => void disconnectSocial(provider)} aria-label={`ניתוק ${providerLabels[provider]}`}>ניתוק</button></div>
        </article>;
      })}
      {dribbbleSource && <article className={styles.sourceCard} key="dribbble" id="profile-source-dribbble" tabIndex={-1}>
        <PlatformIcon platform="dribbble" /><div className={styles.sourceDetails}><strong>Dribbble יובא <SourceCheck /></strong><small>{dribbbleSource.profile.name || 'פרטי הפרופיל והעבודות ייכללו ביצירה'}</small>{dribbbleSource.url && <a href={dribbbleSource.url} target="_blank" rel="noreferrer">פתיחת הפרופיל ↗</a>}</div>
        <div className={styles.sourceActions}><button type="button" disabled={connecting !== null} onClick={connectDribbble}>רענון ייבוא</button><button type="button" onClick={() => void removeDribbbleImport()} aria-label="הסרת ייבוא Dribbble">הסרת ייבוא</button></div>
      </article>}
      {xplaceSource && <article className={styles.sourceCard} key="xplace" id="profile-source-xplace" tabIndex={-1}>
        <PlatformIcon platform="xplace" /><div className={styles.sourceDetails}><strong>XPlace יובא <SourceCheck /></strong><small>{xplaceSource.profile?.headline || xplaceSource.profile?.name || (xplaceSource.url ? 'פרטי הפרופיל הציבוריים ייכללו ביצירה' : 'הטקסט שהודבק ייכלל ביצירה')}</small>{xplaceSource.counts && <small>{xplaceSource.counts.expertise} תחומי התמחות · {xplaceSource.counts.employment} מקומות עבודה · {xplaceSource.counts.education} תארים</small>}{xplaceSource.ownerSignal === true && <small>XPlace זיהתה שהפרופיל הזה שלכם.</small>}{xplaceSource.url && <a href={xplaceSource.url} target="_blank" rel="noreferrer">פתיחת הפרופיל ↗</a>}{xplaceSource.warnings[0] && <small className={styles.sourceNote}>{xplaceSource.warnings[0]}</small>}</div>
        <div className={styles.sourceActions}><button type="button" onClick={removeXPlaceImport} aria-label="הסרת ייבוא XPlace">הסרת ייבוא</button></div>
      </article>}
      </div>
      <small>GitHub ו־LinkedIn יתחברו בחלון מאובטח. אפשר להסיר את הייבוא בכל עת לפני יצירת הפרופיל.</small>
      <small className={styles.sourceHint}>LinkedIn מספק בחיבור הזה שם, תמונת פרופיל ושפה בלבד. להוספת ניסיון תעסוקתי וכישורים, צרפו קורות חיים או אתר מקצועי.</small>
      <small>Dribbble מייבא פרופיל ועבודות שפורסמו בלבד. הסרת המידע מכאן אינה מבטלת את הרשאת Dribbble. <a href="https://dribbble.com/account/applications" target="_blank" rel="noreferrer">ניהול הרשאות ב־Dribbble ↗</a></small>
      <p className="legal-inline-notice">לחיצה על ״יצירת פרופיל בעזרת AI״ מבקשת לשלוח את המסמכים, הקישורים והמידע המיובא שמופיעים כאן ל־Google Vertex AI לצורך יצירת הטיוטה. אפשר למלא ולשמור פרופיל ידנית בלי להשתמש ב־AI. <Link href="/privacy#uploads">פרטי העיבוד</Link> · <Link href="/terms#ai">תנאי השימוש בכלי AI</Link>.</p>
      <button type="button" className="generate-profile" disabled={busy || hasPendingImport || !hasSources} onClick={generate}>{busy ? 'יוצרים את הפרופיל…' : hasPendingImport ? 'מייבאים את המקורות…' : '✦ יצירת פרופיל בעזרת AI'}</button>
    </div>
    <p role="status">{notice}</p>
    <div className="profile-template">
      <div className="freelancer-profile-heading"><h2>הפרופיל שלך <small>הכול ניתן לעריכה</small></h2><label className={`freelancer-avatar-upload${avatarDragOver ? ' is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); setAvatarDragOver(true); }} onDragLeave={() => setAvatarDragOver(false)} onDrop={event => { event.preventDefault(); setAvatarDragOver(false); loadAvatar(event.dataTransfer.files[0]); }}><input type="file" accept="image/png,image/jpeg,image/webp,image/avif" onChange={event => loadAvatar(event.target.files?.[0])}/>{profile.avatar ? <img src={profile.avatar} alt="תמונת הפרופיל שלך"/> : <><span aria-hidden="true">＋</span><small>תמונת פרופיל</small></>}</label></div>
      {([['name', 'שם'], ['headline', 'Tagline · במשפט אחד'], ['bio', 'Summary · הסיפור שלך']] as const).map(([key, label]) => <label key={key}>{label}<textarea rows={key === 'name' || key === 'headline' ? 1 : 3} value={profile[key]} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} placeholder="המידע מהמקורות יופיע כאן. אפשר גם לכתוב בעצמך."/></label>)}
      <ProfileEntryEditor title="תיק עבודות וקישורי מדיה" value={profile.portfolio} onChange={(portfolio) => setProfile({ ...profile, portfolio })} placeholder="תיאור עבודה, קישור או הישג"/>
      <ProfileEntryEditor title="ניסיון תעסוקתי" value={profile.experience} onChange={(experience) => setProfile({ ...profile, experience })} placeholder="תפקיד, ארגון, תקופה ותחומי אחריות"/>
      <ProfileEntryEditor title="השכלה וקורסים" value={profile.education} onChange={(education) => setProfile({ ...profile, education })} placeholder="תואר, קורס או הכשרה · מוסד · תקופה"/>
      <h3>תגיות מקצועיות</h3><p>התגיות עוזרות למצוא פרויקטים ולהציג אותך ללקוחות מתאימים.</p>
      <div className="studio-tags">{profile.skills.map((skill, index) => <button type="button" key={`${skill}-${index}`} onClick={() => setProfile({ ...profile, skills: profile.skills.filter((_, i) => i !== index) })} aria-label={`הסרת ${skill}`}>{skill} ×</button>)}</div>
      <form className="tag-entry" onSubmit={(event) => { event.preventDefault(); if (tag.trim() && !profile.skills.includes(tag.trim())) setProfile({ ...profile, skills: [...profile.skills, tag.trim()] }); setTag(''); }}><input aria-label="תגית חדשה" value={tag} onChange={(event) => setTag(event.target.value)} placeholder="הוספת כישור"/><button>＋</button></form>
      <button type="button" className="generate-profile" onClick={saveProfile} disabled={busy}>שמירת הפרופיל</button>
    </div>
  </section>;
}
