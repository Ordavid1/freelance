import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildCreateFields, findForbiddenTerm, parseArgs, planClose, planRetire, planSeed, seedDocId, validateCatalog } from '../scripts/seed-projects/catalog.ts';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/seed-catalog.fixture.json', import.meta.url), 'utf8'));
const valid = fixture();

test('a valid catalog is accepted and normalised', () => {
  const result = validateCatalog(valid);
  assert.equal(result.ok, true);
  assert.equal(result.batch, 'fixture-batch');
  assert.equal(result.entries.length, 2);
  const withSpaces = fixture();
  withSpaces.projects[0].title = `  ${withSpaces.projects[0].title}  `;
  withSpaces.projects[0].skills = ['Webflow', ' Webflow ', 'עיצוב'];
  const trimmed = validateCatalog(withSpaces);
  assert.equal(trimmed.entries[0].title, valid.projects[0].title);
  assert.deepEqual(trimmed.entries[0].skills, ['Webflow', 'עיצוב']);
});

test('invalid entries are all reported and nothing is accepted', () => {
  const bad = fixture();
  bad.projects[0].slug = 'Bad Slug';
  bad.projects[1].clientName = 'x';
  bad.projects[1].title = 'קצר';
  bad.projects[1].sample = false;
  const result = validateCatalog(bad);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 4);
  assert.equal(validateCatalog({ batch: 'x', projects: [] }).ok, false);
  assert.equal(validateCatalog(null).ok, false);
  assert.equal(validateCatalog({ ...valid, batch: 'Bad Batch' }).ok, false);
});

test('persona is required, linted and compared on update', () => {
  const missing = fixture();
  delete missing.projects[0].persona;
  assert.equal(validateCatalog(missing).ok, false);
  const lint = fixture();
  lint.projects[0].persona = 'גרסת דמו של בעלת עסק';
  assert.equal(validateCatalog(lint).ok, false);
  const { batch, entries } = validateCatalog(valid);
  const stored = { ...buildCreateFields(entries[0], batch), owner: { persona: entries[0].persona, name: entries[0].clientName, kind: 'ai-agent' } };
  assert.deepEqual(planSeed([entries[0]], batch, new Map([[seedDocId(entries[0].slug), stored]])).map((item) => item.action), ['unchanged']);
  const changed = { ...stored, owner: { ...stored.owner, persona: 'אחר לגמרי' } };
  assert.deepEqual(planSeed([entries[0]], batch, new Map([[seedDocId(entries[0].slug), changed]]))[0].changed, ['owner']);
});

test('duplicate slugs are rejected', () => {
  const dup = fixture();
  dup.projects[1].slug = dup.projects[0].slug;
  const result = validateCatalog(dup);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes('duplicate slug')));
});

test('content lint rejects whole-word labels but allows ordinary Hebrew words', () => {
  for (const text of ['גרסת דמו', 'Demo project', 'ההדגמה', 'לדמו', 'תוכן סינתטי', 'MOCK data', 'a placeholder text']) assert.notEqual(findForbiddenTerm(text), null, text);
  for (const text of ['דמויות ילדים', 'דמות ראשית', 'mockup design', 'אתר לקונדיטוריה']) assert.equal(findForbiddenTerm(text), null, text);
  for (const field of ['title', 'description', 'clientName', 'category', 'budget', 'deadline']) {
    const bad = fixture();
    bad.projects[0][field] = `${bad.projects[0][field]} demo`;
    assert.equal(validateCatalog(bad).ok, false, field);
  }
  const skill = fixture();
  skill.projects[0].skills.push('גרסת דמו');
  assert.equal(validateCatalog(skill).ok, false);
  const characters = fixture();
  characters.projects[0].title = 'איורים של דמויות ילדים לספר';
  assert.equal(validateCatalog(characters).ok, true);
});

test('arguments: dry run by default, commit needs an explicit project', () => {
  assert.deepEqual(parseArgs(['--catalog', 'c.json']).options, { catalog: 'c.json', commit: false, retire: false, close: false });
  assert.equal(parseArgs(['--catalog', 'c.json', '--commit']).ok, false);
  assert.equal(parseArgs(['--catalog', 'c.json', '--commit', '--project', 'p']).options.commit, true);
  assert.equal(parseArgs([]).ok, false);
  assert.equal(parseArgs(['--catalog', 'c.json', '--nope']).ok, false);
});

test('arguments: --close is its own mode and cannot be combined with --retire', () => {
  assert.equal(parseArgs(['--catalog', 'c.json', '--close']).options.close, true);
  assert.equal(parseArgs(['--catalog', 'c.json', '--close']).options.commit, false);
  assert.equal(parseArgs(['--catalog', 'c.json', '--close', '--commit', '--project', 'p']).options.commit, true);
  assert.equal(parseArgs(['--catalog', 'c.json', '--close', '--commit']).ok, false, 'commit still needs an explicit project');
  assert.equal(parseArgs(['--catalog', 'c.json', '--close', '--retire']).ok, false);
});

