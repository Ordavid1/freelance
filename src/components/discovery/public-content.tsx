import Link from 'next/link';
import Image from 'next/image';
import type { Project } from '@/lib/data';
import { categories, type Question } from '@/lib/seo/content';
import { StructuredData } from './structured-data';
import { absoluteUrl } from '@/lib/seo/site';

export function Questions({ items }: { items: Question[] }) {
  return <section aria-labelledby="faq-heading"><h2 id="faq-heading">שאלות ותשובות</h2>{items.map(({ question, answer }) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}<StructuredData data={{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map(({ question, answer }) => ({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } })) }} /></section>;
}
export function DiscoveryLinks() {
  return <nav className="discovery-links" aria-label="מידע על Freelance Place"><Link href="/">פרויקטים ומרחב העבודה</Link><Link href="/alternatives/xplace">אלטרנטיבה ל־XPlace.com</Link><Link href="/guides/project-brief">איך כותבים בריף לפרויקט?</Link><Link href="/privacy">מדיניות פרטיות</Link><Link href="/terms">תנאי שימוש</Link>{categories.map((category) => <Link key={category.slug} href={`/categories/${category.slug}`}>{category.name}</Link>)}</nav>;
}
export function PublicHeader() {
  return <header className="discovery-header"><Link href="/" aria-label="Freelance Place — דף הבית"><Image src="/freelance-place-logo.svg" width={52} height={52} alt="Freelance Place" /></Link><span lang="en" dir="ltr">Freelance Place</span><Link href="/signin">כניסה לחשבון</Link></header>;
}
export function ProjectLinks({ projects }: { projects: Project[] }) {
  const realProjects = projects.filter((project) => !project.sample);
  return <section><h2>פרויקטים שפורסמו באתר</h2>{realProjects.length ? <ul className="discovery-projects">{realProjects.map((project) => <li key={project.slug}><Link href={`/projects/${encodeURIComponent(project.slug)}`}>{project.title}</Link><p>{project.category} · {project.budget}</p></li>)}</ul> : <p>רשימת הפרויקטים מתעדכנת עם פרסומים חדשים. אפשר לחזור למרחב העבודה כדי לבדוק זמינות או לפרסם פרויקט.</p>}</section>;
}
export function CollectionData({ title, path, projects }: { title: string; path: string; projects: Project[] }) {
  return <StructuredData data={{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, url: absoluteUrl(path), inLanguage: 'he-IL', isPartOf: { '@id': absoluteUrl('/#website') }, mainEntity: { '@type': 'ItemList', itemListElement: projects.filter((project) => !project.sample).map((project, index) => ({ '@type': 'ListItem', position: index + 1, name: project.title, url: absoluteUrl(`/projects/${encodeURIComponent(project.slug)}`) })) } }} />;
}
