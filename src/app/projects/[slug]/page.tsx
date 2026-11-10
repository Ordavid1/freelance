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
import { publicProjects } from '@/lib/seo/listing';
import { relatedProjects } from '@/lib/seo/related';
import { projectSkillTags } from '@/lib/seo/skill-match';
import { indexableSkills } from '@/lib/seo/skills';
import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { AiAgentNote, ProjectCardList } from '@/components/discovery/project-cards';
import { StructuredData } from '@/components/discovery/structured-data';
import { AI_AGENT_BADGE, SAMPLE_CLIENT_HISTORY, SAMPLE_DETAIL_NOTICE } from '@/lib/projects/presentation';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params; const project = await readPublicProject(slug);
  if (!project) return { title: 'הפרויקט לא נמצא', robots: noIndex };
  return pageMetadata(project.title, summarize(`${project.category} · ${project.budget}. ${project.description}`, 160), `/projects/${encodeURIComponent(slug)}`, !project.sample || project.ownerKind === 'ai-agent');
}
const isoDate = (millis?: number) => millis && Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;

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
  const related = relatedProjects(project, publicProjects(await discoveryProjects()));
  return <AppShell active="discover"><div className="page-body">{project.sample && <p className="notice">{SAMPLE_DETAIL_NOTICE}</p>}{(!project.sample || project.ownerKind === 'ai-agent') && <><StructuredData data={withContext(breadcrumbNode(crumbs))} /><StructuredData data={withContext(webPageNode({ path, name: project.title, description: summarize(project.description, 300), published, modified, keywords: project.skills }))} /></>}<Breadcrumbs items={crumbs} structured={false} /><Link className="back-link" href="/">← חזרה לפרויקטים</Link><PageHeading eyebrow={project.category} title={project.title} description={`פורסם ${project.posted} · ${project.proposals} הצעות`}/>{publishedDay && publishedText && <p className="disc-dates">תאריך פרסום: <time dateTime={publishedDay}>{publishedText}</time></p>}<div className="detail-grid"><article className="detail-main"><div className="detail-meta"><div><small>תקציב משוער</small><strong>{project.budget}</strong></div><div><small>תאריך יעד</small><strong>{project.deadline}</strong></div><div><small>מודל תשלום</small><strong>מחיר קבוע</strong></div></div><OpportunitySignal project={project}/><h2>על הפרויקט</h2><ProjectDescription text={project.description}/><h2>מה נצטרך ממך</h2><p>בהצעה שלך, ספר/י בקצרה על הגישה שלך, העבודה הרלוונטית שעשית, ומה היית רוצה לברר לפני שמתחילים. אפשר לעדכן את ההצעה לפני שליחתה.</p><h2>כישורים רלוונטיים</h2><div className="tag-list">{tags.map(({ tag, skill }) => skill ? <Link key={tag} className="tag tag-link" href={`/skills/${skill.slug}`}>{tag}</Link> : <span key={tag} className="tag">{tag}</span>)}</div><div className="client-history"><strong>על הלקוח/ה · {project.client}{project.sample && <span className="ai-agent-badge">{AI_AGENT_BADGE}</span>}</strong><p>{project.sample ? SAMPLE_CLIENT_HISTORY : project.clientHistory}</p>{project.sample && project.ownerPersona && <p>{project.ownerPersona}</p>}</div></article><aside className="detail-aside"><h3>נשמע כמו משהו בשבילך?</h3><p>הכינו הצעה עם מחיר, זמן משוער וכמה מילים אישיות. ההצעה תישלח רק אחרי אישור מפורש.</p><ProposalAction title={project.title} projectSlug={project.sample ? undefined : project.slug}/><Link href="/messages" className="button-outline detail-message">שאלה לפני ההצעה</Link><div className="detail-privacy">♡ <span>הצעות ופרטים נשארים בשיחה של הפרויקט.</span></div></aside></div>{related.length > 0 && <section className="disc-related" aria-labelledby="related-projects-heading"><h2 id="related-projects-heading">פרויקטים דומים</h2><ProjectCardList projects={related} skills={catalogue} headingLevel={3} /><AiAgentNote projects={related} /></section>}</div></AppShell>;
}
