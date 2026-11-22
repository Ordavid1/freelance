// The decision emails to a headhunter (pure: builds subject and bodies, sends nothing). Content is limited to the page name,
// the minisite or editor link and the moderator's reason; no contact details, counters or internal flags. Links come from
// minisiteUrl and absoluteUrl, so the origin is never hard-coded here.
import { absoluteUrl, SITE_NAME } from '../seo/site.ts';
import { HEADHUNTER_EDITOR_PATH } from './constants.ts';
import { TRIAL_STATUS } from './editor-copy.ts';
import type { ModerationAction } from './moderation.ts';
import { minisiteUrl } from './urls.ts';

export type DecisionMail = { subject: string; text: string; html: string };
/** `trial`: an approved fast-track page that has not reached the threshold yet (the 40-hour window is running). */
export type DecisionMailInput = { action: ModerationAction; handle: string; displayName: string; reason?: string; trial?: boolean };

/** The decisions that email the owner. suspend and reinstate are deliberately silent here. */
export const MAILED_ACTIONS: readonly ModerationAction[] = ['approve', 'reject', 'request-changes'];

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

export function buildDecisionMail(input: DecisionMailInput): DecisionMail | null {
  if (!MAILED_ACTIONS.includes(input.action)) return null;
  const name = oneLine(input.displayName);
  const reason = oneLine(input.reason ?? '');
  const editor = absoluteUrl(HEADHUNTER_EDITOR_PATH);

  let subject: string;
  let lines: string[];
  let link: { url: string; label: string };
  if (input.action === 'approve') {
    const page = minisiteUrl(input.handle);
    subject = `עמוד הסוכנות שלכם ב־${SITE_NAME} אושר`;
    lines = [
      `העמוד של ${name} אושר והוא פעיל.`,
      'התג עם שם הסוכנות מופיע עכשיו על הפרויקטים הפתוחים שלכם.',
      'אפשר לשתף את הקישור לעמוד עם מועמדים ולקוחות, למשל בפרופיל הלינקדאין, בחתימת המייל ובהודעות גיוס.',
      ...(input.trial ? [TRIAL_STATUS.mailLine] : []),
    ];
    link = { url: page, label: 'לעמוד הסוכנות' };
  } else if (input.action === 'request-changes') {
    subject = 'נדרשים שינויים בעמוד הסוכנות שלכם';
    lines = [`בדקנו את הבקשה של ${name} ונדרשים בה שינויים לפני הפרסום.`, ...(reason ? [`הסיבה: ${reason}`] : []), 'אחרי העדכון ושמירה, הבקשה חוזרת לבדיקה.'];
    link = { url: editor, label: 'לעריכת העמוד' };
  } else {
    subject = 'הבקשה לעמוד הסוכנות לא אושרה';
    lines = [`הבקשה של ${name} לעמוד סוכנות לא אושרה.`, ...(reason ? [`הסיבה: ${reason}`] : []), 'אם לדעתכם מדובר בטעות, אפשר לפנות אלינו דרך צ׳אט התמיכה באתר.'];
    link = { url: editor, label: 'לעמוד ההגדרות' };
  }

  const text = `שלום,\n\n${lines.join('\n\n')}\n\n${link.label}: ${link.url}\n\n${SITE_NAME}`;
  const html = `<div dir="rtl" lang="he" style="font-family:Arial,sans-serif;color:#17263a;max-width:600px;margin:auto"><h2>${escapeHtml(subject)}</h2><p>שלום,</p>${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}<p><a href="${escapeHtml(link.url)}" style="color:#145a4e;font-weight:bold">${escapeHtml(link.label)}</a></p><p style="color:#69766f">${escapeHtml(SITE_NAME)}</p></div>`;
  return { subject, text, html };
}
