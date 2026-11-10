import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { InfoArticle, articleActions, crumbs } from '@/components/discovery/guide-article';
import { PublicHeader } from '@/components/discovery/public-content';
import { StructuredData } from '@/components/discovery/structured-data';
import { membershipFacts } from '@/lib/seo/facts';
import { pricingContent } from '@/lib/seo/info-content';
import { metadataFor, requirePage } from '@/lib/seo/registry';
import { breadcrumbNode, membershipServiceNode, webPageNode, withContext } from '@/lib/seo/schema';

// Price, trial length and billing state are read per request from the product facts (never typed
// here), so the page follows the payment configuration without a deploy.
export const dynamic = 'force-dynamic';
const path = '/pricing';
const { title, description, published, modified } = requirePage(path);
export const metadata = metadataFor(path);

export default function PricingPage() {
  const facts = membershipFacts();
  const content = pricingContent(facts);
  // Service and Offer markup exists only while the membership can actually be bought.
  const service = membershipServiceNode(facts);
  const trail = [crumbs.home, { name: content.h1, path }];
  return <><PublicHeader /><main className="discovery-content">
    <Breadcrumbs items={trail} />
    <InfoArticle content={content} path={path} modified={modified} actions={[articleActions.postProject, articleActions.browseProjects]} />
    <StructuredData data={withContext(breadcrumbNode(trail))} />
    <StructuredData data={withContext(webPageNode({ path, name: title, description, published, modified }))} />
    {service ? <StructuredData data={withContext(service)} /> : null}
  </main></>;
}
