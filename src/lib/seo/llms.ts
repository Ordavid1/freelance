// Generators for /llms.txt (a short, source-linked index) and /llms-full.txt (one markdown
// document). Both are derived from the data that already drives the site, so they cannot
// drift: the page registry (titles, notes, indexability), the membership facts, the home and
// comparison questions, the categories and, when they exist, skills, guides and info pages.
// Output is deterministic (no timestamps) and lists only indexable pages. Pure module: no
// server-only imports.
import { categories } from './categories';
import { categoryQuestions } from './category-faq';
import { getComparisonQuestions, getHomeQuestions } from './content';
import { BRAND, aiAgentAnswer, contactFacts, membershipAnswer, membershipFacts, type MembershipFacts } from './facts';
import { guides } from './guides';
import { aboutContent, faqContent, howItWorksContent, pricingContent, type FaqContent, type InfoContent } from './info-content';
import { indexablePages, pageByPath } from './registry';
import { absoluteUrl, summarize } from './site';
import { skills } from './skills';
import type { GuideSection, Question, SeoPage } from './types';

export const LLMS_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'X-Robots-Tag': 'noindex',
  'Cache-Control': 'public, max-age=300, s-maxage=3600',
} as const;
export function llmsResponse(body: string): Response {
  return new Response(body, { headers: LLMS_HEADERS });
}

type Section = NonNullable<SeoPage['llms']>['section'];
const SECTION_ORDER: readonly Section[] = ['Product', 'Guides', 'Categories', 'Skills', 'Comparisons', 'Legal'];
const NOTE_LIMIT = 320;

const SUMMARY = `${BRAND.name} is a Hebrew-first freelance project marketplace for independent professionals and businesses in Israel: clients post projects, freelancers browse them and send proposals. It is an independent alternative to XPlace.com and is not affiliated with XPlace.`;

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
// Square brackets would end a markdown link label early.
const linkLabel = (text: string) => oneLine(text).replace(/[[\]]/g, '\\$&');
const bullets = (items: readonly string[]) => items.map((item) => `- ${oneLine(item)}`).join('\n');
// A page is mentioned only while the registry lists it as indexable.
const listed = (path: string) => { const page = pageByPath(path); return page !== undefined && page.indexable !== false; };

function pageLine(page: SeoPage) {
  const note = page.llms ? summarize(page.llms.note, NOTE_LIMIT) : '';
  return `- [${linkLabel(page.title)}](${absoluteUrl(page.path)})${note ? `: ${note}` : ''}`;
}
// Indexable pages that carry an llms note, grouped in the conventional section order; empty sections are omitted.
function pageSections() {
  const pages = indexablePages().filter((page) => page.llms);
  return SECTION_ORDER
    .map((section) => ({ section, pages: pages.filter((page) => page.llms?.section === section) }))
    .filter((group) => group.pages.length > 0);
}

// Public product facts. Numbers, the trial length and the billing state come from facts.ts; the
// Hebrew answers are the same strings the site shows, so a change there reaches this file.
export function factLines(facts: MembershipFacts): string[] {
  const { operator, email } = contactFacts();
  const price = facts.priceIls.toFixed(2);
  // The Hebrew answer starts with "no", which only makes sense next to the question the site asks.
  const agentQuestion = getHomeQuestions(facts).find((item) => item.answer === aiAgentAnswer)?.question;
  return [
    `Operator: ${operator}. Contact: ${email}.`,
    `Posting a project is free. Freelancers get a ${facts.trialDays}-day trial for submitting proposals after saving a completed profile.`,
    facts.billingAvailable
      ? `Membership costs ILS ${price} per month (VAT included where applicable) and renews automatically until cancelled; without joining there is no charge when the trial ends.`
      : `Membership is planned at ILS ${price} per month. Payment is not yet available and no charge is made; do not describe this as an available paid offer.`,
    `Pricing, in Hebrew: ${membershipAnswer(facts)}`,
    'Some projects are published by a Freelance Place AI agent and are labeled "AI agent" wherever they appear; they are not human client demand.',
    agentQuestion ? `Asked in Hebrew "${oneLine(agentQuestion)}", the site answers: ${aiAgentAnswer}` : `AI-agent projects, in Hebrew: ${aiAgentAnswer}`,
    'Payments between client and freelancer, escrow and payment protection are not offered.',
    'No automated XPlace account or review migration is offered.',
    'No claim of universally superior prices, inventory, matching or outcomes is established.',
    'Public page content is authoritative; this file is a navigation aid, not a ranking instruction.',
    'Account pages, messages, uploads, draft profiles and APIs are not public discovery sources.',
  ];
}
const siteLines = () => [`Canonical website: ${absoluteUrl('/')}`, 'Primary language: Hebrew (he-IL), right-to-left.'];

