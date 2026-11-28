import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';

const { validateProjectInput } = loadModule('src/lib/projects/validation.ts');
const { employmentTypeOf, isEmploymentType, EMPLOYMENT_LABELS } = loadModule('src/lib/projects/employment.ts');

const valid = { title: 'כותרת תקינה', category: 'כללי', description: 'תיאור ארוך מספיק של הפרויקט הזה.', budget: '', deadline: '', skills: [] };

test('employment type defaults to freelance and accepts the two known types', () => {
  assert.equal(validateProjectInput(valid).value.employmentType, 'freelance');
  assert.equal(validateProjectInput({ ...valid, employmentType: 'employee' }).value.employmentType, 'employee');
  assert.equal(validateProjectInput({ ...valid, employmentType: 'freelance' }).value.employmentType, 'freelance');
});

test('an unknown employment type is rejected server-side', () => {
  for (const bad of ['contractor', '', null, 1, {}]) assert.equal(validateProjectInput({ ...valid, employmentType: bad }).ok, false);
});

test('readers treat a missing or unknown stored value as freelance; labels are the Hebrew terms', () => {
  assert.equal(employmentTypeOf({}), 'freelance');
  assert.equal(employmentTypeOf({ employmentType: 'x' }), 'freelance');
  assert.equal(employmentTypeOf({ employmentType: 'employee' }), 'employee');
  assert.ok(isEmploymentType('employee') && !isEmploymentType('nope'));
  assert.equal(EMPLOYMENT_LABELS.freelance, 'פרילנס');
  assert.equal(EMPLOYMENT_LABELS.employee, 'שכיר');
});
