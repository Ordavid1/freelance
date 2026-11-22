// Data of the generated share card `/{handle}/opengraph-image` (pure module). A card exists only for a live headhunter:
// the handle format is checked before any read, and the record goes through `resolveMinisite`, the same decision the
// page makes, so a card can never be rendered for a handle the page answers 404 or redirects.
import { summarize } from '../seo/site.ts';
import { resolveMinisite, type MinisiteDeps } from './minisite.ts';
import { headhunterInitials, openProjectsLabel } from './presentation.ts';
import { isHandleFormat } from './handle.ts';
import { minisiteDisplay } from './urls.ts';

export const HEADHUNTER_CARD_NAME_MAX = 30;

export type HeadhunterCard = {
  /** Display name, clamped. Plain text: Satori renders it as text, never as markup. */
  name: string;
  initials: string;
  /** "6 פרויקטים פתוחים לפרילנסרים" (no count when nothing is open). */
  line: string;
  /** The page address without scheme, from `minisiteDisplay`. */
  display: string;
};

export function cardLine(openProjects: number): string {
  return openProjects >= 1 ? `${openProjectsLabel(openProjects)} לפרילנסרים` : 'פרויקטים לפרילנסרים';
}

/** Null (answer 404) for a malformed, unknown, retired, not-live or feature-off handle. */
export async function headhunterCard(rawHandle: unknown, deps: MinisiteDeps): Promise<HeadhunterCard | null> {
  if (typeof rawHandle !== 'string' || !isHandleFormat(rawHandle)) return null;
  const result = await resolveMinisite(rawHandle, undefined, deps);
  if (result.kind !== 'page' || !result.state.live) return null;
  const name = summarize(result.view.displayName, HEADHUNTER_CARD_NAME_MAX);
  return { name, initials: headhunterInitials(result.view.displayName), line: cardLine(result.projects.openCount), display: minisiteDisplay(result.view.handle) };
}
