import Link from 'next/link';
import type { ReactNode } from 'react';
import { SupportHeaderActions } from '@/components/support-chat';

import { legalEmail, legalOperator, legalUpdated } from '@/lib/legal/identity';

export { legalEmail, legalOperator, legalUpdated };

export function LegalContact() {
  return <p>המפעיל ובעל השליטה במידע: <bdi lang="en">{legalOperator}</bdi>. לשאלות, בקשות פרטיות, דיווחים והודעות משפטיות: <a href={`mailto:${legalEmail}`}><bdi>{legalEmail}</bdi></a>.</p>;
}

export function LegalDocument({ title, intro, sections }: {
  title: string;
  intro: string;
  sections: { id: string; title: string; content: ReactNode }[];
}) {
  return <main className="legal-page" id="legal-content">
    <SupportHeaderActions><Link className="legal-back" href="/">→ חזרה ל־Freelance Place</Link></SupportHeaderActions>
    <header className="legal-header"><p className="legal-eyebrow">Freelance Place · מידע משפטי</p><h1>{title}</h1><p>{intro}</p><p className="legal-date">בתוקף ועודכן לאחרונה: <time dateTime={legalUpdated}>10 בנובמבר 2026</time></p></header>
    <LegalContact/>
    <nav className="legal-toc" aria-label="תוכן העמוד"><h2>בעמוד הזה</h2><ol>{sections.map(section => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol></nav>
    <article>{sections.map((section, index) => <section className="legal-section" id={section.id} key={section.id} aria-labelledby={`${section.id}-title`}><h2 id={`${section.id}-title`}>{index + 1}. {section.title}</h2>{section.content}</section>)}</article>
    <p className="legal-end"><a href="#legal-content">חזרה לראש העמוד ↑</a></p>
  </main>;
}
