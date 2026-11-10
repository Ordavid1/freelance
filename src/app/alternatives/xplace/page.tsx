import Link from 'next/link';
import { PublicHeader, DiscoveryLinks, Questions } from '@/components/discovery/public-content';
import { StructuredData } from '@/components/discovery/structured-data';
import { comparisonSources, comparisonLead, comparisonRows, speedMethod, speedRows, speedWeightNote, type ComparisonRow } from '@/lib/seo/comparison';
import { comparisonPaymentsParagraph, getComparisonQuestions } from '@/lib/seo/content';
import { contactFacts, membershipFacts } from '@/lib/seo/facts';
import { metadataFor, requirePage } from '@/lib/seo/registry';
import { breadcrumbNode, webPageNode, withContext } from '@/lib/seo/schema';
const path = '/alternatives/xplace';
const { title, description, modified } = requirePage(path);
export const metadata = metadataFor(path);

function ComparisonTable({ caption, firstColumn, rows }: { caption: string; firstColumn: string; rows: ComparisonRow[] }) {
  return <div className="discovery-table"><table><caption>{caption}</caption><thead><tr><th scope="col">{firstColumn}</th><th scope="col">Freelance Place</th><th scope="col">XPlace.com</th></tr></thead><tbody>
    {rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td data-label="Freelance Place">{row.freelancePlace}</td><td data-label="XPlace.com">{row.xplace}</td></tr>)}
  </tbody></table></div>;
}

export default function XPlaceAlternative() {
  const facts = membershipFacts();
  const { email } = contactFacts();
  const sources = comparisonSources();
  return <>
    <PublicHeader />
    <main className="discovery-content">
      <nav aria-label="פירורי לחם"><Link href="/">דף הבית</Link> / אלטרנטיבה ל־XPlace.com</nav>
      <article>
        <p className="discovery-eyebrow">Freelance Place · עבודה עצמאית בישראל</p>
        <h1>{title}</h1>
        <p className="discovery-lead">{comparisonLead(facts)}</p>
        <p>מאת צוות Freelance Place · נבדק בתאריך <time dateTime={sources.checked}>{sources.checkedText}</time></p>

        <h2>איך לבחור את האלטרנטיבה הטובה ביותר ל־XPlace?</h2>
        <p>התחילו מהצורך שלכם: האם יש פרויקטים בתחום ההתמחות שלכם, האם היקף העבודה ברור, ואיך מתקדמים משיחה להצעה? השוו את העלות הכוללת, את ההתחייבות הכספית ואת המהירות והנוחות של הממשק. בדקו את המצב העדכני בכל שירות לפני הרשמה או תשלום.</p>

        <h2>מה מציע כל שירות?</h2>
        <ComparisonTable caption="השוואת מידע ציבורי ויכולות קיימות, נכון למועד הבדיקה" firstColumn="מה בודקים" rows={comparisonRows(facts)} />

        <h2>כמה מהר האתר נטען?</h2>
        <p>אתר מהיר חוסך זמן ונתוני גלישה, במיוחד במובייל. בדקנו את דף הבית של שני האתרים באותה שיטה ובאותו יום.</p>
        <ComparisonTable caption="מדידת מהירות של דף הבית, שני האתרים באותה שיטה" firstColumn="מדד" rows={speedRows()} />
        <p>{speedWeightNote()}</p>
        <p>{speedMethod()}</p>

        <h2>למי כדאי לבדוק את Freelance Place?</h2>
        <p>למי שמעדיפים להתמקד בפרויקט ובהצעה בלי לאבד את ההקשר. אפשר להתחיל בבניית פרופיל מחומרים שכבר יש לכם, לערוך את הכישורים ולבחון פרויקטים רלוונטיים. לקוחות יכולים להתחיל מתיאור הצורך ולחדד את התוצרים לפני פרסום.</p>
        <p>{comparisonPaymentsParagraph(facts)}</p>

        <h2>איך מתחילים?</h2>
        <ol><li>בוחנים את תחומי הפרויקטים ואת הדרישות.</li><li>מכינים פרופיל עם ניסיון ועבודות שבבעלותכם.</li><li>מנסחים הצעה שמגדירה תוצרים, מחיר ולוח זמנים.</li><li>בודקים את הפרטים ומאשרים את הפעולה לפני השליחה.</li></ol>
        <p><Link className="discovery-cta" href="/">לפרויקטים ולמרחב העבודה</Link> <Link href="/guides/project-brief">מדריך לכתיבת בריף</Link></p>

        <h2>מקור ושיטת ההשוואה</h2>
        <p>המידע על XPlace מבוסס על העמודים הציבוריים של XPlace.com, שנבדקו ב־{sources.checkedText}: {sources.links.map((link, index) => <span key={link.url}>{index > 0 && (index === sources.links.length - 1 ? ' ו' : ', ')}<a href={link.url} rel="external">{link.label}</a></span>)}. מחירים ותנאים משתנים, ולכן בדקו את הנוסח העדכני באתר שלהם לפני שמחליטים.</p>
        <p>המידע על Freelance Place מבוסס על היכולות בקוד ועל מסכי המוצר הנוכחיים, ומדידת המהירות מתוארת למעלה. ההשוואה אינה בודקת היקף מאגרים, כמות פרויקטים, הצלחת התאמות או זמן למציאת עבודה, ואת אלה כדאי לבדוק בעצמכם בשני האתרים.</p>
        <p>נתון לא מעודכן? כתבו אל <a href={`mailto:${email}`}>{email}</a> ונבדוק ונתקן.</p>
        <p>Freelance Place אינו קשור ל־XPlace. השם והדומיין מוזכרים לצורך זיהוי והשוואה.</p>
      </article>
      <Questions items={getComparisonQuestions(facts)} />
      <DiscoveryLinks />
      <StructuredData data={withContext(breadcrumbNode([{ name: 'דף הבית', path: '/' }, { name: title, path }]))} />
      <StructuredData data={withContext(webPageNode({ path, name: title, description, modified, citation: sources.links.map((link) => link.url) }))} />
    </main>
  </>;
}
