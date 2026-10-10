import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Orchestrator } from '../orchestrator.js';
import { DEFAULT_MAX_TOOL_CALLS } from '../task-run.js';
import { TASK_STATUS, assertPositiveInteger } from '../contracts.js';
import { assertCapabilityGrants, assertEnforceableScopes, grantsNeedWorkspaceRoot } from '../capabilities.js';
import { resolveWorkspaceRoot } from '../workspace-scope.js';
import { defaultDatabasePath } from '../storage/sqlite-database.js';
import { ProviderConfigError } from '../providers/provider-factory.js';

export async function runMissionCommand({ args, stdout, stderr, dependencies }) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      provider: { type: 'string' },
      'max-calls': { type: 'string', default: '3' },
      'max-tool-calls': { type: 'string' },
      db: { type: 'string' },
      json: { type: 'boolean', default: false },
      workspace: { type: 'string' },
      capability: { type: 'string', multiple: true, default: [] },
    },
    allowPositionals: true,
  });
  const objective = positionals.join(' ').trim();
  const maxProviderCalls = assertPositiveInteger(Number(values['max-calls']), 'max-calls');
  // An omitted flag leaves the default where it is defined: TaskRun.
  const maxToolCalls = values['max-tool-calls'] === undefined
    ? undefined
    : assertPositiveInteger(Number(values['max-tool-calls']), 'max-tool-calls');
  const capabilityGrants = parseCapabilityFlags(values.capability);
  let workspaceRoot = values.workspace?.trim() || null;
  if (grantsNeedWorkspaceRoot(capabilityGrants) && workspaceRoot === null) {
    throw new Error('workspace capabilities need a root. hint: hane run --workspace <dir> --capability workspace.read=<scope>');
  }
  // Resolved at ingress so a bad root is a usage error before the first
  // provider call, and the mission stores the path it will actually enforce.
  if (workspaceRoot !== null) workspaceRoot = resolveWorkspaceRoot(workspaceRoot);
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
    stdout.write(`provider: ${config.label} (${config.model}) · budget: ${maxProviderCalls} calls · db: ${dbPath}\n`);
    if (capabilityGrants.length > 0) {
      stdout.write(`grants: ${capabilityGrants.map((grant) => `${grant.name}(${grant.scope})`).join(', ')}\n`);
      stdout.write(`workspace: ${workspaceRoot}\n`);
      stdout.write(`tool budget: ${maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS} calls\n`);
    }
    stdout.write('\n');
  }

  const task = await orchestrator.start({
    objective,
    maxProviderCalls,
    providerLabel: config.label,
    capabilityGrants,
    workspaceRoot,
    maxToolCalls,
    onEvent,
  });

  if (values.json) {
    stdout.write(`${JSON.stringify(task.snapshot(), null, 2)}\n`);
  } else {
    stdout.write(`\nstatus: ${task.status} · audit: ${task.audit.length} entries · tool calls: ${task.toolCalls}\n`);
    if (task.outputs.reviewer) stdout.write(`--- reviewer ---\n${task.outputs.reviewer}\n`);
  }
  return exitCodeForStatus(task.status);
}

/** `--capability workspace.read=src` becomes one declarative grant. */
function parseCapabilityFlags(flags) {
  return assertEnforceableScopes(assertCapabilityGrants(flags.map((flag) => {
    const separator = flag.indexOf('=');
    if (separator === -1) throw new TypeError(`--capability expects name=scope, got "${flag}".`);
    return { name: flag.slice(0, separator).trim(), scope: flag.slice(separator + 1) };
  })));
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
