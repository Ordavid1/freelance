import { guides } from './guides';
import { newestDate } from './guides-index';
import type { SeoPage } from './types';

// Informational pages (for example /pricing, /about, /faq) and the guides index. Add an entry only together with its route.
// Titles and descriptions never carry prices, trial lengths or billing state: those statements come from facts.ts on the page itself.
const CREATED = '2026-11-10';

export const infoPages: SeoPage[] = [
  {
    path: '/guides', kind: 'hub',
    title: 'מדריכים לשכירת פרילנסרים ולעבודה עצמאית',
    description: 'מדריכים מעשיים בעברית ללקוחות ולפרילנסרים: איך כותבים בריף, משווים הצעות, מתמחרים פרויקט ומסכמים תנאי עבודה. כל מדריך נפתח בתשובה ישירה.',
    // The index changes whenever a guide changes, so its date follows the newest guide.
    published: CREATED, modified: newestDate(CREATED, guides.map((guide) => guide.modified)),
    llms: { section: 'Guides', note: 'Index of all guides, grouped by audience: clients, freelancers and both.' },
  },
];
