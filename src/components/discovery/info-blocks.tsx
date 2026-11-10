import Link from 'next/link';
import { formatHebrewDate } from '@/lib/seo/dates';
import type { GlossaryTerm } from '@/lib/seo/glossary-data';
import type { GuideGroup } from '@/lib/seo/guides-index';
import type { FaqGroup } from '@/lib/seo/info-content';
import { faqNode, withContext } from '@/lib/seo/schema';
import { PageContents, articleLabels } from './guide-article';
import { StructuredData } from './structured-data';
import './guide-article.css';

// Page-specific blocks of the information pages. Like guide-article.tsx they render data only:
// every heading, answer and definition arrives from a content module.

// The guides index: one block per audience, each guide with its direct answer.
export function GuideIndex({ groups }: { groups: readonly GuideGroup[] }) {
  return <>{groups.map((group) => {
    const id = `audience-${group.audience}`;
    return <section key={group.audience} id={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{group.heading}</h2>
      <p>{group.description}</p>
      <ul className="ga-cards">{group.items.map((item) => <li key={item.path} className="ga-card">
        <h3><Link href={item.path}>{item.title}</Link></h3>
        <p>{item.summary}</p>
        {item.modified ? <p className="ga-card-meta">{articleLabels.updated}<time dateTime={item.modified}>{formatHebrewDate(item.modified)}</time></p> : null}
      </li>)}</ul>
    </section>;
  })}</>;
}

// The questions page: answers are visible (not collapsed), grouped by topic with an anchor per
// group and per question. One FAQPage carries every question and is built from the same items
// that are rendered, so the markup and the visible text are identical. Groups without
// questions are skipped.
export function FaqGroups({ groups }: { groups: readonly FaqGroup[] }) {
  const filled = groups.filter((group) => group.items.length > 0);
  const all = filled.flatMap((group) => group.items);
  return <>
    <PageContents items={filled.map((group) => ({ id: group.id, label: group.heading }))} />
    {filled.map((group, groupIndex) => <section key={group.id} id={group.id} className="ga-section" aria-labelledby={`${group.id}-heading`}>
      <h2 id={`${group.id}-heading`}>{group.heading}</h2>
      {group.items.map((item, itemIndex) => <div key={itemIndex} id={`q-${groupIndex + 1}-${itemIndex + 1}`} className="ga-qa">
        <h3>{item.question}</h3>
        <p>{item.answer}</p>
      </div>)}
    </section>)}
    {all.length ? <StructuredData data={withContext(faqNode(all))} /> : null}
  </>;
}

// A term's element id comes from its position, never from its Hebrew text, so anchors stay ASCII.
export const glossaryTermId = (index: number) => `term-${index + 1}`;

// The glossary as a definition list: the term, its one-sentence definition and the practical sentence,
// with an anchor per term and a jump list at the top.
export function GlossaryList({ terms }: { terms: readonly GlossaryTerm[] }) {
  if (!terms.length) return null;
  return <>
    <PageContents titleId="glossary-terms-title" title={articleLabels.terms} chips items={terms.map((term, index) => ({ id: glossaryTermId(index), label: term.term }))} />
    <dl className="ga-glossary">{terms.map((term, index) => <div key={index} id={glossaryTermId(index)} className="ga-term">
      <dt>{term.term}</dt>
      <dd>{term.definition}</dd>
      <dd className="ga-practical"><strong>{articleLabels.practical}: </strong>{term.practical}</dd>
    </div>)}</dl>
  </>;
}

// Who operates the service and how to reach them, from the contact facts (never typed here).
export function OperatorContact({ operator, email }: { operator: string; email: string }) {
  return <section className="ga-operator" aria-label={articleLabels.operatorDetails}>
    <dl>
      <dt>{articleLabels.operator}</dt>
      <dd><bdi lang="en">{operator}</bdi></dd>
      <dt>{articleLabels.contact}</dt>
      <dd><a href={`mailto:${email}`}><bdi>{email}</bdi></a></dd>
    </dl>
  </section>;
}
