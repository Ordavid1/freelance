// Hebrew copy of the apply/edit screen and its entry card (client-safe; no inline strings in components).
// The project threshold always comes from HEADHUNTER_MIN_PROJECTS, never a literal.
import { HEADHUNTER_EDITOR_PATH, HEADHUNTER_FAST_TRACK_HOURS, HEADHUNTER_MIN_PROJECTS, HEADHUNTER_RENAME_COOLDOWN_DAYS } from './constants.ts';
import { SITE_NAME } from '../seo/site.ts';
import type { HeadhunterStatus } from './types.ts';

export const EDITOR_PATH = HEADHUNTER_EDITOR_PATH;

export const ENTRY_CARD = {
  title: 'עמוד סוכנות גיוס',
  text: `מגייסים ומשרדי גיוס מקבלים עמוד משלהם ב־${SITE_NAME} ותג על כל פרויקט. העמוד נפתח אחרי ${HEADHUNTER_MIN_PROJECTS} פרויקטים ואישור.`,
  cta: 'לעמוד הסוכנות',
} as const;

export const EDITOR_TEXT = {
  title: 'עמוד הסוכנות שלי',
  pageTitle: 'עמוד הסוכנות',
  back: 'חזרה לפרופיל',
  breadcrumbHome: 'דף הבית',
  breadcrumbProfile: 'הפרופיל שלי',
  brief: `השירות חינם. עמוד משלכם ב־${SITE_NAME}, עם כל הפרויקטים שלכם, פרטי קשר ותג על כל פרויקט. העמוד נפתח אחרי ${HEADHUNTER_MIN_PROJECTS} פרויקטים ואישור של הצוות.`,
  briefLabel: 'בקיצור:',
  unavailable: 'לא הצלחנו לטעון את הנתונים כרגע. נסו לרענן את העמוד בעוד רגע.',
  closedTitle: 'ההרשמה לעמודי סוכנויות טרם נפתחה',
  closedText: 'כרגע אי אפשר להגיש בקשה לעמוד סוכנות. כשההרשמה תיפתח, הטופס יופיע כאן.',
  progressHeading: 'הדרך לפתיחת העמוד',
  progressHint: 'פרויקטים פתוחים או סגורים שפורסמו באתר נספרים.',
  publishProject: 'לפרסום פרויקט',
  identityTitle: 'זהות וכתובת',
  identityHelp: 'השם מופיע בתג על כל פרויקט ובראש העמוד. הכתובת באותיות לטיניות, בלי רווחים.',
  displayName: 'שם הסוכנות',
  handle: 'כתובת העמוד',
  handleHint: `3 עד 30 תווים: אותיות לטיניות קטנות, ספרות ומקף`,
  handleLatinOnly: 'הכתובת באותיות לטיניות בלבד. השם עצמו יכול להיות בעברית.',
  handleSuggest: 'הצעה מהשם:',
  handleChecking: 'בודקים…',
  handleAvailable: '✓ פנוי',
  kind: 'סוג',
  city: 'עיר',
  optional: 'לא חובה',
  headerTitle: 'כותרת העמוד',
  headerHelp: 'טקסט פשוט בלבד, בלי קישורים ובלי עיצוב. הצבעים, הגופנים והמבנה אחידים לכל הסוכנויות.',
  tagline: 'שורת סלוגן',
  about: 'על הסוכנות',
  contactTitle: 'יצירת קשר',
  contactHelp: 'חובה לפחות דרך אחת. ההודעה בפלטפורמה זמינה תמיד.',
  contactPublic: 'פרטי הקשר שתמלאו יפורסמו בעמוד הסוכנות, גלויים לכל מי שנכנס אליו.',
  email: 'אימייל',
  phone: 'טלפון',
  whatsapp: 'וואטסאפ',
  website: 'אתר',
  websiteHint: 'כתובת מאובטחת (https) בלבד',
  linkedin: 'לינקדאין',
  linkedinHint: 'עמוד חברה או פרופיל',
  shareTitle: 'שיתוף ברשתות',
  shareHelp: 'אם לא תגדירו, נציג כרטיס בעיצוב האתר עם שם הסוכנות. כל שדה שתגדירו מחליף רק את עצמו.',
  shareTitleField: 'כותרת',
  shareDescriptionField: 'תיאור קצר',
  attestation: `אני מוסמך/ת לייצג את השם הזה, ואני מפרסם/ת את הפרויקטים בעצמי או בשם הלקוח שלהם. הפרטים שמילאתי נכונים.`,
  submitApply: 'שליחת הבקשה',
  submitApplying: 'שולחים…',
  submitSave: 'שמירת שינויים',
  submitSaving: 'שומרים…',
  applyNote: `אפשר להגיש עכשיו. הבקשה עוברת לבדיקה אחרי ${HEADHUNTER_MIN_PROJECTS} פרויקטים שפורסמו באתר.`,
  saved: 'השינויים נשמרו.',
  savedPending: 'השינויים נשמרו. העמוד חזר לבדיקה.',
  applied: 'הבקשה נשמרה.',
  previewHeading: 'תצוגה מקדימה חיה',
  previewNote: 'אותו רכיב שמוצג בעמוד',
  previewNamePlaceholder: 'שם הסוכנות',
  tagHeading: 'כך התג יופיע על הפרויקטים',
  tagNeedsHandle: 'הזינו כתובת תקינה כדי לראות את התג.',
  tagNotLive: 'התג והעמוד יופיעו רק אחרי אישור. עד אז הם לא גלויים לאף אחד.',
  tagExpired: 'התג והעמוד לא מוצגים כרגע. הם יחזרו כשיפורסמו מספיק פרויקטים.',
  tagLive: 'התג והעמוד פעילים.',
  renameHeading: 'החלפת כתובת',
  renameNote: `אפשר להחליף כתובת פעם אחת ב־${HEADHUNTER_RENAME_COOLDOWN_DAYS} ימים. הכתובת הישנה ממשיכה להפנות לחדשה.`,
  renameButton: 'החלפת הכתובת',
  renaming: 'מחליפים…',
  renamed: 'הכתובת הוחלפה.',
  nameChangeWarning: 'החלפת שם הסוכנות שולחת את העמוד לבדיקה מחדש.',
  reasonLabel: 'הסיבה:',
  changesRequestedTitle: 'נדרשים שינויים',
  changesRequestedText: 'אחרי העדכון ושמירה, הבקשה חוזרת לבדיקה.',
  pendingTitle: 'הבקשה בבדיקה',
  pendingText: 'הצוות בודק את הפרטים. נעדכן במייל כשתהיה החלטה. אפשר לעדכן את הפרטים בינתיים.',
  liveTitle: 'העמוד פעיל',
  liveCopy: 'העתקת הקישור',
  liveCopied: 'הועתק',
  liveOpen: 'לצפייה בעמוד',
  liveShare: 'אפשר לשתף את הקישור עם מועמדים ולקוחות.',
  rejectedTitle: 'הבקשה לא אושרה',
  suspendedTitle: 'העמוד הושהה',
  readonlyText: 'אי אפשר לערוך את הפרטים במצב הזה. אם לדעתכם מדובר בטעות, פנו אלינו דרך צ׳אט התמיכה ונבדוק שוב.',
} as const;

