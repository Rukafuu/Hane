import assert from 'node:assert/strict';
import test from 'node:test';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';
import { SqliteProviderConfigStore } from '../src/storage/sqlite-provider-config-store.js';
import { createSettingsApi } from '../src/server/settings-api.js';
import { OPENROUTER_BASE, OPENROUTER_CREDENTIAL } from '../src/server/openrouter-api.js';

const model = (id, output = ['text']) => ({ id, name: id, context_length: 32768, architecture: { output_modalities: output }, pricing: { prompt: '0', completion: '0' } });
function setup(t, remote = async url => Response.json(url.endsWith('/key') ? { data: { label: 'private-account-label' } } : { data: [model('vendor/one'), model('vendor/two'), model('image/only', ['image'])] })) {
  const database = openHaneDatabase(':memory:');
  const providers = new SqliteProviderConfigStore({ database });
  const secrets = new Map(); const calls = []; let authorized = true;
  const api = createSettingsApi({ database, providerConfigStore: providers,
    credentialManager: { get: async id => secrets.get(id) || null, set: async (id, value) => secrets.set(id, value) },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return remote(url, options); },
    readJsonBody: async request => request.body || {}, respondJson: (response, status, data) => Object.assign(response, { status, data }),
  });
  t.after(() => database.close());
  return { database, providers, secrets, calls, lock: () => { authorized = false; },
    call: async (path = '', method = 'GET', body) => { const response = {}; await api({ request: { url: '/api/settings/openrouter' + path, method, body }, response, isAuthorized: () => authorized }); return response; },
  };
}

test('OpenRouter key validates before storing; catalog adds usable models with a shared vault reference', async t => {
  const h = setup(t);
  assert.equal((await h.call('/models')).status, 409);
  const saved = await h.call('/secret', 'POST', { secret: 'synthetic-test-key' });
  assert.deepEqual(saved.data, { configured: true });
  assert.equal(h.secrets.get(OPENROUTER_CREDENTIAL), 'synthetic-test-key');
  const catalog = await h.call('/models');
  assert.deepEqual(catalog.data.models.map(m => m.id), ['vendor/one', 'vendor/two']);
  assert.equal(catalog.data.models[0].contextLength, 32768);
  const result = await h.call('/models', 'POST', { models: ['vendor/one', 'vendor/two'] });
  assert.equal(result.status, 200); assert.equal(result.data.providers.length, 2);
  assert.ok(result.data.providers.every(p => p.baseUrl === OPENROUTER_BASE && p.credentialReference === OPENROUTER_CREDENTIAL));
  await h.call('/models', 'POST', { models: ['vendor/one'] });
  assert.equal(h.providers.list().length, 2);
  assert.ok(h.calls.every(c => ['/key', '/models'].some(p => c.url === OPENROUTER_BASE + p) && !c.options.body && c.options.redirect === 'error'));
  assert.equal(JSON.stringify([saved, catalog, result, h.providers.list()]).includes('synthetic-test-key'), false);
  assert.equal(JSON.stringify(saved).includes('private-account-label'), false);
});

test('OpenRouter rejected or malformed key responses do not replace the stored credential or echo remote errors', async t => {
  for (const response of [Response.json({ error: 'private-account-label synthetic-test-key' }, { status: 401 }), new Response('private-account-label synthetic-test-key')]) {
    const h = setup(t, async () => response);
    h.secrets.set(OPENROUTER_CREDENTIAL, 'previous-test-key');
    const result = await h.call('/secret', 'POST', { secret: 'synthetic-test-key' });
    assert.ok([400, 502].includes(result.status));
    assert.equal(h.secrets.get(OPENROUTER_CREDENTIAL), 'previous-test-key');
    assert.equal(JSON.stringify(result).includes('synthetic-test-key'), false);
    assert.equal(JSON.stringify(result).includes('private-account-label'), false);
  }
});

test('OpenRouter refuses stale selections and locked sessions without saving providers', async t => {
  const h = setup(t); h.secrets.set(OPENROUTER_CREDENTIAL, 'synthetic-test-key');
  assert.equal((await h.call('/models', 'POST', { models: ['vendor/one', 'missing/model'] })).status, 400);
  assert.equal(h.providers.list().length, 0);
  h.lock(); const count = h.calls.length;
  assert.equal((await h.call('/secret', 'POST', { secret: 'synthetic-test-key' })).status, 401);
  assert.equal((await h.call('/models')).status, 401);
  assert.equal(h.calls.length, count);
});

test('OpenRouter rolls back all selected models when persistence fails', async t => {
  const h = setup(t); h.secrets.set(OPENROUTER_CREDENTIAL, 'synthetic-test-key');
  const upsert = h.providers.upsert.bind(h.providers); let count = 0;
  h.providers.upsert = config => { if (++count === 2) throw new Error('database fault'); return upsert(config); };
  assert.equal((await h.call('/models', 'POST', { models: ['vendor/one', 'vendor/two'] })).status, 502);
  assert.equal(h.providers.list().length, 0);
});

test('OpenRouter rechecks session after network waits before saving a key', async t => {
  let h; h = setup(t, async () => { h.lock(); return Response.json({ data: {} }); });
  assert.equal((await h.call('/secret', 'POST', { secret: 'synthetic-test-key' })).status, 401);
  assert.equal(h.secrets.size, 0);
});
