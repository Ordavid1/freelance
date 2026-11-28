// Single source for a project's employment type: engaged as a freelancer (the product's default and the value of
// every project created before this field existed) or hired as an employee. Free of server-only code, so the
// validation, the readers, the feed filter and the UI all share one definition.
export const EMPLOYMENT_TYPES = ['freelance', 'employee'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const DEFAULT_EMPLOYMENT_TYPE: EmploymentType = 'freelance';

/** The Hebrew label of each type, used by the composer, the feed filter and the card label. */
export const EMPLOYMENT_LABELS: Record<EmploymentType, string> = { freelance: 'פרילנס', employee: 'שכיר' };

/** Feed filter value: every type, or one of them. */
export type EmploymentFilter = 'all' | EmploymentType;
export const EMPLOYMENT_FILTER_ALL_LABEL = 'הכול';
export const EMPLOYMENT_FIELD_LABEL = 'סוג העסקה';
export const EMPLOYMENT_ERROR = 'סוג ההעסקה אינו תקין.';

export const isEmploymentType = (value: unknown): value is EmploymentType => typeof value === 'string' && (EMPLOYMENT_TYPES as readonly string[]).includes(value);

/** Read side: a stored value that is missing or unknown is a freelance project, so old documents need no migration. */
export const employmentTypeOf = (project: { employmentType?: unknown }): EmploymentType => (isEmploymentType(project.employmentType) ? project.employmentType : DEFAULT_EMPLOYMENT_TYPE);

/** Employee jobs take a plain application message: no quote, delivery time or pricing model. */
export const requiresQuote = (type: EmploymentType) => type === 'freelance';
export const APPLICATION_COPY: Record<EmploymentType, { heading: string; submit: string; sent: string; placeholder: string; hint: string; offerLabel: string; fieldLabel: string }> = {
  freelance: { heading: 'ההצעה שלך מתחילה כאן', submit: 'שליחת הצעה', sent: 'ההצעה נשלחה ונשמרה בפרויקט.', placeholder: 'מה אהבת בפרויקט, ומה תרצה/י ליצור יחד?', hint: 'ההצעה תישלח לבעל/ת הפרויקט לאחר אישור.', offerLabel: 'ההצעה ששלחת', fieldLabel: 'כמה מילים על הגישה שלך' },
  employee: { heading: 'הגשת מועמדות', submit: 'שליחת מועמדות', sent: 'המועמדות נשלחה ונשמרה בפרויקט.', placeholder: 'ספרו בקצרה על הניסיון שלכם ולמה המשרה מתאימה לכם.', hint: 'המועמדות תישלח למפרסם/ת המשרה לאחר אישור.', offerLabel: 'המועמדות ששלחת', fieldLabel: 'כמה מילים עליכם ועל הניסיון שלכם' },
};
