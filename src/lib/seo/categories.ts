export type Category = {
  slug: string; name: string; title: string; intro: string; scope: string; selection: string;
  skills: readonly string[]; match: readonly string[]; question: string; answer: string;
  // Optional dedicated meta description, used when `intro` falls outside the 70-165 character window.
  metaDescription?: string;
};
export const categories: readonly Category[] = [
  { slug: 'web-development', name: 'פיתוח אתרים', title: 'פרויקטים לפרילנסרים בפיתוח אתרים', intro: 'אתר תדמית, חנות מקוונת או יישום חדש: מתחילים מתוצאה שאפשר להגדיר ולבדוק. ב־Freelance Place אפשר לפרסם דרישה לפיתוח ולבחון פרויקטים פתוחים לפי הכישורים שלכם.', scope: 'בבריף ציינו מה כבר קיים: עיצוב, תוכן, דומיין, אחסון וקוד. הגדירו את מספר העמודים, החיבורים למערכות אחרות ודרישות הנגישות והביצועים. הפרידו בין בנייה חד־פעמית לתחזוקה שוטפת.', selection: 'בקשו לראות עבודה דומה והסבר על האחריות של הפרילנסר באותו פרויקט. הסכימו מראש על סביבת בדיקה, גישה לקוד, תנאי מסירה ותהליך תיקון תקלות.', skills: ['Next.js', 'React', 'WordPress', 'Webflow', 'Shopify'], match: ['פיתוח אתרים', 'תכנות ופיתוח תוכנה'], question: 'מה לכלול בפרויקט פיתוח אתר?', answer: 'סוג האתר, קהל היעד, פונקציות נדרשות, עיצוב ותוכן קיימים, התקציב, מועד המסירה וקריטריוני הקבלה. ציינו גם מי אחראי על הדומיין, האחסון והתחזוקה לאחר ההשקה.' },
  { slug: 'design', name: 'עיצוב ומיתוג', title: 'פרויקטים לפרילנסרים בעיצוב ומיתוג', intro: 'עיצוב מועיל מתחיל בהבנת הקהל והמסר. כאן אפשר להגדיר פרויקט למיתוג, עיצוב ממשק או חומרים שיווקיים, ולמצוא הזדמנויות שמתאימות לניסיון ולתיק העבודות שלכם.', scope: 'פרטו את התוצרים: לוגו, מערכת צבעים, מסכי מוצר או קובצי קמפיין. ציינו באילו ערוצים ישתמשו בהם, מהן מידות היצוא ואילו קובצי מקור נדרשים. הסכימו על מספר סבבי התיקונים לפני תחילת העבודה.', selection: 'השוו תהליכי חשיבה ולא רק תמונות יפות. בקשו הסבר על הבעיה שהעיצוב פתר ועל תפקיד המעצב או המעצבת. הגדירו בעלות על הקבצים וזכויות שימוש בפונטים ובתמונות.', skills: ['Figma', 'UX/UI', 'אסטרטגיית מותג', 'עיצוב גרפי'], match: ['עיצוב מוצר', 'עיצוב וגרפיקה', 'מיתוג ותוכן'], question: 'איך מגדירים בריף למעצב או למעצבת?', answer: 'מציינים את מטרת העיצוב, קהל היעד, התוצרים המדויקים, דוגמאות לסגנון הרצוי, לוח הזמנים ומספר סבבי התיקונים. מסכמים גם פורמטים, קובצי מקור וזכויות שימוש.' },
  { slug: 'writing-marketing', name: 'כתיבה ושיווק', title: 'פרויקטים לפרילנסרים בכתיבה ושיווק', intro: 'טקסט, תוכן וקמפיין צריכים לשרת מטרה ברורה. פרסמו משימת כתיבה או שיווק עם קהל יעד, מסר ותוצאה מבוקשת, או בחנו פרויקטים שמתאימים להתמחות שלכם.', scope: 'הגדירו את הערוץ, שפת התוכן, מספר התוצרים, האורך ותהליך האישור. בשיווק ממומן הפרידו בין שכר העבודה לתקציב המדיה. בכתיבה ציינו מי אחראי למחקר, בדיקת עובדות ועריכה מקצועית.', selection: 'בחנו עבודות בתחום דומה ובקשו להסביר את היעד ואת שיטת המדידה. הסכימו על גישה לנתונים, מסגרת הדיווח ומדדי ההצלחה. הימנעו מהבטחת תוצאה שאינה בשליטת נותן השירות.', skills: ['קופירייטינג', 'SEO', 'שיווק דיגיטלי', 'עברית'], match: ['מיתוג ותוכן', 'כתיבה ועריכה', 'שיווק ומכירות'], question: 'מה צריך להופיע בפרויקט תוכן או שיווק?', answer: 'קהל היעד, מטרת התוכן, הערוצים, שפת הכתיבה, מספר התוצרים, תהליך האישור, התקציב ומועד המסירה. בקמפיין ממומן מפרידים בין תקציב המדיה לשכר העבודה.' },
  { slug: 'video-animation', name: 'וידאו ואנימציה', title: 'פרויקטים לפרילנסרים בווידאו ואנימציה', intro: 'סרטון השקה, הסבר מוצר או אנימציה לרשתות: בריף ברור מגדיר איך הסרטון צריך לעבוד עבור הצופה. כאן אפשר לפרסם דרישה או לחפש עבודה המתאימה לכלי ההפקה ולסגנון שלכם.', scope: 'ציינו משך, יחסי מסך, שפה, כתוביות וערוצי פרסום. פרטו אם יש תסריט, קריינות, חומרי גלם ושפה גרפית. קבעו שלבי אישור נפרדים לתסריט, סטוריבורד וגרסה ראשונה כדי לצמצם תיקונים מאוחרים.', selection: 'בקשו לראות דוגמאות עם תפקיד דומה לזה שאתם צריכים: צילום, עריכה, אנימציה או סאונד. הסכימו על רישיונות מוזיקה וחומרי גלם, פורמטי יצוא ומסירת קובצי פרויקט.', skills: ['Motion design', 'After Effects', 'וידאו', 'עריכה'], match: ['וידאו ואנימציה'], question: 'מה לציין בהזמנת סרטון מפרילנסר?', answer: 'המטרה והקהל, משך הסרטון, יחס המסך, חומרי הגלם, השפה, הכתוביות, הקריינות, מספר הגרסאות, תהליך האישור וזכויות השימוש במוזיקה ובתמונות.' },
];

// A project belongs to a category when its stored category label is one the category
// lists, or when one of its skills is a skill the category lists (case-insensitive).
// The category page, project breadcrumbs and any other listing share this one rule.
type CategorizableProject = { category: string; skills: readonly string[] };
export function projectMatchesCategory(project: CategorizableProject, category: Category) {
  return category.match.some((name) => name === project.category)
    || project.skills.some((skill) => category.skills.some((name) => name.toLowerCase() === skill.toLowerCase()));
}
// The category a project is filed under: a label match wins over a skill match.
export function categoryForProject(project: CategorizableProject): Category | undefined {
  return categories.find((category) => category.match.some((name) => name === project.category))
    || categories.find((category) => projectMatchesCategory(project, category));
}

