// `npm run package`  -> dist/freelance-place-xplace-import-<version>.zip (checked, deterministic)
// `npm run build:dev` -> dist-dev/ unpacked folder pointing at http://localhost:3000 (never zipped)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, listFiles, readManifest, runChecks, makeZip, devTransform } from './lib.mjs';

const dev = process.argv.includes('--dev');
const files = listFiles();
const problems = runChecks(ROOT, files);
if (problems.length) {
  console.error('Package checks FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}

if (dev) {
  const out = path.join(ROOT, 'dist-dev');
  fs.rmSync(out, { recursive: true, force: true });
  for (const f of files) {
    const target = path.join(out, f);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, devTransform(f, fs.readFileSync(path.join(ROOT, f))));
  }
  console.log(`Dev build: ${out} (load unpacked; bridge and FP_ORIGIN -> http://localhost:3000). Not for the Store.`);
} else {
  const version = readManifest().version;
  const entries = files.map((f) => ({ name: f, data: fs.readFileSync(path.join(ROOT, f)) }));
  const zip = makeZip(entries);
  if (zip.length >= 200 * 1024) { console.error(`Zip too large: ${zip.length} bytes`); process.exit(1); }
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  const target = path.join(ROOT, 'dist', `freelance-place-xplace-import-${version}.zip`);
  fs.writeFileSync(target, zip);
  console.log(`Checks passed (${files.length} files).\nZip: ${target}\nSize: ${zip.length} bytes`);
}
