import { ImageResponse } from 'next/og';
import { HeadhunterCardElement } from '@/lib/headhunters/og-card';
import { headhunterCard } from '@/lib/headhunters/og';
import { loadCardFonts } from '@/lib/headhunters/og-font-loader';
import { minisiteDeps } from '@/lib/headhunters/server-deps';

// The share card of a live minisite. Anything else (malformed, unknown, retired, not live, feature off, a failed read)
// is a plain 404: the platform card is not served under a handle that does not exist.
export const alt = 'Freelance Place';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const dynamic = 'force-dynamic';

const NOT_FOUND = { status: 404, headers: { 'Cache-Control': 'no-store' } } as const;
export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  let card;
  try { card = await headhunterCard((await params).handle, minisiteDeps); }
  catch (error) { console.error('Headhunter share card unavailable', error instanceof Error ? error.name : 'Error'); return new Response(null, NOT_FOUND); }
  if (!card) return new Response(null, NOT_FOUND);
  return new ImageResponse(<HeadhunterCardElement card={card} />, {
    ...size,
    fonts: await loadCardFonts(),
    // Counts change and a suspended page must stop serving its card: short shared-cache lifetime, not the 1-year default.
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
