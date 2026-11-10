import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatHebrewDate } from '@/lib/seo/dates';
import type { InfoContent } from '@/lib/seo/info-content';
import { pageByPath } from '@/lib/seo/registry';
import type { Guide, GuideSection, Question } from '@/lib/seo/types';
import { Questions } from './public-content';
import './guide-article.css';

// Answer-first article layout. Guides (Guide) and information pages (InfoContent) share one
// section renderer, so every long-form page has the same order: H1, the "בקיצור" direct answer,
// byline with the modified date, in-page contents, sections (H2 with a lead answer, then detail),
// FAQ, sources, note and related reading. All page copy comes from the data modules; this file
// holds only interface labels.

export const articleLabels = {
  summary: 'בקיצור', by: 'מאת', author: 'צוות Freelance Place', updated: 'עודכן ב־', contents: 'תוכן העמוד',
  faq: 'שאלות ותשובות', sources: 'מקורות', checked: 'נבדק ב־', note: 'הבהרה', related: 'קריאה נוספת',
  operatorDetails: 'פרטי המפעיל', operator: 'המפעיל', contact: 'יצירת קשר',
  guideNotFound: 'המדריך לא נמצא',
} as const;

// Shared breadcrumb levels (pages feed the trail to both <Breadcrumbs> and breadcrumbNode()).
export const crumbs = {
  home: { name: 'דף הבית', path: '/' },
  guides: { name: 'מדריכים', path: '/guides' },
};

export type ArticleAction = { label: string; href: string };
export const articleActions = {
  postProject: { label: 'לפרסום פרויקט', href: '/projects/new' },
  browseProjects: { label: 'לפרויקטים ולמרחב העבודה', href: '/' },
};
const audienceActions: Record<Guide['audience'], ArticleAction[]> = {
  clients: [articleActions.postProject],
  freelancers: [articleActions.browseProjects],
  both: [articleActions.postProject, articleActions.browseProjects],
};

// Anchors of the blocks this layout adds around the author's sections. The FAQ heading id is the
// one Questions renders.
const FAQ_ANCHOR = 'faq-heading';
const SOURCES_ANCHOR = 'article-sources';
const RELATED_ANCHOR = 'article-related';
const TOC_TITLE_ID = 'article-toc-title';

type Source = NonNullable<Guide['sources']>[number];
type SectionTable = NonNullable<GuideSection['table']>;

export function Byline({ modified }: { modified?: string }) {
  return <p className="ga-byline">{articleLabels.by} <span className="ga-author">{articleLabels.author}</span>{modified ? <> · {articleLabels.updated}<time dateTime={modified}>{formatHebrewDate(modified)}</time></> : null}</p>;
}

export function ArticleHeader({ title, summary, modified }: { title: string; summary?: string; modified?: string }) {
  return <header className="ga-header">
    <h1>{title}</h1>
    {summary ? <div className="ga-summary"><p className="ga-summary-label">{articleLabels.summary}</p><p className="ga-summary-text">{summary}</p></div> : null}
    <Byline modified={modified} />
  </header>;
}

// In-page navigation. Rendered only when there is enough to navigate (three or more entries).
export function PageContents({ titleId = TOC_TITLE_ID, title = articleLabels.contents, items, chips = false }: { titleId?: string; title?: string; items: readonly { id: string; label: string }[]; chips?: boolean }) {
  if (items.length < 3) return null;
  const links = items.map((item) => <li key={item.id}><a href={`#${item.id}`}>{item.label}</a></li>);
  return <nav className="ga-toc" aria-labelledby={titleId}><p className="ga-toc-title" id={titleId}>{title}</p>{chips ? <ul className="ga-chips">{links}</ul> : <ol>{links}</ol>}</nav>;
}

function SectionTableView({ table }: { table: SectionTable }) {
  // The first column names the row (a driver, a model, an option); the other cells carry the
  // column title as data-label so the table stacks into readable cards on narrow screens.
  return <div className="discovery-table ga-table"><table>
    <caption>{table.caption}</caption>
    <thead><tr>{table.columns.map((column, index) => <th key={index} scope="col">{column}</th>)}</tr></thead>
    <tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => cellIndex === 0 ? <th key={cellIndex} scope="row">{cell}</th> : <td key={cellIndex} data-label={table.columns[cellIndex]}>{cell}</td>)}</tr>)}</tbody>
  </table></div>;
}

function SectionView({ section }: { section: GuideSection }) {
  const headingId = `${section.id}-heading`;
  const items = section.list?.items ?? [];
  const list = items.map((item, index) => <li key={index}>{item}</li>);
  return <section id={section.id} className="ga-section" aria-labelledby={headingId}>
    <h2 id={headingId}>{section.heading}</h2>
    <p className="ga-answer">{section.answer}</p>
    {section.paragraphs?.map((text, index) => <p key={index}>{text}</p>)}
    {items.length ? section.list?.ordered ? <ol className="ga-list">{list}</ol> : <ul className="ga-list">{list}</ul> : null}
    {section.table && section.table.columns.length && section.table.rows.length ? <SectionTableView table={section.table} /> : null}
  </section>;
}

