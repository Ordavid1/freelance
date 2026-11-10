// Everything the site says when it compares itself with XPlace.com. XPlace's prices and a dated
// speed test of both home pages live here as data, each with a check date and a source. Every
// sentence is built from that data and from the membership facts (facts.ts), so a claim cannot
// outlive its numbers: refresh the constants and the home FAQ, the comparison page and the llms
// files follow. A saving or a speed advantage is stated only while the data still shows it (see
// the guards in `derive`). Pure module: no server-only imports.
import { formatHebrewDate } from './dates';
import { membershipAnswer, type MembershipFacts } from './facts';
import type { Question } from './types';

type Range = readonly [low: number, high: number];
export type ComparisonRow = { label: string; freelancePlace: string; xplace: string };

// What XPlace publishes. Prices are ILS per month before VAT; every plan is billed once for its
// whole period (plans page: "חיוב העסקה נעשה בתשלום אחד לכל התקופה ולא ניתן לחלקו לתשלומים").
export const XPLACE = {
  checked: '2026-11-10',
  sources: {
    plans: { label: 'טבלת המחירים לפרילנסרים', url: 'https://www.xplace.com/il/plans' },
    terms: { label: 'תנאי השימוש', url: 'https://www.xplace.com/il/terms' },
    home: { label: 'עמוד הבית', url: 'https://www.xplace.com/' },
  },
  plans: {
    monthly: { months: 1, perMonth: 99, total: 99 },
    quarterly: { months: 3, perMonth: 89, total: 267 },
    annual: { months: 12, perMonth: 69, total: 828 },
  },
} as const;

// Google Lighthouse on the production home pages. Scores are the range over the runs, every
// other value is the median. Both sites were measured in the same session with the same settings.
export const SPEED_TEST = {
  checked: '2026-11-10',
  tool: 'Google Lighthouse 12.8.2',
  setup: 'מובייל מדומה (Moto G Power, חיבור Slow 4G, האטת מעבד פי 4)',
  runs: 3,
  freelancePlace: { mobileScore: [89, 95], desktopScore: [96, 99], accessibility: 100, bestPractices: 100, lcpSeconds: 2.1, blockingMs: 253, requests: 24, kilobytes: 308, thirdPartyRequests: 0, thirdPartyHosts: 0 },
  xplace: { mobileScore: [50, 52], desktopScore: [75, 82], accessibility: 93, bestPractices: 61, lcpSeconds: 4.1, blockingMs: 2051, requests: 162, kilobytes: 20327, thirdPartyRequests: 65, thirdPartyHosts: 31, videos: 6, videoKilobytes: 14579, animatedGifKilobytes: 3281 },
} as const;

