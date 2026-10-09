import { parseArgs } from 'node:util';
import { defaultDatabasePath } from '../storage/sqlite-database.js';
import { readSecretFromStdin } from './prompt-secret.js';

export async function providerAddCommand({ args, stdout, stderr, dependencies }) {
  const { values } = parseArgs({
    args,
    options: {
      label: { type: 'string' },
      'base-url': { type: 'string' },
      model: { type: 'string' },
      'credential-reference': { type: 'string' },
      'max-tokens': { type: 'string' },
      db: { type: 'string' },
    },
  });
  if (!values.label || !values['base-url'] || !values.model) {
    stderr.write('error: --label, --base-url, and --model are required.\nhint: hane provider add --label <name> --base-url <url> --model <id>\n');
    return 1;
  }
  let maxTokens = null;
  if (values['max-tokens'] !== undefined) {
    const parsed = Number(values['max-tokens']);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      stderr.write('error: --max-tokens must be a positive integer.\nhint: hane provider add --label <name> --base-url <url> --model <id> --max-tokens 4000\n');
      return 1;
    }
    maxTokens = parsed;
  }
  const store = dependencies.createProviderConfigStore(dependencies.openDatabase(values.db ?? defaultDatabasePath()));
  const config = store.upsert({
    label: values.label,
    baseUrl: values['base-url'],
    model: values.model,
    credentialReference: values['credential-reference'] ?? `local-agent-orchestrator/${values.label}`,
    maxTokens,
  });
  stdout.write(`Provider "${config.label}" saved.\nhint: store its key with hane provider set-secret ${config.label}\n`);
  return 0;
}

export async function providerListCommand({ args = [], stdout, dependencies }) {
  const { values } = parseArgs({ args, options: { db: { type: 'string' } }, allowPositionals: true });
  const store = dependencies.createProviderConfigStore(dependencies.openDatabase(values.db ?? defaultDatabasePath()));
  const providers = store.list();
  if (providers.length === 0) {
    stdout.write('No providers configured.\nhint: hane provider add --label <name> --base-url <url> --model <id>\n');
    return 0;
  }
  for (const provider of providers) {
    const budget = provider.maxTokens ? ` · max_tokens ${provider.maxTokens}` : '';
    stdout.write(`${provider.label} · ${provider.model} · ${provider.baseUrl}${budget}\n`);
  }
  return 0;
}

export async function providerRemoveCommand({ args, stdout, stderr, dependencies }) {
  const { values, positionals } = parseArgs({ args, options: { db: { type: 'string' } }, allowPositionals: true });
  const label = positionals[0];
  if (!label) {
    stderr.write('error: a provider label is required.\nhint: hane provider remove <label>\n');
    return 1;
  }
  const store = dependencies.createProviderConfigStore(dependencies.openDatabase(values.db ?? defaultDatabasePath()));
  if (!store.remove(label)) {
    stderr.write(`error: unknown provider "${label}".\nhint: hane provider list\n`);
    return 1;
  }
  stdout.write(`Provider "${label}" removed. The stored credential was left in the OS credential vault.\n`);
  return 0;
}

export async function providerSetSecretCommand({ args, stdin, stdout, stderr, dependencies }) {
  const { values, positionals } = parseArgs({ args, options: { db: { type: 'string' } }, allowPositionals: true });
  const label = positionals[0];
  if (!label) {
    stderr.write('error: a provider label is required.\nhint: hane provider set-secret <label>\n');
    return 1;
  }
  const store = dependencies.createProviderConfigStore(dependencies.openDatabase(values.db ?? defaultDatabasePath()));
  const config = store.findByLabel(label);
  if (!config) {
    stderr.write(`error: unknown provider "${label}".\nhint: hane provider add --label ${label} --base-url <url> --model <id>\n`);
    return 1;
  }
  const secret = await readSecretFromStdin({ stdin, stdout });
  await dependencies.credentialManager.set(config.credentialReference, secret);
  stdout.write(`Secret stored for "${config.label}" in the OS credential vault.\n`);
  return 0;
}
