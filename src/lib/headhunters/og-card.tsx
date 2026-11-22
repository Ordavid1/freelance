// The 1200x630 share card (Satori element). Colours and logo are the platform card's (src/app/opengraph-image.tsx);
// the layout is the approved mockup: right-aligned Hebrew, a lime-on-ink pill with the page address at the bottom.
// Satori has no bidirectional text or right-to-left flex layout, so the Hebrew strings are put in visual order with
// `toVisualRtl`, rows list the right-hand item first by hand, and every text is a single unwrapped line.
import type { HeadhunterCard } from './og.ts';
import { toVisualRtl } from './visual-text.ts';

const INK = '#151719';
const LIME = '#CEEF00';
const CREAM = '#F6F5EF';
const MUTED = '#4b5258';
/** Width of the text column beside the 200px initials block, inside the 72px side padding. */
const TEXT_WIDTH = 790;

/** Largest size (up to 104px) at which the name still fits the text column on one line. */
export function nameSize(name: string) {
  return Math.max(44, Math.min(104, Math.floor(TEXT_WIDTH / (Math.max(1, Array.from(name).length) * 0.6))));
}

const oneLine = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;

export function HeadhunterCardElement({ card }: { card: HeadhunterCard }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', background: CREAM, color: INK, padding: '56px 72px', fontFamily: 'Heebo' }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
        <div style={{ display: 'flex', fontSize: 44, fontWeight: 700, letterSpacing: -1, marginRight: 20 }}>Freelance Place</div>
        <svg width="84" height="84" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill={LIME} /><g transform="translate(20 20) scale(0.88)" fill={INK}><path d="M22 0H80V20H22V72H0V22ZM66 30H100V100H22V80H62L80 50H66Z" /><path d="M36 38H56V58H36Z" /></g></svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: TEXT_WIDTH, marginRight: 44 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', maxWidth: '100%', fontSize: nameSize(card.name), fontWeight: 800, lineHeight: 1.15, letterSpacing: -1, ...oneLine }}>{toVisualRtl(card.name)}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', maxWidth: '100%', fontSize: 44, fontWeight: 700, color: MUTED, marginTop: 14, ...oneLine }}>{toVisualRtl(card.line)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 200, height: 200, borderRadius: 50, background: INK, color: LIME, fontSize: 92, fontWeight: 700, flexShrink: 0 }}>{toVisualRtl(card.initials)}</div>
      </div>
      <div style={{ display: 'flex', background: INK, color: LIME, borderRadius: 999, padding: '12px 34px', fontSize: 38, fontWeight: 700, ...oneLine }}>{card.display}</div>
    </div>
  );
}
