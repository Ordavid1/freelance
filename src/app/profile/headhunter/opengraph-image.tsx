import { ImageResponse } from 'next/og';
import { HEADHUNTER_EDITOR_PATH } from '@/lib/headhunters/constants';
import { LandingCardElement } from '@/lib/headhunters/landing-card';
import { loadCardFonts } from '@/lib/headhunters/og-font-loader';
import { LANDING } from '@/lib/seo/headhunter-content';
import { SITE_URL } from '@/lib/seo/site';

// The share card of the public agency-page landing, used as its og:image and twitter:image (see shareImage in the registry).
// It carries no per-request data, so it is generated once like the platform card at /opengraph-image. The same URL is public
// for crawlers and link previews (signedOutPublicPaths in lib/seo/site.ts); the proxy sends noindex only with a session cookie.
export const alt = 'Freelance Place';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    <LandingCardElement headline={LANDING.card.headline} line={LANDING.card.line} address={`${new URL(SITE_URL).host}${HEADHUNTER_EDITOR_PATH}`} />,
    { ...size, fonts: await loadCardFonts() },
  );
}
