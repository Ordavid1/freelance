import { projectSkills } from './skills.ts';
// Shared project-input validation (no server-only imports so scripts can use it).
export type ProjectInput = { title: string; category: string; description: string; budget: string; deadline: string; skills: string[] };
export type ProjectInputResult = { ok: true; value: ProjectInput } | { ok: false; error: string };

export const PROJECT_CONTENT_ERROR = 'נדרשת כותרת ותיאור מלא של הפרויקט.';
export const PROJECT_DETAILS_ERROR = 'פרטי הפרויקט לא תקינים.';

export function validateProjectInput(body: unknown): ProjectInputResult {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : null;
  if (!input || typeof input.title !== 'string' || input.title.trim().length < 5 || input.title.length > 120 || typeof input.description !== 'string' || input.description.trim().length < 20 || input.description.length > 5000) {
    return { ok: false, error: PROJECT_CONTENT_ERROR };
  }
  if (typeof input.category !== 'string' || typeof input.budget !== 'string' || input.budget.length > 100 || typeof input.deadline !== 'string' || input.deadline.length > 100 || !Array.isArray(input.skills) || input.skills.length > 20 || input.skills.some((skill) => typeof skill !== 'string' || skill.length > 60)) {
    return { ok: false, error: PROJECT_DETAILS_ERROR };
  }
  return {
    ok: true,
    value: {
      title: input.title.trim(),
      category: input.category.trim().slice(0, 80),
      description: input.description.trim(),
      budget: input.budget.trim(),
      deadline: input.deadline.trim(),
      skills: projectSkills({ title: input.title as string, description: input.description as string, skills: input.skills as string[] }),
    },
  };
}
