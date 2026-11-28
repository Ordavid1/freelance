import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { InfoArticle, articleActions, crumbs } from '@/components/discovery/guide-article';
import { PublicHeader } from '@/components/discovery/public-content';
import { StructuredData } from '@/components/discovery/structured-data';
import { featureEnabled } from '@/lib/security/runtime-switch';
import { aiContent } from '@/lib/seo/info-content';
import { metadataFor, requirePage } from '@/lib/seo/registry';
import { breadcrumbNode, webPageNode, withContext } from '@/lib/seo/schema';

const path = '/ai';
const { title, description, published, modified } = requirePage(path);
export const metadata = metadataFor(path);
// The page exists only while the MCP switch is on, and the switch can change without a deploy.
export const dynamic = 'force-dynamic';

export default async function AiPage() {
  if (!(await featureEnabled('mcp'))) notFound();
  const content = aiContent();
  const trail = [crumbs.home, { name: content.h1, path }];
  return <><PublicHeader /><main className="discovery-content">
    <Breadcrumbs items={trail} structured={false} className="ga-crumbs" />
    <InfoArticle content={content} path={path} modified={modified} actions={[articleActions.browseProjects, articleActions.postProject]} />
    <StructuredData data={withContext(breadcrumbNode(trail))} />
    <StructuredData data={withContext(webPageNode({ path, name: title, description, published, modified }))} />
  </main></>;
}
