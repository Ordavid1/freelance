#!/usr/bin/env node
// Bulk-submits the URLs of the live sitemap to IndexNow, which shares them with Bing, Yandex, Naver,
// Seznam and the other participating engines. Use it after a launch, a migration or a large content
// change. Single project changes are announced automatically (src/lib/projects/events.ts), and
// resubmitting unchanged URLs on a schedule only wastes the quota, so this is a manual tool.
//
//   SITE_URL=<origin> npm run seo:indexnow -- --dry-run   read the sitemap, check the key file, send nothing
//   SITE_URL=<origin> npm run seo:indexnow                submit
//
// SITE_URL (or NEXT_PUBLIC_SITE_URL) is required and is never assumed: it must be the HTTPS origin of the
// live site. INDEXNOW_KEY overrides the key exactly as it does on the server. Protocol and response codes:
// https://www.indexnow.org/documentation
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Kept in step with src/lib/seo/indexnow.ts (tests/seo-indexnow.test.mjs fails when they drift): this
// script is plain Node and cannot import that TypeScript module.
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const DEFAULT_INDEXNOW_KEY = '937d6e4c8033ee12864f2c5c27fcf898';
export const INDEXNOW_MAX_URLS = 10_000;
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
const MAX_CHILD_SITEMAPS = 50;
const TIMEOUT_MS = 20_000;
const SAMPLE_SIZE = 10;
const HINTS = {
  400: 'the request was malformed',
  403: 'the key file is missing or does not match the key',
  422: 'the URLs do not belong to the host, or the key does not match the protocol schema',
  429: 'too many requests, try again later',
};

export const USAGE = `Usage: SITE_URL=<origin> node scripts/indexnow-submit.mjs [--dry-run] [--batch-size N]
Submits every URL listed in <origin>/sitemap.xml to IndexNow.
  --dry-run       read the sitemap and check the key file, but send nothing
  --batch-size N  URLs per request, 1 to ${INDEXNOW_MAX_URLS} (default ${INDEXNOW_MAX_URLS})
Environment: SITE_URL or NEXT_PUBLIC_SITE_URL (required: the HTTPS origin of the live site),
INDEXNOW_KEY (optional key override).`;

// A failure with a message that is safe to print; `exitCode` 2 marks a usage or configuration error.
export class ScriptError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}
const usage = (message) => new ScriptError(message, 2);

export function parseArgs(argv) {
  const options = { dryRun: false, batchSize: INDEXNOW_MAX_URLS, help: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--batch-size' || argument.startsWith('--batch-size=')) {
      const raw = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argv[++index];
      const size = /^\d+$/.test(raw ?? '') ? Number(raw) : Number.NaN;
      if (!Number.isSafeInteger(size) || size < 1 || size > INDEXNOW_MAX_URLS) throw usage(`--batch-size must be a whole number from 1 to ${INDEXNOW_MAX_URLS}.`);
      options.batchSize = size;
    } else throw usage(`Unknown argument: ${argument}`);
  }
  return options;
}

// The same rule the site applies to its own origin (src/lib/seo/site.ts).
export function siteOrigin(env) {
  const raw = (env.SITE_URL || env.NEXT_PUBLIC_SITE_URL || '').trim();
  if (!raw) throw usage('Set SITE_URL (or NEXT_PUBLIC_SITE_URL) to the HTTPS origin of the live site.');
  let url;
  try { url = new URL(raw); } catch { throw usage('SITE_URL is not a valid URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw usage('SITE_URL must be an HTTPS origin without credentials, path, query or fragment.');
  }
  return url.origin;
}

// A configured key the protocol would reject is ignored, as on the server.
export function indexNowKey(env) {
  const configured = env.INDEXNOW_KEY?.trim();
  return configured && KEY_PATTERN.test(configured) ? configured : DEFAULT_INDEXNOW_KEY;
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
// A sitemap is either a urlset (pages) or a sitemapindex (more sitemaps); both list their targets in <loc>.
export function parseSitemap(xml) {
  const locs = [...xml.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/gi)]
    .map((match) => match[1].replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity]))
    .filter(Boolean);
  return { index: /<sitemapindex[\s>]/i.test(xml), locs };
}

// Only absolute URLs on the site's own origin and without credentials; fragments dropped, duplicates removed.
export function selectUrls(locs, origin) {
  const accepted = new Set();
  for (const loc of locs) {
    let url;
    try { url = new URL(loc); } catch { continue; }
    if (url.origin !== origin || url.username || url.password) continue;
    url.hash = '';
    accepted.add(url.href);
  }
  return [...accepted];
}

export function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

