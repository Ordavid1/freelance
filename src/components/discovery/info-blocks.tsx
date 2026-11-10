import Link from 'next/link';
import { formatHebrewDate } from '@/lib/seo/dates';
import type { GuideGroup } from '@/lib/seo/guides-index';
import { articleLabels } from './guide-article';
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
