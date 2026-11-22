// Hebrew messages of the headhunter API beyond the input validation messages in validation.ts and handle.ts.
import { HEADHUNTER_RENAME_COOLDOWN_DAYS } from './constants.ts';

export const HEADHUNTER_API_ERRORS = {
  SIGN_IN: 'יש להתחבר כדי להמשיך.',
  FORBIDDEN: 'הבקשה נדחתה.',
  NOT_FOUND: 'לא נמצאה בקשה לעמוד סוכנות בחשבון הזה.',
  APPLICATIONS_CLOSED: 'ההרשמה לעמודי סוכנויות טרם נפתחה.',
  ALREADY_APPLIED: 'כבר הוגשה בקשה לעמוד סוכנות בחשבון הזה.',
  HANDLE_TAKEN: 'הכתובת הזו תפוסה או דומה מדי לכתובת קיימת. נסו כתובת אחרת.',
  HANDLE_SAME: 'זו כבר הכתובת הנוכחית שלכם.',
  EDIT_BLOCKED: 'אי אפשר לערוך את העמוד במצבו הנוכחי.',
  UNAVAILABLE: 'לא הצלחנו לבצע את הפעולה כרגע. נסו שוב בהמשך.',
} as const;

export function handleCooldownError(retryAfterDays: number) {
  const days = Math.max(1, Math.ceil(retryAfterDays));
  return `אפשר להחליף כתובת פעם אחת ב־${HEADHUNTER_RENAME_COOLDOWN_DAYS} ימים. נסו שוב בעוד ${days === 1 ? 'יום' : `${days} ימים`}.`;
}
