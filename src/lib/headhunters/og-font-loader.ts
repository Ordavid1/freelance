import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Heebo (SIL Open Font License) carries the Hebrew and Latin glyphs Satori's default font lacks. Only ttf/otf/woff work
// in Satori, so the woff2 files next/font serves cannot be reused. The app runs from the repository tree (next start).
const FONT_DIR = join(process.cwd(), 'src', 'lib', 'headhunters', 'og-fonts');
export type CardFont = { name: string; data: Buffer; weight: 700 | 800; style: 'normal' };

let fonts: Promise<CardFont[]> | undefined;
export function loadCardFonts(): Promise<CardFont[]> {
  const loading = (fonts ??= Promise.all(([['Heebo-Bold.ttf', 700], ['Heebo-ExtraBold.ttf', 800]] as const).map(async ([file, weight]): Promise<CardFont> => (
    { name: 'Heebo', data: await readFile(join(FONT_DIR, file)), weight, style: 'normal' }))));
  loading.catch(() => { if (fonts === loading) fonts = undefined; });
  return loading;
}
