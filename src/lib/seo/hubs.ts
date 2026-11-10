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
];
