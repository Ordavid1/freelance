import type { ReactNode } from 'react';
import { HEADHUNTER_CLOSED_BADGE, HEADHUNTER_CONTACT_LABEL, HEADHUNTER_KIND_LABEL, HEADHUNTER_STAT_OPEN, HEADHUNTER_STAT_PUBLISHED, headhunterInitials } from '@/lib/headhunters/presentation';
import type { MinisiteView } from '@/lib/headhunters/minisite';
import type { ContactLink } from '@/lib/headhunters/types';
import { ContactClickTracker } from './headhunter-contact-tracker';
import './headhunter-minisite.css';

// Server components for the minisite page. They receive the public view only (MinisiteView), never the stored record.

const ICONS: Record<ContactLink['kind'], ReactNode> = {
  email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
  whatsapp: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />,
  website: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  linkedin: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 11v5M8 8v.01M12 16v-5m0 2a3 3 0 0 1 6 0v3" /></>,
};
const isExternal = (href: string) => /^https?:\/\//i.test(href);

/** `handle` turns on click tracking (the live page); the editor preview omits it, so previewing never counts as a click. */
export function HeadhunterContact({ links, handle }: { links: readonly ContactLink[]; handle?: string }) {
  if (links.length === 0) return null;
  const items = links.map((link) => <li key={link.kind} className={link.kind === 'whatsapp' || link.kind === 'linkedin' ? 'hh-half' : undefined}>
    <a href={link.href} {...(isExternal(link.href) ? { target: '_blank', rel: 'nofollow noopener noreferrer' } : {})}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{ICONS[link.kind]}</svg>
      <bdi>{link.label}</bdi>
    </a>
  </li>);
  return handle
    ? <ContactClickTracker handle={handle} label={HEADHUNTER_CONTACT_LABEL}>{items}</ContactClickTracker>
    : <ul className="hh-contact" aria-label={HEADHUNTER_CONTACT_LABEL}>{items}</ul>;
}

/** `preview` is the editor's copy of the header: a level-2 heading and no click tracking. */
export function HeadhunterHero({ view, openCount, publishedCount, preview = false }: { view: MinisiteView; openCount: number; publishedCount: number; preview?: boolean }) {
  const Heading = preview ? 'h2' : 'h1';
  const paragraphs = (view.about ?? '').split(/\n{2,}|\r\n\r\n/).map((part) => part.trim()).filter(Boolean);
  return <section className="hh-hero" aria-labelledby="hh-name">
    <div className="hh-hero-top">
      <div className="hh-logo" aria-hidden="true">{headhunterInitials(view.displayName)}</div>
      <div className="hh-id">
        <p className="hh-kind">{HEADHUNTER_KIND_LABEL[view.kind]}{view.city ? ` · ${view.city}` : ''}</p>
        <Heading id="hh-name">{view.displayName}</Heading>
        {view.tagline && <p className="hh-tagline">{view.tagline}</p>}
      </div>
      <dl className="hh-stats">
        <div className="hh-stat"><dt>{HEADHUNTER_STAT_OPEN}</dt><dd>{openCount}</dd></div>
        <div className="hh-stat"><dt>{HEADHUNTER_STAT_PUBLISHED}</dt><dd>{publishedCount}</dd></div>
      </dl>
    </div>
    {paragraphs.map((text, index) => <p className="hh-about" key={index}>{text}</p>)}
    <HeadhunterContact links={view.contact} {...(preview ? {} : { handle: view.handle })} />
  </section>;
}

/** Titles only: a closed project has no public page in this product, so nothing here links. */
export function HeadhunterClosedList({ titles, heading }: { titles: readonly { slug: string; title: string }[]; heading: string }) {
  if (titles.length === 0) return null;
  return <section className="hh-closed" aria-labelledby="hh-closed-heading">
    <h2 id="hh-closed-heading">{heading}</h2>
    <ul>{titles.map((project) => <li key={project.slug}><span>{project.title}</span><span className="project-closed-badge">{HEADHUNTER_CLOSED_BADGE}</span></li>)}</ul>
  </section>;
}
