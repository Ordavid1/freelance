// Shared SEO contracts. Every page, guide and skill module builds on these shapes,
// so they are changed only together with the registry and its invariant tests.
export type Question = { question: string; answer: string };
export type PageKind = 'home' | 'hub' | 'category' | 'skill' | 'guide' | 'comparison' | 'info' | 'legal';
export type SeoPage = {
  path: string;                 // starts with '/', no trailing slash except '/'
  kind: PageKind;
  title: string;                // <title> without brand suffix, 20-60 chars
  description: string;          // 70-165 chars
  published?: string;           // 'YYYY-MM-DD'
  modified?: string;            // 'YYYY-MM-DD', >= published; drives sitemap lastmod + dateModified
  indexable?: boolean;          // default true; false => noindex + excluded from sitemap/footer/llms
  llms?: { section: 'Product' | 'Guides' | 'Categories' | 'Skills' | 'Comparisons' | 'Legal'; note: string };
};
export type GuideSection = {
  id: string;                   // ASCII kebab-case anchor
  heading: string;              // H2
  answer: string;               // direct answer, 1-2 sentences, <= 320 chars
  paragraphs?: string[];
  list?: { ordered?: boolean; items: string[] };
  table?: { caption: string; columns: string[]; rows: string[][] };
};
export type Guide = {
  slug: string;                 // ASCII kebab-case -> /guides/<slug>
  title: string; description: string;
  audience: 'clients' | 'freelancers' | 'both';
  published: string; modified: string;
  summary: string;              // "בקיצור", <= 320 chars
  sections: GuideSection[];     // >= 4
  faq: Question[];              // >= 3
  related: string[];            // registry paths
  sources?: { name: string; url: string; checked: string }[];
  disclaimer?: string;
};
export type Skill = {
  slug: string;                 // ASCII -> /skills/<slug>
  name: string;                 // Hebrew display name
  aliases: string[];            // project-matching terms (case-insensitive; Hebrew + English variants)
  category: string;             // slug of a category in content.ts
  title: string; description: string;
  definition: string;           // answer-first: what it is, <= 280 chars
  whenNeeded: string;
  deliverables: string[];       // >= 4
  howToChoose: string[];        // >= 4
  priceDrivers: string[];       // >= 3, qualitative, no amounts
  questions: Question[];        // >= 3
  related: string[];            // other skill slugs
  guides?: string[];            // guide slugs
  published: string; modified: string;
};
