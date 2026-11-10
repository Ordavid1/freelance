import Link from 'next/link';
import type { Project } from '@/lib/data';
import { formatHebrewDate } from '@/lib/seo/dates';
import { projectCountSentence } from '@/lib/seo/listing';
import type { GuideLink } from '@/lib/seo/linking';
import { summarize } from '@/lib/seo/site';
import type { Skill } from '@/lib/seo/types';
import { ProjectCardList } from './project-cards';
import { Questions } from './public-content';
import './taxonomy.css';

export const SKILL_PROJECT_LIMIT = 6;

type Props = {
  skill: Skill;
  category?: { slug: string; name: string };
  related: readonly Skill[];
  guides: readonly GuideLink[];
  // Open public projects that match the skill, newest first.
  projects: readonly Project[];
};

// The answer-first skill page body: H1, the "בקיצור" definition, byline with the modified
// date, the sections people look for (when it is needed, deliverables, how to choose, price
// drivers), FAQ, sources, related pages, real matching projects and a call to action.
export function SkillArticle({ skill, category, related, guides, projects }: Props) {
  const modified = formatHebrewDate(skill.modified);
  const shown = projects.slice(0, SKILL_PROJECT_LIMIT);
  const count = projectCountSentence(projects.length, { one: 'הקשור לכישור הזה', many: 'הקשורים לכישור הזה' });
  return <article>
    <p className="disc-eyebrow"><Link href="/skills">כישורים</Link>{category && <> · <Link href={`/categories/${category.slug}`}>{category.name}</Link></>}</p>
    <h1>{skill.name}</h1>
    <p className="disc-brief"><strong>בקיצור:</strong> {skill.definition}</p>
    <p className="disc-byline">מאת צוות Freelance Place · עודכן ב־<time dateTime={skill.modified}>{modified ?? skill.modified}</time></p>

    <h2>{`מתי צריך ${skill.name}?`}</h2>
    <p className="disc-after">{skill.whenNeeded}</p>

    <h2>מה מקבלים בסוף העבודה?</h2>
    <p className="disc-after">בסוף העבודה אמורים להיות בידיכם התוצרים הבאים. כדאי להסכים עליהם בכתב לפני שמתחילים:</p>
    <ul className="disc-list">{skill.deliverables.map((item) => <li key={item}>{item}</li>)}</ul>

    <h2>איך בוחרים פרילנסר?</h2>
    <p className="disc-after">בוחרים לפי עבודות קודמות שאפשר לבדוק, תהליך עבודה ברור ותנאי מסירה שסוכמו מראש. אלה הבדיקות המומלצות:</p>
    <ul className="disc-list">{skill.howToChoose.map((item) => <li key={item}>{item}</li>)}</ul>

    <h2>מה משפיע על המחיר?</h2>
    <p className="disc-after">המחיר נקבע לפי היקף העבודה והדרישות שלה. אלה הגורמים העיקריים בתחום הזה:</p>
    <ul className="disc-list">{skill.priceDrivers.map((item) => <li key={item}>{item}</li>)}</ul>
    <p className="disc-after">השוו הצעות רק כשהן מתייחסות לאותה רשימת תוצרים ולאותו היקף עבודה.</p>

    <Questions items={skill.questions} />

    {skill.sources && skill.sources.length > 0 && <section aria-labelledby="skill-sources">
      <h2 id="skill-sources">מקורות</h2>
      <ul className="disc-sources">{skill.sources.map((source) => <li key={source.url}><a href={source.url} rel="noopener">{source.name}</a> · נבדק ב־<time dateTime={source.checked}>{formatHebrewDate(source.checked) ?? source.checked}</time></li>)}</ul>
    </section>}

    {skill.disclaimer && <p className="disc-disclaimer" role="note">{skill.disclaimer}</p>}

    {related.length > 0 && <section aria-labelledby="skill-related">
      <h2 id="skill-related">כישורים קרובים</h2>
      <ul className="disc-link-list">{related.map((item) => <li key={item.slug}><Link href={`/skills/${item.slug}`}>{item.name}</Link><p>{summarize(item.definition, 120)}</p></li>)}</ul>
    </section>}

    {guides.length > 0 && <section aria-labelledby="skill-guides">
      <h2 id="skill-guides">מדריכים שיעזרו</h2>
      <ul className="disc-link-list">{guides.map((guide) => <li key={guide.path}><Link href={guide.path}>{guide.title}</Link></li>)}</ul>
    </section>}

    <section aria-labelledby="skill-projects">
      <h2 id="skill-projects">פרויקטים פתוחים שקשורים לכישור הזה</h2>
      {projects.length > 0 ? <>
        <p className="disc-status">{count}{projects.length > shown.length ? ` מוצגים כאן ${shown.length} הפרויקטים האחרונים שפורסמו.` : ''}</p>
        <ProjectCardList projects={shown} />
      </> : <p className="disc-empty">כרגע אין באתר פרויקטים פתוחים שמסומנים בכישור הזה. הרשימה מתעדכנת עם כל פרסום חדש, ואפשר לפרסם פרויקט משלכם או לעיין בכל הפרויקטים הפתוחים.</p>}
    </section>

    <section aria-labelledby="skill-cta">
      <h2 id="skill-cta">יש לכם פרויקט בתחום הזה?</h2>
      <p className="disc-after">פרסמו אותו כדי שפרילנסרים יוכלו להגיש הצעות. מחפשים עבודה? עיינו בפרויקטים הפתוחים.</p>
      <p className="disc-actions"><Link className="discovery-cta" href="/projects/new">לפרסום פרויקט</Link><Link href="/projects">לכל הפרויקטים הפתוחים</Link></p>
    </section>
  </article>;
}
