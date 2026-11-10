import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { ArticleHeader, RelatedReading, crumbs } from '@/components/discovery/guide-article';
import { GlossaryList, glossaryTermId } from '@/components/discovery/info-blocks';
import { PublicHeader } from '@/components/discovery/public-content';
import { StructuredData } from '@/components/discovery/structured-data';
import { glossaryIntro, glossaryTerms } from '@/lib/seo/glossary-data';
import { metadataFor, requirePage } from '@/lib/seo/registry';
import { breadcrumbNode, definedTermSetNode, webPageNode, withContext } from '@/lib/seo/schema';

const path = '/glossary';
const { title, description, published, modified } = requirePage(path);
export const metadata = metadataFor(path);
// Pages that put the terms to use. Paths the registry does not know are skipped by RelatedReading.
const related = ['/guides/project-brief', '/guides/compare-freelancer-quotes', '/guides/freelance-contract-checklist', '/guides', '/faq'];

export default function GlossaryPage() {
  const trail = [crumbs.home, { name: glossaryIntro.h1, path }];
  // A set without terms says nothing, so it is emitted only when there are terms.
  const termSet = glossaryTerms.length
    ? definedTermSetNode({ path, name: glossaryIntro.h1, description: glossaryIntro.summary, terms: glossaryTerms.map((term, index) => ({ name: term.term, description: term.definition, anchor: glossaryTermId(index) })) })
    : null;
  return <><PublicHeader /><main className="discovery-content">
    <Breadcrumbs items={trail} />
    <article className="ga-article">
      <ArticleHeader title={glossaryIntro.h1} summary={glossaryIntro.summary} modified={modified} />
      <GlossaryList terms={glossaryTerms} />
      <RelatedReading paths={related} current={path} />
    </article>
    <StructuredData data={withContext(breadcrumbNode(trail))} />
    <StructuredData data={withContext(webPageNode({ path, name: title, description, published, modified }))} />
    {termSet ? <StructuredData data={withContext(termSet)} /> : null}
  </main></>;
}
