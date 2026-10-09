import { CREDENTIAL_REFERENCE_PATTERN } from '../contracts.js';

/** @typedef {{ label: string, baseUrl: string, model: string, credentialReference: string, maxTokens: number|null }} ProviderConfig */

const LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const FORBIDDEN_KEYS = Object.freeze(['apiKey', 'secret', 'token']);
const MAX_MODEL_LENGTH = 200;
const MAX_TOKENS_LIMIT = 1_000_000;

/**
 * Validates and normalizes a provider configuration. The configuration is
 * declarative metadata only; any object carrying a credential value is
 * rejected because credentials belong exclusively in the OS credential vault.
 * @param {unknown} candidate
 * @returns {ProviderConfig}
 */
export function assertProviderConfig(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('provider configuration must be an object.');
  }
  for (const forbidden of FORBIDDEN_KEYS) {
    if (Object.hasOwn(candidate, forbidden)) {
      throw new TypeError(`provider configuration must never carry "${forbidden}"; the credential belongs only in the OS credential vault.`);
    }
  }
  const { label, baseUrl, model, credentialReference, maxTokens } = candidate;
  if (typeof label !== 'string' || !LABEL_PATTERN.test(label)) {
    throw new TypeError('label must match [a-z0-9][a-z0-9._-]{0,63}.');
  }
  if (typeof baseUrl !== 'string') throw new TypeError('baseUrl must be a string.');
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new TypeError('baseUrl must be an absolute http(s) URL.');
  }
  if (parsedBaseUrl.protocol !== 'http:' && parsedBaseUrl.protocol !== 'https:') {
    throw new TypeError('baseUrl must use http or https.');
  }
  if (typeof model !== 'string' || model.trim().length === 0 || model.length > MAX_MODEL_LENGTH) {
    throw new TypeError(`model must be a non-empty string of at most ${MAX_MODEL_LENGTH} characters.`);
  }
  if (typeof credentialReference !== 'string' || !CREDENTIAL_REFERENCE_PATTERN.test(credentialReference)) {
    throw new TypeError('credentialReference must be namespaced as local-agent-orchestrator/<provider>.');
  }
  if (maxTokens !== undefined && maxTokens !== null) {
    if (!Number.isInteger(maxTokens) || maxTokens <= 0 || maxTokens > MAX_TOKENS_LIMIT) {
      throw new TypeError(`maxTokens must be a positive integer of at most ${MAX_TOKENS_LIMIT} or null.`);
    }
  }
  return Object.freeze({
    label,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model: model.trim(),
    credentialReference,
    maxTokens: maxTokens ?? null,
  });
}
