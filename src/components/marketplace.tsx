'use client';
import { ProjectDescription } from '@/components/project-description';

import Link from 'next/link';
import { AI_AGENT_BADGE, SAMPLE_CLIENT_HISTORY } from '@/lib/projects/presentation';
import Image from 'next/image';
import { useState } from 'react';
import type { Project } from '@/lib/data';
import { AuthControl } from '@/components/auth-control';
import { AccountSafetyNotice } from './account-safety';
import { ViewerProvider } from './viewer-context';

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link className="brand" href="/" aria-label="Freelance Place"><Image src="/freelance-place-logo.svg" width={compact ? 32 : 44} height={compact ? 32 : 44} alt="Freelance Place" /></Link>;
}

// One viewer (session) lookup is shared by everything inside the shell.
export function AppShell(props: { children: React.ReactNode; active?: string }) {
  return <ViewerProvider><AppShellContent {...props} /></ViewerProvider>;
}

function AppShellContent({ children, active = 'discover' }: { children: React.ReactNode; active?: string }) {
  const [role, setRole] = useState('פרילנסר/ית');
  const links = [{ href: '/', label: 'הבית שלי', icon: '⌂', key: 'home' }, { href: '/', label: 'גילוי פרויקטים', icon: '⌕', key: 'discover' }, { href: '/messages', label: 'הודעות', icon: '▤', key: 'messages' }, { href: '/profile/import', label: 'הפרופיל שלי', icon: '◉', key: 'profile' }, { href: '/membership', label: 'מנוי ותשלומים', icon: '₪', key: 'membership' }];
  return <div className="app-shell" dir="rtl">
    <header className="topbar"><Brand/><div className="top-search"><span>⌕</span><span>מה בא לך ליצור היום?</span><kbd>⌘ K</kbd></div><button className="role-switch" onClick={() => setRole(role === 'פרילנסר/ית' ? 'מחפש/ת פרילנסר/ית' : 'פרילנסר/ית')} aria-label="החלפת תפקיד"><span className="role-dot"/>{role}<span className="chevron">⌄</span></button><Link className="icon-button inbox-top" href="/messages" aria-label="הודעות">▤<i/></Link><AuthControl/></header>
    <div className="workspace"><aside className="sidebar"><div className="sidebar-label">המרחב שלך</div><nav>{links.map((l) => <Link key={l.key} href={l.href} className={`nav-item ${active === l.key ? 'active' : ''}`}><span className="nav-icon">{l.icon}</span><span>{l.label}</span>{l.key === 'messages' && <b className="nav-count">2</b>}</Link>)}</nav><div className="sidebar-bottom"><div className="mini-profile"><div className="avatar avatar-small">א</div><div><strong>הפרופיל שלך</strong><small>פרופיל · 72%</small></div><span className="more">•••</span></div><Link href="/membership" className="membership-nudge"><span>החברות שלך</span><strong>₪19.99 <small>/ חודש</small></strong><span className="progress"><i/></span><small>ניהול מנוי ותשלומים ←</small></Link></div></aside>
      <main className="main-content"><AccountSafetyNotice/>{children}</main></div>
    <nav className="mobile-nav" aria-label="ניווט ראשי">{[{ href: '/', label: 'בית', icon: '⌂' }, { href: '/', label: 'גילוי', icon: '⌕' }, { href: '/messages', label: 'הודעות', icon: '▤' }, { href: '/profile/import', label: 'פרופיל', icon: '◉' }].map(i => <Link key={i.label} href={i.href}><span>{i.icon}</span>{i.label}</Link>)}</nav>
  </div>;
}

export function OpportunitySignal({ project }: { project: Project }) {
  return <div className="opportunity"><span className="signal-mark"/><div><strong>{project.fit}</strong><span>{project.activity}</span></div><span className="signal-separator"/><span className="activity-indicator"><i/>{project.proposals} הצעות</span></div>;
}

export function ProjectCard({ project, compact = false, saved, onToggleSave }: { project: Project; compact?: boolean; saved?: boolean; onToggleSave?: () => void }) {
  return <article className={`project-card ${compact ? 'project-card-compact' : ''} ${project.featured ? 'featured' : ''}`}>
    <div className="card-topline"><span className="category-chip">{project.category}</span><button className={`save-button ${saved ? 'saved' : ''}`} aria-label={saved ? 'הסרת פרויקט שמור' : 'שמירת הפרויקט'} aria-pressed={saved} onClick={onToggleSave}> {saved ? '♥' : '♡'}</button></div>
    <Link href={`/projects/${project.slug}`} className="project-title-link"><h3>{project.title}</h3></Link>
    {!compact && <ProjectDescription text={project.description}/>}
    <div className="project-facts"><span><small>תקציב</small><strong>{project.budget}</strong></span><span><small>מועד</small><strong>{project.deadline}</strong></span><span><small>פורסם</small><strong>{project.posted}</strong></span></div>
    <OpportunitySignal project={project}/>
    <div className="card-footer"><span className="client-avatar">{project.client.slice(0,1)}</span><span><strong>{project.client}{project.sample&&<span className="ai-agent-badge">{AI_AGENT_BADGE}</span>}</strong><small>{project.sample?SAMPLE_CLIENT_HISTORY:project.clientHistory}</small></span><Link href={`/projects/${project.slug}`} className="text-action">לפרטי הפרויקט <span>←</span></Link></div>
  </article>;
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: React.ReactNode; description?: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action && <div className="heading-action">{action}</div>}</div>;
}
