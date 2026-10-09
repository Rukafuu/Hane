import { assertProviderConfig } from './provider-config.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

export class ProviderConfigError extends Error {}
export class CredentialMissingError extends Error {}

/**
 * Composes credentials → provider: the secret is resolved exactly once through
 * the credential manager and handed only to the in-memory provider instance.
 * The secret is never returned, logged, or persisted by this module.
 * @param {{ config: unknown,
 *           credentialManager: { get(reference: string): Promise<string | null> },
 *           providerConstructor?: typeof OpenAICompatibleProvider }} options
 */
export async function createProviderFromConfig({ config, credentialManager, providerConstructor = OpenAICompatibleProvider }) {
  let normalized;
  try {
    normalized = assertProviderConfig(config);
  } catch (error) {
    throw new ProviderConfigError(error instanceof Error ? error.message : 'Invalid provider configuration.');
  }
  if (!credentialManager || typeof credentialManager.get !== 'function') {
    throw new TypeError('credentialManager.get(reference) is required.');
  }
  const secret = await credentialManager.get(normalized.credentialReference);
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new CredentialMissingError(`No credential is stored for "${normalized.label}". Run: hane provider set-secret ${normalized.label}`);
  }
  return new providerConstructor({
    baseUrl: normalized.baseUrl,
    apiKey: secret,
    model: normalized.model,
    maxTokens: normalized.maxTokens,
  });
}
