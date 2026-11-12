import { projectMatchesSkills, projectSkills } from '@/lib/projects/skills';

export type CompatibilityMetric = {
  score: number | null;
  matched: number;
  total: number;
  matches: string[];
  note: string;
};

export type CompatibilityAnalysis = {
  score: number | null;
  label: string;
  skills: CompatibilityMetric;
  experience: CompatibilityMetric;
  conclusion: string;
};

type RecordLike = Record<string, unknown>;

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const stringList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean) : [];
const percent = (matched: number, total: number) => total ? Math.round(matched / total * 100) : null;

/** Compare only professional profile fields and project requirements; never returns profile text or contact details. */
export function analyzeCompatibility(project: RecordLike, profile: RecordLike | null): CompatibilityAnalysis {
  const title = text(project.title);
  const description = [text(project.category), text(project.description)].filter(Boolean).join('\n');
  const requirements = projectSkills({ title, description, skills: stringList(project.skills) });
  const profileSkills = stringList(profile?.skills);
  const evidence = [profile?.headline, profile?.bio, profile?.portfolio, profile?.experience]
    .map(text).filter(Boolean).join('\n');

  const skillMatches = profileSkills.length
    ? requirements.filter(skill => projectMatchesSkills({ title: '', description: '', skills: [skill] }, profileSkills))
    : [];
  const evidenceMatches = evidence
    ? requirements.filter(skill => projectMatchesSkills({ title: '', description: evidence, skills: [] }, [skill]))
    : [];
  const skillsScore = percent(skillMatches.length, requirements.length);
  const experienceScore = percent(evidenceMatches.length, requirements.length);
  const weighted = [
    ...(skillsScore === null ? [] : [{ score: skillsScore, weight: 0.65 }]),
    ...(experienceScore === null ? [] : [{ score: experienceScore, weight: 0.35 }]),
  ];
  const totalWeight = weighted.reduce((sum, metric) => sum + metric.weight, 0);
  const score = totalWeight ? Math.round(weighted.reduce((sum, metric) => sum + metric.score * metric.weight, 0) / totalWeight) : null;
  const label = score === null ? 'מידע חסר' : score >= 80 ? 'גבוהה' : score >= 55 ? 'בינונית' : 'נמוכה';

  let conclusion: string;
  if (!requirements.length) {
    conclusion = 'בפרויקט לא הוגדרו כישורים ברורים להשוואה. כדאי לבחון את ההתאמה דרך השיחה והדוגמאות.';
  } else if (score === null) {
    conclusion = 'בפרופיל עדיין אין מספיק כישורים או ניסיון מתועד להשוואה. אפשר לבקש פרטים נוספים בשיחה.';
  } else if (score >= 80) {
    conclusion = experienceScore === null
      ? 'רוב הכישורים שנדרשו מופיעים בפרופיל. ניסיון מקצועי נוסף לא מתועד שם.'
      : 'נמצאה חפיפה גבוהה לכישורים בפרויקט, וגם חלק מהניסיון הרלוונטי מתועד בפרופיל.';
  } else if (score >= 55) {
    conclusion = 'יש חפיפה חלקית לדרישות. כדאי לברר בשיחה את הכישורים והניסיון שלא מופיעים בפרופיל.';
  } else {
    conclusion = 'החפיפה לפרטי הפרויקט מוגבלת לפי המידע בפרופיל. כדאי לבדוק התאמה בשיחה לפני שמחליטים.';
  }

  const makeMetric = (metricScore: number | null, matches: string[], known: boolean, label: string): CompatibilityMetric => ({
    score: metricScore,
    matched: matches.length,
    total: requirements.length,
    matches: matches.slice(0, 4),
    note: !requirements.length ? 'לא הוגדרו דרישות להשוואה' : !known ? `לא הוגדרו ${label} בפרופיל` : matches.length ? matches.slice(0, 3).join(' · ') : 'לא נמצאה חפיפה בפרטים שהוזנו',
  });

  return {
    score,
    label,
    skills: makeMetric(skillsScore, skillMatches, profileSkills.length > 0, 'כישורים'),
    experience: makeMetric(experienceScore, evidenceMatches, Boolean(evidence), 'התנסות מקצועית'),
    conclusion,
  };
}
