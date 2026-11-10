import { skillCompleteness, skills } from './skills';
import type { SeoPage } from './types';

// The skills hub lists only skill pages that pass the quality gate, so it is indexable only
// when at least one exists, and it changes whenever a listed page does: its date is the
// latest `modified` among them, never an invented one.
const listedSkills = skills.filter((skill) => skillCompleteness(skill).complete);
const skillsModified = listedSkills.reduce<string | undefined>((latest, skill) => (!latest || skill.modified > latest ? skill.modified : latest), undefined);

// Hub pages (for example /skills or /projects). Add an entry only together with its route.
export const hubPages: SeoPage[] = [
  {
    path: '/skills', kind: 'hub',
    title: 'כישורים ושירותי פרילנסרים: מה לבדוק לפני שבוחרים',
    description: 'הסבר על כל כישור שאפשר לשכור אליו פרילנסר: מה העבודה כוללת, איך בוחרים נותן שירות, מה משפיע על המחיר ואילו פרויקטים פתוחים קשורים אליו.',
    indexable: listedSkills.length > 0,
    ...(skillsModified ? { modified: skillsModified } : {}),
    llms: { section: 'Skills', note: 'Index of skill pages: what each service includes, how to choose a freelancer and what drives the price.' },
  },
  {
    // Paginated as /projects?page=n: page 1 is this canonical URL and every later page is indexable on its own.
    path: '/projects', kind: 'hub', listsProjects: true,
    title: 'פרויקטים פתוחים לפרילנסרים בישראל',
    description: 'הפרויקטים הפתוחים ב־Freelance Place מהחדש לישן: פיתוח אתרים, עיצוב, כתיבה ווידאו. כל פרויקט נפתח לעמוד מלא עם תיאור, תקציב וכישורים.',
    llms: { section: 'Product', note: 'Crawlable index of open public projects, newest first, with category and skill links.' },
  },
];
