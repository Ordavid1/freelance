'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('permissions exactly storage, no host permissions or powerful keys', () => {
  assert.deepEqual(manifest.permissions, ['storage']);
  for (const k of ['host_permissions', 'optional_host_permissions', 'optional_permissions', 'externally_connectable', 'web_accessible_resources']) assert.ok(!(k in manifest), k);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '0.2.0');
  assert.equal(manifest.incognito, 'not_allowed');
});

test('content script matches are exactly the allowed patterns', () => {
  assert.equal(manifest.content_scripts.length, 2);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://www.xplace.com/*', 'https://xplace.com/*']);
  assert.equal(manifest.content_scripts[0].run_at, 'document_idle');
  assert.deepEqual(manifest.content_scripts[1].matches, ['https://freelance-place.com/*']);
  assert.equal(manifest.content_scripts[1].run_at, 'document_start');
});

test('every referenced file exists and the bridge origin equals FP_ORIGIN', () => {
  const files = [manifest.background.service_worker, manifest.options_ui.page, ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap((c) => c.js)];
  for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), f);
  const { FPX } = require('./helpers/load');
  for (const m of manifest.content_scripts[1].matches) assert.ok(m.startsWith(FPX.config.FP_ORIGIN + '/'));
});

test('no remote code, eval or dynamic HTML in the shipped sources', async () => {
  const { runChecks } = await import('../scripts/lib.mjs');
  assert.deepEqual(runChecks(), []);
});

test('the checks do catch violations (self test on a temp copy)', async () => {
  const lib = await import('../scripts/lib.mjs');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fpx-'));
  for (const f of lib.listFiles()) { fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true }); fs.copyFileSync(path.join(root, f), path.join(tmp, f)); }
  const m = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8'));
  m.permissions = ['storage', 'tabs']; m.host_permissions = ['<all_urls>'];
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(m));
  fs.appendFileSync(path.join(tmp, 'src/config.js'), '\neval("1");\nimportScripts("https://x.example/a.js");\n');
  const problems = lib.runChecks(tmp);
  assert.ok(problems.some((p) => p.includes('permissions')));
  assert.ok(problems.some((p) => p.includes('host_permissions')));
  assert.ok(problems.some((p) => p.includes('eval(')));
  assert.ok(problems.some((p) => p.includes('importScripts')));
});

test('zip is deterministic and small', async () => {
  const lib = await import('../scripts/lib.mjs');
  const entries = () => lib.listFiles().map((f) => ({ name: f, data: fs.readFileSync(path.join(root, f)) }));
  const a = lib.makeZip(entries()); const b = lib.makeZip(entries());
  assert.ok(a.equals(b));
  assert.ok(a.length < 200 * 1024);
  assert.ok(!lib.listFiles().some((f) => f.startsWith('tests/') || f.includes('node_modules')));
});

test('localisation: Hebrew default, he and en messages for name and description', () => {
  assert.equal(manifest.default_locale, 'he');
  assert.equal(manifest.name, '__MSG_extName__');
  assert.equal(manifest.description, '__MSG_extDescription__');
  const he = JSON.parse(fs.readFileSync(path.join(root, '_locales/he/messages.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(root, '_locales/en/messages.json'), 'utf8'));
  assert.equal(he.extName.message, 'Freelance Place — XPlace Import');
  assert.equal(en.extName.message, 'Freelance Place — XPlace Import');
  assert.equal(he.extDescription.message, 'העבירו את הפרופיל והפרויקטים שלכם מ־XPlace אל Freelance Place בלחיצה אחת, ובדקו הכול לפני השמירה.');
  assert.equal(en.extDescription.message, 'Move your own XPlace profile and projects to Freelance Place in one click, and review everything before saving.');
});

test('package includes _locales', async () => {
  const lib = await import('../scripts/lib.mjs');
  const files = lib.listFiles();
  assert.ok(files.includes('_locales/he/messages.json') && files.includes('_locales/en/messages.json'));
});