export function buildPayload(origin, key, urls) {
  return { host: new URL(origin).host, key, keyLocation: `${origin}/${key}.txt`, urlList: urls };
}

async function readText(http, url, timeoutMs, failure) {
  let response;
  try { response = await http(url, { signal: AbortSignal.timeout(timeoutMs) }); } catch { throw new ScriptError(`${failure}.`); }
  if (response.status !== 200) throw new ScriptError(`${failure} (HTTP ${response.status}).`);
  return response.text();
}

// The URLs of <origin>/sitemap.xml, following one level of sitemap index.
export async function collectSitemapUrls(origin, http, timeoutMs = TIMEOUT_MS) {
  const root = parseSitemap(await readText(http, `${origin}/sitemap.xml`, timeoutMs, 'The sitemap could not be read'));
  if (!root.index) return selectUrls(root.locs, origin);
  const children = selectUrls(root.locs, origin);
  if (children.length > MAX_CHILD_SITEMAPS) throw new ScriptError(`The sitemap index lists more than ${MAX_CHILD_SITEMAPS} sitemaps.`);
  const locs = [];
  for (const child of children) {
    const parsed = parseSitemap(await readText(http, child, timeoutMs, 'A sitemap listed in the index could not be read'));
    if (parsed.index) throw new ScriptError('Nested sitemap indexes are not supported.');
    locs.push(...parsed.locs);
  }
  return selectUrls(locs, origin);
}

// IndexNow verifies ownership by fetching the key file, which must answer 200 with the key.
export async function keyFileIsLive(origin, key, http, timeoutMs = TIMEOUT_MS) {
  try {
    const response = await http(`${origin}/${key}.txt`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    return response.status === 200 && (await response.text()).trim() === key;
  } catch {
    return false;
  }
}

export async function submitBatch(endpoint, payload, http, timeoutMs = TIMEOUT_MS) {
  try {
    const response = await http(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
      // Never forward the payload to a host the endpoint redirects to.
      redirect: 'manual',
    });
    await response.body?.cancel().catch(() => undefined);
    return { ok: response.status === 200 || response.status === 202, status: response.status };
  } catch {
    return { ok: false, status: null };
  }
}

// Returns the process exit code: 0 done, 1 failed, 2 usage or configuration error. Never throws and prints
// only counts, statuses and fixed messages (never raw errors).
export async function run(argv, env = process.env, { fetch: http = fetch, log = console.log, warn = console.error, endpoint = INDEXNOW_ENDPOINT, timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const options = parseArgs(argv);
    if (options.help) { log(USAGE); return 0; }
    const origin = siteOrigin(env);
    const key = indexNowKey(env);
    const urls = await collectSitemapUrls(origin, http, timeoutMs);
    if (urls.length === 0) throw new ScriptError('The sitemap lists no URLs on the site origin, so there is nothing to submit.');
    const batches = chunk(urls, options.batchSize);
    log(`Sitemap: ${urls.length} URLs on ${new URL(origin).host}, ${batches.length} batch${batches.length === 1 ? '' : 'es'} of up to ${options.batchSize}.`);
    const live = await keyFileIsLive(origin, key, http, timeoutMs);
    log(live ? 'Key file: live.' : `Key file: NOT live at ${origin}/${key}.txt (it must answer 200 with the key).`);
    if (options.dryRun) {
      for (const url of urls.slice(0, SAMPLE_SIZE)) log(`  ${url}`);
      if (urls.length > SAMPLE_SIZE) log(`  ... and ${urls.length - SAMPLE_SIZE} more`);
      log('Dry run: nothing was submitted.');
      return 0;
    }
    if (!live) throw new ScriptError('Nothing was submitted: deploy the key file first, because IndexNow rejects submissions it cannot verify.');
    let accepted = 0;
    for (const [index, batch] of batches.entries()) {
      const result = await submitBatch(endpoint, buildPayload(origin, key, batch), http, timeoutMs);
      log(`Batch ${index + 1}/${batches.length}: ${batch.length} URLs, ${result.status === null ? 'no response' : `HTTP ${result.status}`}.`);
      if (!result.ok) {
        throw new ScriptError(`Submission stopped${result.status === null ? '' : `: ${HINTS[result.status] || 'the endpoint rejected the batch'}`}. ${accepted} of ${urls.length} URLs were accepted.`);
      }
      accepted += batch.length;
    }
    log(`Done: ${accepted} URLs submitted.`);
    return 0;
  } catch (error) {
    warn(error instanceof ScriptError ? error.message : 'IndexNow submission failed.');
    return error instanceof ScriptError ? error.exitCode : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2));
}
