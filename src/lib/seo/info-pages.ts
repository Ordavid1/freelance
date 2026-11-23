import { HEADHUNTER_EDITOR_PATH, HEADHUNTER_LANDING_CARD_PATH } from '@/lib/headhunters/constants';
import { guides } from './guides';
import { newestDate } from './guides-index';
import type { SeoPage } from './types';

// Informational pages (for example /pricing, /about, /faq) and the guides index. Add an entry only together with its route.
// Titles and descriptions never carry prices, trial lengths or billing state: those statements come from facts.ts on the page itself.
const CREATED = '2026-11-10';
// Pages whose copy changed after publication carry the day of the change in `modified` (it drives lastmod and dateModified).
const REVISED = '2026-11-23';
// The agency-page landing was published later; bump `modified` below whenever its copy (headhunter-content.ts) changes.
const AGENCY_PAGE_PUBLISHED = '2026-11-23';

export const infoPages: SeoPage[] = [
  {
    path: '/how-it-works', kind: 'info',
    title: 'איך עובד Freelance Place: ללקוחות ולפרילנסרים',
    description: 'שני מסלולים: לקוחות מפרסמים פרויקט, מקבלים הצעות ומנהלים שיחה; פרילנסרים בונים פרופיל, מוצאים פרויקטים ושולחים הצעה רק אחרי אישור.',
    published: CREATED, modified: CREATED,
    llms: { section: 'Product', note: 'Step-by-step flows for clients and for freelancers, limited to features that exist today.' },
  },
  {
    path: '/pricing', kind: 'info',
    title: 'כמה עולה Freelance Place? פרסום, ניסיון וחברות',
    description: 'מה עולה פרסום פרויקט, מה כולל הניסיון לפרילנסרים ומה כוללת החברות: מחיר, חידוש וביטול, ומה אינו כלול. תשובה ישירה ושאלות נפוצות.',
    published: CREATED, modified: REVISED,
    llms: { section: 'Product', note: 'Cost of posting, the freelancer trial and the membership, generated from the live product rules.' },
  },
  {
    path: '/faq', kind: 'info',
    title: 'שאלות ותשובות על Freelance Place: לקוחות ופרילנסרים',
    description: 'תשובות קצרות לשאלות נפוצות: פרסום פרויקט, הגשת הצעות, חברות ותשלום, אמון ופרטיות. כל תשובה עומדת בפני עצמה.',
    published: CREATED, modified: REVISED,
    llms: { section: 'Product', note: 'Grouped questions and answers on posting, proposals, membership, trust and privacy.' },
  },
  {
    path: '/about', kind: 'info',
    title: 'אודות Freelance Place: מי מפעיל ואיך יוצרים קשר',
    description: 'מי מפעיל את Freelance Place, מי אחראי לתוכן ואיך מתקנים בו טעויות ואיך פונים אלינו. השירות עצמאי ואינו קשור ל־XPlace.',
    published: CREATED, modified: CREATED,
    llms: { section: 'Product', note: 'Who operates the service, independence from XPlace, editorial policy and contact.' },
  },
  {
    path: '/guides', kind: 'hub',
    title: 'מדריכים לשכירת פרילנסרים ולעבודה עצמאית',
    description: 'מדריכים מעשיים בעברית ללקוחות ולפרילנסרים: איך כותבים בריף, משווים הצעות, מתמחרים פרויקט ומסכמים תנאי עבודה. כל מדריך נפתח בתשובה ישירה.',
    // The index changes whenever a guide changes, so its date follows the newest guide.
    published: CREATED, modified: newestDate(CREATED, guides.map((guide) => guide.modified)),
    llms: { section: 'Guides', note: 'Index of all guides, grouped by audience: clients, freelancers and both.' },
  },
  {
    path: '/glossary', kind: 'info',
    title: 'מילון מונחים לעבודה עם פרילנסרים ופרויקטים',
    description: 'הגדרה קצרה וטיפ מעשי לכל מונח שנתקלים בו בפרויקט עם פרילנסר: בריף, היקף עבודה, אבן דרך, סבב תיקונים, זכויות שימוש ועוד.',
    published: CREATED, modified: CREATED,
    llms: { section: 'Guides', note: 'Plain-language definitions of terms used in freelance projects, each with a practical tip.' },
  },
  {
    // The public page of /profile/headhunter: signed-out visitors and crawlers get it, and a signed-in session gets the private
    // editor at the same URL (see signedOutPublicPaths in site.ts). The route answers 404 while the headhunter feature switch is off.
    path: HEADHUNTER_EDITOR_PATH, kind: 'info', needsHeadhunterSwitch: true, shareImage: HEADHUNTER_LANDING_CARD_PATH,
    title: 'פרסום פרויקטים לפרילנסרים: עמוד חינם לסוכנויות גיוס',
    description: 'סוכנויות גיוס, משרדי השמה, מגייסים ואנשי HR עצמאיים מפרסמים פרויקטים לפרילנסרים ב־Freelance Place ופותחים עמוד משלהם עם תג על כל פרויקט. השירות חינם.',
    published: AGENCY_PAGE_PUBLISHED, modified: AGENCY_PAGE_PUBLISHED,
    llms: { section: 'Product', note: 'Free agency page for recruiting agencies and independent recruiters: what it includes, how to open it, the two tracks, the rules and the limits.' },
  },
];
