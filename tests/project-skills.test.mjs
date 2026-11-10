import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule } from './helpers/load-ts.mjs';
const { normalizeSkill, projectMatchesSkills: matches, projectSkills } = loadModule('src/lib/projects/skills.ts');
const project = (skills = [], title = '', description = '') => ({ skills, title, description });
test('normalization, bilingual names, compound skills and qualified profile tags match', () => {
  for (const [profile, tags] of [
    [' וורדפרס ', ['WordPress']], ['NextJS', ['Next.js']], ['UX / UI', ['UI/UX']],
    ['React development', ['React.js']], ['מציאות מדומה', ['Virtual Reality']],
    ['עיצוב גרפי', ['Graphic Design']], ['ווב־פלואו', ['Webflow']],
    ['ניהול רשתות חברתיות', ['Social Media Management']],
  ]) assert.equal(matches(project(tags), [profile]), true, profile);
  assert.equal(normalizeSkill('  NEXT.js  '), 'next js');
});
test('briefs recover missing tags without category matching or substring collisions', () => {
  assert.equal(matches(project([], 'פיתוח סביבת VR', 'דרוש ניסיון ב־Unreal Engine'), ['מציאות מדומה']), true);
  assert.equal(matches(project([], 'מערכת חדשה', 'העיצוב יוכן בFigma'), ['פיגמה']), true);
  assert.equal(matches(project([], 'הזדמנות', 'דרושה כתיבה שיווקית לאתר'), ['Copywriting']), true);
  for (const [tag, text] of [['UI', 'build tools'], ['AR', 'marketing'], ['React', 'reactive programming'], ['Java', 'JavaScript'], ['C', 'C++'], ['TypeScript', 'React'], ['ניהול', 'ניהול זמן חשוב']]) {
    assert.equal(matches(project([], text), [tag]), false, `${tag}: ${text}`);
  }
  assert.equal(matches(project(['React']), []), false);
  assert.equal(matches(project([]), ['']), false);
});
test('read and publish paths retain author tags and add explicitly mentioned skills', () => {
  const value = project(['Custom pipeline'], 'פיתוח Unity', 'מעקב ידיים במציאות מדומה');
  const skills = projectSkills(value);
  for (const skill of ['Custom pipeline', 'Unity', 'Hand Tracking', 'VR']) assert.ok(skills.includes(skill), skill);
  assert.ok(!skills.includes('Unreal Engine'));
  assert.equal(projectSkills(project(['WordPress'], 'וורדפרס')).filter(s => s === 'WordPress').length, 1);
  const { validateProjectInput } = loadModule('src/lib/projects/validation.ts');
  const result = validateProjectInput({title:'פיתוח Unity חדש',description:'דרוש ניסיון ב-Unity לפיתוח חוויית מציאות מדומה',skills:[],category:'כללי',budget:'',deadline:''});
  assert.equal(result.ok, true);
  assert.ok(result.value.skills.includes('Unity'));
});
test('seeded projects contain tags and match bilingual variants against the real catalogue', () => {
  const { projects } = JSON.parse(readFileSync('scripts/seed-projects/catalog.he.json','utf8'));
  assert.ok(projects.every(p => p.skills.length));
  assert.ok(projects.some(p => matches(p, ['וורדפרס'])));
  assert.ok(projects.some(p => matches(p, ['פיגמה'])));
  assert.ok(projects.some(p => matches(p, ['NextJS'])));
});

test('adjacent opportunities are one-hop, optional, explained and never stored as expertise', () => {
  const { projectSkillMatch } = loadModule('src/lib/projects/skills.ts');
  const next = project(['Next.js']);
  assert.equal(projectSkillMatch(next, ['React']).kind, 'adjacent');
  assert.match(projectSkillMatch(next, ['React']).reason, /React.*Next.js/);
  assert.equal(projectSkillMatch(next, ['React'], false).kind, 'none');
  assert.equal(projectSkillMatch(next, ['NextJS']).kind, 'direct');
  assert.equal(projectSkillMatch(next, ['Python']).kind, 'none');
  assert.equal(projectSkillMatch(project(['Elementor']), ['WooCommerce']).kind, 'none');
  assert.equal(projectSkillMatch(project(['WordPress']), ['ווקומרס']).kind, 'adjacent');
  assert.equal(projectSkillMatch(project([], 'פיתוח ב-Unreal Engine'), ['Unity']).kind, 'adjacent');
  assert.equal(projectSkills(project(['React'])).includes('Next.js'), false);
  assert.equal(matches(next, ['React']), false);
});
