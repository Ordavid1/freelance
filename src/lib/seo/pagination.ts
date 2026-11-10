// Pagination for the public project index: a fixed page size, 1-based `?page=n` URLs and
// in-memory slicing of the list the data layer returns. Pure module.
export const PROJECTS_PAGE_SIZE = 12;

// The page a `page` query value asks for. Absent means page 1. Anything that is not a plain
// positive integer without leading zeros (0, -1, 2.5, 01, abc, a repeated parameter) is
// invalid and gives undefined, so the index never serves several URLs for the same page.
export function parsePageParam(value: string | readonly string[] | undefined): number | undefined {
  if (value === undefined) return 1;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,6}$/.test(value)) return undefined;
  return Number(value);
}

export type PageSlice<T> = {
  items: T[]; page: number; totalPages: number; total: number; size: number;
  // 1-based position of the first and last item shown (0 and 0 for an empty list).
  from: number; to: number;
};

// The requested page of `items`. An empty list still has one (empty) page; a page outside
// 1..totalPages gives undefined, which the route turns into a 404.
export function paginate<T>(items: readonly T[], page: number, size: number = PROJECTS_PAGE_SIZE): PageSlice<T> | undefined {
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  if (!Number.isInteger(page) || page < 1 || page > totalPages) return undefined;
  const start = (page - 1) * size;
  const slice = items.slice(start, start + size);
  return { items: slice, page, totalPages, total: items.length, size, from: slice.length ? start + 1 : 0, to: start + slice.length };
}

// Page 1 has no parameter: it is the canonical /projects. Every later page is its own URL.
export function projectsPagePath(page: number): string {
  return page <= 1 ? '/projects' : `/projects?page=${page}`;
}

// The page numbers a pager lists: the first and last page, the current page and its
// neighbours, with `null` marking a gap of two or more pages (a gap of one shows its number).
export function pageWindow(page: number, totalPages: number): (number | null)[] {
  const wanted = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const pages = [...wanted].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b);
  const result: (number | null)[] = [];
  pages.forEach((value, index) => {
    const previous = pages[index - 1];
    if (previous !== undefined) {
      if (value - previous === 2) result.push(previous + 1);
      else if (value - previous > 2) result.push(null);
    }
    result.push(value);
  });
  return result;
}
