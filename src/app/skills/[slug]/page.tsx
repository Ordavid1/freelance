import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { PublicHeader } from '@/components/discovery/public-content';
import { SkillArticle } from '@/components/discovery/skill-article';
import { StructuredData } from '@/components/discovery/structured-data';
import { categories } from '@/lib/seo/categories';
import { guideLinks } from '@/lib/seo/linking';
import { sortNewestFirst } from '@/lib/seo/listing';
import { discoveryProjects } from '@/lib/seo/projects';
import { metadataFor, requirePage } from '@/lib/seo/registry';
import { webPageNode, withContext } from '@/lib/seo/schema';
import { noIndex } from '@/lib/seo/site';
import { projectsForSkill } from '@/lib/seo/skill-match';
import { relatedSkills, skillBySlug } from '@/lib/seo/skills';

// Open projects change with every publication, so the page is rendered per request.
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const skill = skillBySlug(slug);
  if (!skill) return { title: 'הכישור לא נמצא', robots: noIndex };
  // The registry marks a skill that fails the completeness gate as noindex.
  return metadataFor(`/skills/${skill.slug}`);
}

export default async function SkillPage({ params }: Props) {
  const { slug } = await params;
  const skill = skillBySlug(slug);
  if (!skill) notFound();
  const path = `/skills/${skill.slug}`;
  const page = requirePage(path);
  const category = categories.find((item) => item.slug === skill.category);
  const projects = projectsForSkill(skill, sortNewestFirst(await discoveryProjects()));
  const crumbs = [{ name: 'דף הבית', path: '/' }, { name: 'כישורים', path: '/skills' }, { name: skill.name, path }];
  return <>
    <PublicHeader />
    <main className="discovery-content">
      <Breadcrumbs items={crumbs} />
      <SkillArticle skill={skill} category={category && { slug: category.slug, name: category.name }} related={relatedSkills(skill)} guides={guideLinks(skill.guides)} projects={projects} />
      <StructuredData data={withContext(webPageNode({ path, name: page.title, description: page.description, published: skill.published, modified: skill.modified, keywords: skill.aliases }))} />
    </main>
  </>;
}
