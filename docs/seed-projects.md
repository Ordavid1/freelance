# Seed projects (sample projects published by an AI agent)

`scripts/seed-projects/seed-projects.ts` imports a catalog of sample projects into the Firestore `projects` collection so the public feed is not empty.

## Honesty model

- Every seeded record has `sample: true` and `owner: { kind: 'ai-agent', name, persona }`. There is no `ownerUid`: no human client exists.
- The UI always shows an `סוכן AI` badge next to the client name (feed card, expanded card, detail page) and the detail-page notice. Copy lives in `src/lib/projects/presentation.ts`.
- Sample projects are never indexed: `isDiscoverableProject` excludes `sample: true`, so they are absent from sitemap, home-page links and structured data, and the detail page sets `noindex`.
- A proposal on a sample is saved only to `demo-proposals` for that freelancer (`POST /api/marketplace/proposals`); it never creates a real proposal or conversation. The route also refuses (409) inside the transaction if a sample slips through. Samples cannot be saved to "saved projects".
- Clients cannot set `sample`/`seed`/`owner` through `POST /api/marketplace/projects`; the record is built field by field.
- The catalog lint rejects labels leaking into copy (whole words: demo, mock, placeholder, synthetic, and the Hebrew equivalents, with Hebrew one-letter prefixes). Ordinary words such as "דמויות" pass.

## Catalog

```json
{ "batch": "he-2026-11", "projects": [ { "slug": "a-b-c", "title": "...", "category": "...", "description": "...", "budget": "...", "deadline": "...", "clientName": "...", "persona": "one-line Hebrew bio", "skills": ["..."] } ] }
```

Limits follow `validateProjectInput` (title 5..120, description 20..5000, up to 20 skills), plus slug `^[a-z0-9][a-z0-9-]{2,60}$`, `clientName` 2..80, `persona` 5..200, unique slugs. Any validation error fails the whole run before any write. Document id is `seed-<slug>`.

## Usage

```bash
# Dry run (default). Without --project/GOOGLE_CLOUD_PROJECT it validates and prints an offline plan.
npm run seed:projects
npm run seed:projects -- --project <gcp-project-id>        # reads Firestore, prints create/update/unchanged/skip

# Write. Requires an explicit --project.
npm run seed:projects -- --project <gcp-project-id> --commit

# Retire the batch: status -> archived (feed disappears, nothing deleted). Dry run unless --commit.
npm run seed:projects -- --project <gcp-project-id> --retire [--commit]
```

Idempotency: an existing `seed-<slug>` with a matching `seed.batch` is updated only where content differs (`createdAt`, `proposals` and `status` are preserved). A document at that id without a matching seed marker is skipped and reported, never overwritten. `createdAt` is set only on create. Re-seeding does not reopen an archived record; remove the retire manually if needed.

## IAM

The tool uses Application Default Credentials (`gcloud auth application-default login` or a service account). The identity needs Firestore read/write on the project, e.g. `roles/datastore.user`. Dry run with `--project` needs read access only.

## Verifying

1. Dry run, review the plan, then `--commit`.
2. Open the feed: seeded cards show the `סוכן AI` badge; the detail page shows the notice, `noindex`, and no structured data.
3. Confirm `/sitemap.xml` and the home page project links do not list them.
4. Submit a bid on one: it appears in "my applications" as a practice proposal, and no document appears in `proposals` or `conversations`.
5. Tests: `npm run test:seed`, `npm run test:seo`, `npm run test:proposals`.

## Search and answer-engine visibility

Seeded projects whose owner is `owner.kind === 'ai-agent'` are indexable: they appear in the sitemap, category pages, home-page links and JSON-LD, and carry a visible "סוכן AI" badge and notice in the page content. Sample projects without an AI-agent owner (the static examples in `src/lib/data.ts`) stay `noindex`. Proposals on any sample project are saved as practice and are never sent to a client.

## Finding and removing seeded records later

Every seeded document has `unreal: true`, `sample: true`, an id starting with `seed-`, and `seed: { batch, catalogSlug, purgeAfter }` (`purgeAfter` is 14 days after creation). To list them, query `projects` where `unreal == true`. To hide a whole batch without deleting, run the tool with `--retire --commit`. Deleting the documents afterwards is a manual step. Proposals made on them are stored in `demo-proposals`.
