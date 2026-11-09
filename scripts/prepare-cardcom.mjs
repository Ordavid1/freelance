#!/usr/bin/env node
// Resolves Secret Manager references in memory, probes a read-only Cardcom endpoint,
// and emits references-only Terraform configuration. Never prints raw SDK errors.
import { GoogleAuth } from 'google-auth-library';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function options(argv) {
  const result = { project: 'freelance-514118', region: 'me-west1', secretProject: 'crypto-coral-328619', terminalSecret: 'cardcom-terminal-number', apiNameSecret: 'cardcom-api-name', output: 'deploy/cardcom.generated.tfvars.json' };
  const keys = { '--project': 'project', '--region': 'region', '--secret-project': 'secretProject', '--terminal-secret': 'terminalSecret', '--api-name-secret': 'apiNameSecret', '--password-secret': 'passwordSecret', '--output': 'output' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') return { help: true };
    const key = keys[argv[i]];
    if (!key || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('INVALID_ARGUMENTS');
    result[key] = argv[++i];
  }
  for (const key of ['project', 'region', 'secretProject', 'terminalSecret', 'apiNameSecret', 'passwordSecret']) {
    if (result[key] && !/^[a-zA-Z0-9_-]+$/.test(result[key])) throw new Error('INVALID_RESOURCE_NAME');
  }
  return result;
}
const data = value => typeof value === 'string' ? JSON.parse(value) : value;
export async function prepare(config, { auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }), transport = fetch, save = writeFile, report = console.log } = {}) {
  let client;
  try { client = await auth.getClient(); await client.getAccessToken(); } catch { throw new Error('GCP_AUTH_UNAVAILABLE'); }
  async function read(url, code) {
    try { return data((await client.request({ url, timeout: 20000 })).data); } catch { throw new Error(code); }
  }
  const refs = {};
  async function secret(name, env) {
    const path = `projects/${config.secretProject}/secrets/${name}/versions/latest`;
    const metadata = await read(`https://secretmanager.googleapis.com/v1/${path}`, 'SECRET_METADATA_UNAVAILABLE');
    if (metadata.state !== 'ENABLED' || !/\/versions\/\d+$/.test(metadata.name)) throw new Error('SECRET_VERSION_UNAVAILABLE');
    const payload = await read(`https://secretmanager.googleapis.com/v1/${metadata.name}:access`, 'SECRET_ACCESS_DENIED');
    const value = Buffer.from(payload.payload?.data || '', 'base64').toString('utf8').trim();
    if (!value) throw new Error('EMPTY_SECRET');
    refs[env] = { project: config.secretProject, name, version: metadata.name.split('/').at(-1) };
    return value;
  }
  const terminal = Number(await secret(config.terminalSecret, 'CARDCOM_TERMINAL_NUMBER'));
  const apiName = await secret(config.apiNameSecret, 'CARDCOM_API_NAME');
  const password = config.passwordSecret ? await secret(config.passwordSecret, 'CARDCOM_API_PASSWORD') : undefined;
  if (!Number.isSafeInteger(terminal) || terminal <= 0) throw new Error('INVALID_TERMINAL_SECRET');
  report('Cardcom secret references and enabled versions resolved; values withheld.');
  // A random, never-used external id: this endpoint can only read, never charge.
  let probe;
  try {
    const response = await transport('https://secure.cardcom.solutions/api/v11/Transactions/GetTransactionByExternalUniqTran', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(25000),
      body: JSON.stringify({ TerminalNumber: terminal, ApiName: apiName, ...(password ? { ApiPassword: password } : {}), ExternalUniqTranId: `freelance-probe-${randomUUID()}` }),
    });
    const body = await response.json();
    probe = { httpStatus: response.status, responseCode: typeof body.ResponseCode === 'number' || /^\d+$/.test(String(body.ResponseCode)) ? Number(body.ResponseCode) : null };
  } catch { throw new Error('CARDCOM_PROBE_FAILED'); }
  report(`Cardcom read-only production lookup: HTTP ${probe.httpStatus}, ResponseCode ${probe.responseCode ?? 'missing'}.`);
  report('A no-match lookup is not proof that token charging or invoice generation works. No debit or checkout was created.');
  const service = await read(`https://run.googleapis.com/v2/projects/${config.project}/locations/${config.region}/services/freelance-engine`, 'CLOUD_RUN_READ_FAILED');
  const container = service.template?.containers?.[0];
  if (!container?.image) throw new Error('CURRENT_IMAGE_UNAVAILABLE');
  const vars = { project_id: config.project, region: config.region, engine_image: container.image, billing_enabled: false, cardcom_secrets: refs };
  const env = Object.fromEntries((container.env || []).map(item => [item.name, item]));
  if (env.GOOGLE_SIGN_IN_ENABLED?.value) vars.google_sign_in_enabled = env.GOOGLE_SIGN_IN_ENABLED.value === 'true';
  const nango = env.NANGO_API_KEY?.valueSource?.secretKeyRef;
  if (nango) { vars.nango_secret_name = nango.secret.split('/').at(-1); vars.nango_secret_version = nango.version; }
  else vars.nango_secret_name = null;
  for (const [name, key] of [['NANGO_GITHUB_INTEGRATION_ID', 'nango_github_integration_id'], ['NANGO_LINKEDIN_INTEGRATION_ID', 'nango_linkedin_integration_id']]) {
    if (env[name]?.value) vars[key] = env[name].value;
  }
  const dribbble = env.DRIBBBLE_CLIENT_SECRET?.valueSource?.secretKeyRef;
  if (dribbble) {
    vars.dribbble_client_secret_name = dribbble.secret.split('/').at(-1);
    vars.dribbble_client_secret_version = dribbble.version;
  }
  for (const [name, key] of [['DRIBBBLE_CLIENT_ID', 'dribbble_client_id'], ['DRIBBBLE_REDIRECT_URI', 'dribbble_redirect_uri']]) {
    if (env[name]?.value) vars[key] = env[name].value;
  }
  await save(config.output, JSON.stringify(vars, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  report('Deployment configuration written with pinned secret references and billing disabled. Existing output files are never overwritten.');
  return { probe, vars };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = options(process.argv.slice(2));
    if (config.help) console.log('Usage: node scripts/prepare-cardcom.mjs [--secret-project PROJECT] [--terminal-secret NAME] [--api-name-secret NAME] [--password-secret NAME] [--project PROJECT] [--region REGION] [--output FILE]\nDefaults use secret names/project from the attached working implementation. Runs a read-only production lookup, then writes disabled billing configuration with pinned secret versions and current Cloud Run settings.');
    else await prepare(config);
  } catch (error) {
    const allowed = new Set(['INVALID_ARGUMENTS','INVALID_RESOURCE_NAME','GCP_AUTH_UNAVAILABLE','SECRET_METADATA_UNAVAILABLE','SECRET_VERSION_UNAVAILABLE','SECRET_ACCESS_DENIED','EMPTY_SECRET','INVALID_TERMINAL_SECRET','CARDCOM_PROBE_FAILED','CLOUD_RUN_READ_FAILED','CURRENT_IMAGE_UNAVAILABLE']);
    console.error(allowed.has(error.message) ? error.message : error.code === 'EEXIST' ? 'OUTPUT_ALREADY_EXISTS' : 'PREPARATION_FAILED');
    process.exitCode = 1;
  }
}
