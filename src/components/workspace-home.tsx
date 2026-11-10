'use client';
import { ProjectDescription } from '@/components/project-description';
import { AI_AGENT_BADGE, SAMPLE_CLIENT_HISTORY, SAMPLE_FEED_HINT, SAMPLE_FOOTER_TEXT } from '@/lib/projects/presentation';
import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { MyApplications } from './my-applications';
import { projects, type Project } from '@/lib/data';
import '@/app/studio.css';
import '@/app/workspace-responsive.css';
import '@/app/workspace-palette.css';
import { TrialStatus } from '@/components/trial-status';
import { AuthControl } from '@/components/auth-control';
import { AccountSafetyNotice } from './account-safety';
import { ViewerProvider, useViewer } from '@/components/viewer-context';
// Heavy views load only when they are opened.
const ProjectComposer = dynamic(() => import('@/components/actions').then((module) => module.ProjectComposer));
const ProfileSetup = dynamic(() => import('@/components/publisher-profile-setup').then((module) => module.ProfileSetup));
const StudioInbox = dynamic(() => import('@/components/studio-tools').then((module) => module.StudioInbox));
const BidForm = dynamic(() => import('@/components/studio-tools').then((module) => module.BidForm));
const ProjectProposals = dynamic(() => import('@/components/project-proposals').then((module) => module.ProjectProposals));
// The hard-coded demo cards in lib/data.ts have no project page and closed projects answer 404 there,
// so only open projects from the database link to their own page.
const demoSlugs = new Set(projects.map((project) => project.slug));
const hasProjectPage = (project: Project) => !demoSlugs.has(project.slug) && (project.status || 'open') === 'open';
// Welcome panel for visitors without a session; it replaces the personal KPIs, which only make sense signed in.
const WELCOME_TITLE='ברוכים הבאים.';
const WELCOME_NOTE='התחברו כדי להקים פרופיל, להגיש הצעות ולנהל שיחות. אפשר לעיין בפרויקטים גם בלי חשבון.';
const WELCOME_CTA='התחברות והקמת פרופיל';
const menus=['הבית שלי','פרופיל','הודעות','מנוי ותשלומים','פרסום פרויקט'];
type ProjectSort = 'recent' | 'value-low' | 'value-high' | 'date-value' | 'applications-low' | 'applications-high';
type ProjectPeriod = 'all' | '24h' | '72h' | 'week' | 'fortnight' | 'month';
const periodMs: Record<Exclude<ProjectPeriod, 'all'>, number> = { '24h': 24*60*60*1000, '72h': 72*60*60*1000, week: 7*24*60*60*1000, fortnight: 14*24*60*60*1000, month: 30*24*60*60*1000 };
function projectDate(project: Project) { if (project.createdAt) return project.createdAt; const text=project.posted; const now=Date.now(); if (text.includes('אתמול')) return now-24*60*60*1000; const n=Number(text.match(/\d+/)?.[0]||0); if (text.includes('דקות')) return now-n*60*1000; if (text.includes('שעה')) return now-n*60*60*1000; return 0; }
function budgetRange(value: string) { const numbers=value.match(/[\d,]+/g)?.map(item=>Number(item.replaceAll(',',''))).filter(Number.isFinite)||[]; return numbers.length ? [Math.min(...numbers),Math.max(...numbers)] as const : [0,0] as const; }
type WorkspaceHomeProps = { children?: ReactNode; initialView?: 'הבית שלי' | 'פרופיל'; initialProjects?: Project[] | null };
export default function WorkspaceHome(props: WorkspaceHomeProps) { return <ViewerProvider><WorkspaceHomeContent {...props}/></ViewerProvider>; }
function WorkspaceHomeContent({children, initialView = 'הבית שלי', initialProjects = null}: WorkspaceHomeProps){
 const viewer=useViewer();const signedIn=viewer.status==='signed-in';const viewerName=viewer.user?.name||viewer.user?.email?.split('@')[0]||'';
 // The server renders the public feed; the client only fetches it when the server could not (initialProjects === null).
 const [tags,setTags]=useState<string[]>([]);const [liveProjects,setLiveProjects]=useState<Project[]>(initialProjects||[]);const [ownProjects,setOwnProjects]=useState<Project[]>([]);const [matched,setMatched]=useState(false);const [saved,setSaved]=useState<string[]>([]);
 useEffect(()=>{if(initialProjects)return;let active=true;void fetch('/api/marketplace/projects',{cache:'no-store'}).then(response=>response.ok?response.json():{items:[]}).then(data=>{if(active)setLiveProjects(data.items||[])}).catch(()=>{});return()=>{active=false}},[]);
 // A newly published project is merged locally; the public feed is only re-fetched for events without one.
 useEffect(()=>{const onPublished=(event:Event)=>{const project=(event as CustomEvent)?.detail;if(project?.slug){setLiveProjects(old=>[project,...old.filter(item=>item.slug!==project.slug)]);setOwnProjects(old=>[project,...old.filter(item=>item.slug!==project.slug)]);return}void (async()=>{try{const [publicResponse,ownResponse]=await Promise.all([fetch('/api/marketplace/projects',{cache:'no-store'}),signedIn?fetch('/api/marketplace/projects?mine=1',{cache:'no-store'}):Promise.resolve(null)]);if(publicResponse.ok)setLiveProjects((await publicResponse.json()).items||[]);if(ownResponse?.ok)setOwnProjects((await ownResponse.json()).items||[])}catch{}})()};window.addEventListener('fz-project-published',onPublished);return()=>window.removeEventListener('fz-project-published',onPublished)},[signedIn]);
 // Account-only data (profile tags, own projects, saved projects) is requested for signed-in viewers only.
 useEffect(()=>{if(!signedIn)return;let active=true;const syncProfile=async(event?:Event)=>{const eventProfile=(event as CustomEvent)?.detail;if(eventProfile?.skills){setTags(eventProfile.skills);return}try{const response=await fetch('/api/marketplace/profile',{cache:'no-store'});if(response.ok){const data=await response.json();if(active)setTags(data.profile?.skills||[])}}catch{}};
  void syncProfile();
  void fetch('/api/marketplace/projects?mine=1',{cache:'no-store'}).then(response=>response.ok?response.json():{items:[]}).then(data=>{if(active)setOwnProjects(data.items||[])}).catch(()=>{});
  void fetch('/api/marketplace/saved-projects',{cache:'no-store'}).then(response=>response.ok?response.json():{slugs:[]}).then(data=>{if(active)setSaved(data.slugs||[])}).catch(()=>{});
  const handler=(event:Event)=>void syncProfile(event);window.addEventListener('fz-profile-updated',handler);return()=>{active=false;window.removeEventListener('fz-profile-updated',handler)}},[signedIn]);
 const [view,setView]=useState<string>(initialView);const [publisher,setPublisher]=useState(false);const [query,setQuery]=useState('');const [open,setOpen]=useState<string|null>(null);const [sent,setSent]=useState<string[]>([]);const [projectStatus,setProjectStatus]=useState<'all'|'open'|'closed'>('all');const [projectSort,setProjectSort]=useState<ProjectSort>('recent');const [projectPeriod,setProjectPeriod]=useState<ProjectPeriod>('all');
 async function toggleSaved(project:Project){if(project.sample)return;const nextSaved=!saved.includes(project.slug);const response=await fetch('/api/marketplace/saved-projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectSlug:project.slug,saved:nextSaved})});if(!response.ok)return;setSaved(nextSaved?saved.includes(project.slug)?saved:[...saved,project.slug]:saved.filter(slug=>slug!==project.slug))}
 const viewingOwn = publisher;
 // Until the session is known the home panel is laid out but invisible, so nothing misleading flashes and nothing shifts.
 const pendingHome = viewer.status==='loading' && view==='הבית שלי';
 const feedProjects = (viewingOwn ? ownProjects : [...liveProjects, ...projects]).filter(project => {
   if (!viewingOwn && projectStatus !== 'all' && (project.status || 'open') !== projectStatus) return false;
   if (!viewingOwn && projectPeriod !== 'all' && Date.now() - projectDate(project) > periodMs[projectPeriod]) return false;
   if (!viewingOwn && matched && !project.skills.some(skill => tags.some(tag => tag.toLowerCase() === skill.toLowerCase()))) return false;
   return !query || `${project.title} ${project.description} ${project.skills.join(' ')}`.toLowerCase().includes(query.toLowerCase());
 }).sort((a,b)=> {
   if (projectSort === 'value-low') return budgetRange(a.budget)[0] - budgetRange(b.budget)[0];
   if (projectSort === 'value-high') return budgetRange(b.budget)[1] - budgetRange(a.budget)[1];
   if (projectSort === 'date-value') return projectDate(b)-projectDate(a) || budgetRange(b.budget)[1]-budgetRange(a.budget)[1];
   if (projectSort === 'applications-low') return a.proposals-b.proposals;
   if (projectSort === 'applications-high') return b.proposals-a.proposals;
   return projectDate(b)-projectDate(a);
 });
 return <div className="studio" dir="rtl"><aside className="personal"><AuthControl/><nav aria-label="המרחב האישי">{menus.map(m=><button key={m} className={view===m?'selected':''} onClick={()=>setView(m)}>{m}</button>)}</nav><div className={`panel-view${pendingHome?' is-pending':''}`} key={view} aria-hidden={pendingHome||undefined}>
 {view==='הבית שלי'&&(signedIn?<><div className="hello-avatar" aria-hidden="true"/><div className="personal-title panel-heading">טוב לראות אותך{viewerName?`, ${viewerName}`:''}.</div><p>מקום לרעיונות שלך.<br/>ולאנשים שיעזרו להם לקרות.</p><div className="role-choice"><button className={!publisher?'selected':''} onClick={()=>setPublisher(false)}>אני פרילנסר/ית</button><button className={publisher?'selected':''} onClick={()=>setPublisher(true)}>אני מחפש/ת פרילנסר</button></div><div className="panel-heading">הפעילות שלך</div><div className="studio-kpis"><div><b>{ownProjects.length}</b><span>הפרויקטים שלך</span></div><div><b>{liveProjects.length}</b><span>פרויקטים זמינים</span></div><div><b>—</b><span>הצעות והודעות חדשות</span></div></div>{!publisher&&<MyApplications revision={sent.length}/>}</>:<><div className="hello-avatar" aria-hidden="true"/><div className="personal-title panel-heading">{WELCOME_TITLE}</div><p>מקום לרעיונות שלך.<br/>ולאנשים שיעזרו להם לקרות.</p><p className="welcome-note">{WELCOME_NOTE}</p><Link className="button button-dark welcome-cta" href="/signin">{WELCOME_CTA}</Link></>)}
 {view==='פרופיל'&&<><h1>הפרופיל שלי</h1><ProfileSetup initialRole={publisher?'publisher':'freelancer'}/></>}{view==='הודעות'&&<StudioInbox/>}{view==='פרסום פרויקט'&&<><h1>מה ניצור יחד?</h1><ProjectComposer/></>}{view==='מנוי ותשלומים'&&<TrialStatus full/>}
 </div><footer>{SAMPLE_FOOTER_TEXT}<div className="workspace-legal-links"><Link href="/privacy">מדיניות פרטיות</Link><Link href="/terms">תנאי שימוש</Link></div></footer></aside><main className="studio-feed"><AccountSafetyNotice/><div className="feed-intro"><div><span className="soft-label">{viewingOwn?'הפרויקטים שלך':'נמצא את החיבור הבא'}</span><h1>{viewingOwn?'הפרויקטים שלי':'פרויקטים לפרילנסרים בישראל'}</h1><p>{viewingOwn?'הפרויקטים שלך והצעות אמיתיות שהתקבלו.':'פרויקטים פתוחים לפרילנסרים.'}</p></div><Image className="feed-brand-mark" src="/freelance-place-logo.svg" width={56} height={56} alt="Freelance Place" priority/></div><div className="studio-search"><span>⌕</span><input aria-label="חיפוש פרויקטים" placeholder="מה מעניין אותך? כישור, תחום או פרויקט…" value={query} onChange={e=>setQuery(e.target.value)}/><span>{feedProjects.length} פרויקטים</span></div>{!viewingOwn&&<div className="project-filters"><label>סטטוס<select value={projectStatus} onChange={event=>setProjectStatus(event.target.value as 'all'|'open'|'closed')}><option value="all">פתוחים וסגורים</option><option value="open">פתוחים</option><option value="closed">סגורים</option></select></label><label>מיון<select value={projectSort} onChange={event=>setProjectSort(event.target.value as ProjectSort)}><option value="recent">תאריך: מהחדש לישן</option><option value="value-low">תקציב: נמוך לגבוה</option><option value="value-high">תקציב: גבוה לנמוך</option><option value="date-value">תאריך ותקציב</option><option value="applications-low">מספר הצעות: מעט להרבה</option><option value="applications-high">מספר הצעות: הרבה למעט</option></select></label><label>תקופה<select value={projectPeriod} onChange={event=>setProjectPeriod(event.target.value as ProjectPeriod)}><option value="all">כל התקופות</option><option value="24h">24 השעות האחרונות</option><option value="72h">72 השעות האחרונות</option><option value="week">השבוע האחרון</option><option value="fortnight">השבועיים האחרונים</option><option value="month">החודש האחרון</option></select></label></div>}{!viewingOwn&&<button className="tag-filter" aria-pressed={matched} onClick={()=>setMatched(!matched)}>{matched?'✓ לפי התגיות שלי':'סינון לפי התגיות שלי'} ({tags.length})</button>}<div className="studio-feed-label"><h2>{viewingOwn?'הפרויקטים שלך':'פרויקטים בשבילך'}</h2><span>{SAMPLE_FEED_HINT}</span></div>
 {feedProjects.slice(0,100).map((p,index)=><article className={`studio-project ${open===p.slug?'expanded':''}`} key={p.slug}><div className={`project-summary${hasProjectPage(p)?' has-page-link':''}`}><button className="expand-project" aria-expanded={open===p.slug} onClick={()=>setOpen(open===p.slug?null:p.slug)}><div className="project-category"><span className={`category-dot tone-${index}`}/>{p.category}{p.sample&&<span className="ai-agent-badge">{AI_AGENT_BADGE}</span>}<small>{p.posted}</small></div><h2>{p.title}</h2>{p.status==='closed'&&<span className="project-closed-badge">נסגר</span>}<ProjectDescription text={p.description}/><div className="project-bottom"><strong dir="ltr">{p.budget}</strong><span>{p.deadline}</span><b>{open===p.slug?'סגירה −':viewingOwn?'פרטים נוספים ＋':'פרטים והגשת הצעה ＋'}</b></div></button><button className="studio-save" aria-label={saved.includes(p.slug)?'הסרת פרויקט שמור':'שמירת פרויקט'} aria-pressed={saved.includes(p.slug)} disabled={p.sample || p.status==='closed'} onClick={()=>void toggleSaved(p)}>{saved.includes(p.slug)?'♥':p.sample?'♡':'♡'}</button>{hasProjectPage(p)&&<Link className="studio-open-page" href={`/projects/${encodeURIComponent(p.slug)}`} prefetch={false} aria-label="פתיחת עמוד הפרויקט" title="פתיחת עמוד הפרויקט"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></Link>}</div>
 {viewingOwn&&<ProjectProposals projectSlug={p.slug} initialStatus={p.status} onClosed={()=>{const close=(items:Project[])=>items.map(item=>item.slug===p.slug?{...item,status:'closed'}:item);setOwnProjects(close);setLiveProjects(close)}}/>}
 {open===p.slug&&<div className="project-expanded"><div className="expanded-facts"><div><h3>על הלקוח/ה</h3><p>{p.client}{p.sample&&<span className="ai-agent-badge">{AI_AGENT_BADGE}</span>}</p><small>{p.sample?SAMPLE_CLIENT_HISTORY:p.clientHistory}</small>{p.sample&&p.ownerPersona&&<small>{p.ownerPersona}</small>}</div><div><h3>כישורים רלוונטיים</h3><div className="studio-tags">{p.skills.map(s=><span key={s}>{s}</span>)}</div></div></div>{!viewingOwn&&(p.status==='closed'?<p className="closed-project-note">הפרויקט נסגר ולא מקבל הצעות חדשות.</p>:<BidForm project={p.slug} sample={p.sample} onSent={()=>setSent(old=>old.includes(p.slug)?old:[...old,p.slug])}/>)}</div>}</article>)}<p className="feed-end">מצאת משהו מסקרן? כל הפרטים נפתחים כאן, בלי לאבד את המקום.</p>{children}</main></div>
}
