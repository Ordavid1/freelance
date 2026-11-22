// Satori (next/og) lays text out in logical order, left to right, with no bidirectional algorithm, so Hebrew would come
// out mirrored. `toVisualRtl` returns the string in the order it must be drawn left to right for a right-to-left
// paragraph (a simplified UAX #9: strong Hebrew/Arabic runs are reversed, Latin letters and digits keep their order,
// neutrals take the surrounding direction, or the paragraph's when the neighbours differ). Pure module.

type Kind = 'R' | 'L' | 'N';

const RTL_CHAR = /[֐-׿؀-ۿݐ-ݿיִ-ﭏﭐ-﷿ﹰ-﻿]/u;
const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' };

function kindOf(char: string): Kind {
  if (RTL_CHAR.test(char)) return 'R';
  return /[\p{L}\p{Nd}]/u.test(char) ? 'L' : 'N';
}

/** Characters grouped so a base letter keeps its combining marks (niqqud) when a run is reversed. */
function clusters(text: string): string[] {
  const result: string[] = [];
  for (const char of Array.from(text)) {
    if (/\p{M}/u.test(char) && result.length > 0) result[result.length - 1] += char;
    else result.push(char);
  }
  return result;
}

export function toVisualRtl(text: string): string {
  const chars = clusters(text.normalize('NFC'));
  const strong = chars.map((cluster) => kindOf(Array.from(cluster)[0]));
  // Resolve neutrals: between two equal strong kinds they join them, otherwise they follow the paragraph (RTL).
  const resolved: ('R' | 'L')[] = strong.map((kind) => (kind === 'N' ? 'R' : kind));
  for (let index = 0; index < chars.length; index++) {
    if (strong[index] !== 'N') continue;
    let start = index;
    while (index + 1 < chars.length && strong[index + 1] === 'N') index++;
    const before = start > 0 ? strong[start - 1] : 'N';
    const after = index + 1 < chars.length ? strong[index + 1] : 'N';
    const kind: 'R' | 'L' = before === 'L' && after === 'L' ? 'L' : 'R';
    for (; start <= index; start++) resolved[start] = kind;
  }
  const runs: { kind: 'R' | 'L'; text: string[] }[] = [];
  chars.forEach((cluster, index) => {
    const kind = resolved[index];
    const last = runs.at(-1);
    if (last && last.kind === kind) last.text.push(cluster);
    else runs.push({ kind, text: [cluster] });
  });
  return runs.reverse().map((run) => (run.kind === 'R'
    ? run.text.reverse().map((cluster) => MIRROR[cluster] ?? cluster).join('')
    : run.text.join(''))).join('');
}
