// Headhunter UI copy (client-safe, no inline Hebrew strings in components).
import { SITE_NAME } from '../seo/site.ts';
import { HEADHUNTER_MIN_PROJECTS } from './constants.ts';
import type { HeadhunterKind } from './types.ts';

export const HEADHUNTER_KIND_LABEL: Record<HeadhunterKind, string> = {
  agency: 'סוכנות גיוס',
  independent: 'מגייס/ת עצמאי/ת',
};

export function headhunterTagLabel(name: string) {
  return `פרויקט של ${name}, לעמוד הסוכנות`;
}

export function openProjectsLabel(count: number) {
  if (count === 1) return 'פרויקט פתוח אחד';
  if (count >= 2) return `${count} פרויקטים פתוחים`;
  return 'אין פרויקטים פתוחים';
}

export function progressLabel(published: number) {
  return `${Math.max(0, Math.min(HEADHUNTER_MIN_PROJECTS, Math.floor(published) || 0))} מתוך ${HEADHUNTER_MIN_PROJECTS} פרויקטים`;
}

export function remainingLabel(published: number) {
  const remaining = Math.max(0, HEADHUNTER_MIN_PROJECTS - (Math.floor(published) || 0));
  if (remaining === 0) return 'עמדתם בדרישת הפרויקטים';
  if (remaining === 1) return 'עוד פרויקט אחד לפתיחת עמוד הסוכנות';
  return `עוד ${remaining} פרויקטים לפתיחת עמוד הסוכנות`;
}

export function HEADHUNTER_PAGE_NOTE(name: string) {
  return `העמוד מנוהל על ידי ${name}. ${SITE_NAME} בדקה את פרטי הסוכנות לפני הפרסום ואינה צד להתקשרות.`;
}

export const HEADHUNTER_EMPTY_OPEN = 'אין כרגע פרויקטים פתוחים';
export const HEADHUNTER_CLOSED_HEADING = 'נסגרו לאחרונה';
export const HEADHUNTER_OPEN_HEADING = 'פרויקטים פתוחים';
export const HEADHUNTER_MESSAGE_CTA = 'שליחת הודעה בפלטפורמה';
export const HEADHUNTER_ALL_PROJECTS = 'כל הפרויקטים';

export function headhunterMoreHeading(name: string) {
  return `עוד פרויקטים מ${name}`;
}
export const HEADHUNTER_STAT_OPEN = 'פרויקטים פתוחים';
export const HEADHUNTER_STAT_PUBLISHED = 'פורסמו באתר';
export const HEADHUNTER_SORT_NOTE = 'מהחדש לישן';
export const HEADHUNTER_CONTACT_LABEL = 'דרכי יצירת קשר';
export const HEADHUNTER_CLOSED_BADGE = 'נסגר';

/** Up to two initials for the logo block (the record has no uploaded logo yet): first letters of the first two words. */
export function headhunterInitials(name: string) {
  const letters = name.trim().split(/\s+/u).filter(Boolean).slice(0, 2).map((word) => Array.from(word.replace(/^[^\p{L}\p{N}]+/u, ''))[0] ?? '');
  const text = letters.join('');
  return (text || Array.from(name.trim())[0] || '?').toUpperCase();
}

/** The count line under the open-projects heading. */
export function openProjectsCountLine(count: number) {
  return count > 0 ? `${openProjectsLabel(count)} · ${HEADHUNTER_SORT_NOTE}` : '';
}
