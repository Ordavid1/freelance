// Public product facts for pages, structured data and llms files. Numbers and the
// billing state come from the code that enforces them (price, trial length and the
// payment gateway configuration), never from copy typed by hand, so a public claim
// cannot drift from what the product does. Pure module: no server-only imports.
import { PRICE_AGOROT, cardcomConfig } from '@/lib/billing/cardcom';
import { TRIAL_MS } from '@/lib/membership/state';
import { legalEmail, legalOperator } from '@/lib/legal/identity';

export const BRAND = { name: 'Freelance Place', nameHe: 'פרילנס פלייס' } as const;

export type MembershipFacts = { priceIls: number; priceLabel: string; trialDays: number; billingAvailable: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;

export function membershipFacts(env: NodeJS.ProcessEnv = process.env): MembershipFacts {
  const priceIls = PRICE_AGOROT / 100;
  // Same availability rule the billing status endpoint applies.
  let billingAvailable = true;
  try { cardcomConfig(env); } catch { billingAvailable = false; }
  return { priceIls, priceLabel: `₪${priceIls.toFixed(2)}`, trialDays: Math.round(TRIAL_MS / DAY_MS), billingAvailable };
}

export function contactFacts() {
  return { operator: legalOperator, legalName: legalOperator, email: legalEmail };
}

// Answer to "how much does it cost". Free posting and the trial are statements about
// the product rules; the paid membership is described only when billing can be used.
export function membershipAnswer(facts: MembershipFacts) {
  const lead = `פרסום פרויקטים חינם. פרילנסרים מקבלים ${facts.trialDays} ימי ניסיון להגשת הצעות אחרי שמירת פרופיל שהושלם`;
  if (facts.billingAvailable) {
    return `${lead}, ואחריהם אפשר להצטרף לחברות ב־${facts.priceLabel} לחודש (כולל מע״מ ככל שחל), שמתחדשת אוטומטית עד לביטול. ללא הצטרפות אין חיוב בסיום הניסיון. התנאים המלאים מופיעים בתנאי השימוש.`;
  }
  return `${lead}. מחיר החברות המתוכנן הוא ${facts.priceLabel} לחודש; התשלום עדיין אינו זמין ולא מופעל חיוב.`;
}

export const aiAgentAnswer = 'לא. חלק מהפרויקטים באתר מפורסמים על ידי סוכן AI של Freelance Place כדי להמחיש איך נראה פרויקט ברור. הם מסומנים "סוכן AI" בכל מקום שבו הם מופיעים, והצעה עליהם נשמרת בחשבון שלך ואינה נשלחת ללקוח/ה אנושי/ת. פרויקט שפורסם על ידי משתמש מוצג ללא תג זה.';