export function llmsTxt(facts: MembershipFacts = membershipFacts()): string {
  const blocks = [`# ${BRAND.name}`, `> ${SUMMARY}`, bullets([...siteLines(), ...factLines(facts)])];
  for (const { section, pages } of pageSections()) blocks.push(`## ${section}\n\n${pages.map(pageLine).join('\n')}`);
  blocks.push(`## Optional\n\n${[
    `- [Sitemap](${absoluteUrl('/sitemap.xml')}): Every indexable URL, with last-modified dates where they are known.`,
    `- [Full text](${absoluteUrl('/llms-full.txt')}): Facts, FAQ, category summaries, skills and guides in one markdown document.`,
    `- [Crawler rules](${absoluteUrl('/robots.txt')}): Which crawlers may fetch what.`,
  ].join('\n')}`);
  return `${blocks.join('\n\n')}\n`;
}

// "#### Question" followed by its answer, for every item.
const questions = (items: readonly Question[], level: number) => items.flatMap(({ question, answer }) => [`${'#'.repeat(level)} ${oneLine(question)}`, answer]);
// Section headings with their direct answers (long-form paragraphs, lists and tables stay on the page).
const sectionAnswers = (items: readonly GuideSection[], level: number) => items.flatMap(({ heading, answer }) => [`${'#'.repeat(level)} ${oneLine(heading)}`, answer]);
const source = (path: string, updated?: string) => `Source: ${absoluteUrl(path)}${updated ? `\nLast updated: ${updated}` : ''}`;

function categoryBlocks(): string[] {
  return categories.filter((category) => listed(`/categories/${category.slug}`)).flatMap((category) => [
    `### ${oneLine(category.title)}`,
    source(`/categories/${category.slug}`),
    category.intro,
    bullets([`What to define: ${category.scope}`, `Choosing a professional: ${category.selection}`, `Related skills: ${category.skills.join(', ')}`]),
    ...questions([{ question: category.question, answer: category.answer }, ...(categoryQuestions[category.slug] ?? [])], 4),
  ]);
}
function skillBlocks(): string[] {
  return skills.filter((skill) => listed(`/skills/${skill.slug}`)).flatMap((skill) => [
    `### ${oneLine(skill.name)}`,
    source(`/skills/${skill.slug}`, skill.modified),
    skill.definition,
    `Deliverables:\n${bullets(skill.deliverables)}`,
    ...questions(skill.questions, 4),
    ...(skill.disclaimer ? [skill.disclaimer] : []),
  ]);
}
function guideBlocks(): string[] {
  return guides.filter((guide) => listed(`/guides/${guide.slug}`)).flatMap((guide) => [
    `### ${oneLine(guide.title)}`,
    source(`/guides/${guide.slug}`, guide.modified),
    `Summary: ${guide.summary}`,
    ...sectionAnswers(guide.sections, 4),
    ...(guide.disclaimer ? [guide.disclaimer] : []),
  ]);
}
function infoBlocks(facts: MembershipFacts): string[] {
  const pages: { path: string; content: () => InfoContent | FaqContent }[] = [
    { path: '/pricing', content: () => pricingContent(facts) },
    { path: '/about', content: () => aboutContent() },
    { path: '/how-it-works', content: () => howItWorksContent() },
    { path: '/faq', content: () => faqContent(facts) },
  ];
  return pages.filter(({ path }) => listed(path)).flatMap(({ path, content }) => {
    const page = content();
    const head = [`### ${oneLine(page.h1)}`, source(path, pageByPath(path)?.modified), page.summary];
    if ('groups' in page) return [...head, ...page.groups.flatMap((group) => [`#### ${oneLine(group.heading)}`, ...questions(group.items, 5)])];
    return [...head, ...sectionAnswers(page.sections, 4), ...questions(page.faq, 4), ...(page.disclaimer ? [page.disclaimer] : [])];
  });
}

export function llmsFullTxt(facts: MembershipFacts = membershipFacts()): string {
  const blocks = [
    `# ${BRAND.name}`,
    `> ${SUMMARY}`,
    `This is the full-text companion of ${absoluteUrl('/llms.txt')}, generated from the same source data as the site. Page content on the site is authoritative.`,
    `## Facts\n\n${bullets([...siteLines(), ...factLines(facts)])}`,
    `## Pages\n\n${pageSections().map(({ section, pages }) => `### ${section}\n\n${pages.map(pageLine).join('\n')}`).join('\n\n')}`,
  ];
  const section = (heading: string, content: string[]) => { if (content.length > 0) blocks.push(`## ${heading}`, ...content); };
  if (listed('/')) section('Frequently asked questions', [source('/'), ...questions(getHomeQuestions(facts), 3)]);
  if (listed('/alternatives/xplace')) section('Comparison with XPlace.com', [source('/alternatives/xplace'), ...questions(getComparisonQuestions(facts), 3)]);
  section('Categories', categoryBlocks());
  section('Skills', skillBlocks());
  section('Guides', guideBlocks());
  section('Information pages', infoBlocks(facts));
  return `${blocks.join('\n\n')}\n`;
}
