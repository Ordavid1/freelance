import { comparisonQuestions, homeComparisonQuestion } from './comparison';
import { membershipAnswer, membershipFacts, type MembershipFacts } from './facts';
import { indexablePages } from './registry';
import type { Question } from './types';

export type { Question } from './types';
export { categories, categoryForProject, projectMatchesCategory, type Category } from './categories';
// Every page the sitemap and navigation advertise; derived from the registry so it cannot drift.
export const editorialPaths = indexablePages().map((page) => page.path);

// Copy that mentions pricing or billing is always derived from the product facts, so it
// stays true when billing is switched on or off. The XPlace comparison is built the same way
// from dated, sourced data (comparison.ts).
export function getHomeQuestions(facts: MembershipFacts = membershipFacts()): Question[] {
  return [
    { question: 'מה זה Freelance Place?', answer: 'Freelance Place הוא מרחב לפרילנסרים ולעסקים בישראל: מפרסמים פרויקט, בוחנים הזדמנויות ומכינים הצעת מחיר. הממשק בעברית ותומך בכתיבה מימין לשמאל.' },
    { question: 'למי האתר מתאים?', answer: 'לפרילנסרים שעובדים באופן עצמאי וללקוחות שמחפשים עזרה בפרויקט מוגדר, בתחומי פיתוח אתרים, עיצוב, כתיבה, שיווק ווידאו. מתחילים מתיאור התוצאה הרצויה, הכישורים, התקציב ולוח הזמנים.' },
    homeComparisonQuestion(facts),
    { question: 'כמה עולה להשתמש באתר?', answer: membershipAnswer(facts) },
  ];
}
export function getComparisonQuestions(facts: MembershipFacts = membershipFacts()): Question[] {
  return comparisonQuestions(facts);
}

// Comparison-page statement about payments.
export function comparisonPaymentsParagraph(facts: MembershipFacts = membershipFacts()) {
  const membership = facts.billingAvailable
    ? `פרסום פרויקט הוא בחינם. פרילנסרים מקבלים ${facts.trialDays} ימי ניסיון להגשת הצעות, ואחריהם אפשר להצטרף לחברות ב־${facts.priceLabel} לחודש בחידוש אוטומטי עד לביטול; ללא הצטרפות אין חיוב בסיום הניסיון.`
    : `פרסום פרויקט הוא בחינם. מחיר החברות המתוכנן הוא ${facts.priceLabel} לחודש, והתשלום עדיין אינו זמין ולא מופעל חיוב.`;
  return `${membership} תשלום בין לקוח לפרילנסר, נאמנות (escrow) והגנת תשלום אינם מוצעים: את תנאי התשלום על העבודה מסכימים הצדדים ביניהם, כמפורט בתנאי השימוש. האתר עדיין מתפתח, ולכן בחרו על סמך הכלים הזמינים והמידע המוצג בזמן השימוש.`;
}
