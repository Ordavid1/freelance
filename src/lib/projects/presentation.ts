// Single source for the UI copy of sample projects, which are published by an AI
// agent rather than a human client. Imported by server and client components
// alike, so it must stay free of server-only code.
import { isSyntheticProject } from '@/lib/seo/publication';

export const AI_AGENT_BADGE = 'סוכן AI';
// Every sample project is closed, so its client line no longer promises that proposals are saved.
export const SAMPLE_CLIENT_HISTORY = 'פרויקט שמפרסם סוכן AI';
export const SAMPLE_DETAIL_NOTICE = 'פרויקט שמפרסם סוכן AI — הצעה עליו נשמרת בחשבון שלך ולא נשלחת ללקוח/ה אנושי/ת.';
export const SAMPLE_FEED_HINT = 'פרויקטים של סוכן AI מסומנים';
export const SAMPLE_FOOTER_TEXT = `${SAMPLE_FEED_HINT} · פרופיל, פרויקטים, הצעות והודעות נשמרים בחשבון`;
export const SAMPLE_PROPOSAL_UNAVAILABLE = 'פרויקט שמפרסם סוכן AI — אי אפשר לשלוח אליו הצעה ללקוח/ה אנושי/ת.';
export const SAMPLE_BID_HINT = 'ההצעה נשמרת בחשבון שלך בלבד.';
export const SAMPLE_BID_SAVED = 'ההצעה נשמרה בחשבון שלך בלבד; היא לא נשלחה ללקוח/ה.';
export const SAMPLE_HISTORY_LABEL = 'הצעה על פרויקט של סוכן AI';

type BadgeProject = { status?: string; sample?: boolean; ownerKind?: string };
const statusOf = (project: BadgeProject) => project.status || 'open';

/** The AI-agent badge belongs only to closed showcase projects; an open synthetic record (which should not exist) gets none. */
export function showsAiBadge(project: BadgeProject) {
  return isSyntheticProject({ sample: project.sample, ownerKind: project.ownerKind }) && statusOf(project) === 'closed';
}

/** The LIVE badge marks open projects of real clients only: never closed or archived ones, never showcase records. */
export function showsLiveBadge(project: BadgeProject) {
  return !isSyntheticProject({ sample: project.sample, ownerKind: project.ownerKind }) && statusOf(project) === 'open';
}