/** The track choice on the apply form. The numbers always come from HEADHUNTER_MIN_PROJECTS and HEADHUNTER_FAST_TRACK_HOURS. */
export const TRACK_COPY = {
  heading: 'מתי העמוד עולה לאוויר',
  help: 'אפשר לבחור פעם אחת, בעת הגשת הבקשה. בשני המסלולים הבקשה עוברת אישור של הצוות.',
  standard: { title: 'מסלול רגיל', text: `העמוד עולה לאוויר כשפורסמו ${HEADHUNTER_MIN_PROJECTS} פרויקטים באתר.` },
  fast: { title: 'עמוד פעיל מיד', text: `העמוד עולה לאוויר ברגע האישור, בלי לחכות. צריך לפרסם ${HEADHUNTER_MIN_PROJECTS} פרויקטים תוך ${HEADHUNTER_FAST_TRACK_HOURS} שעות, אחרת העמוד יורד.` },
} as const;

/** The sentence at the bottom of the sign-up page. */
export const TRIAL_NOTICE = {
  label: 'חשוב לדעת',
  text: `אם לא יפורסמו ${HEADHUNTER_MIN_PROJECTS} פרויקטים תוך ${HEADHUNTER_FAST_TRACK_HOURS} שעות מרגע שהעמוד עלה לאוויר, העמוד יוסר. הפרויקטים עצמם נשארים באתר, והעמוד יחזור מעצמו כשיגיעו ל־${HEADHUNTER_MIN_PROJECTS} פרויקטים. במסלול הרגיל העמוד עולה רק אחרי ${HEADHUNTER_MIN_PROJECTS} פרויקטים, ולכן ההגבלה הזו לא חלה עליו.`,
} as const;

