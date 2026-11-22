import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { StructuredData } from '@/components/discovery/structured-data';
import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { Pagination } from '@/components/discovery/pagination';
import { ProjectCardList } from '@/components/discovery/project-cards';
import { PublicHeader } from '@/components/discovery/public-content';
import { HeadhunterClosedList, HeadhunterHero } from '@/components/headhunter-minisite';
import { HEADHUNTER_CLOSED_HEADING, HEADHUNTER_EMPTY_OPEN, HEADHUNTER_OPEN_HEADING, HEADHUNTER_PAGE_NOTE, openProjectsCountLine } from '@/lib/headhunters/presentation';
import { minisiteMetadata, minisitePagePath, resolveMinisite } from '@/lib/headhunters/minisite';
import { minisiteStructuredData } from '@/lib/headhunters/seo';
import { minisiteDeps as deps } from '@/lib/headhunters/server-deps';
import { minisitePath } from '@/lib/headhunters/urls';
import { indexableSkills } from '@/lib/seo/skills';
import { noIndex } from '@/lib/seo/site';

// A headhunter's minisite at /{handle}. Static routes win over this segment in Next, and the reserved-handle test keeps the
// two namespaces apart. Every outcome (redirect, 404, page, metadata) comes from resolveMinisite, so they cannot disagree.
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ handle: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

// One resolution per request, shared by generateMetadata and the page. A repeated ?page parameter is never a valid page.
const resolve = cache((handle: string, page: string | undefined) => resolveMinisite(handle, page, deps));
const pageKey = (value: string | string[] | undefined) => (Array.isArray(value) ? value.join('&') : value);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  try {
    return minisiteMetadata(await resolve((await params).handle, pageKey((await searchParams).page)));
  } catch (error) {
    console.error('Headhunter page metadata unavailable', error instanceof Error ? error.name : 'Error');
    return { title: 'העמוד לא נמצא', robots: noIndex };
  }
}

export default async function HeadhunterPage({ params, searchParams }: Props) {
  const result = await resolve((await params).handle, pageKey((await searchParams).page));
  if (result.kind === 'not-found') notFound();
  if (result.kind === 'redirect') permanentRedirect(result.to);

  const { view, projects, page, totalPages } = result;
  const skills = indexableSkills();
  const structured = minisiteStructuredData(result);
  const trail = [{ name: 'דף הבית', path: '/' }, { name: view.displayName, path: minisitePath(view.handle) }];
  return <>
    <PublicHeader />
    <main className="discovery-content hh-site">
      {structured && <StructuredData data={structured} />}
      <Breadcrumbs items={trail} structured={false} />
      <HeadhunterHero view={view} openCount={projects.openCount} publishedCount={projects.publishedCount} />

      <section aria-labelledby="hh-open-heading">
        <div className="hh-section-head"><h2 id="hh-open-heading">{HEADHUNTER_OPEN_HEADING}</h2><p>{openProjectsCountLine(projects.openCount)}</p></div>
        {projects.openCount > 0
          ? <>
            <ProjectCardList projects={projects.items} skills={skills} />
            <Pagination page={page} totalPages={totalPages} hrefFor={(next) => minisitePagePath(view.handle, next)} label="עימוד פרויקטים" />
          </>
          : <p className="hh-empty">{HEADHUNTER_EMPTY_OPEN}</p>}
      </section>

      {page === 1 && <HeadhunterClosedList heading={HEADHUNTER_CLOSED_HEADING} titles={projects.closed} />}
      <p className="hh-note">{HEADHUNTER_PAGE_NOTE(view.displayName)}</p>
    </main>
  </>;
}
