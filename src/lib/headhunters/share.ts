import { absoluteUrl, summarize } from '../seo/site.ts';
import { HEADHUNTER_LIMITS } from './constants.ts';
import { minisitePath } from './urls.ts';
import { openProjectsLabel } from './presentation.ts';

export type HeadhunterShare = {
  title: string;
  description: string;
  image: { kind: 'custom'; url: string } | { kind: 'generated'; path: string };
};

function clamp(value: string | undefined, max: number) {
  return typeof value === 'string' ? summarize(value, max) : '';
}

/** Share metadata with an independent fallback per field, so the page and its image route cannot diverge. */
export function resolveHeadhunterShare(
  input: { displayName: string; handle: string; tagline?: string; openProjects: number; share?: { title?: string; description?: string; imagePath?: string } },
  siteName: string,
): HeadhunterShare {
  const custom = input.share ?? {};
  const name = input.displayName.trim();
  const title = clamp(custom.title, HEADHUNTER_LIMITS.shareTitle) || clamp(`${name} | ${siteName}`, HEADHUNTER_LIMITS.shareTitle);

  const tagline = (input.tagline ?? '').trim().replace(/[\s.!?,;:]+$/u, '');
  const open = openProjectsLabel(input.openProjects);
  const generated = tagline
    ? input.openProjects >= 1 ? `${tagline} · ${open}` : tagline
    : `פרויקטים של ${name} ב־${siteName}: ${open}.`;
  const description = clamp(custom.description, HEADHUNTER_LIMITS.shareDescription) || clamp(generated, HEADHUNTER_LIMITS.shareDescription);

  // A custom image is always one we stored and re-encoded ourselves, served from our own origin: never a hotlinked URL.
  const imagePath = typeof custom.imagePath === 'string' ? custom.imagePath.trim() : '';
  const image: HeadhunterShare['image'] = imagePath.startsWith('/') && !imagePath.startsWith('//')
    ? { kind: 'custom', url: absoluteUrl(imagePath) }
    : { kind: 'generated', path: `${minisitePath(input.handle)}/opengraph-image` };
  return { title, description, image };
}
