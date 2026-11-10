// One list of every public page: titles, descriptions and dates live here, and the
// metadata, sitemap, footer and llms files all derive from it. A page is registered
// only together with its route. Pure module (no server-only imports).
import type { Metadata } from 'next';
import { legalUpdated } from '@/lib/legal/identity';
import { categories } from './categories';
import { guides } from './guides';
import { hubPages } from './hubs';
import { infoPages } from './info-pages';
import { skillCompleteness, skills } from './skills';
import { pageMetadata } from './site';
import type { SeoPage } from './types';

const corePages: SeoPage[] = [
  {
    path: '/', kind: 'home',
    title: 'Freelance Place — פרויקטים לפרילנסרים ופרסום פרויקט בחינם',
    description: 'Freelance Place מחבר פרילנסרים ועסקים סביב פרויקטים: פיתוח, עיצוב, כתיבה ווידאו. מרחב עבודה בעברית, פרופיל והצעות מחיר. הכירו אלטרנטיבה ל־XPlace.com.',
    llms: { section: 'Product', note: 'Product explanation, current public projects and FAQ.' },
  },
  {
    path: '/alternatives/xplace', kind: 'comparison',
    title: 'אלטרנטיבה ל־XPlace.com לפרילנסרים בישראל',
    description: 'השוואה מבוססת מקורות בין Freelance Place ל־XPlace.com: מחיר מנוי, התחייבות, ניסיון חינם ומהירות טעינה, עם תאריך בדיקה ושיטה גלויה.',
    modified: '2026-11-10',
    llms: { section: 'Comparisons', note: 'Dated, sourced comparison of membership price, commitment, free trial and page speed, with the method and the cited XPlace pages.' },
  },
  {
    path: '/guides/project-brief', kind: 'guide',
    title: 'איך כותבים בריף לפרויקט עם פרילנסר?',
    description: 'מדריך מעשי לכתיבת בריף לפרויקט: מטרה, תוצרים, היקף, תקציב, לוח זמנים וקריטריוני קבלה. כולל דוגמה לפרויקט אתר תדמית ורשימת בדיקה לפני פרסום.',
    published: '2026-11-08', modified: '2026-11-08',
    llms: { section: 'Guides', note: 'Practical scope, deliverables, budget and acceptance guidance.' },
  },
  {
    path: '/privacy', kind: 'legal',
    title: 'מדיניות פרטיות ועיבוד מידע אישי',
    description: 'איזה מידע מעובד ב־Freelance Place, מי מקבל אותו, כיצד משתמשים ב־AI ואיך לעיין במידע, לתקנו או לבקש מחיקה.',
    modified: legalUpdated,
    llms: { section: 'Legal', note: 'How personal data is processed.' },
  },
  {
    path: '/terms', kind: 'legal',
    title: 'תנאי שימוש: חשבון, פרויקטים והצעות',
    description: 'תנאי השימוש ב־Freelance Place: חשבונות, פרויקטים, הצעות, הודעות, כלי AI, זכויות בתוכן ומגבלות השירות.',
    modified: legalUpdated,
    llms: { section: 'Legal', note: 'Terms of use, membership and limits of the service.' },
  },
];

const categoryPages: SeoPage[] = categories.map((category) => ({
  path: `/categories/${category.slug}`, kind: 'category',
  title: category.title, description: category.metaDescription ?? category.intro,
  llms: { section: 'Categories', note: 'Category guidance and public projects.' },
}));

const guidePages: SeoPage[] = guides.map((guide) => ({
  path: `/guides/${guide.slug}`, kind: 'guide', title: guide.title, description: guide.description,
  published: guide.published, modified: guide.modified,
  llms: { section: 'Guides', note: guide.summary },
}));

// Only skills that pass the content quality gate are indexable.
const skillPages: SeoPage[] = skills.map((skill) => ({
  path: `/skills/${skill.slug}`, kind: 'skill', title: skill.title, description: skill.description,
  published: skill.published, modified: skill.modified, indexable: skillCompleteness(skill).complete,
  llms: { section: 'Skills', note: skill.definition },
}));

const pages: SeoPage[] = [...corePages, ...categoryPages, ...guidePages, ...skillPages, ...hubPages, ...infoPages];

export function allPages(): SeoPage[] { return pages; }
export function indexablePages(): SeoPage[] { return pages.filter((page) => page.indexable !== false); }
export function pageByPath(path: string): SeoPage | undefined { return pages.find((page) => page.path === path); }
export function requirePage(path: string): SeoPage {
  const page = pageByPath(path);
  if (!page) throw new Error(`No SEO page is registered for ${path}.`);
  return page;
}

// Next.js metadata for a registered page, so titles, descriptions and dates have one source.
export function metadataFor(path: string): Metadata {
  const page = requirePage(path);
  return pageMetadata(page.title, page.description, page.path, page.indexable !== false, {
    type: page.kind === 'guide' ? 'article' : 'website',
    published: page.published,
    modified: page.modified,
    absoluteTitle: page.kind === 'home',
  });
}
