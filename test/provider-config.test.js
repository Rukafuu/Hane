import assert from 'node:assert/strict';
import test from 'node:test';
import { assertProviderConfig } from '../src/providers/provider-config.js';

const validConfig = {
  label: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1/',
  model: 'meta-llama/llama-3.1-8b-instruct:free',
  credentialReference: 'local-agent-orchestrator/openrouter',
};

test('normalizes and freezes a valid provider configuration', () => {
  const config = assertProviderConfig(validConfig);
  assert.deepEqual(config, {
    label: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    credentialReference: 'local-agent-orchestrator/openrouter',
    maxTokens: null,
  });
  assert.ok(Object.isFrozen(config));
});

test('keeps a valid maxTokens or normalizes it to null', () => {
  assert.equal(assertProviderConfig({ ...validConfig, maxTokens: 4096 }).maxTokens, 4096);
  assert.equal(assertProviderConfig({ ...validConfig, maxTokens: undefined }).maxTokens, null);
  for (const invalid of [0, -1, 1.5, 2_000_000, '4096']) {
    assert.throws(() => assertProviderConfig({ ...validConfig, maxTokens: invalid }), /maxTokens/);
  }
});

test('rejects configurations that carry a credential value', () => {
  for (const forbidden of ['apiKey', 'secret', 'token']) {
    assert.throws(() => assertProviderConfig({ ...validConfig, [forbidden]: 'sk-test' }), /credential vault/);
  }
});

test('rejects invalid fields', () => {
  assert.throws(() => assertProviderConfig(null), /object/);
  assert.throws(() => assertProviderConfig([]), /object/);
  assert.throws(() => assertProviderConfig({ ...validConfig, label: '-nope' }), /label/);
  assert.throws(() => assertProviderConfig({ ...validConfig, label: '' }), /label/);
  assert.throws(() => assertProviderConfig({ ...validConfig, baseUrl: 'not a url' }), /baseUrl/);
  assert.throws(() => assertProviderConfig({ ...validConfig, baseUrl: 'ftp://example.com' }), /baseUrl/);
  assert.throws(() => assertProviderConfig({ ...validConfig, model: '  ' }), /model/);
  assert.throws(() => assertProviderConfig({ ...validConfig, model: 'x'.repeat(201) }), /model/);
  assert.throws(() => assertProviderConfig({ ...validConfig, credentialReference: 'openrouter' }), /credentialReference/);
});
