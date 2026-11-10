import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { ArticleHeader, crumbs } from '@/components/discovery/guide-article';
import { GuideIndex } from '@/components/discovery/info-blocks';
import { PublicHeader } from '@/components/discovery/public-content';
import { StructuredData } from '@/components/discovery/structured-data';
import { guides } from '@/lib/seo/guides';
import { guideGroups, guideListItems, guidesIndexIntro } from '@/lib/seo/guides-index';
import { allPages, metadataFor, requirePage } from '@/lib/seo/registry';
import { breadcrumbNode, collectionPageNode, withContext } from '@/lib/seo/schema';

const path = '/guides';
const { description, modified } = requirePage(path);
export const metadata = metadataFor(path);

export default function GuidesIndexPage() {
  // Every guide page in the registry is listed, in the order shown, so the ItemList matches what people see.
  const groups = guideGroups(guideListItems(allPages(), guides));
  const items = groups.flatMap((group) => group.items).map((item) => ({ name: item.title, path: item.path }));
  const trail = [crumbs.home, crumbs.guides];
  return <><PublicHeader /><main className="discovery-content">
    <Breadcrumbs items={trail} />
    <ArticleHeader title={guidesIndexIntro.h1} summary={guidesIndexIntro.summary} modified={modified} />
    <GuideIndex groups={groups} />
    <StructuredData data={withContext(breadcrumbNode(trail))} />
    <StructuredData data={withContext(collectionPageNode({ path, name: guidesIndexIntro.h1, description, modified, items }))} />
  </main></>;
}
