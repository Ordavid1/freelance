import { aiAgentAnswer, membershipAnswer, membershipFacts, type MembershipFacts } from './facts';
import { indexablePages } from './registry';
import type { Question } from './types';

export type { Question } from './types';
export { categories, categoryForProject, projectMatchesCategory, type Category } from './categories';
// Every page the sitemap and navigation advertise; derived from the registry so it cannot drift.
export const editorialPaths = indexablePages().map((page) => page.path);

// Copy that mentions pricing or billing is always derived from the product facts, so it
// stays true when billing is switched on or off.
export function getHomeQuestions(facts: MembershipFacts = membershipFacts()): Question[] {
  return [
    { question: 'מה זה Freelance Place?', answer: 'Freelance Place הוא מרחב לפרילנסרים ולעסקים בישראל: מפרסמים פרויקט, בוחנים הזדמנויות ומכינים הצעת מחיר. הממשק בעברית ותומך בכתיבה מימין לשמאל.' },
    { question: 'למי האתר מתאים?', answer: 'לפרילנסרים שעובדים באופן עצמאי וללקוחות שמחפשים עזרה בפרויקט מוגדר, בתחומי פיתוח אתרים, עיצוב, כתיבה, שיווק ווידאו. מתחילים מתיאור התוצאה הרצויה, הכישורים, התקציב ולוח הזמנים.' },
    { question: 'האם Freelance Place הוא אלטרנטיבה ל־XPlace.com?', answer: 'כן. Freelance Place מציע גישה נוספת לחיפוש ולפרסום פרויקטים, עם מרחב עבודה אישי, סינון לפי כישורים וכלי עזר לניסוח. ההשוואה ל־XPlace.com מפרידה בין יכולות קיימות ליכולות מתוכננות, כדי שתוכלו לבחור לפי הצרכים שלכם.' },
    { question: 'כמה עולה להשתמש באתר?', answer: membershipAnswer(facts) },
    { question: 'האם כל פרויקט שמופיע באתר אמיתי?', answer: aiAgentAnswer },
  ];
}
export function getComparisonQuestions(facts: MembershipFacts = membershipFacts()): Question[] {
  return [
    { question: 'מהי האלטרנטיבה הטובה ביותר ל־XPlace.com?', answer: 'הבחירה תלויה בסוג הפרויקטים, היצע הלקוחות, התקציב והכלים שחשובים לכם. Freelance Place מיועד למי שמחפשים חוויית עבודה בעברית שמרכזת גילוי פרויקטים, הכנת פרופיל והצעות. כדאי לבדוק פרויקטים אמיתיים ואת מצב היכולות לפני שמחליטים.' },
    { question: 'מה ההבדל בין Freelance Place לבין XPlace?', answer: 'XPlace.com מציג חיפוש פרילנסרים ופרויקטים, פרסום פרויקט בחינם ומסלולי מנוי לפרילנסרים. Freelance Place מתמקד במרחב אישי, פרופיל מבוסס מקורות וסינון פרויקטים לפי כישורים. בדקו את המאגרים והכלים הזמינים בכל שירות לפי תחום העבודה שלכם.' },
    { question: 'כמה עולה Freelance Place, ומה לגבי XPlace?', answer: `${membershipAnswer(facts)} את המחירים והמסלולים של XPlace יש לבדוק ישירות באתר שלו.` },
    { question: 'אפשר להעביר חשבון או ביקורות מ־XPlace?', answer: 'אין כיום העברה אוטומטית של חשבון, ביקורות, הודעות או פרויקטים מ־XPlace. אפשר להכין פרופיל אישי על בסיס חומרים שבבעלותכם ולבדוק את המידע לפני שמירתו.' },
    { question: 'האם Freelance Place קשור ל־XPlace?', answer: 'לא. Freelance Place הוא מוצר עצמאי. השם XPlace והדומיין xplace.com מוזכרים לצורך השוואה וזיהוי השירות האחר.' },
  ];
}

// Comparison-page statements about membership and payments.
export function comparisonMembershipCell(facts: MembershipFacts = membershipFacts()) {
  return facts.billingAvailable
    ? `פרסום פרויקט בחינם. ${facts.trialDays} ימי ניסיון להגשת הצעות, ואחריהם ${facts.priceLabel} לחודש בחידוש אוטומטי עד לביטול.`
    : `מחיר מתוכנן: ${facts.priceLabel} לחודש. התשלום עדיין אינו זמין.`;
}
export function comparisonPaymentsParagraph(facts: MembershipFacts = membershipFacts()) {
  const membership = facts.billingAvailable
    ? `פרסום פרויקט הוא בחינם. פרילנסרים מקבלים ${facts.trialDays} ימי ניסיון להגשת הצעות, ואחריהם אפשר להצטרף לחברות ב־${facts.priceLabel} לחודש בחידוש אוטומטי עד לביטול; ללא הצטרפות אין חיוב בסיום הניסיון.`
    : `פרסום פרויקט הוא בחינם. מחיר החברות המתוכנן הוא ${facts.priceLabel} לחודש, והתשלום עדיין אינו זמין ולא מופעל חיוב.`;
  return `${membership} תשלום בין לקוח לפרילנסר, נאמנות (escrow) והגנת תשלום אינם מוצעים: את תנאי התשלום על העבודה מסכימים הצדדים ביניהם, כמפורט בתנאי השימוש. האתר עדיין מתפתח, ולכן בחרו על סמך הכלים הזמינים והמידע המוצג בזמן השימוש.`;
}
