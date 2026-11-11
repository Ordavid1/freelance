// Error type and HTTP mapping shared by the importer core and the import API routes.
// Isomorphic: no server-only imports.
import type { XPlaceImportErrorCode } from './types';

export const IMPORT_ERROR_STATUS: Record<XPlaceImportErrorCode, number> = {
  IMPORT_DISABLED: 503,
  INVALID_URL: 400,
  ATTESTATION_REQUIRED: 400,
  INVALID_PAYLOAD: 400,
  NOT_FOUND: 404,
  NOT_ENOUGH_DATA: 422,
  UPSTREAM_UNAVAILABLE: 502,
  RATE_LIMITED: 429,
};

export const IMPORT_ERROR_MESSAGE: Record<XPlaceImportErrorCode, string> = {
  IMPORT_DISABLED: 'ייבוא מ־XPlace עדיין לא זמין.',
  INVALID_URL: 'הקישור אינו קישור תקין לפרופיל או לפרויקט ב־XPlace.',
  ATTESTATION_REQUIRED: 'יש לאשר שהתוכן שלכם או שאתם מורשים לייבא אותו.',
  INVALID_PAYLOAD: 'המידע שנקלט מהתוסף אינו תקין. נסו לייבא שוב.',
  NOT_FOUND: 'לא מצאנו את הדף ב־XPlace. בדקו את הקישור ושהדף ציבורי.',
  NOT_ENOUGH_DATA: 'לא מצאנו בדף מספיק מידע ציבורי לייבוא.',
  UPSTREAM_UNAVAILABLE: 'XPlace לא הגיבה כרגע. נסו שוב בעוד כמה דקות.',
  RATE_LIMITED: 'בוצעו יותר מדי ייבואים. המתינו ונסו שוב.',
};

export class ImportError extends Error {
  readonly code: XPlaceImportErrorCode;
  /** Set for RATE_LIMITED so the response can carry Retry-After. */
  readonly retryAfterSeconds?: number;
  constructor(code: XPlaceImportErrorCode, retryAfterSeconds?: number) {
    super(code);
    this.name = 'ImportError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The JSON error response every import route returns for an ImportError. */
export function importErrorResponse(error: ImportError): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (error.code === 'RATE_LIMITED') headers['Retry-After'] = String(Math.max(1, Math.ceil(error.retryAfterSeconds ?? 30)));
  return Response.json({ code: error.code, error: IMPORT_ERROR_MESSAGE[error.code] }, { status: IMPORT_ERROR_STATUS[error.code], headers });
}
