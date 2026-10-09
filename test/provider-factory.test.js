import assert from 'node:assert/strict';
import test from 'node:test';
import { CredentialMissingError, ProviderConfigError, createProviderFromConfig } from '../src/providers/provider-factory.js';

const openrouter = {
  label: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'meta-llama/llama-3.1-8b-instruct:free',
  credentialReference: 'local-agent-orchestrator/openrouter',
};

class RecordingProvider {
  constructor({ baseUrl, apiKey, model, maxTokens }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
  }
}

test('composes the credential manager secret into a provider without exposing it', async () => {
  const reads = [];
  const credentialManager = { async get(reference) { reads.push(reference); return 'secret-value'; } };

  const provider = await createProviderFromConfig({ config: openrouter, credentialManager, providerConstructor: RecordingProvider });

  assert.deepEqual(reads, ['local-agent-orchestrator/openrouter']);
  assert.equal(provider.apiKey, 'secret-value');
  assert.equal(provider.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(provider.model, 'meta-llama/llama-3.1-8b-instruct:free');
  assert.equal(provider.maxTokens, null);
});

test('forwards the declared token budget to the provider', async () => {
  const credentialManager = { async get() { return 'secret-value'; } };

  const provider = await createProviderFromConfig({
    config: { ...openrouter, maxTokens: 4096 },
    credentialManager,
    providerConstructor: RecordingProvider,
  });

  assert.equal(provider.maxTokens, 4096);
});

test('rejects with a hint when no secret is stored for the provider', async () => {
  const credentialManager = { async get() { return null; } };

  await assert.rejects(
    () => createProviderFromConfig({ config: openrouter, credentialManager }),
    (error) => error instanceof CredentialMissingError && /set-secret openrouter/.test(error.message),
  );
});

test('wraps invalid configurations in a ProviderConfigError', async () => {
  const credentialManager = { async get() { return 'secret-value'; } };

  await assert.rejects(() => createProviderFromConfig({ config: { ...openrouter, label: '' }, credentialManager }), ProviderConfigError);
  await assert.rejects(() => createProviderFromConfig({ config: { ...openrouter, apiKey: 'sk-test' }, credentialManager }), ProviderConfigError);
});

test('requires a credential manager with a get method', async () => {
  await assert.rejects(() => createProviderFromConfig({ config: openrouter, credentialManager: {} }), TypeError);
});
