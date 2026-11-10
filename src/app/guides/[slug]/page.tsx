import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { GuideArticle, articleLabels, crumbs } from '@/components/discovery/guide-article';
import { PublicHeader } from '@/components/discovery/public-content';
import { StructuredData } from '@/components/discovery/structured-data';
import { guides } from '@/lib/seo/guides';
import { metadataFor } from '@/lib/seo/registry';
import { articleNode, breadcrumbNode, withContext } from '@/lib/seo/schema';
import { noIndex } from '@/lib/seo/site';

// Authored guides (src/lib/seo/guides). Static routes such as /guides/project-brief take precedence over this one.
type Props = { params: Promise<{ slug: string }> };
const findGuide = (slug: string) => guides.find((guide) => guide.slug === slug);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const guide = findGuide((await params).slug);
  if (!guide) return { title: articleLabels.guideNotFound, robots: noIndex };
  return metadataFor(`/guides/${guide.slug}`);
}

export default async function GuidePage({ params }: Props) {
  const guide = findGuide((await params).slug);
  if (!guide) notFound();
  const path = `/guides/${guide.slug}`;
  const trail = [crumbs.home, crumbs.guides, { name: guide.title, path }];
  // The FAQPage markup is emitted by the FAQ block of GuideArticle from the same questions it renders.
  return <><PublicHeader /><main className="discovery-content">
    <Breadcrumbs items={trail} structured={false} className="ga-crumbs" />
    <GuideArticle guide={guide} />
    <StructuredData data={withContext(breadcrumbNode(trail))} />
    <StructuredData data={withContext(articleNode({ path, headline: guide.title, description: guide.description, published: guide.published, modified: guide.modified }))} />
  </main></>;
}
