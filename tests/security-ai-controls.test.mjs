import test from 'node:test';
import assert from 'node:assert/strict';
import { isIP } from 'node:net';
import { loadModule } from './helpers/load-ts.mjs';
function fixture(enabled) {
  const calls = [];
  const ai = loadModule('src/lib/ai.ts', { env: { GOOGLE_CLOUD_PROJECT: 'test-project', AI_GENERATION_ENABLED: enabled }, stubs: {
    'node:net': { isIP },
    '@google/genai': { GoogleGenAI: class { models = { generateContent: async request => {
      calls.push(request);
      return { text: '{}', candidates: [{ finishReason: 'STOP' }] };
    } }; } },
  } });
  return { ai, calls };
}
test('AI emergency switch stops calls before constructing a provider request', async () => {
  const { ai, calls } = fixture('false');
  await assert.rejects(ai.generateWithVertex('private input'), /temporarily disabled/);
  assert.equal(calls.length, 0);
});
test('AI requests have a default output budget and preserve explicit profile budgets', async () => {
  const { ai, calls } = fixture('true');
  await ai.generateWithVertex('brief');
  await ai.generateWithVertex('profile', { maxOutputTokens: 16384 });
  assert.equal(calls[0].config.maxOutputTokens, 4096);
  assert.equal(calls[1].config.maxOutputTokens, 16384);
});