const NO_CARD = 'בלי כרטיס אשראי';
const ils = (amount: number) => `₪${amount}`;
const percentLess = (ours: number, theirs: number) => Math.round((1 - ours / theirs) * 100);
const range = ([low, high]: Range) => low === high ? String(low) : `${low}–${high}`;
const megabytes = (kilobytes: number) => {
  const value = kilobytes / 1024;
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
};
const checkedOn = () => formatHebrewDate(XPLACE.checked);
const joinSentences = (...parts: string[]) => parts.filter(Boolean).join(' ');
// "בעלות, בגמישות ובמהירות": the last item takes a plain ו.
const listHe = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} ו${items[items.length - 1]}` : items[0] ?? '';

// The numbers the copy may state. A saving is stated only while ours is really below theirs and a
// speed advantage only while the measured ranges do not overlap, so a stale comparison goes quiet
// instead of turning false. Without an available paid offer there is no price comparison at all.
export function derive(facts: MembershipFacts) {
  const ours = SPEED_TEST.freelancePlace;
  const theirs = SPEED_TEST.xplace;
  const saving = (plan: { perMonth: number }) => {
    const percent = facts.billingAvailable ? percentLess(facts.priceIls, plan.perMonth) : 0;
    return percent > 0 ? percent : undefined;
  };
  return {
    price: `${facts.priceLabel} לחודש כולל מע״מ ככל שחל`,
    trialDays: facts.trialDays,
    billing: facts.billingAvailable,
    monthlySaving: saving(XPLACE.plans.monthly),
    // Cheaper than even XPlace's cheapest prepaid plan, while billed month by month: the basis for "flexibility".
    annualSaving: saving(XPLACE.plans.annual),
    faster: ours.mobileScore[0] > theirs.mobileScore[1] && ours.kilobytes < theirs.kilobytes,
    // The same measurement also scores accessibility and counts requests to other companies' servers.
    cleaner: ours.accessibility > theirs.accessibility && ours.thirdPartyRequests < theirs.thirdPartyRequests,
    ourScore: range(ours.mobileScore), theirScore: range(theirs.mobileScore),
    ourWeight: megabytes(ours.kilobytes), theirWeight: megabytes(theirs.kilobytes),
    ourAccessibility: String(ours.accessibility), theirAccessibility: String(theirs.accessibility),
    ourThirdParty: String(ours.thirdPartyRequests), theirThirdParty: String(theirs.thirdPartyRequests),
  };
}
type Derived = ReturnType<typeof derive>;

const speedSentence = (d: Derived) => d.faster
  ? `דף הבית שלנו שוקל כ־${d.ourWeight} MB ומקבל ${d.ourScore} בבדיקת Google Lighthouse במובייל, לעומת כ־${d.theirWeight} MB ו־${d.theirScore} ב־XPlace.`
  : '';
// Accessibility score and requests to third parties are part of how the page feels and what it does behind the reader's back.
const qualitySentence = (d: Derived) => d.cleaner
  ? `ציון הנגישות שלו ${d.ourAccessibility} לעומת ${d.theirAccessibility}, והוא לא שולח בקשות לצדדים שלישיים, לעומת ${d.theirThirdParty} ב־XPlace.`
  : '';

function priceSentence(d: Derived) {
  if (d.monthlySaving === undefined) return '';
  const { monthly, annual } = XPLACE.plans;
  const annualPart = d.annualSaving === undefined ? '' : ` וכ־${d.annualSaving}% פחות מהמסלול השנתי שלה (${ils(annual.perMonth)} לחודש, ${ils(annual.total)} בתשלום אחד מראש)`;
  return `חברות ב־Freelance Place עולה ${d.price}, משלמים חודש בחודשו ואפשר לבטל בכל עת. זה כ־${d.monthlySaving}% פחות מהמסלול החודשי של XPlace (${ils(monthly.perMonth)} לפני מע״מ)${annualPart}.`;
}

// The home FAQ answer to "במה Freelance Place טוב יותר מ־XPlace.com?". The first sentence is the
// direct answer; every claim after it is a number that can be checked at the sources on the comparison page.
export function homeComparisonAnswer(facts: MembershipFacts) {
  const d = derive(facts);
  // Only the aspects the data still supports. With none, the answer says so instead of claiming an edge.
  const advantages = [...(d.monthlySaving !== undefined ? ['בעלות'] : []), ...(d.annualSaving !== undefined ? ['בגמישות'] : []), ...(d.faster ? ['במהירות'] : [])];
  const lead = advantages.length > 0 ? `${listHe(advantages)}, ואפשר לבדוק כל מספר.` : 'הנתונים שנבדקו אינם מראים כרגע יתרון מדיד, ולכן איננו טוענים לכזה.';
  const trial = d.billing
    ? `לפני החברות מקבלים ${d.trialDays} ימי ניסיון להגשת הצעות, ${NO_CARD}.`
    : `פרסום פרויקט הוא בחינם, ופרילנסרים מקבלים ${d.trialDays} ימי ניסיון להגשת הצעות ${NO_CARD}. התשלום עדיין אינו זמין ולא מופעל חיוב.`;
  const hasNumbers = d.monthlySaving !== undefined || d.faster || d.cleaner;
  const source = hasNumbers ? `${d.monthlySaving !== undefined ? 'המחירים והמדידה' : 'המדידה'} מ־${checkedOn()}; המקורות בעמוד ההשוואה.` : '';
  return joinSentences(lead, priceSentence(d), trial, speedSentence(d), qualitySentence(d), source);
}
export function homeComparisonQuestion(facts: MembershipFacts): Question {
  return { question: 'במה Freelance Place טוב יותר מ־XPlace.com?', answer: homeComparisonAnswer(facts) };
}

// The one-line teaser on the home page, above the link to the comparison.
export function homeTeaser(facts: MembershipFacts) {
  const d = derive(facts);
  return d.monthlySaving !== undefined
    ? `${d.trialDays} ימי ניסיון ${NO_CARD}, ואחר כך ${d.price}, במקום ${ils(XPLACE.plans.monthly.perMonth)} לחודש לפני מע״מ ב־XPlace. אפשר לבטל בכל עת.`
    : `${d.trialDays} ימי ניסיון להגשת הצעות ${NO_CARD}, ופרסום פרויקט בחינם.`;
}

// The lead of the comparison page.
export function comparisonLead(facts: MembershipFacts) {
  const d = derive(facts);
  const cost = d.monthlySaving !== undefined
    ? `${d.trialDays} ימי ניסיון להגשת הצעות ${NO_CARD}, ואחריהם ${d.price}: כ־${d.monthlySaving}% פחות ממסלול המנוי החודשי של XPlace.`
    : `פרסום פרויקט בחינם, ו־${d.trialDays} ימי ניסיון להגשת הצעות ${NO_CARD}.`;
  return joinSentences('מחפשים אלטרנטיבה ל־XPlace.com? Freelance Place הוא מרחב עבודה בעברית לפרילנסרים ולעסקים, עם פרויקטים, פרופיל מקצועי והצעות מחיר.', cost, d.faster ? 'דף הבית נטען מהר יותר ושוקל פחות, ואפשר לבדוק את זה בעצמכם.' : '');
}

// The comparison table. Rows where both sites are the same are kept, so the table shows what is
// equal as well as what differs.
export function comparisonRows(facts: MembershipFacts): ComparisonRow[] {
  const d = derive(facts);
  const { monthly, quarterly, annual } = XPLACE.plans;
  const xplacePrices = `${ils(monthly.perMonth)} לחודש במסלול חודשי, ${ils(quarterly.perMonth)} לחודש במסלול של ${quarterly.months} חודשים (${ils(quarterly.total)}) או ${ils(annual.perMonth)} לחודש במסלול של ${annual.months} חודשים (${ils(annual.total)}), לפני מע״מ.`;
  const xplaceCommitment = 'כל מסלול נגבה בתשלום אחד לכל התקופה, ללא תשלומים. לפי תנאי השימוש, מנוי שנרכש אינו ניתן להקפאה ואין החזר כספי מלא או חלקי־יחסי לאחר הרכישה.';
  return [
    { label: 'מטרת האתר', freelancePlace: 'פרסום וגילוי פרויקטים, פרופיל מקצועי והצעות במרחב עבודה בעברית.', xplace: 'האתר מציג חיפוש פרילנסרים ופרויקטים במגוון תחומים.' },
    { label: 'פרסום פרויקט', freelancePlace: 'בחינם. כותבים משפט אחד, מקבלים טיוטה בעזרת AI, בודקים ומפרסמים.', xplace: 'עמוד הבית מציע פרסום פרויקט בחינם וקבלת הצעות מחיר.' },
    { label: 'מחיר לפרילנסרים', freelancePlace: d.billing ? `${d.price}.` : `מחיר מתוכנן: ${facts.priceLabel} לחודש. התשלום עדיין אינו זמין ולא מופעל חיוב.`, xplace: xplacePrices },
    { label: 'התחייבות וביטול', freelancePlace: d.billing ? 'חיוב חודשי באישור מפורש, וביטול החידוש בעמוד החברות בכל עת. הגישה נשארת עד סוף התקופה ששולמה.' : 'כרגע לא מופעל חיוב, ולכן אין התחייבות כספית.', xplace: xplaceCommitment },
    { label: 'ניסיון חינם', freelancePlace: `${d.trialDays} ימי ניסיון להגשת הצעות ${NO_CARD}. ללא הצטרפות אין חיוב בסיום הניסיון.`, xplace: 'בעמוד המסלולים לא מצוינת תקופת ניסיון חינם, ויש בו חשבון חינם לצד המסלולים בתשלום.' },
    { label: 'כלי AI לפרופיל ולניסוח', freelancePlace: 'עזרה בניסוח פרויקט ויצירת פרופיל בעזרת AI, זמינות לכל משתמש רשום וללא תשלום נוסף. הטיוטה נשמרת או מתפרסמת רק באישורכם.', xplace: 'בטבלת המסלולים מופיע סוכן פרויקטים חכם. כלי הפרופיל והניסוח של XPlace לא נבדקו.' },
    { label: 'תשלום על העבודה', freelancePlace: 'מחוץ למערכת. אין נאמנות (escrow) או הגנת תשלום.', xplace: 'לפי תנאי השימוש, התשלומים בין המשתמשים נעשים באופן עצמאי, מחוץ למערכת האתר.' },
  ];
}

export function speedRows(): ComparisonRow[] {
  const ours = SPEED_TEST.freelancePlace;
  const theirs = SPEED_TEST.xplace;
  const seconds = (value: number, digits = 1) => `${value.toFixed(digits)} שניות`;
  return [
    { label: 'ציון ביצועים במובייל (0–100)', freelancePlace: range(ours.mobileScore), xplace: range(theirs.mobileScore) },
    { label: 'ציון ביצועים במחשב (0–100)', freelancePlace: range(ours.desktopScore), xplace: range(theirs.desktopScore) },
    { label: 'הצגת התוכן המרכזי (LCP)', freelancePlace: seconds(ours.lcpSeconds), xplace: seconds(theirs.lcpSeconds) },
    { label: 'זמן חסימה של הממשק (TBT)', freelancePlace: seconds(ours.blockingMs / 1000, 2), xplace: seconds(theirs.blockingMs / 1000, 2) },
    { label: 'משקל טעינה ראשונה', freelancePlace: `כ־${megabytes(ours.kilobytes)} MB`, xplace: `כ־${megabytes(theirs.kilobytes)} MB` },
    { label: 'בקשות רשת', freelancePlace: String(ours.requests), xplace: String(theirs.requests) },
    { label: 'בקשות לצדדים שלישיים', freelancePlace: String(ours.thirdPartyRequests), xplace: `${theirs.thirdPartyRequests}, ל־${theirs.thirdPartyHosts} דומיינים (כגון אנליטיקה ופרסום)` },
    { label: 'נגישות (ציון Lighthouse)', freelancePlace: String(ours.accessibility), xplace: String(theirs.accessibility) },
    { label: 'שיטות עבודה מומלצות (ציון Lighthouse)', freelancePlace: String(ours.bestPractices), xplace: String(theirs.bestPractices) },
  ];
}

// Why the XPlace home page weighs what it weighs, so the weight is explained and not just stated.
export function speedWeightNote() {
  const theirs = SPEED_TEST.xplace;
  return `רוב המשקל בדף הבית של XPlace הוא ${theirs.videos} סרטוני רקע (כ־${megabytes(theirs.videoKilobytes)} MB) וקובץ GIF מונפש (כ־${megabytes(theirs.animatedGifKilobytes)} MB).`;
}
export function speedMethod() {
  return `שיטה: ${SPEED_TEST.tool}, ${SPEED_TEST.setup}. ${SPEED_TEST.runs} הרצות לכל אתר ב־${formatHebrewDate(SPEED_TEST.checked)}, דף הבית בלבד. מוצג טווח הציונים וחציון שאר המדדים. התוצאות משתנות עם הזמן והרשת, ואפשר לחזור על הבדיקה ב־PageSpeed Insights של Google.`;
}
export const comparisonSources = () => ({ checked: XPLACE.checked, checkedText: checkedOn(), links: [XPLACE.sources.plans, XPLACE.sources.terms, XPLACE.sources.home] });

// The FAQ on the comparison page.
export function comparisonQuestions(facts: MembershipFacts): Question[] {
  const d = derive(facts);
  const { monthly, quarterly, annual } = XPLACE.plans;
  const speed = d.faster ? `דף בית שמקבל ${d.ourScore} ב־Lighthouse במובייל לעומת ${d.theirScore} ב־XPlace` : '';
  // What a visitor can check, in the order of what they are looking for; only what the data still shows.
  const wants = listHe([...(d.monthlySaving !== undefined ? ['מחיר נמוך'] : []), ...(d.annualSaving !== undefined ? ['גמישות'] : []), ...(d.faster ? ['אתר מהיר'] : [])]);
  const proof = [d.monthlySaving !== undefined ? `${d.price}, במקום ${ils(monthly.perMonth)} לחודש לפני מע״מ` : 'פרסום פרויקט בחינם', `${d.trialDays} ימי ניסיון ${NO_CARD}`, speed].filter(Boolean).join(', ');
  const best = joinSentences(
    `${wants ? `מי שמחפשים ${wants}` : 'מי שמחפשים לנסות בלי חיוב'} ימצאו ב־Freelance Place אלטרנטיבה שאפשר לבדוק בחינם: ${proof}.`,
    d.billing ? 'התחילו בניסיון והשוו בעצמכם.' : 'התשלום עדיין אינו זמין ולא מופעל חיוב.',
  );
  const difference = joinSentences(
    'ההבדלים שאפשר למדוד:',
    d.monthlySaving !== undefined ? `מחיר: ${d.price} מול ${ils(monthly.perMonth)} לפני מע״מ.` : '',
    d.monthlySaving !== undefined ? 'התחייבות: אצלנו חודש בחודשו, ובמסלולי XPlace הארוכים משלמים מראש על כל התקופה.' : '',
    `ניסיון: ${d.trialDays} ימים ${NO_CARD}, ובעמוד המסלולים של XPlace לא מצוינת תקופת ניסיון.`,
    d.faster ? `מהירות: ${d.ourScore} מול ${d.theirScore} ב־Lighthouse במובייל.` : '',
    'בשני האתרים פרסום פרויקט הוא בחינם והתשלום על העבודה מתבצע בין הצדדים, מחוץ לאתר.',
  );
  const xplacePlans = `${ils(monthly.perMonth)} לחודש במסלול חודשי, ${ils(quarterly.perMonth)} לחודש במסלול של ${quarterly.months} חודשים (${ils(quarterly.total)}) ו־${ils(annual.perMonth)} לחודש במסלול של ${annual.months} חודשים (${ils(annual.total)})`;
  return [
    { question: 'מהי האלטרנטיבה הטובה ביותר ל־XPlace.com?', answer: best },
    { question: 'מה ההבדל בין Freelance Place לבין XPlace?', answer: difference },
    { question: 'כמה עולה Freelance Place, ומה לגבי XPlace?', answer: `${membershipAnswer(facts)} המחירים של XPlace לפי עמוד המסלולים שלה ב־${checkedOn()}, לפני מע״מ ובתשלום אחד לכל התקופה: ${xplacePlans}.` },
    { question: 'אפשר לנסות את Freelance Place בלי לוותר על XPlace?', answer: `כן. הניסיון ב־Freelance Place חינם, ${NO_CARD} ובלי חיוב בסיומו אם לא מצטרפים, ולכן אפשר להפעיל אותו במקביל לכל שירות אחר. לפי תנאי השימוש של XPlace, מנוי שנרכש אינו ניתן להקפאה ואין עליו החזר כספי מלא או חלקי־יחסי, ולכן כדאי לקרוא אותם לפני שמשלמים מראש על מסלול ארוך.` },
    { question: 'אפשר להעביר חשבון או ביקורות מ־XPlace?', answer: 'אין כיום העברה אוטומטית של חשבון, ביקורות, הודעות או פרויקטים מ־XPlace. אפשר להכין פרופיל אישי על בסיס חומרים שבבעלותכם ולבדוק את המידע לפני שמירתו.' },
    { question: 'האם Freelance Place קשור ל־XPlace?', answer: 'לא. Freelance Place הוא מוצר עצמאי. השם XPlace והדומיין xplace.com מוזכרים לצורך השוואה וזיהוי השירות האחר.' },
  ];
}

// English lines for llms.txt. Same data, same guards, so an answer engine reads the same numbers as a visitor.
export function llmsComparisonLines(facts: MembershipFacts): string[] {
  const d = derive(facts);
  const { monthly, quarterly, annual } = XPLACE.plans;
  const lines: string[] = [];
  if (d.monthlySaving !== undefined) {
    lines.push(`XPlace.com prices, from its public plans page checked ${XPLACE.checked}: freelancer subscriptions cost ILS ${monthly.perMonth} per month, ILS ${quarterly.perMonth} per month for ${quarterly.months} months or ILS ${annual.perMonth} per month for ${annual.months} months, before VAT, each billed as one payment for the whole period. Freelance Place membership costs ILS ${facts.priceIls.toFixed(2)} per month with VAT included where applicable, billed monthly and cancellable at any time.`);
  }
  if (d.faster) {
    lines.push(`Speed, ${SPEED_TEST.tool} simulated mobile test of both home pages on ${SPEED_TEST.checked} (${SPEED_TEST.runs} runs each): Freelance Place scored ${d.ourScore} and transferred about ${d.ourWeight} MB; XPlace scored ${d.theirScore} and transferred about ${d.theirWeight} MB.`);
  }
  if (d.cleaner) {
    lines.push(`Same ${SPEED_TEST.checked} measurement: Lighthouse accessibility score ${d.ourAccessibility} for Freelance Place and ${d.theirAccessibility} for XPlace; requests to third-party hosts on the home page ${d.ourThirdParty} and ${d.theirThirdParty}.`);
  }
  return lines;
}
