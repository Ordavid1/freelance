// Content and grouping for the /guides index. Every guide page in the registry is listed, whether it
// is authored data (guides/*.ts) or a hand-built page such as /guides/project-brief, so the index
// cannot miss a guide. Pure module: no server-only imports.
import type { Guide, SeoPage } from './types';

export type GuideAudience = Guide['audience'];
export type GuideListItem = { path: string; title: string; summary: string; audience: GuideAudience; modified?: string };
export type GuideGroup = { audience: GuideAudience; heading: string; description: string; items: GuideListItem[] };

export const guidesIndexIntro = {
  h1: 'מדריכים לשכירת פרילנסרים ולעבודה עצמאית',
  summary: 'אוסף מדריכים מעשיים בעברית לעבודה עם פרילנסרים: ללקוחות שמגדירים פרויקט ומשווים הצעות, ולפרילנסרים שמתמחרים וכותבים הצעה. כל מדריך נפתח בתשובה קצרה ומציג את תאריך העדכון שלו.',
};

// Display order of the audience groups; a group with no guide is not rendered.
const GROUPS: readonly Omit<GuideGroup, 'items'>[] = [
  { audience: 'clients', heading: 'מדריכים ללקוחות', description: 'איך מגדירים פרויקט, משווים הצעות ובוחרים פרילנסר.' },
  { audience: 'freelancers', heading: 'מדריכים לפרילנסרים', description: 'איך מתמחרים פרויקט, כותבים הצעה ומתנהלים מול לקוחות.' },
  { audience: 'both', heading: 'מדריכים ללקוחות ולפרילנסרים', description: 'נושאים שחשובים לשני הצדדים בפרויקט.' },
];

// Hand-built guide pages are not part of the guide data, so their audience is declared here.
// Anything unlisted is treated as relevant to both sides.
const handBuiltAudience: Record<string, GuideAudience> = { '/guides/project-brief': 'clients' };

export function guideListItems(pages: readonly SeoPage[], authored: readonly Guide[]): GuideListItem[] {
  const bySlug = new Map(authored.map((guide) => [`/guides/${guide.slug}`, guide]));
  return pages
    .filter((page) => page.kind === 'guide' && page.indexable !== false)
    .map((page) => {
      const guide = bySlug.get(page.path);
      return { path: page.path, title: page.title, summary: guide?.summary ?? page.description, audience: guide?.audience ?? handBuiltAudience[page.path] ?? 'both', modified: page.modified };
    });
}

export function guideGroups(items: readonly GuideListItem[]): GuideGroup[] {
  return GROUPS
    .map((group) => ({ ...group, items: items.filter((item) => item.audience === group.audience) }))
    .filter((group) => group.items.length > 0);
}

// The hub changes whenever a guide changes, so its date is the newest guide date (never older than the hub's own).
export function newestDate(floor: string, dates: readonly string[]): string {
  return dates.reduce((latest, date) => (date > latest ? date : latest), floor);
}
