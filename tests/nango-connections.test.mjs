import { loadModule } from './helpers/load-ts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NextResponse } from 'next/server.js';

function load(path, stubs = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URL, URLSearchParams, process: { env: {
    NANGO_API_KEY: 'test-key', NANGO_GITHUB_INTEGRATION_ID: 'github', NANGO_LINKEDIN_INTEGRATION_ID: 'linkedin',
  } }, require(name) {
    if (name === '@/lib/security/request-body') return loadModule('src/lib/security/request-body.ts');
    if (name === 'server-only') return {};
    if (name in stubs) return stubs[name];
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return module.exports;
}
const connection = { id: 432, connection_id: 'oauth-connection', provider_config_key: 'github', tags: { end_user_id: 'owner' } };
function route(name, records = [connection]) {
  const calls = [];
  const api = load('src/lib/integrations/nango.ts');
  const result = load(`src/app/api/integrations/nango/${name}/route.ts`, {
    'next/server': { NextResponse },
    '@/lib/auth/session': { isSameOrigin: () => true, getCurrentUser: async () => ({ uid: 'owner' }) },
    '@/lib/integrations/nango': { ...api, nangoJson: async (path, init) => {
      calls.push({ path, init });
      if (path.startsWith('/connections?')) return { connections: records };
      if (path === '/proxy/user') return { login: 'designer', name: 'Designer' };
      if (path.startsWith('/proxy/users/')) return [{ name: 'Portfolio', html_url: 'https://github.com/designer/portfolio', private: false }];
      if (path.startsWith('/connections/oauth-connection?') && init?.method === 'DELETE') return {};
      throw new Error('Unexpected provider request');
    } },
  });
  return { ...result, calls };
}
const importRequest = () => new Request('https://freelance-place.com/api/integrations/nango/import', {
  method: 'POST', body: JSON.stringify({ provider: 'github', connectionId: 'oauth-connection' }),
});

test('connection list exposes OAuth connection_id, not Nango numeric internal id', async () => {
  const response = await route('connections').GET();
  assert.deepEqual(await response.json(), { connections: [{ provider: 'github', connectionId: 'oauth-connection' }] });
});

test('authorized connection imports only profile context using connection_id', async () => {
  const api = route('import');
  const response = await api.POST(importRequest());
  assert.equal(response.status, 200);
  const imported = await response.json();
  assert.equal(imported.profile.name, 'Designer');
  assert.match(imported.sourceText, /GitHub profile: Designer/);
  assert.doesNotMatch(imported.sourceText, /Portfolio/);
  assert.equal(api.calls.length, 2, 'profile context never fetches repositories');
  assert.equal(api.calls[1].init.headers['Connection-Id'], 'oauth-connection');
});

test('same connection_id cannot import another user or integration, or an untagged record', async () => {
  for (const record of [
    { ...connection, tags: { end_user_id: 'stranger' } },
    { ...connection, provider_config_key: 'linkedin' },
    { ...connection, provider_config_key: undefined },
    { ...connection, tags: {} },
  ]) {
    const api = route('import', [record]);
    assert.equal((await api.POST(importRequest())).status, 403);
    assert.equal(api.calls.length, 1);
  }
});

test('disconnect uses public connection_id and retains ownership validation', async () => {
  const request = () => new Request('https://freelance-place.com/api/integrations/nango/connections?provider=github&connectionId=oauth-connection', { method: 'DELETE' });
  const api = route('connections');
  assert.equal((await api.DELETE(request())).status, 200);
  assert.match(api.calls[1].path, /^\/connections\/oauth-connection\?provider_config_key=github$/);
  const foreign = route('connections', [{ ...connection, tags: { end_user_id: 'stranger' } }]);
  assert.equal((await foreign.DELETE(request())).status, 403);
  assert.equal(foreign.calls.length, 1);
});
