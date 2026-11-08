import Link from 'next/link';
import type { ReactNode } from 'react';

export const legalOperator = 'Or David AI Assimilation Services';
export const legalEmail = 'or@ailead.work';
export const legalUpdated = '2026-11-08';

export function LegalContact() {
  return <p>המפעיל ובעל השליטה במידע: <bdi lang="en">{legalOperator}</bdi> (אור דוד). לשאלות, בקשות פרטיות, דיווחים והודעות משפטיות: <a href={`mailto:${legalEmail}`}><bdi>{legalEmail}</bdi></a>.</p>;
}

export function LegalDocument({ title, intro, sections }: {
  title: string;
  intro: string;
  sections: { id: string; title: string; content: ReactNode }[];
}) {
  return <main className="legal-page" id="legal-content">
    <Link className="legal-back" href="/">→ חזרה ל־Freelance Zone</Link>
    <header className="legal-header"><p className="legal-eyebrow">Freelance Zone · מידע משפטי</p><h1>{title}</h1><p>{intro}</p><p className="legal-date">בתוקף ועודכן לאחרונה: <time dateTime={legalUpdated}>8 בנובמבר 2026</time></p></header>
    <LegalContact/>
    <nav className="legal-toc" aria-label="תוכן העמוד"><h2>בעמוד הזה</h2><ol>{sections.map(section => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol></nav>
    <article>{sections.map((section, index) => <section className="legal-section" id={section.id} key={section.id} aria-labelledby={`${section.id}-title`}><h2 id={`${section.id}-title`}>{index + 1}. {section.title}</h2>{section.content}</section>)}</article>
    <p className="legal-end"><a href="#legal-content">חזרה לראש העמוד ↑</a></p>
  </main>;
}

export function LegalFooter() {
  return <footer className="legal-footer"><span>Freelance Zone</span><nav aria-label="מידע משפטי"><Link href="/privacy">מדיניות פרטיות</Link><Link href="/terms">תנאי שימוש</Link><a href={`mailto:${legalEmail}`}>יצירת קשר</a></nav></footer>;
}
