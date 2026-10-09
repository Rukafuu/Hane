import assert from 'node:assert/strict';
import test from 'node:test';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';
import { SqliteProviderConfigStore } from '../src/storage/sqlite-provider-config-store.js';

const openrouter = {
  label: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'meta-llama/llama-3.1-8b-instruct:free',
  credentialReference: 'local-agent-orchestrator/openrouter',
};

test('stores, lists, finds, and removes provider configurations', () => {
  const database = openHaneDatabase(':memory:');
  const store = new SqliteProviderConfigStore({ database });
  store.upsert(openrouter);
  store.upsert({ ...openrouter, label: 'anthropic', credentialReference: 'local-agent-orchestrator/anthropic' });

  assert.deepEqual(store.list().map((entry) => entry.label), ['anthropic', 'openrouter']);
  assert.equal(store.findByLabel('openrouter').baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(store.findByLabel('openrouter').credentialReference, 'local-agent-orchestrator/openrouter');
  assert.equal(store.findByLabel('missing'), null);

  assert.equal(store.remove('anthropic'), true);
  assert.equal(store.remove('anthropic'), false);
  database.close();
});

test('accepts a filename and overwrites a configuration with the same label', () => {
  const store = new SqliteProviderConfigStore(':memory:');
  store.upsert(openrouter);
  store.upsert({ ...openrouter, model: 'other-model' });

  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].model, 'other-model');
});

test('round-trips the declared token budget', () => {
  const store = new SqliteProviderConfigStore(':memory:');
  store.upsert({ ...openrouter, maxTokens: 8192 });
  assert.equal(store.findByLabel('openrouter').maxTokens, 8192);
  assert.equal(store.list()[0].maxTokens, 8192);

  store.upsert(openrouter);
  assert.equal(store.findByLabel('openrouter').maxTokens, null);
});

test('never stores a credential value and rejects secret-bearing configurations', () => {
  const database = openHaneDatabase(':memory:');
  const store = new SqliteProviderConfigStore({ database });
  assert.throws(() => store.upsert({ ...openrouter, apiKey: 'sk-test' }), /credential vault/);
  store.upsert(openrouter);

  assert.deepEqual(
    database.prepare('PRAGMA table_info(provider_configs)').all().map((column) => column.name),
    ['label', 'base_url', 'model', 'credential_reference', 'max_tokens'],
  );
  database.close();
});