// The shared section renderer: guides and information pages both use it.
export function GuideSections({ sections }: { sections: readonly GuideSection[] }) {
  return <>{sections.map((section) => <SectionView key={section.id} section={section} />)}</>;
}

export function ArticleActions({ items }: { items: readonly ArticleAction[] }) {
  if (!items.length) return null;
  return <p className="ga-actions">{items.map((item, index) => <Link key={item.href} className={index === 0 ? 'discovery-cta' : 'ga-secondary'} href={item.href}>{item.label}</Link>)}</p>;
}

// Only https links are rendered as links; anything else is shown as plain text.
function httpsUrl(value: string): boolean {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}
function SourceList({ sources }: { sources: readonly Source[] }) {
  return <section id={SOURCES_ANCHOR} className="ga-sources" aria-labelledby={`${SOURCES_ANCHOR}-heading`}>
    <h2 id={`${SOURCES_ANCHOR}-heading`}>{articleLabels.sources}</h2>
    <ul>{sources.map((source, index) => <li key={index}>{httpsUrl(source.url) ? <a href={source.url} rel="external">{source.name}</a> : source.name}{source.checked ? <> · <span className="ga-checked">{articleLabels.checked}<time dateTime={source.checked}>{formatHebrewDate(source.checked)}</time></span></> : null}</li>)}</ul>
  </section>;
}

function Disclaimer({ text }: { text: string }) {
  return <div className="ga-disclaimer" role="note"><p><strong>{articleLabels.note}: </strong>{text}</p></div>;
}

// Links to related pages by registry title. Paths the registry does not know, pages that are not
// indexable, the page itself and repeats are skipped, so the list never offers a dead end.
export function relatedLinks(paths: readonly string[], current: string): { path: string; title: string }[] {
  const seen = new Set<string>([current]);
  const links: { path: string; title: string }[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    const page = pageByPath(path);
    if (page && page.indexable !== false) links.push({ path, title: page.title });
  }
  return links;
}
export function RelatedReading({ paths, current }: { paths: readonly string[]; current: string }) {
  const links = relatedLinks(paths, current);
  if (!links.length) return null;
  return <section id={RELATED_ANCHOR} className="ga-related" aria-labelledby={`${RELATED_ANCHOR}-heading`}>
    <h2 id={`${RELATED_ANCHOR}-heading`}>{articleLabels.related}</h2>
    <ul>{links.map((link) => <li key={link.path}><Link href={link.path}>{link.title}</Link></li>)}</ul>
  </section>;
}

export type ArticleModel = {
  path: string;                       // this page, never offered as related reading
  title: string;                      // the H1
  summary: string;
  modified?: string;                  // 'YYYY-MM-DD'; the page also passes it to its JSON-LD
  sections: readonly GuideSection[];
  faq: Question[];
  related: readonly string[];
  sources?: readonly Source[];
  disclaimer?: string;
  actions?: readonly ArticleAction[];
  afterSections?: ReactNode;          // page-specific block between the sections and the FAQ
};

export function ArticleView({ path, title, summary, modified, sections, faq, related, sources, disclaimer, actions, afterSections }: ArticleModel) {
  const contents = [
    ...sections.map((section) => ({ id: section.id, label: section.heading })),
    ...(faq.length ? [{ id: FAQ_ANCHOR, label: articleLabels.faq }] : []),
    ...(sources?.length ? [{ id: SOURCES_ANCHOR, label: articleLabels.sources }] : []),
  ];
  return <article className="ga-article">
    <ArticleHeader title={title} summary={summary} modified={modified} />
    <PageContents items={contents} />
    <GuideSections sections={sections} />
    {afterSections}
    {faq.length ? <Questions items={faq} /> : null}
    {actions?.length ? <ArticleActions items={actions} /> : null}
    {sources?.length ? <SourceList sources={sources} /> : null}
    {disclaimer ? <Disclaimer text={disclaimer} /> : null}
    <RelatedReading paths={related} current={path} />
  </article>;
}

export function GuideArticle({ guide }: { guide: Guide }) {
  return <ArticleView path={`/guides/${guide.slug}`} title={guide.title} summary={guide.summary} modified={guide.modified} sections={guide.sections} faq={guide.faq} related={guide.related} sources={guide.sources} disclaimer={guide.disclaimer} actions={audienceActions[guide.audience]} />;
}

export function InfoArticle({ content, path, modified, actions, afterSections }: { content: InfoContent; path: string; modified?: string; actions?: readonly ArticleAction[]; afterSections?: ReactNode }) {
  return <ArticleView path={path} title={content.h1} summary={content.summary} modified={modified} sections={content.sections} faq={content.faq} related={content.related} disclaimer={content.disclaimer} actions={actions} afterSections={afterSections} />;
}
