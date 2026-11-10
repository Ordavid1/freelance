// Visible Hebrew dates for bylines, source check dates and listings. The ISO value always stays
// in <time dateTime>, so the text people read and the date machines read cannot disagree.
// Month names are written out here instead of coming from the runtime's ICU data, so the server
// renders the same text everywhere. Pure module.
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const TIME_ZONE = 'Asia/Jerusalem';

// '2026-11-10' -> '10 בנובמבר 2026'. A value that is not a real calendar date is returned unchanged.
export function formatHebrewDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return iso;
  return `${day} ב${MONTHS[month - 1]} ${year}`;
}

// The calendar day (YYYY-MM-DD) of a timestamp in Israel, where the product is used, so a
// project published late in the evening is not shown with the previous UTC day. Falls back to
// the UTC day if the runtime has no time zone data.
export function israelDate(millis: number | undefined): string | undefined {
  if (typeof millis !== 'number' || !Number.isFinite(millis)) return undefined;
  const instant = new Date(millis);
  if (Number.isNaN(instant.getTime())) return undefined;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
    const part = (type: string) => parts.find((item) => item.type === type)?.value;
    const year = part('year'); const month = part('month'); const day = part('day');
    if (year && month && day) return `${year.padStart(4, '0')}-${month}-${day}`;
  } catch { /* fall through to UTC */ }
  return instant.toISOString().slice(0, 10);
}
