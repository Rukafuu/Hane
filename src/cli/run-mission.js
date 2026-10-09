import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Orchestrator } from '../orchestrator.js';
import { TASK_STATUS, assertPositiveInteger } from '../contracts.js';
import { defaultDatabasePath } from '../storage/sqlite-database.js';
import { ProviderConfigError } from '../providers/provider-factory.js';

export async function runMissionCommand({ args, stdout, stderr, dependencies }) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      provider: { type: 'string' },
      'max-calls': { type: 'string', default: '3' },
      db: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  const objective = positionals.join(' ').trim();
  const maxProviderCalls = assertPositiveInteger(Number(values['max-calls']), 'max-calls');
  const dbPath = values.db ?? defaultDatabasePath();
  if (values.db) mkdirSync(path.dirname(values.db), { recursive: true });

  const database = dependencies.openDatabase(dbPath);
  const repository = dependencies.createTaskRepository(database);
  const providerConfigStore = dependencies.createProviderConfigStore(database);
  const config = resolveProviderConfig(providerConfigStore, values.provider);
  const provider = await dependencies.createProvider({ config, credentialManager: dependencies.credentialManager });

  const missionId = crypto.randomUUID();
  const orchestrator = new Orchestrator({ provider, repository, idFactory: () => missionId });

  let savedRoles = 0;
  const onEvent = values.json ? null : (event) => {
    if (event.type === 'role_saved') {
      savedRoles += 1;
      stdout.write(`[${savedRoles}/${maxProviderCalls}] ${event.role.padEnd(8)} saved (call ${event.task.providerCalls}/${maxProviderCalls})\n`);
    } else if (event.type === 'role_skipped_budget') {
      stdout.write(`[${event.task.providerCalls}/${maxProviderCalls}] ${event.role.padEnd(8)} skipped (budget exhausted)\n`);
    } else if (event.type === 'role_failed') {
      stdout.write(`[${savedRoles + 1}/${maxProviderCalls}] ${event.role.padEnd(8)} failed\n`);
    }
  };

  if (!values.json) {
    stdout.write(`hane · mission ${missionId}\n`);
    stdout.write(`provider: ${config.label} (${config.model}) · budget: ${maxProviderCalls} calls · db: ${dbPath}\n\n`);
  }

  const task = await orchestrator.start({ objective, maxProviderCalls, providerLabel: config.label, onEvent });

  if (values.json) {
    stdout.write(`${JSON.stringify(task.snapshot(), null, 2)}\n`);
  } else {
    stdout.write(`\nstatus: ${task.status} · audit: ${task.audit.length} entries\n`);
    if (task.outputs.reviewer) stdout.write(`--- reviewer ---\n${task.outputs.reviewer}\n`);
  }
  return exitCodeForStatus(task.status);
}

export function exitCodeForStatus(status) {
  if (status === TASK_STATUS.COMPLETED) return 0;
  if (status === TASK_STATUS.NEEDS_ATTENTION || status === TASK_STATUS.AWAITING_APPROVAL) return 2;
  return 3;
}

/**
 * Resolves which provider configuration a mission should use: an explicit
 * request wins, then the provider a stored mission already ran on, then the
 * single configured provider.
 */
export function resolveProviderConfig(store, requestedLabel, fallbackLabel = null) {
  const label = requestedLabel ?? fallbackLabel;
  if (label) {
    const config = store.findByLabel(label);
    if (!config) {
      throw new ProviderConfigError(requestedLabel
        ? `Unknown provider "${requestedLabel}". hint: hane provider list`
        : `Provider "${label}" was used by this mission but is no longer configured. Pass --provider <label>. hint: hane provider list`);
    }
    return config;
  }
  const providers = store.list();
  if (providers.length === 1) return providers[0];
  throw new ProviderConfigError(providers.length === 0
    ? 'No provider is configured. hint: hane provider add --label <name> --base-url <url> --model <id>'
    : 'Several providers are configured; pass --provider <label>. hint: hane provider list');
}
