export type Project = {
  slug: string; title: string; category: string; description: string; budget: string;
  deadline: string; posted: string; client: string; clientHistory: string;
  skills: string[]; fit: string; activity: string; proposals: number; featured?: boolean; sample?: boolean;
};

export const projects: Project[] = [
  { slug: 'brand-language', title: 'מחפשים קול חדש למותג קפה מקומי', category: 'מיתוג ותוכן', description: 'אנחנו בית קלייה קטן מחיפה, עם מוצר מעולה אבל שפה שלא מספרת את הסיפור. מחפשים שותף/ה לדיוק הטון, כתיבת עמוד הבית וכמה חומרים להשקה.', budget: '₪4,000–6,000', deadline: 'עד 12 בדצמבר', posted: 'לפני 24 דקות', client: 'קלייה צפונית', clientHistory: '4 פרויקטים הושלמו · תגובה תוך יום', skills: ['אסטרטגיית מותג', 'קופירייטינג', 'עברית'], fit: 'מתאים ל־3 מהכישורים שלך', activity: 'הלקוח/ה פעיל/ה עכשיו', proposals: 6, featured: true, sample: true },
  { slug: 'shopify-refresh', title: 'שדרוג חוויית החנות ב־Shopify', category: 'עיצוב מוצר', description: 'חנות פעילה למוצרי טיפוח טבעיים. צריך לרענן את עמוד הבית ואת תהליך הרכישה, בלי לפגוע בהמרות הקיימות.', budget: '₪7,000–10,000', deadline: 'גמיש · תחילת עבודה השבוע', posted: 'לפני שעה', client: 'Noya Botanics', clientHistory: '9 פרויקטים הושלמו · תגובה תוך 3 שעות', skills: ['Shopify', 'UX/UI', 'Figma'], fit: 'מתאים ל־2 מהכישורים שלך', activity: 'התקבלו 3 הצעות חדשות', proposals: 11, sample: true },
  { slug: 'founder-site', title: 'אתר תדמית לסטודיו אדריכלות', category: 'פיתוח אתרים', description: 'סטודיו בוטיק מחפש אתר מהיר ונגיש שמציג פרויקטים ותהליך עבודה. יש עיצוב מוכן ב־Figma, דרושה בנייה ב־Webflow או Next.js.', budget: '₪9,000–14,000', deadline: 'עד 20 בדצמבר', posted: 'אתמול', client: 'סטודיו קו', clientHistory: '2 פרויקטים הושלמו · לקוח/ה חדש/ה', skills: ['Webflow', 'Next.js', 'נגישות'], fit: 'מתאים ל־1 מהכישורים שלך', activity: 'הצעות נסגרות בעוד 5 ימים', proposals: 4, sample: true },
  { slug: 'launch-motion', title: 'אנימציה קצרה להשקת אפליקציה', category: 'וידאו ואנימציה', description: 'אנימציה של 15–20 שניות לרשתות החברתיות. יש שפה עיצובית, צריך להפוך אותה לתנועה ולספק כמה יחסי מסך.', budget: '₪2,500–4,000', deadline: 'עד 4 בדצמבר', posted: 'לפני 3 שעות', client: 'Luma Health', clientHistory: '6 פרויקטים הושלמו · תגובה תוך יום', skills: ['Motion design', 'After Effects', 'וידאו'], fit: 'מתאים ל־2 מהכישורים שלך', activity: 'הלקוח/ה ענה/תה היום', proposals: 8, sample: true },
];

export function getProject(slug: string) { return projects.find((project) => project.slug === slug); }
