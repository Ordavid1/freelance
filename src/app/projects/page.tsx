import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { Pagination } from '@/components/discovery/pagination';
import { ProjectCardList } from '@/components/discovery/project-cards';
import { PublicHeader } from '@/components/discovery/public-content';
import { StructuredData } from '@/components/discovery/structured-data';
import { categories } from '@/lib/seo/categories';
import { formatHebrewDate, israelDate } from '@/lib/seo/dates';
import { projectCountSentence, projectPath, projectRangeSentence, sortNewestFirst } from '@/lib/seo/listing';
import { paginate, parsePageParam, projectsPagePath } from '@/lib/seo/pagination';
import { discoveryProjects } from '@/lib/seo/projects';
import { metadataFor, requirePage } from '@/lib/seo/registry';
import { collectionPageNode, withContext, type JsonLdNode } from '@/lib/seo/schema';
import { noIndex, pageMetadata } from '@/lib/seo/site';
import { indexableSkills } from '@/lib/seo/skills';

// The list changes with every publication, so the page is rendered per request.
export const dynamic = 'force-dynamic';
type Props = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

const path = '/projects';
const heading = 'פרויקטים פתוחים לפרילנסרים';
// An empty list is a thin page (or a failed read): keep it out of the index but let links be followed.
const emptyListing: Metadata['robots'] = { index: false, follow: true };

// What the index lists: discoverable projects (real clients' projects only), newest first. Pagination
// slices this list in memory, so what discoveryProjects returns decides how many pages exist.
async function listedProjects() {
  return sortNewestFirst(await discoveryProjects());
}

// The ItemList of a later page continues the numbering of the pages before it.
function continueNumbering(node: JsonLdNode, offset: number): JsonLdNode {
  const list = node.mainEntity as { itemListElement: { position: number }[] };
  return { ...node, mainEntity: { ...list, itemListElement: list.itemListElement.map((entry) => ({ ...entry, position: entry.position + offset })) } };
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const requested = parsePageParam((await searchParams).page);
  const listed = await listedProjects();
  const slice = requested === undefined ? undefined : paginate(listed, requested);
  if (!slice) return { title: 'העמוד לא נמצא', robots: noIndex };
  // Page 1 is the canonical /projects; every later page is indexable with a canonical of its own.
  const base = metadataFor(path);
  if (slice.page === 1) return listed.length > 0 ? base : { ...base, robots: emptyListing };
  const registered = requirePage(path);
  return pageMetadata(`${registered.title} · עמוד ${slice.page}`, `עמוד ${slice.page} מתוך ${slice.totalPages}. ${registered.description}`, projectsPagePath(slice.page));
}

export default async function ProjectsIndex({ searchParams }: Props) {
  const requested = parsePageParam((await searchParams).page);
  if (requested === undefined) notFound();
  const listed = await listedProjects();
  const slice = paginate(listed, requested);
  if (!slice) notFound();

  const registered = requirePage(path);
  const status = slice.totalPages > 1
    ? projectRangeSentence(slice.from, slice.to, slice.total)
    : projectCountSentence(slice.total, { one: 'באתר', many: 'באתר' });
  const latest = israelDate(listed[0]?.createdAt);
  const latestText = latest ? formatHebrewDate(latest) : undefined;
  const pagePath = projectsPagePath(slice.page);
  const title = slice.page > 1 ? `${registered.title} · עמוד ${slice.page}` : registered.title;
  const skills = indexableSkills();
  const collection = collectionPageNode({ path: pagePath, name: title, description: registered.description, items: slice.items.map((project) => ({ name: project.title, path: projectPath(project.slug) })) });

  return <>
    <PublicHeader />
    <main className="discovery-content">
      <Breadcrumbs items={[{ name: 'דף הבית', path: '/' }, { name: 'פרויקטים', path }]} />
      <h1>{slice.page > 1 ? `${heading} · עמוד ${slice.page}` : heading}</h1>
      <p className="disc-brief"><strong>בקיצור:</strong> כאן מופיעים הפרויקטים הפתוחים להצעות ב־Freelance Place, מהחדש לישן. כל פרויקט נפתח לעמוד מלא עם התיאור, התקציב והכישורים.</p>
      {(status || latestText) && <p className="disc-status">{status}{latest && latestText && <>{status ? ' ' : ''}הפרויקט האחרון פורסם ב־<time dateTime={latest}>{latestText}</time>.</>}</p>}

      {slice.total > 0 ? <section aria-labelledby="projects-list">
        <h2 id="projects-list">הפרויקטים</h2>
        <ProjectCardList projects={slice.items} skills={skills} />
        <Pagination page={slice.page} totalPages={slice.totalPages} hrefFor={projectsPagePath} label="עימוד פרויקטים" />
      </section> : <p className="disc-empty">כרגע אין פרויקטים פתוחים להצגה ברשימה. הרשימה מתעדכנת עם כל פרסום חדש. אפשר לפרסם פרויקט משלכם, או לעיין בתחומים ובכישורים שמופיעים למטה.</p>}

      <section aria-labelledby="projects-browse">
        <h2 id="projects-browse">עיון לפי תחום וכישור</h2>
        <p className="disc-after">בחרו תחום כדי לקרוא על העבודה בו, או כישור כדי לראות מה כולל השירות ואילו פרויקטים קשורים אליו.</p>
        <ul className="disc-browse">
          {categories.map((category) => <li key={category.slug}><Link className="disc-chip disc-chip-category" href={`/categories/${category.slug}`}>{category.name}</Link></li>)}
          {skills.map((skill) => <li key={skill.slug}><Link className="disc-chip" href={`/skills/${skill.slug}`}>{skill.name}</Link></li>)}
        </ul>
      </section>

      <section aria-labelledby="projects-cta">
        <h2 id="projects-cta">יש לכם פרויקט?</h2>
        <p className="disc-after">תארו מה אתם צריכים, ופרילנסרים יוכלו להגיש הצעות. מחפשים עבודה? המשיכו לעיין ברשימה.</p>
        <p className="disc-actions"><Link className="discovery-cta" href="/projects/new">לפרסום פרויקט</Link><Link href="/skills">לכל הכישורים</Link></p>
      </section>

      <StructuredData data={withContext(slice.page > 1 ? continueNumbering(collection, slice.from - 1) : collection)} />
    </main>
  </>;
}
