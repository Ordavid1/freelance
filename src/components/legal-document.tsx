import Link from 'next/link';
import type { ReactNode } from 'react';
import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { crumbs } from '@/components/discovery/guide-article';
import { StructuredData } from '@/components/discovery/structured-data';
import { SupportHeaderActions } from '@/components/support-chat';

import { legalEmail, legalOperator, legalUpdated, legalUpdatedLabel } from '@/lib/legal/identity';
import { requirePage } from '@/lib/seo/registry';
import { breadcrumbNode, webPageNode, withContext } from '@/lib/seo/schema';

export { legalEmail, legalOperator, legalUpdated };

export function LegalContact() {
  return <p>המפעיל ובעל השליטה במידע: <bdi lang="en">{legalOperator}</bdi>. לשאלות, בקשות פרטיות, דיווחים והודעות משפטיות: <a href={`mailto:${legalEmail}`}><bdi>{legalEmail}</bdi></a>.</p>;
}

// `path` is the page's registered path (/privacy, /terms): the visible breadcrumb and the BreadcrumbList and WebPage JSON-LD
// are built from it and from the registry entry, like on the other public pages.
export function LegalDocument({ path, title, intro, sections }: {
  path: string;
  title: string;
  intro: string;
  sections: { id: string; title: string; content: ReactNode }[];
}) {
  const page = requirePage(path);
  const trail = [crumbs.home, { name: title, path }];
  return <main className="legal-page" id="legal-content">
    <SupportHeaderActions><Link className="legal-back" href="/">→ חזרה ל־Freelance Place</Link></SupportHeaderActions>
    <Breadcrumbs items={trail} structured={false} className="legal-crumbs" />
    <header className="legal-header"><p className="legal-eyebrow">Freelance Place · מידע משפטי</p><h1>{title}</h1><p>{intro}</p><p className="legal-date">בתוקף ועודכן לאחרונה: <time dateTime={legalUpdated}>{legalUpdatedLabel}</time></p></header>
    <LegalContact/>
    <nav className="legal-toc" aria-label="תוכן העמוד"><h2>בעמוד הזה</h2><ol>{sections.map(section => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol></nav>
    <article>{sections.map((section, index) => <section className="legal-section" id={section.id} key={section.id} aria-labelledby={`${section.id}-title`}><h2 id={`${section.id}-title`}>{index + 1}. {section.title}</h2>{section.content}</section>)}</article>
    <p className="legal-end"><a href="#legal-content">חזרה לראש העמוד ↑</a></p>
    <StructuredData data={withContext(breadcrumbNode(trail))} />
    <StructuredData data={withContext(webPageNode({ path, name: page.title, description: page.description, published: page.published, modified: page.modified }))} />
  </main>;
}
