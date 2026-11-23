// The 1200x630 share card of the public agency-page landing (/profile/headhunter): the platform card's colours and logo and the
// minisite card's right-aligned layout (og-card.tsx), with the landing's headline and one line under it. Satori has no
// bidirectional text or right-to-left flex layout, so the Hebrew strings are put in visual order with `toVisualRtl` and every
// text is a single unwrapped line; the headline therefore arrives already cut into lines. Pure module: no server-only imports.
import { toVisualRtl } from './visual-text.ts';

const INK = '#151719';
const LIME = '#CEEF00';
const CREAM = '#F6F5EF';
const MUTED = '#4b5258';
/** Width of the text block: the card minus its 72px side padding. */
const TEXT_WIDTH = 1056;

/** Largest size (up to 92px) at which the longest headline line still fits the text block on one line. */
export function headlineSize(lines: readonly string[]) {
  const longest = Math.max(1, ...lines.map((line) => Array.from(line).length));
  return Math.max(48, Math.min(92, Math.floor(TEXT_WIDTH / (longest * 0.6))));
}

const oneLine = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;

export function LandingCardElement({ headline, line, address }: { headline: readonly string[]; line: string; address: string }) {
  const size = headlineSize(headline);
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', background: CREAM, color: INK, padding: '56px 72px', fontFamily: 'Heebo' }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
        <div style={{ display: 'flex', fontSize: 44, fontWeight: 700, letterSpacing: -1, marginRight: 20 }}>Freelance Place</div>
        <svg width="84" height="84" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill={LIME} /><g transform="translate(20 20) scale(0.88)" fill={INK}><path d="M22 0H80V20H22V72H0V22ZM66 30H100V100H22V80H62L80 50H66Z" /><path d="M36 38H56V58H36Z" /></g></svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: '100%' }}>
        {headline.map((text) => (
          <div key={text} style={{ display: 'flex', justifyContent: 'flex-end', maxWidth: '100%', fontSize: size, fontWeight: 800, lineHeight: 1.18, letterSpacing: -1, ...oneLine }}>{toVisualRtl(text)}</div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end', maxWidth: '100%', fontSize: 42, fontWeight: 700, color: MUTED, marginTop: 24, ...oneLine }}>{toVisualRtl(line)}</div>
      </div>
      <div style={{ display: 'flex', background: INK, color: LIME, borderRadius: 999, padding: '12px 34px', fontSize: 38, fontWeight: 700, ...oneLine }}>{address}</div>
    </div>
  );
}
