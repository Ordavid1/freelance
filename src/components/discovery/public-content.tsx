import Link from 'next/link';
import Image from 'next/image';
import type { Project } from '@/lib/data';
import { categories, type Question } from '@/lib/seo/content';
import { projectPath } from '@/lib/seo/listing';
import { collectionPageNode, faqNode, withContext } from '@/lib/seo/schema';
import { StructuredData } from './structured-data';

export function Questions({ items }: { items: Question[] }) {
  return <section aria-labelledby="faq-heading"><h2 id="faq-heading">שאלות ותשובות</h2>{items.map(({ question, answer }) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}<StructuredData data={withContext(faqNode(items))} /></section>;
}
export function DiscoveryLinks() {
  return <nav className="discovery-links" aria-label="מידע על Freelance Place"><Link href="/">פרויקטים ומרחב העבודה</Link><Link href="/alternatives/xplace">אלטרנטיבה ל־XPlace.com</Link><Link href="/guides/project-brief">איך כותבים בריף לפרויקט?</Link><Link href="/privacy">מדיניות פרטיות</Link><Link href="/terms">תנאי שימוש</Link>{categories.map((category) => <Link key={category.slug} href={`/categories/${category.slug}`}>{category.name}</Link>)}</nav>;
}
export function PublicHeader() {
  return <header className="discovery-header"><Link href="/" aria-label="Freelance Place — דף הבית"><Image src="/freelance-place-logo.svg" width={52} height={52} alt="Freelance Place" /></Link><span lang="en" dir="ltr">Freelance Place</span><Link href="/signin">כניסה לחשבון</Link></header>;
}
// Both receive discoverable projects only (see publication.ts). With none to list, neither renders:
// a heading or an empty ItemList with nothing under it adds no value for readers or crawlers.
export function ProjectLinks({ projects }: { projects: Project[] }) {
  if (projects.length === 0) return null;
  return <section><h2>פרויקטים שפורסמו באתר</h2><ul className="discovery-projects">{projects.map((project) => <li key={project.slug}><Link href={projectPath(project.slug)}>{project.title}</Link><p>{project.category} · {project.budget}</p></li>)}</ul></section>;
}
export function CollectionData({ title, path, projects }: { title: string; path: string; projects: Project[] }) {
  if (projects.length === 0) return null;
  return <StructuredData data={withContext(collectionPageNode({ path, name: title, items: projects.map((project) => ({ name: project.title, path: projectPath(project.slug) })) }))} />;
}
