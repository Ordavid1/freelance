// Rules for listing projects on public pages (project index, skill pages, category pages
// and related projects), so every list treats AI-agent projects, ordering and counts the
// same way. Pure module: no server-only imports.
import { AI_AGENT_BADGE } from '@/lib/projects/presentation';

type Listable = { slug: string; sample?: boolean; ownerKind?: string; createdAt?: number };

// Projects published by the AI agent carry the sample flag and the ai-agent owner kind.
// Every public list labels them "סוכן AI" and never presents them as human client demand.
export function isAiAgentProject(project: Pick<Listable, 'sample' | 'ownerKind'>): boolean {
  return project.sample === true || project.ownerKind === 'ai-agent';
}

// Discovery already applies the publication rules. This keeps built-in demo cards (sample
// projects without an AI-agent owner) out of any public list even if one slips through.
export function isPublicProject(project: Pick<Listable, 'sample' | 'ownerKind'>): boolean {
  return !project.sample || project.ownerKind === 'ai-agent';
}

export function publicProjects<T extends Pick<Listable, 'sample' | 'ownerKind'>>(projects: readonly T[]): T[] {
  return projects.filter(isPublicProject);
}

export function countAiAgentProjects(projects: readonly Pick<Listable, 'sample' | 'ownerKind'>[]): number {
  return projects.filter(isAiAgentProject).length;
}

// Newest first with the slug as a tie-breaker, so pagination and "related" lists are
// deterministic: the same data always produces the same order.
export function sortNewestFirst<T extends Listable>(projects: readonly T[]): T[] {
  return [...projects].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

export function projectPath(slug: string): string {
  return `/projects/${encodeURIComponent(slug)}`;
}

const label = `"${AI_AGENT_BADGE}"`;
const projectNoun = (total: number) => total === 1 ? 'פרויקט פתוח אחד' : total === 2 ? 'שני פרויקטים פתוחים' : `${total} פרויקטים פתוחים`;

// The sentence that discloses how many of the listed projects come from the AI agent.
function aiAgentClause(total: number, aiAgent: number): string {
  if (aiAgent <= 0) return '';
  if (total === 1) return `, והוא מסומן ${label}`;
  if (aiAgent >= total) return `, וכל אחד מהם מסומן ${label}`;
  return aiAgent === 1 ? `, מהם אחד מסומן ${label}` : `, מהם ${aiAgent} מסומנים ${label}`;
}

// "כרגע יש 3 פרויקטים פתוחים בתחום הזה, מהם אחד מסומן "סוכן AI"." Real counts only: nothing
// is said when there are none (a zero would read as a failure), and the AI-agent share is
// always disclosed. `place` carries the wording that must agree with the number.
export function projectCountSentence(total: number, aiAgent: number, place: { one: string; many: string }): string | undefined {
  if (!Number.isInteger(total) || total <= 0) return undefined;
  return `כרגע יש ${projectNoun(total)} ${total === 1 ? place.one : place.many}${aiAgentClause(total, Math.min(Math.max(aiAgent, 0), total))}.`;
}

// For a paginated list: which projects this page shows, how many exist in total and how many
// of the total come from the AI agent ("מוצגים 13–24 מתוך 27 פרויקטים פתוחים. 20 מהם מסומנים ...").
export function projectRangeSentence(from: number, to: number, total: number, aiAgentTotal: number): string | undefined {
  if (!Number.isInteger(total) || total <= 0) return undefined;
  const ai = Math.min(Math.max(aiAgentTotal, 0), total);
  const range = from === to ? `מוצג פרויקט ${from}` : `מוצגים ${from}–${to}`;
  const disclosure = ai === 0 ? ''
    : total === 1 ? ` הפרויקט מסומן ${label}.`
    : ai === total ? ` כל הפרויקטים מסומנים ${label}.`
    : ai === 1 ? ` אחד מהם מסומן ${label}.`
    : ` ${ai} מהם מסומנים ${label}.`;
  return `${range} מתוך ${total} ${total === 1 ? 'פרויקט פתוח' : 'פרויקטים פתוחים'}.${disclosure}`;
}
