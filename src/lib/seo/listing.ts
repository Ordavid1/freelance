// Rules for listing projects on public pages (project index, skill pages, category pages
// and related projects), so every list orders and counts the same way. The lists receive only
// discoverable projects (see publication.ts). Pure module: no server-only imports.
type Listable = { slug: string; createdAt?: number };

// Newest first with the slug as a tie-breaker, so pagination and "related" lists are
// deterministic: the same data always produces the same order.
export function sortNewestFirst<T extends Listable>(projects: readonly T[]): T[] {
  return [...projects].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

export function projectPath(slug: string): string {
  return `/projects/${encodeURIComponent(slug)}`;
}

const projectNoun = (total: number) => total === 1 ? 'פרויקט פתוח אחד' : total === 2 ? 'שני פרויקטים פתוחים' : `${total} פרויקטים פתוחים`;

// "כרגע יש 3 פרויקטים פתוחים בתחום הזה." Real counts only: nothing is said when there are
// none (a zero would read as a failure). `place` carries the wording that must agree with the number.
export function projectCountSentence(total: number, place: { one: string; many: string }): string | undefined {
  if (!Number.isInteger(total) || total <= 0) return undefined;
  return `כרגע יש ${projectNoun(total)} ${total === 1 ? place.one : place.many}.`;
}

// For a paginated list: which projects this page shows and how many exist in total
// ("מוצגים 13–24 מתוך 27 פרויקטים פתוחים.").
export function projectRangeSentence(from: number, to: number, total: number): string | undefined {
  if (!Number.isInteger(total) || total <= 0) return undefined;
  const range = from === to ? `מוצג פרויקט ${from}` : `מוצגים ${from}–${to}`;
  return `${range} מתוך ${total} ${total === 1 ? 'פרויקט פתוח' : 'פרויקטים פתוחים'}.`;
}