function hoursText(hours: number) {
  if (hours <= 1) return 'פחות משעה';
  if (hours === 2) return 'שעתיים';
  return `${hours} שעות`;
}

/** The owner's trial banner (editor, approved or waiting fast-track records). `hoursLeft` is whole hours, rounded up. */
export const TRIAL_STATUS = {
  runningPill: 'פעיל · תקופת ניסיון',
  expiredPill: 'לא מוצג כרגע',
  waitingTitle: 'מסלול עמוד פעיל מיד',
  waitingText: `אחרי האישור העמוד עולה לאוויר מיד, ומתחילה ספירה של ${HEADHUNTER_FAST_TRACK_HOURS} שעות לפרסום ${HEADHUNTER_MIN_PROJECTS} פרויקטים.`,
  runningTitle: 'עמוד פעיל, בתקופת ניסיון',
  runningLeft: (hoursLeft: number) => `נותרו ${hoursText(hoursLeft)}`,
  runningNote: `העמוד גלוי, אבל לא מופיע במנועי חיפוש עד ${HEADHUNTER_MIN_PROJECTS} פרויקטים. אם עד סוף התקופה לא יפורסמו ${HEADHUNTER_MIN_PROJECTS}, העמוד יוסר.`,
  expiredTitle: 'תקופת הניסיון הסתיימה, העמוד הוסר',
  expiredText: `לא פורסמו ${HEADHUNTER_MIN_PROJECTS} פרויקטים תוך ${HEADHUNTER_FAST_TRACK_HOURS} שעות. הפרויקטים והכתובת שמורים, והעמוד יחזור לאוויר מעצמו כשיפורסמו ${HEADHUNTER_MIN_PROJECTS}.`,
  mailLine: `העמוד פעיל לתקופת ניסיון של ${HEADHUNTER_FAST_TRACK_HOURS} שעות. אם עד אז לא יפורסמו ${HEADHUNTER_MIN_PROJECTS} פרויקטים, העמוד יוסר (הפרויקטים נשארים באתר, והעמוד יחזור כשיגיעו ל־${HEADHUNTER_MIN_PROJECTS}).`,
} as const;

export const STATUS_PILL: Record<HeadhunterStatus, string> = {
  draft: 'טיוטה · עוד לא פורסם',
  pending: 'ממתין לאישור',
  approved: 'פעיל',
  rejected: 'לא אושר',
  suspended: 'מושהה',
};

export const ANALYTICS = {
  apply: 'headhunter_apply_submit',
  contactClick: 'headhunter_contact_click',
} as const;

// Showcase strip beside the apply form: real screens of the feature, each with a short caption.
const SHOWCASE_DIR = '/headhunter-showcase';
export const SHOWCASE = {
  title: 'כך זה נראה',
  hint: 'לחצו על תמונה כדי להגדיל',
  close: 'סגירה',
  items: [
    { src: `${SHOWCASE_DIR}/agency-page.webp`, width: 800, height: 673, title: 'עמוד הסוכנות שלכם', text: 'דף משלכם באתר: שם, תיאור, פרטי קשר וכל הפרויקטים הפתוחים במקום אחד.' },
    { src: `${SHOWCASE_DIR}/project-tag.webp`, width: 800, height: 299, title: 'תג על כל פרויקט', text: 'בפיד הפרויקטים, כל פרויקט שפרסמתם מקבל תג עם שם הסוכנות וקישור לעמוד.' },
    { src: `${SHOWCASE_DIR}/share-card.webp`, width: 800, height: 420, title: 'כרטיס שיתוף', text: 'כך נראה הכרטיס שנוצר אוטומטית לקישור לעמוד שלכם.' },
    { src: `${SHOWCASE_DIR}/share-previews.webp`, width: 1100, height: 611, title: 'שיתוף בוואטסאפ, בלינקדין ובפייסבוק', text: 'ברירת מחדל אוטומטית, או כותרת ותיאור משלכם. הדוגמה להמחשה בלבד.' },
    { src: `${SHOWCASE_DIR}/agency-mobile.webp`, width: 390, height: 690, title: 'העמוד בנייד', text: 'העמוד מותאם גם למסך הטלפון.' },
    { src: `${SHOWCASE_DIR}/tag-mobile.webp`, width: 390, height: 370, title: 'התג בנייד', text: 'התג על הפרויקט בפיד, במסך הטלפון.' },
  ],
} as const;
