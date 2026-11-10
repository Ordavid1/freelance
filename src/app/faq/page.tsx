import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { ArticleHeader, RelatedReading, crumbs } from '@/components/discovery/guide-article';
import { FaqGroups } from '@/components/discovery/info-blocks';
import { PublicHeader } from '@/components/discovery/public-content';
import { StructuredData } from '@/components/discovery/structured-data';
import { membershipFacts } from '@/lib/seo/facts';
import { faqContent } from '@/lib/seo/info-content';
import { metadataFor, requirePage } from '@/lib/seo/registry';
import { breadcrumbNode, webPageNode, withContext } from '@/lib/seo/schema';

// Membership answers are built from the product facts on every request, like /pricing.
export const dynamic = 'force-dynamic';
const path = '/faq';
const { title, description, published, modified } = requirePage(path);
export const metadata = metadataFor(path);

export default function FaqPage() {
  const content = faqContent(membershipFacts());
  const trail = [crumbs.home, { name: content.h1, path }];
  // FaqGroups emits the single FAQPage, with every question of every group.
  return <><PublicHeader /><main className="discovery-content">
    <Breadcrumbs items={trail} structured={false} className="ga-crumbs" />
    <article className="ga-article">
      <ArticleHeader title={content.h1} summary={content.summary} modified={modified} />
      <FaqGroups groups={content.groups} />
      <RelatedReading paths={content.related} current={path} />
    </article>
    <StructuredData data={withContext(breadcrumbNode(trail))} />
    <StructuredData data={withContext(webPageNode({ path, name: title, description, published, modified }))} />
  </main></>;
}
