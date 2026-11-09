import { ProjectDescription } from '@/components/project-description';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell, OpportunitySignal, PageHeading } from '@/components/marketplace';
import { ProposalAction } from '@/components/actions';
import { readPublicProject } from '@/lib/seo/projects';
import { absoluteUrl, breadcrumbs, noIndex, pageMetadata } from '@/lib/seo/site';
import { StructuredData } from '@/components/discovery/structured-data';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params; const project = await readPublicProject(slug);
  if (!project) return { title: 'הפרויקט לא נמצא', robots: noIndex };
  return pageMetadata(project.title, `${project.category} · ${project.budget}. ${project.description.slice(0, 135)}`, `/projects/${encodeURIComponent(slug)}`, !project.sample);
}

export default async function ProjectDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const project = await readPublicProject(slug); if (!project) notFound();
  return <AppShell active="discover"><div className="page-body">{project.sample && <p className="notice">פרויקט לדוגמה בלבד — אינו פתוח להצעות.</p>}{!project.sample && <><StructuredData data={breadcrumbs([{ name: 'דף הבית', path: '/' }, { name: project.title, path: `/projects/${encodeURIComponent(slug)}` }])} /><StructuredData data={{ '@context': 'https://schema.org', '@type': 'WebPage', name: project.title, description: project.description, url: absoluteUrl(`/projects/${encodeURIComponent(slug)}`), inLanguage: 'he-IL', isPartOf: { '@id': absoluteUrl('/#website') } }} /></>}<Link className="back-link" href="/">← חזרה לפרויקטים</Link><PageHeading eyebrow={project.category} title={project.title} description={`פורסם ${project.posted} · ${project.proposals} הצעות`}/><div className="detail-grid"><article className="detail-main"><div className="detail-meta"><div><small>תקציב משוער</small><strong>{project.budget}</strong></div><div><small>תאריך יעד</small><strong>{project.deadline}</strong></div><div><small>מודל תשלום</small><strong>מחיר קבוע</strong></div></div><OpportunitySignal project={project}/><h2>על הפרויקט</h2><ProjectDescription text={project.description}/><h2>מה נצטרך ממך</h2><p>בהצעה שלך, ספר/י בקצרה על הגישה שלך, העבודה הרלוונטית שעשית, ומה היית רוצה לברר לפני שמתחילים. אפשר לעדכן את ההצעה לפני שליחתה.</p><h2>כישורים רלוונטיים</h2><div className="tag-list">{project.skills.map((s) => <span key={s} className="tag">{s}</span>)}</div><div className="client-history"><strong>על הלקוח/ה · {project.client}</strong><p>{project.sample ? 'פרטי לקוח/ה לדוגמה.' : project.clientHistory}</p></div></article><aside className="detail-aside"><h3>נשמע כמו משהו בשבילך?</h3><p>הכינו הצעה עם מחיר, זמן משוער וכמה מילים אישיות. ההצעה תישלח רק אחרי אישור מפורש.</p><ProposalAction title={project.title} projectSlug={project.sample ? undefined : project.slug}/><Link href="/messages" className="button-outline detail-message">שאלה לפני ההצעה</Link><div className="detail-privacy">♡ <span>הצעות ופרטים נשארים בשיחה של הפרויקט.</span></div></aside></div></div></AppShell>;
}
