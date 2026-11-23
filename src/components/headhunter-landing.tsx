import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { ArticleActions, InfoArticle, articleActions, crumbs, type ArticleAction } from '@/components/discovery/guide-article';
import { PublicHeader } from '@/components/discovery/public-content';
import { StructuredData } from '@/components/discovery/structured-data';
import { signInHref } from '@/lib/auth/safe-next';
import { EDITOR_TEXT } from '@/lib/headhunters/editor-copy';
import { LANDING, headhunterLandingContent } from '@/lib/seo/headhunter-content';
import { requirePage } from '@/lib/seo/registry';
import { agencyServiceId, agencyServiceNode, breadcrumbNode, webPageNode, withContext } from '@/lib/seo/schema';
import './headhunter-landing.css';

// What /profile/headhunter shows to signed-out visitors and crawlers: an answer-first information page (the same layout as the
// other information pages) about the free agency page. The text lives in headhunter-content.ts, the title and description in the
// registry. The signed-in session gets the private editor at the same URL; the page decides, this component only renders.

// Mock-ups of a fictional agency, never presented as real: every image says so in its alt text, caption and the note above them.
function Illustrations() {
  const { gallery } = LANDING;
  return <section className="hh-lp-gallery" aria-labelledby="hh-lp-gallery-title">
    <h2 id="hh-lp-gallery-title">{gallery.heading}</h2>
    <p className="hh-lp-note" role="note">{gallery.note}</p>
    <div className="hh-lp-grid">
      {gallery.items.map((item) => <figure key={item.id} className={`hh-lp-fig hh-lp-fig-${item.id}`}>
        <img src={item.src} width={item.width} height={item.height} alt={item.alt} loading="lazy" decoding="async" />
        <figcaption><span className="hh-lp-badge">{gallery.badge}</span>{item.caption}</figcaption>
      </figure>)}
    </div>
  </section>;
}

// `applicationsOpen` is the second feature switch: while it is off the page still explains the service, but offers no sign-up.
export function HeadhunterLanding({ applicationsOpen }: { applicationsOpen: boolean }) {
  const path = LANDING.path;
  const { title, description, published, modified } = requirePage(path);
  const content = headhunterLandingContent();
  const trail = [crumbs.home, { name: LANDING.breadcrumb, path }];
  // After signing in, the visitor comes back to this URL and finds the sign-up form instead of this page.
  const signIn = signInHref(path);
  const apply: ArticleAction = { label: LANDING.cta.apply, href: signIn };
  const actions: ArticleAction[] = applicationsOpen ? [apply, articleActions.postProject] : [articleActions.postProject];
  const closed = <div className="ga-disclaimer" role="note"><p><strong>{EDITOR_TEXT.closedTitle}. </strong>{EDITOR_TEXT.closedText}</p></div>;
  return <>
    <PublicHeader signInHref={signIn} />
    <main className="discovery-content hh-lp">
      <Breadcrumbs items={trail} structured={false} className="ga-crumbs" />
      <InfoArticle content={content} path={path} modified={modified} actions={actions}
        afterHeader={applicationsOpen ? <ArticleActions items={actions} /> : closed}
        afterSection={{ 'what-you-get': <Illustrations /> }} />
      <StructuredData data={withContext(breadcrumbNode(trail))} />
      <StructuredData data={withContext(webPageNode({ path, name: title, description, published, modified, mainEntity: agencyServiceId(path) }))} />
      <StructuredData data={withContext(agencyServiceNode({ path, ...LANDING.service }))} />
    </main>
  </>;
}
