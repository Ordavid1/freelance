// Visible Hebrew dates for bylines and source check dates. The ISO value always stays in
// <time dateTime>, so the text people read and the date machines read cannot disagree.
// Pure module: no Intl/ICU dependency, so output is identical on every runtime.
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// '2026-11-10' -> '10 בנובמבר 2026'. A value that is not a real calendar date is returned unchanged.
export function formatHebrewDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return iso;
  return `${day} ב${MONTHS[month - 1]} ${year}`;
}
