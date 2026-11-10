// Marketplace matching is deliberately independent of SEO page grouping: knowing
// TypeScript, for example, must not silently claim React expertise.
export function normalizeSkill(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g, '')
    .replace(/[‐‑–—־_/.,:()\[\]"״׳'’]/g, ' ').replace(/\s+/g, ' ').trim();
}
const groups = [
  ['WordPress', 'Word Press', 'וורדפרס'], ['WooCommerce', 'Woo Commerce', 'ווקומרס'],
  ['Shopify', 'שופיפיי'], ['Webflow', 'וובפלו', 'ווב פלואו'], ['Elementor', 'אלמנטור'],
  ['React', 'ReactJS', 'React.js', 'ריאקט'], ['Next.js', 'NextJS', 'Next JS', 'נקסט'],
  ['JavaScript', 'Java Script'], ['TypeScript', 'Type Script'], ['Node.js', 'NodeJS', 'Node JS'],
  ['Python', 'פייתון'], ['Figma', 'פיגמה'], ['Photoshop', 'פוטושופ'], ['Illustrator', 'אילוסטרייטור'],
  ['UX', 'User Experience', 'חוויית משתמש'], ['UI', 'User Interface', 'עיצוב ממשק'],
  ['UX/UI', 'UI/UX', 'עיצוב חוויית משתמש וממשק'], ['Product Design', 'עיצוב מוצר'],
  ['Graphic Design', 'עיצוב גרפי'], ['Branding', 'מיתוג'], ['Logo Design', 'עיצוב לוגו'],
  ['Copywriting', 'קופירייטינג', 'כתיבה שיווקית'], ['Content Writing', 'כתיבת תוכן'],
  ['SEO', 'קידום אתרים', 'קידום אורגני'], ['Google Ads', 'גוגל אדס'],
  ['Social Media Management', 'ניהול רשתות חברתיות', 'ניהול סושיאל'],
  ['Video Editing', 'עריכת וידאו'], ['After Effects', 'אפטר אפקטס'], ['Premiere Pro', 'פרמייר פרו'],
  ['Motion Graphics', 'Motion Design', 'מושן גרפיקס'], ['3D', 'תלת ממד', 'תלת מימד'],
  ['Unity', 'Unity3D'], ['Unreal Engine', 'Unreal', 'אנריל'],
  ['VR', 'Virtual Reality', 'מציאות מדומה'], ['AR', 'Augmented Reality', 'מציאות רבודה'],
  ['XR', 'Extended Reality'], ['Multiplayer', 'מולטיפלייר'], ['Hand Tracking', 'מעקב ידיים'],
  ['Automation', 'אוטומציה', 'אוטומציות'], ['Zapier', 'זאפייר'],
  ['Landing Page', 'Landing Pages', 'דף נחיתה', 'דפי נחיתה'],
  ['Ecommerce', 'E commerce', 'מסחר אלקטרוני', 'חנות מקוונת', 'חנויות מקוונות'],
  ['Web Development', 'פיתוח אתרים', 'בניית אתרים'], ['Responsive Design', 'עיצוב רספונסיבי'],
];
const aliases = groups.map(group => [...new Set(group.map(normalizeSkill))]);
function containsPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Hebrew prepositions attached to a tool name are common in briefs (ב־Figma / בFigma).
  return new RegExp(`(?:^|[^\\p{L}\\p{N}+#])(?:[בלוהכשמ]־?)?${escaped}(?=$|[^\\p{L}\\p{N}+#])`, 'u').test(text);
}
function skillKeys(value: string): string[] {
  const normalized = normalizeSkill(value);
  const keys = aliases.flatMap((group, index) => group.some(alias => containsPhrase(normalized, alias)) ? [`skill:${index}`] : []);
  return [normalized, ...keys].filter(Boolean);
}
export function projectMatchesSkills(project: { title: string; description: string; skills: readonly string[] }, profileSkills: readonly string[]): boolean {
  const projectKeys = new Set(project.skills.flatMap(skillKeys));
  const brief = normalizeSkill(`${project.title}\n${project.description}`);
  return profileSkills.some(tag => {
    const keys = skillKeys(tag);
    if (keys.some(key => projectKeys.has(key))) return true;
    // Recognised terms can recover missing tags; unknown long phrases may match
    // literally, but generic single words do not infer skills from prose.
    return keys.some(key => key.startsWith('skill:') && aliases[Number(key.slice(6))].some(alias => containsPhrase(brief, alias)))
      || (normalizeSkill(tag).split(' ').length > 1 && containsPhrase(brief, normalizeSkill(tag)));
  });
}
/** Keep author tags, and fill gaps only with skills explicitly named in the brief. */
export function projectSkills(project: { title: string; description: string; skills: readonly string[] }): string[] {
  const result = [...new Set(project.skills.map(skill => skill.trim()).filter(Boolean))];
  const keys = new Set(result.flatMap(skillKeys));
  const brief = normalizeSkill(`${project.title}\n${project.description}`);
  groups.forEach((group, index) => {
    if (!keys.has(`skill:${index}`) && aliases[index].some(alias => containsPhrase(brief, alias))) result.push(group[0]);
  });
  return result.slice(0, 20);
}

// Explicit, one-step neighbours only. Never add these to saved profile/project
// tags: an adjacent opportunity is an option to explore, not claimed expertise.
const adjacentPairs = [
  ['WordPress', 'WooCommerce'], ['WordPress', 'Elementor'],
  ['React', 'Next.js'], ['JavaScript', 'TypeScript'],
  ['UX', 'UI'], ['UX', 'Product Design'], ['UI', 'Figma'], ['Product Design', 'Figma'],
  ['Graphic Design', 'Branding'], ['Graphic Design', 'Logo Design'], ['Branding', 'Logo Design'],
  ['Copywriting', 'Content Writing'], ['Video Editing', 'Motion Graphics'],
  ['After Effects', 'Motion Graphics'], ['Premiere Pro', 'Video Editing'],
  ['VR', 'XR'], ['AR', 'XR'], ['Unity', 'Unreal Engine'], ['Automation', 'Zapier'],
];
const groupKey = (name: string) => `skill:${groups.findIndex(group => group[0] === name)}`;
const neighbours = adjacentPairs.map(([left, right]) => [groupKey(left), groupKey(right)]);
export type ProjectSkillMatch = { kind: 'direct' | 'adjacent' | 'none'; reason?: string };
export function projectSkillMatch(project: { title: string; description: string; skills: readonly string[] }, profileSkills: readonly string[], includeAdjacent = true): ProjectSkillMatch {
  if (projectMatchesSkills(project, profileSkills)) return { kind: 'direct' };
  if (!includeAdjacent) return { kind: 'none' };
  const required = new Set(projectSkills(project).flatMap(skillKeys));
  for (const tag of profileSkills) {
    const known = new Set(skillKeys(tag));
    for (const [left, right] of neighbours) {
      const target = known.has(left) && required.has(right) ? right : known.has(right) && required.has(left) ? left : null;
      if (target) return { kind: 'adjacent', reason: `${tag} ← ${groups[Number(target.slice(6))][0]}` };
    }
  }
  return { kind: 'none' };
}
