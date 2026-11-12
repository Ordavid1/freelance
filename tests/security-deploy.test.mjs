import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('deploy script stays executable because deploy.yml runs it directly', () => {
  assert.ok(statSync('scripts/deploy-engine.sh').mode & 0o111, 'scripts/deploy-engine.sh must keep its executable bit');
});

test('release script deploys only a resolved digest and stops when the digest is invalid', () => {
  for (const valid of [true, false]) {
    const root = mkdtempSync(path.join(tmpdir(), 'freelance-release-test-'));
    try {
      for (const dir of ['scripts', 'deploy', 'bin']) mkdirSync(path.join(root, dir));
      copyFileSync('scripts/deploy-engine.sh', path.join(root, 'scripts/deploy-engine.sh'));
      writeFileSync(path.join(root, 'package.json'), '{}');
      writeFileSync(path.join(root, 'package-lock.json'), '{}');
      writeFileSync(path.join(root, 'deploy/production.env'), 'PROJECT_ID=test-project\nREGION=test-region\nSERVICE=test-engine\nREPOSITORY=test-repository\n');
      const log = path.join(root, 'calls.jsonl');
      writeFileSync(path.join(root, 'bin/gcloud'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'artifacts') console.log(process.env.TEST_DIGEST);
`, { mode: 0o755 });
      const digest = `sha256:${'a'.repeat(64)}`;
      const result = spawnSync('bash', [path.join(root, 'scripts/deploy-engine.sh')], { encoding: 'utf8', env: {
        PATH: `${path.join(root, 'bin')}:${process.env.PATH}`, GITHUB_SHA: 'test-revision',
        TEST_CALLS: log, TEST_DIGEST: valid ? digest : 'not-a-digest',
      } });
      const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const updates = calls.filter(args => args.slice(0, 3).join(' ') === 'run services update');
      assert.equal(result.status, valid ? 0 : 1, result.stderr);
      assert.equal(updates.length, valid ? 1 : 0);
      if (valid) assert.ok(updates[0].includes(`--image=test-region-docker.pkg.dev/test-project/test-repository/engine@${digest}`));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
