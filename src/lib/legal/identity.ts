// Single source for who operates the service and when the legal texts last changed.
// Pure data: imported by the legal pages, public facts, structured data and the footer.
export const legalOperator = 'Aether AI Assimilation';
export const legalEmail = 'or@ailead.work';
export const legalUpdated = '2026-11-23';

const hebrewMonths = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
// '2026-11-17' -> '17 בנובמבר 2026'. The date printed on the legal pages comes from legalUpdated, so the two never disagree.
export function formatLegalDate(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${day} ב${hebrewMonths[month - 1]} ${year}`;
}
export const legalUpdatedLabel = formatLegalDate(legalUpdated);
