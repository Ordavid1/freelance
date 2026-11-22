import { ProjectDescription } from '@/components/project-description';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell, OpportunitySignal, PageHeading } from '@/components/marketplace';
import { ProposalAction } from '@/components/actions';
import { discoveryProjects, readPublicProject } from '@/lib/seo/projects';
import { noIndex, pageMetadata, summarize } from '@/lib/seo/site';
import { breadcrumbNode, webPageNode, withContext } from '@/lib/seo/schema';
import { categoryForProject } from '@/lib/seo/content';
import { formatHebrewDate, israelDate } from '@/lib/seo/dates';
import { isSyntheticProject } from '@/lib/seo/publication';
import { relatedProjects } from '@/lib/seo/related';
import { projectSkillTags } from '@/lib/seo/skill-match';
import { indexableSkills } from '@/lib/seo/skills';
import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { ProjectCardList } from '@/components/discovery/project-cards';
import { StructuredData } from '@/components/discovery/structured-data';
import { HeadhunterTag } from '@/components/headhunter-tag';
import { getHeadhunterByHandle } from '@/lib/db/headhunters';
import { getHeadhunterProjects } from '@/lib/db/projects';
import { HEADHUNTER_ALL_PROJECTS, headhunterMoreHeading } from '@/lib/headhunters/presentation';
import { minisitePath } from '@/lib/headhunters/urls';
import type { Project } from '@/lib/data';
import { AI_AGENT_BADGE, SAMPLE_CLIENT_HISTORY, SAMPLE_DETAIL_NOTICE, showsAiBadge, showsLiveBadge } from '@/lib/projects/presentation';
import { LiveBadge } from '@/components/live-badge';

export const dynamic = 'force-dynamic';

// A showcase project (sample, published by the AI agent) keeps its page and its label inside the product, but it
// is noindex with no structured data: search engines are never offered it as a real client's project.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params; const project = await readPublicProject(slug);
  if (!project) return { title: 'הפרויקט לא נמצא', robots: noIndex };
  return pageMetadata(project.title, summarize(`${project.category} · ${project.budget}. ${project.description}`, 160), `/projects/${encodeURIComponent(slug)}`, !isSyntheticProject(project));
}
const isoDate = (millis?: number) => millis && Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;

// Up to three other open projects of the project's headhunter. Only a project that carries a live tag gets the block, and a
// failed read just leaves it out.
async function moreFromHeadhunter(project: Project) {
  const tag = project.headhunter;
  if (!tag) return null;
  try {
    const lookup = await getHeadhunterByHandle(tag.handle);
    if (lookup?.kind !== 'active') return null;
    const { items } = await getHeadhunterProjects(lookup.record.ownerUid, tag.handle, 1);
    const others = items.filter((item) => item.slug !== project.slug).slice(0, 3);
    return others.length > 0 ? { tag, others } : null;
  } catch (error) {
    console.warn('More from headhunter unavailable', error instanceof Error ? error.name : 'Error');
    return null;
  }
}

export default async function ProjectDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const project = await readPublicProject(slug); if (!project) notFound();
  const path = `/projects/${encodeURIComponent(slug)}`;
  const category = categoryForProject(project);
  const published = isoDate(project.createdAt);
  const modified = isoDate(project.updatedAt) ?? published;
  // One trail for the visible breadcrumb and the BreadcrumbList JSON-LD.
  const crumbs = [{ name: 'דף הבית', path: '/' }, ...(category ? [{ name: category.name, path: `/categories/${category.slug}` }] : []), { name: project.title, path }];
  const publishedDay = israelDate(project.createdAt);
  const publishedText = publishedDay ? formatHebrewDate(publishedDay) : undefined;
  // Skill tags link to a skill page only when the shared matching rule finds an indexable one.
  const catalogue = indexableSkills();
  const tags = projectSkillTags(project, catalogue);
  const related = relatedProjects(project, await discoveryProjects());
  const more = await moreFromHeadhunter(project);
  return <AppShell active="discover"><div className="page-body">{project.sample && <p className="notice">{SAMPLE_DETAIL_NOTICE}</p>}{!isSyntheticProject(project) && <><StructuredData data={withContext(breadcrumbNode(crumbs))} /><StructuredData data={withContext(webPageNode({ path, name: project.title, description: summarize(project.description, 300), published, modified, keywords: project.skills }))} /></>}<Breadcrumbs items={crumbs} structured={false} /><Link className="back-link" href="/">← חזרה לפרויקטים</Link><PageHeading eyebrow={<>{project.category}{showsLiveBadge(project) && <LiveBadge />}{project.headhunter && <HeadhunterTag headhunter={project.headhunter} />}</>} title={project.title} description={`פורסם ${project.posted} · ${project.proposals} הצעות`}/>{publishedDay && publishedText && <p className="disc-dates">תאריך פרסום: <time dateTime={publishedDay}>{publishedText}</time></p>}<div className="detail-grid"><article className="detail-main"><div className="detail-meta"><div><small>תקציב משוער</small><strong>{project.budget}</strong></div><div><small>תאריך יעד</small><strong>{project.deadline}</strong></div><div><small>מודל תשלום</small><strong>מחיר קבוע</strong></div></div><OpportunitySignal project={project}/><h2>על הפרויקט</h2><ProjectDescription text={project.description}/><h2>מה נצטרך ממך</h2><p>בהצעה שלך, ספר/י בקצרה על הגישה שלך, העבודה הרלוונטית שעשית, ומה היית רוצה לברר לפני שמתחילים. אפשר לעדכן את ההצעה לפני שליחתה.</p><h2>כישורים רלוונטיים</h2><div className="tag-list">{tags.map(({ tag, skill }) => skill ? <Link key={tag} className="tag tag-link" href={`/skills/${skill.slug}`}>{tag}</Link> : <span key={tag} className="tag">{tag}</span>)}</div><div className="client-history"><strong>על הלקוח/ה · {project.client}{showsAiBadge(project) && <span className="ai-agent-badge">{AI_AGENT_BADGE}</span>}</strong><p>{project.sample ? SAMPLE_CLIENT_HISTORY : project.clientHistory}</p>{project.sample && project.ownerPersona && <p>{project.ownerPersona}</p>}</div></article><aside className="detail-aside"><h3>נשמע כמו משהו בשבילך?</h3><p>הכינו הצעה עם מחיר, זמן משוער וכמה מילים אישיות. ההצעה תישלח רק אחרי אישור מפורש.</p><ProposalAction title={project.title} projectSlug={project.sample ? undefined : project.slug}/><a href="/?view=messages" className="button-outline detail-message">שאלה לפני ההצעה</a><div className="detail-privacy">♡ <span>הצעות ופרטים נשארים בשיחה של הפרויקט.</span></div></aside></div>{more && <section className="disc-related" aria-labelledby="headhunter-more-heading"><h2 id="headhunter-more-heading">{headhunterMoreHeading(more.tag.name)}</h2><ProjectCardList projects={more.others} skills={catalogue} headingLevel={3} /><p><Link href={minisitePath(more.tag.handle)}>{HEADHUNTER_ALL_PROJECTS}</Link></p></section>}{related.length > 0 && <section className="disc-related" aria-labelledby="related-projects-heading"><h2 id="related-projects-heading">פרויקטים דומים</h2><ProjectCardList projects={related} skills={catalogue} headingLevel={3} /></section>}</div></AppShell>;
}
