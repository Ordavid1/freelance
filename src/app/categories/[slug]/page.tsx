import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicHeader, DiscoveryLinks, ProjectLinks, Questions, CollectionData } from '@/components/discovery/public-content';
import { StructuredData } from '@/components/discovery/structured-data';
import { categories } from '@/lib/seo/content';
import { breadcrumbs, noIndex, pageMetadata } from '@/lib/seo/site';
import { discoveryProjects } from '@/lib/seo/projects';
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const category = categories.find((item) => item.slug === slug);
  if (!category) return { title: 'התחום לא נמצא', robots: noIndex };
  return pageMetadata(category.title, category.intro, `/categories/${category.slug}`);
}
export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const category = categories.find((item) => item.slug === slug);
  if (!category) notFound();
  const projects = (await discoveryProjects()).filter((project) => category.match.some((name) => name === project.category) || project.skills.some((skill) => category.skills.some((name) => name.toLowerCase() === skill.toLowerCase())));
  return <><PublicHeader /><main className="discovery-content"><nav aria-label="פירורי לחם"><Link href="/">דף הבית</Link> / {category.name}</nav><h1>{category.title}</h1><p className="discovery-lead">{category.intro}</p><h2>איך מגדירים את העבודה?</h2><p>{category.scope}</p><h2>איך בוחרים איש או אשת מקצוע?</h2><p>{category.selection}</p><h2>כישורים שעשויים להתאים לפרויקט</h2><ul>{category.skills.map((skill) => <li key={skill}>{skill}</li>)}</ul><p><Link className="discovery-cta" href="/projects/new">לפרסום פרויקט</Link> <Link href="/guides/project-brief">מדריך להכנת בריף</Link></p><ProjectLinks projects={projects} /><Questions items={[{ question: category.question, answer: category.answer }]} /><DiscoveryLinks /><CollectionData title={category.title} path={`/categories/${category.slug}`} projects={projects} /><StructuredData data={breadcrumbs([{ name: 'דף הבית', path: '/' }, { name: category.name, path: `/categories/${category.slug}` }])} /></main></>;
}
