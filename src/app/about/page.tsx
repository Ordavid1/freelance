import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { InfoArticle, articleActions, crumbs } from '@/components/discovery/guide-article';
import { OperatorContact } from '@/components/discovery/info-blocks';
import { PublicHeader } from '@/components/discovery/public-content';
import { StructuredData } from '@/components/discovery/structured-data';
import { contactFacts } from '@/lib/seo/facts';
import { aboutContent } from '@/lib/seo/info-content';
import { metadataFor, requirePage } from '@/lib/seo/registry';
import { breadcrumbNode, webPageNode, withContext } from '@/lib/seo/schema';

const path = '/about';
const { title, description, published, modified } = requirePage(path);
export const metadata = metadataFor(path);

export default function AboutPage() {
  const content = aboutContent();
  const contact = contactFacts();
  const trail = [crumbs.home, { name: content.h1, path }];
  // The Organization node lives in the site graph; the AboutPage points to it as its main entity.
  return <><PublicHeader /><main className="discovery-content">
    <Breadcrumbs items={trail} />
    <InfoArticle content={content} path={path} modified={modified} actions={[articleActions.browseProjects, articleActions.postProject]} afterSections={<OperatorContact operator={contact.operator} email={contact.email} />} />
    <StructuredData data={withContext(breadcrumbNode(trail))} />
    <StructuredData data={withContext(webPageNode({ type: 'AboutPage', path, name: title, description, published, modified }))} />
  </main></>;
}
