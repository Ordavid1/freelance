import { loadModule } from './helpers/load-ts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server.js';

function load(path, stubs = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, URL, File, Buffer, console: stubs.__console || console, process: { env: { GOOGLE_CLOUD_PROJECT: 'test-project' } }, require(name) {
    if (name === '@/lib/security/request-body') return loadModule('src/lib/security/request-body.ts');
    if (name === '@/lib/security/rate-limit') return { enforceActionLimit: async () => null };
    if (name === 'server-only') return {};
    if (name === 'node:net') return { isIP };
    if (name in stubs) return stubs[name];
    throw new Error(name);
  } });
  return module.exports;
}
const profile = load('src/lib/profile-generation.ts');
const valid = { name: ' Example ', headline: 'Developer', bio: '', portfolio: '', experience: '', education: '', skills: ['TypeScript', ' TypeScript '], facts: [{ text: 'Builds tools', source: 'github' }] };

test('all profile fields and citation sources are validated before use', () => {
  const result = profile.validateProfileDraft(valid, new Set(['github']));
  assert.equal(result.name, 'Example');
  assert.equal(result.skills.length, 1);
  for (const bad of [{ ...valid, education: 123 }, { ...valid, name: undefined }, { ...valid, bio: 'x'.repeat(1501) }, { ...valid, facts: [{ text: 'Invented employer', source: 'unknown' }] }, { ...valid, skills: [null] }]) {
    assert.throws(() => profile.validateProfileDraft(bad, new Set(['github'])));
  }
});

test('profile route correlates diagnostics without logging source text and rejects failed URL-only retrieval', async () => {
  for (const urlOnly of [false, true]) {
    const logs = [];
    const route = load('src/app/api/ai/profile/route.ts', {
      'node:crypto': { createHash, randomUUID: () => 'generation-test' },
      '@/lib/profile-generation': profile,
      'next/server': { NextResponse },
      '@/lib/auth/session': { isSameOrigin: () => true, getCurrentUser: async () => ({ uid: 'private-user' }) },
      '@/lib/db/firestore': {}, '@/lib/db/storage': {},
      __console: { info: value => logs.push(JSON.parse(value)) },
      '@/lib/ai': { isVertexConfigured: () => true, safePublicUrl: () => true, generateWithVertex: async (_prompt, options) => {
        options.onDiagnostics({ finishReason: 'STOP', totalTokens: 100, urls: [] });
        return urlOnly ? { ...valid, facts: [] } : valid;
      } },
    });
    const form = new FormData();
    form.set('urls', urlOnly ? 'https://example.com/private-context' : '');
    form.set('socialSources', JSON.stringify(urlOnly ? [] : [{ provider: 'github', sourceText: 'Private professional source excerpt' }]));
    const response = await route.POST(new Request('https://freelance-place.com/api/ai/profile', { method: 'POST', body: form }));
    assert.equal(response.status, urlOnly ? 502 : 200);
    assert.equal((await response.json()).generationId, 'generation-test');
    assert.equal(logs[0].requestId, 'generation-test');
    assert.equal(logs[0].vertex.totalTokens, 100);
    for (const secret of ['Private professional source excerpt', 'private-user', 'private-context']) assert.equal(JSON.stringify(logs).includes(secret), false);
  }
});

test('Vertex enforces the profile schema while keeping source content in the user role', async () => {
  let request;
  let diagnostics;
  const ai = load('src/lib/ai.ts', { '@google/genai': { GoogleGenAI: class { models = { generateContent: async input => {
    request = input;
    return { text: JSON.stringify(valid), candidates: [{ finishReason: 'STOP', urlContextMetadata: { urlMetadata: [{ retrievedUrl: 'https://example.com/', urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS' }] } }], usageMetadata: { totalTokenCount: 42 } };
  } }; } } });
  await ai.generateWithVertex('Untrusted source excerpt', { urls: ['https://example.com/'], systemInstruction: profile.profileSystemInstruction, responseJsonSchema: profile.profileResponseSchema(['github']), maxOutputTokens: 8192, onDiagnostics: data => { diagnostics = data; } });
  assert.equal(request.contents[0].role, 'user');
  assert.equal(request.config.systemInstruction, profile.profileSystemInstruction);
  assert.equal(request.config.responseJsonSchema.properties.facts.items.properties.source.enum[0], 'github');
  assert.equal(request.config.httpOptions.timeout, 45000);
  assert.equal(request.config.httpOptions.retryOptions.attempts, 1);
  assert.equal(request.config.maxOutputTokens, 8192);
  assert.equal(request.config.temperature, undefined);
  assert.equal(diagnostics.totalTokens, 42);
  assert.equal(diagnostics.urls[0].status, 'URL_RETRIEVAL_STATUS_SUCCESS');
});

test('truncated or blocked Gemini responses cannot become successful drafts', async () => {
  for (const finishReason of ['MAX_TOKENS', 'SAFETY']) {
    const ai = load('src/lib/ai.ts', { '@google/genai': { GoogleGenAI: class { models = { generateContent: async () => ({ text: JSON.stringify(valid), candidates: [{ finishReason }] }) }; } } });
    await assert.rejects(ai.generateWithVertex('source'), /did not complete/);
  }
});

test('public source URLs exclude credentials and internal addresses without rejecting ordinary fc/fd domains', () => {
  const ai = load('src/lib/ai.ts', { '@google/genai': {} });
  assert.equal(ai.safePublicUrl('https://fcdesign.com'), true);
  for (const url of ['http://127.0.0.1', 'https://user:password@example.com', 'http://metadata.google.internal', 'http://host.local']) assert.equal(ai.safePublicUrl(url), false);
});