test('plan computation: create, update, unchanged and skip-foreign', () => {
  const { batch, entries } = validateCatalog(valid);
  const [first, second] = entries;
  const stored = (entry, extra = {}) => ({ ...buildCreateFields(entry, batch), createdAt: 1, ...extra });
  assert.deepEqual(planSeed(entries, batch, new Map()).map((item) => item.action), ['create', 'create']);
  const existing = new Map([[seedDocId(first.slug), stored(first, { title: 'old title', proposals: 7 })], [seedDocId(second.slug), stored(second)]]);
  const plan = planSeed(entries, batch, existing);
  assert.deepEqual(plan.map((item) => item.action), ['update', 'unchanged']);
  assert.deepEqual(plan[0].changed, ['title']);
  const foreign = new Map([[seedDocId(first.slug), { title: 'someone else', ownerUid: 'u1' }], [seedDocId(second.slug), stored(second, { seed: { batch: 'other', catalogSlug: second.slug } })]]);
  assert.deepEqual(planSeed(entries, batch, foreign).map((item) => item.action), ['skip', 'skip']);
  const unsafe = new Map([[seedDocId(first.slug), stored(first, { sample: false, visibility: 'private' })]]);
  assert.deepEqual(planSeed([first], batch, unsafe)[0].changed.sort(), ['sample', 'visibility']);
});

test('created records are honest samples with no owner', () => {
  const { batch, entries } = validateCatalog(valid);
  const record = buildCreateFields(entries[0], batch);
  assert.equal(record.sample, true);
  assert.equal(record.status, 'closed', 'a showcase record is created closed: no client is hiring');
  assert.equal(record.visibility, 'public');
  assert.equal(record.proposals, 0);
  assert.equal(record.unreal, true);
  assert.match(record.seed.purgeAfter, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual({ ...record.seed, purgeAfter: undefined }, { batch, catalogSlug: entries[0].slug, purgeAfter: undefined });
  assert.equal('ownerUid' in record, false);
  assert.deepEqual(record.owner, { kind: 'ai-agent', name: entries[0].clientName, persona: entries[0].persona });
});

test('retire plan archives only seed records of the batch', () => {
  const docs = [
    { id: 'seed-a-project', data: { sample: true, status: 'open', seed: { batch: 'b', catalogSlug: 'a-project' } } },
    { id: 'seed-b-project', data: { sample: true, status: 'archived', seed: { batch: 'b', catalogSlug: 'b-project' } } },
    { id: 'real-one', data: { status: 'open', seed: { batch: 'b' } } },
  ];
  assert.deepEqual(planRetire(docs, 'b').map((item) => item.action), ['update', 'unchanged', 'skip']);
});

test('close plan closes only open seed records of the batch and leaves every other state alone', () => {
  const seed = (extra = {}, batch = 'b') => ({ sample: true, seed: { batch, catalogSlug: 'x' }, ...extra });
  const docs = [
    { id: 'seed-a-project', data: seed({ status: 'open' }) },
    { id: 'seed-b-project', data: seed({ status: 'closed' }) },
    { id: 'seed-c-project', data: seed({ status: 'archived' }) },
    { id: 'seed-d-project', data: seed() },
    { id: 'real-one', data: { status: 'open', sample: true, seed: { batch: 'b', catalogSlug: 'x' } } },
    { id: 'seed-e-project', data: seed({ status: 'open' }, 'other') },
    { id: 'seed-f-project', data: { status: 'open', seed: { batch: 'b', catalogSlug: 'f' } } },
  ];
  const plan = planClose(docs, 'b');
  assert.deepEqual(plan.map((item) => item.action), ['update', 'unchanged', 'skip', 'skip', 'skip', 'skip', 'skip']);
  assert.deepEqual(plan[0].changed, ['status']);
  assert.match(plan[2].reason, /archived/, 'a retired record is never reopened as closed');
  assert.match(plan[3].reason, /null/, 'a record without a status is reported, not guessed');
  for (const index of [4, 5, 6]) assert.equal(plan[index].reason, 'not a seed record of this batch');
  assert.deepEqual(planClose(docs, 'b').filter((item) => item.action === 'update').map((item) => item.id), ['seed-a-project']);
});

test('re-seeding never changes a record status, so a closed seed stays closed', () => {
  const { batch, entries } = validateCatalog(valid);
  const [first] = entries;
  for (const status of ['open', 'closed', 'archived']) {
    const stored = { ...buildCreateFields(first, batch), createdAt: 1, status };
    assert.deepEqual(planSeed([first], batch, new Map([[seedDocId(first.slug), stored]])).map((item) => item.action), ['unchanged'], status);
  }
});
