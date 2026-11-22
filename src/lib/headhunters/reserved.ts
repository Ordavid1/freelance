// Handles that can never be claimed. The route list is kept in sync with src/app and public/ by
// tests/headhunter-reserved.test.mjs, so a new top-level route fails CI until it is reserved here.

/** Every top-level segment the app or `public/` serves, lower-case. */
export const RESERVED_ROUTE_SEGMENTS: readonly string[] = [
  'about', 'alternatives', 'api', 'categories', 'faq', 'glossary', 'guides', 'how-it-works', 'membership', 'messages',
  'pricing', 'privacy', 'profile', 'projects', 'signin', 'skills', 'terms',
  'sitemap', 'robots', 'llms', 'llms-full', 'opengraph-image', 'twitter-image', 'icon', 'apple-icon', 'favicon', 'manifest',
  'freelance-place-logo', '_next', '__',
  // IndexNow key file in public/.
  '937d6e4c8033ee12864f2c5c27fcf898',
];

/** Own brand and marketplace names: rejected exactly, and also when a longer look-alike handle contains them. */
export const RESERVED_BRAND_WORDS: readonly string[] = [
  'freelance', 'freelance-place', 'freelanceplace', 'freelancer', 'freelancers', 'xplace', 'fiverr', 'upwork',
];

/** Platform words: always rejected. */
export const RESERVED_WORDS: readonly string[] = [
  'admin', 'administrator', 'support', 'help', 'contact', 'mail', 'email', 'www', 'app', 'static', 'assets', 'cdn', 'auth',
  'login', 'logout', 'signup', 'register', 'account', 'settings', 'billing', 'pay', 'payment', 'payments', 'checkout', 'invoice',
  'blog', 'news', 'jobs', 'job', 'hr', 'recruit', 'recruiters', 'recruiter', 'headhunter', 'headhunters', 'agency', 'agencies',
  'team', 'careers', 'career', 'status', 'security', 'root', 'null', 'undefined', 'home', 'search', 'explore', 'discover', 'new',
  'edit', 'dashboard', 'moderation', 'legal', 'docs', 'developer', 'developers', 'press', 'partners', 'about-us', 'contact-us',
  ...RESERVED_BRAND_WORDS,
];

/** Allowed, but flagged for manual review (the real company may apply). */
export const WATCHED_BRAND_TERMS: readonly string[] = [
  'google', 'facebook', 'meta', 'instagram', 'whatsapp', 'linkedin', 'microsoft', 'apple', 'amazon', 'wix', 'monday',
  'jobmaster', 'alljobs', 'drushim', 'gotfriends', 'ethosia', 'nisha', 'manpower', 'adecco', 'hays', 'randstad',
  'michaelpage', 'hunterhr', 'matrix', 'elbit', 'intel', 'nvidia',
];

const RESERVED = new Set<string>([...RESERVED_ROUTE_SEGMENTS, ...RESERVED_WORDS]);

/** Exact match against reserved routes and words. */
export function isReservedHandle(handle: string): boolean {
  return RESERVED.has(handle);
}
