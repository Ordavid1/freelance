import Link from 'next/link';
import type { Project } from '@/lib/data';
import { categoryForProject } from '@/lib/seo/categories';
import { projectPath } from '@/lib/seo/listing';
import { summarize } from '@/lib/seo/site';
import { projectSkillTags } from '@/lib/seo/skill-match';
import { indexableSkills } from '@/lib/seo/skills';
import type { Skill } from '@/lib/seo/types';
import './taxonomy.css';

type CardProject = Pick<Project, 'slug' | 'title' | 'category' | 'budget' | 'description' | 'skills'>;

// Crawlable project cards for public lists. Every title is a real link to /projects/<slug>;
// the category chip links to its category page and each skill tag links to a skill page when
// an indexable one exists (plain text otherwise). Public lists only ever receive discoverable
// projects (see publication.ts), so a card is always a real client's project.
export function ProjectCardList({ projects, skills, headingLevel = 3 }: { projects: readonly CardProject[]; skills?: readonly Skill[]; headingLevel?: 2 | 3 | 4 }) {
  const catalogue = skills ?? indexableSkills();
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  return <ul className="disc-cards">{projects.map((project) => {
    const category = categoryForProject(project);
    const tags = projectSkillTags(project, catalogue);
    return <li className="disc-card" key={project.slug}>
      <Heading className="disc-card-title"><Link href={projectPath(project.slug)}>{project.title}</Link></Heading>
      <p className="disc-card-meta">{project.category} · {project.budget}</p>
      <p className="disc-card-excerpt">{summarize(project.description, 150)}</p>
      {(category || tags.length > 0) && <ul className="disc-chips" aria-label="תחום וכישורים">
        {category && <li><Link className="disc-chip disc-chip-category" href={`/categories/${category.slug}`}>{category.name}</Link></li>}
        {tags.map(({ tag, skill }) => <li key={tag}>{skill ? <Link className="disc-chip" href={`/skills/${skill.slug}`}>{tag}</Link> : <span className="disc-chip">{tag}</span>}</li>)}
      </ul>}
    </li>;
  })}</ul>;
}
