import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AiAgentNote } from '@/components/discovery/project-cards';
import { PublicHeader, DiscoveryLinks, ProjectLinks, Questions, CollectionData } from '@/components/discovery/public-content';
import { StructuredData } from '@/components/discovery/structured-data';
import { categoryQuestions } from '@/lib/seo/category-faq';
import { categoryFaqItems } from '@/lib/seo/category-page';
import { categories, projectMatchesCategory } from '@/lib/seo/content';
import { guidesForCategory } from '@/lib/seo/linking';
import { countAiAgentProjects, projectCountSentence, publicProjects, sortNewestFirst } from '@/lib/seo/listing';
import { metadataFor } from '@/lib/seo/registry';
import { breadcrumbNode, withContext } from '@/lib/seo/schema';
import { noIndex, summarize } from '@/lib/seo/site';
import { discoveryProjects } from '@/lib/seo/projects';
import { indexableSkills, skillsByCategory } from '@/lib/seo/skills';
export const dynamic = 'force-dynamic';
// A category page shows its newest projects; the full list is the paginated /projects index.
const CATEGORY_PROJECT_LIMIT = 12;
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const category = categories.find((item) => item.slug === slug);
  if (!category) return { title: 'התחום לא נמצא', robots: noIndex };
  return metadataFor(`/categories/${category.slug}`);
}
export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const category = categories.find((item) => item.slug === slug);
  if (!category) notFound();
  const projects = sortNewestFirst(publicProjects((await discoveryProjects()).filter((project) => projectMatchesCategory(project, category))));
  const shown = projects.slice(0, CATEGORY_PROJECT_LIMIT);
  // Real counts only: no sentence at all when there is nothing to count.
  const count = projectCountSentence(projects.length, countAiAgentProjects(projects), { one: 'בתחום הזה', many: 'בתחום הזה' });
  const skillPages = skillsByCategory(category.slug, indexableSkills());
  const guides = guidesForCategory(category.slug);
  const questions = categoryFaqItems(category, categoryQuestions[category.slug]);
  return <><PublicHeader /><main className="discovery-content"><nav aria-label="פירורי לחם"><Link href="/">דף הבית</Link> / {category.name}</nav><h1>{category.title}</h1><p className="discovery-lead">{category.intro}</p>{count && <p>{count}</p>}<h2>איך מגדירים את העבודה?</h2><p>{category.scope}</p><h2>איך בוחרים איש או אשת מקצוע?</h2><p>{category.selection}</p><h2>כישורים שעשויים להתאים לפרויקט</h2><ul>{category.skills.map((skill) => <li key={skill}>{skill}</li>)}</ul>{skillPages.length > 0 && <><h2>עמודי הסבר לפי כישור</h2><p>לכל כישור יש עמוד שמסביר מה העבודה כוללת, מה כדאי לבדוק לפני שבוחרים ומה משפיע על המחיר.</p><ul>{skillPages.map((skill) => <li key={skill.slug}><Link href={`/skills/${skill.slug}`}>{skill.name}</Link>: {summarize(skill.definition, 110)}</li>)}</ul></>}<p><Link className="discovery-cta" href="/projects/new">לפרסום פרויקט</Link> <Link href="/guides/project-brief">מדריך להכנת בריף</Link></p>{guides.length > 0 && <><h2>מדריכים קשורים</h2><ul>{guides.map((guide) => <li key={guide.path}><Link href={guide.path}>{guide.title}</Link></li>)}</ul></>}<ProjectLinks projects={shown} /><AiAgentNote projects={shown} />{projects.length > shown.length && <p><Link href="/projects">לכל הפרויקטים הפתוחים</Link></p>}<Questions items={questions} /><DiscoveryLinks /><CollectionData title={category.title} path={`/categories/${category.slug}`} projects={shown} /><StructuredData data={withContext(breadcrumbNode([{ name: 'דף הבית', path: '/' }, { name: category.name, path: `/categories/${category.slug}` }]))} /></main></>;
}
