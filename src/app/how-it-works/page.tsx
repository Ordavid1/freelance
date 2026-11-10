import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { InfoArticle, articleActions, crumbs } from '@/components/discovery/guide-article';
import { PublicHeader } from '@/components/discovery/public-content';
import { StructuredData } from '@/components/discovery/structured-data';
import { howItWorksContent } from '@/lib/seo/info-content';
import { metadataFor, requirePage } from '@/lib/seo/registry';
import { breadcrumbNode, webPageNode, withContext } from '@/lib/seo/schema';

const path = '/how-it-works';
const { title, description, published, modified } = requirePage(path);
export const metadata = metadataFor(path);

export default function HowItWorksPage() {
  const content = howItWorksContent();
  const trail = [crumbs.home, { name: content.h1, path }];
  return <><PublicHeader /><main className="discovery-content">
    <Breadcrumbs items={trail} />
    <InfoArticle content={content} path={path} modified={modified} actions={[articleActions.postProject, articleActions.browseProjects]} />
    <StructuredData data={withContext(breadcrumbNode(trail))} />
    <StructuredData data={withContext(webPageNode({ path, name: title, description, published, modified }))} />
  </main></>;
}
