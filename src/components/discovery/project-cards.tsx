import Link from 'next/link';
import type { Project } from '@/lib/data';
import { AI_AGENT_BADGE } from '@/lib/projects/presentation';
import { categoryForProject } from '@/lib/seo/categories';
import { isAiAgentProject, projectPath } from '@/lib/seo/listing';
import { summarize } from '@/lib/seo/site';
import { projectSkillTags } from '@/lib/seo/skill-match';
import { indexableSkills } from '@/lib/seo/skills';
import type { Skill } from '@/lib/seo/types';
import './taxonomy.css';

type CardProject = Pick<Project, 'slug' | 'title' | 'category' | 'budget' | 'description' | 'skills' | 'sample' | 'ownerKind'>;

// Crawlable project cards for public lists. Every title is a real link to /projects/<slug>;
// the category chip links to its category page and each skill tag links to a skill page when
// an indexable one exists (plain text otherwise). Projects published by the AI agent always
// carry the "סוכן AI" label.
export function ProjectCardList({ projects, skills, headingLevel = 3 }: { projects: readonly CardProject[]; skills?: readonly Skill[]; headingLevel?: 2 | 3 | 4 }) {
  const catalogue = skills ?? indexableSkills();
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  return <ul className="disc-cards">{projects.map((project) => {
    const category = categoryForProject(project);
    const tags = projectSkillTags(project, catalogue);
    return <li className="disc-card" key={project.slug}>
      <Heading className="disc-card-title"><Link href={projectPath(project.slug)}>{project.title}</Link></Heading>
      <p className="disc-card-meta">{isAiAgentProject(project) && <span className="ai-agent-badge">{AI_AGENT_BADGE}</span>}{project.category} · {project.budget}</p>
      <p className="disc-card-excerpt">{summarize(project.description, 150)}</p>
      {(category || tags.length > 0) && <ul className="disc-chips" aria-label="תחום וכישורים">
        {category && <li><Link className="disc-chip disc-chip-category" href={`/categories/${category.slug}`}>{category.name}</Link></li>}
        {tags.map(({ tag, skill }) => <li key={tag}>{skill ? <Link className="disc-chip" href={`/skills/${skill.slug}`}>{tag}</Link> : <span className="disc-chip">{tag}</span>}</li>)}
      </ul>}
    </li>;
  })}</ul>;
}

// Shown under any list that contains AI-agent projects, so they are never read as demand
// from human clients. Renders nothing when the list has none.
export function AiAgentNote({ projects }: { projects: readonly Pick<Project, 'sample' | 'ownerKind'>[] }) {
  if (!projects.some(isAiAgentProject)) return null;
  return <p className="disc-note" role="note">פרויקטים עם התווית &quot;{AI_AGENT_BADGE}&quot; מפורסמים על ידי סוכן AI של Freelance Place ולא על ידי לקוח/ה אנושי/ת. הצעה עליהם נשמרת בחשבון שלכם ואינה נשלחת ללקוח/ה אנושי/ת.</p>;
}
