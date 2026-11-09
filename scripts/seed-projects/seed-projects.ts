// Seed import tool for sample ("inspiration") projects.
//
//   node --experimental-transform-types scripts/seed-projects/seed-projects.ts \
//     --catalog scripts/seed-projects/catalog.he.json [--project <gcp-project-id>] [--commit] [--retire]
//
// Dry run by default. Writes only with --commit, which requires an explicit --project.
// Uses Application Default Credentials; see docs/seed-projects.md.
import { readFileSync } from 'node:fs';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import { buildCreateFields, diffSeedRecord, parseArgs, planRetire, planSeed, summarize, validateCatalog, type ExistingDoc, type PlanItem } from './catalog.ts';

const WRITE_CHUNK = 400;

function printPlan(title: string, items: PlanItem[]) {
  console.log(`\n${title}`);
  for (const item of items) console.log(`  ${item.action.padEnd(9)} ${item.id}${item.changed.length ? `  [${item.changed.join(', ')}]` : ''}${item.reason ? `  (${item.reason})` : ''}`);
  const counts = summarize(items);
  console.log(`  -> create ${counts.create}, update ${counts.update}, unchanged ${counts.unchanged}, skip ${counts.skip}`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) { console.error(parsed.error); process.exit(2); }
  const { catalog: catalogPath, commit, retire } = parsed.options;
  const projectId = parsed.options.project || process.env.GOOGLE_CLOUD_PROJECT;

  let json: unknown;
  try { json = JSON.parse(readFileSync(catalogPath, 'utf8')); }
  catch (error) { console.error(`Cannot read catalog ${catalogPath}: ${error instanceof Error ? error.message : error}`); process.exit(2); }
  const catalog = validateCatalog(json);
  if (!catalog.ok) {
    console.error(`Catalog is invalid (${catalog.errors.length} problem(s)); nothing was written:`);
    for (const message of catalog.errors) console.error(`  - ${message}`);
    process.exit(1);
  }
  const { batch, entries } = catalog;
  console.log(`Catalog OK: batch "${batch}", ${entries.length} project(s).`);
  console.log(`Mode: ${commit ? 'COMMIT' : 'DRY RUN'}${retire ? ' (retire)' : ''}; project: ${projectId || '(none, offline plan)'}`);

  if (!projectId) {
    if (retire) { console.error('--retire needs a project (--project or GOOGLE_CLOUD_PROJECT) to find the batch.'); process.exit(2); }
    printPlan('Offline plan (Firestore was not read; assumes nothing exists yet):', planSeed(entries, batch, new Map()));
    return;
  }

  const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }));
  const projects = db.collection('projects');

  if (retire) {
    const snapshot = await projects.where('seed.batch', '==', batch).get();
    const docs = snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() as DocumentData }));
    const plan = planRetire(docs, batch);
    printPlan(`Retire plan for batch "${batch}" (status -> archived):`, plan);
    if (!commit) { console.log('\nDry run: nothing was written. Re-run with --commit to apply.'); return; }
    const targets = plan.filter((item) => item.action === 'update');
    for (let start = 0; start < targets.length; start += WRITE_CHUNK) {
      const writes = db.batch();
      for (const item of targets.slice(start, start + WRITE_CHUNK)) writes.update(projects.doc(item.id), { status: 'archived', updatedAt: FieldValue.serverTimestamp() });
      await writes.commit();
    }
    console.log(`\nArchived ${targets.length} project(s).`);
    return;
  }

  const refs = entries.map((entry) => projects.doc(`seed-${entry.slug}`));
  const snapshots = await db.getAll(...refs);
  const existing = new Map<string, ExistingDoc>(snapshots.map((snapshot) => [snapshot.id, snapshot.exists ? snapshot.data() : null]));
  const plan = planSeed(entries, batch, existing);
  printPlan(`Seed plan for batch "${batch}":`, plan);
  if (!commit) { console.log('\nDry run: nothing was written. Re-run with --commit --project <id> to apply.'); return; }

  const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));
  type Write = { ref: DocumentReference; kind: 'create' | 'update'; data: DocumentData };
  const writes = plan.flatMap((item): Write[] => {
    const entry = bySlug.get(item.slug)!;
    if (item.action === 'create') return [{ ref: projects.doc(item.id), kind: 'create', data: { ...buildCreateFields(entry, batch), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() } }];
    if (item.action === 'update') return [{ ref: projects.doc(item.id), kind: 'update', data: { ...diffSeedRecord(entry, existing.get(item.id) as DocumentData), updatedAt: FieldValue.serverTimestamp() } }];
    return [];
  });
  for (let start = 0; start < writes.length; start += WRITE_CHUNK) {
    const batchWrite = db.batch();
    for (const write of writes.slice(start, start + WRITE_CHUNK)) {
      if (write.kind === 'create') batchWrite.create(write.ref, write.data); else batchWrite.update(write.ref, write.data);
    }
    await batchWrite.commit();
  }
  const counts = summarize(plan);
  console.log(`\nWrote ${counts.create} create(s) and ${counts.update} update(s); ${counts.skip} skipped, ${counts.unchanged} unchanged.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
