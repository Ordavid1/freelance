import Link from 'next/link';
import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { PublicHeader } from '@/components/discovery/public-content';
import { StructuredData } from '@/components/discovery/structured-data';
import { categories } from '@/lib/seo/categories';
import { formatHebrewDate } from '@/lib/seo/dates';
import { metadataFor, requirePage } from '@/lib/seo/registry';
import { collectionPageNode, withContext } from '@/lib/seo/schema';
import { indexableSkills } from '@/lib/seo/skills';

const path = '/skills';
export const metadata = metadataFor(path);

// Lists every skill page that passes the quality gate, grouped by category. Thin pages are
// never linked from here.
export default function SkillsHub() {
  const page = requirePage(path);
  const listed = indexableSkills();
  const known = new Set(categories.map((category) => category.slug));
  const groups = [
    ...categories.map((category) => ({ key: category.slug, heading: category.name, href: `/categories/${category.slug}` as string | undefined, skills: listed.filter((skill) => skill.category === category.slug) })),
    { key: 'other', heading: 'כישורים נוספים', href: undefined as string | undefined, skills: listed.filter((skill) => !known.has(skill.category)) },
  ].filter((group) => group.skills.length > 0);
  const modified = page.modified ? formatHebrewDate(page.modified) : undefined;
  return <>
    <PublicHeader />
    <main className="discovery-content">
      <Breadcrumbs items={[{ name: 'דף הבית', path: '/' }, { name: 'כישורים', path }]} />
      <h1>כישורים ושירותי פרילנסרים</h1>
      <p className="disc-brief"><strong>בקיצור:</strong> בעמודים האלה מוסבר מה כולל כל שירות, מה כדאי לבדוק לפני שבוחרים פרילנסר ומה משפיע על המחיר. בחרו כישור כדי לקרוא את ההסבר, לראות שאלות ותשובות ופרויקטים פתוחים שקשורים אליו.</p>
      <p className="disc-byline">מאת צוות Freelance Place{page.modified && <> · עודכן ב־<time dateTime={page.modified}>{modified ?? page.modified}</time></>}</p>
      {groups.length > 0 ? groups.map((group) => <section key={group.key} aria-labelledby={`skills-${group.key}`}>
        <h2 id={`skills-${group.key}`}>{group.href ? <Link href={group.href}>{group.heading}</Link> : group.heading}</h2>
        <ul className="disc-skill-grid">{group.skills.map((skill) => <li key={skill.slug}><h3><Link href={`/skills/${skill.slug}`}>{skill.name}</Link></h3><p>{skill.definition}</p></li>)}</ul>
      </section>) : <p className="disc-empty">עמודי הכישורים נמצאים בהכנה ויתווספו בקרוב.</p>}
      <section aria-labelledby="skills-cta">
        <h2 id="skills-cta">לא מצאתם את הכישור שלכם?</h2>
        <p className="disc-after">תארו מה אתם צריכים בפרויקט חדש, ופרילנסרים יוכלו להגיש הצעות. מחפשים עבודה? עיינו בפרויקטים הפתוחים.</p>
        <p className="disc-actions"><Link className="discovery-cta" href="/projects/new">לפרסום פרויקט</Link><Link href="/projects">לכל הפרויקטים הפתוחים</Link></p>
      </section>
      <StructuredData data={withContext(collectionPageNode({ path, name: page.title, description: page.description, items: listed.map((skill) => ({ name: skill.name, path: `/skills/${skill.slug}` })) }))} />
    </main>
  </>;
}
