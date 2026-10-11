import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { SqliteAgentStore } from '../storage/sqlite-agent-store.js';
import { resolveExecutionProviders } from '../teams/execution-plan.js';
import { Orchestrator } from '../orchestrator.js';
import { ROLE_SEQUENCE, TASK_STATUS, assertPositiveInteger } from '../contracts.js';
import { TaskRun } from '../task-run.js';
import { grantsForWorkspaceRead } from '../workspace-scope.js';
import { defaultDatabasePath } from '../storage/sqlite-database.js';
import { resolveProviderConfig, exitCodeForStatus } from './run-mission.js';

const REVISION_ROLES = Object.freeze(['executor', 'reviewer']);

export async function missionsCommand({ args, stdout, dependencies }) {
  const { values } = parseArgs({ args, options: { db: { type: 'string' } }, allowPositionals: true });
  const { repository } = openContext({ values, dependencies });
  const missions = repository.list();
  if (missions.length === 0) {
    stdout.write('No missions recorded.\nhint: hane run "<objective>"\n');
    return 0;
  }
  for (const mission of missions) {
    stdout.write(`${mission.id} · ${mission.status.padEnd(17)} · ${mission.providerCalls}/${mission.maxProviderCalls} calls · ${truncate(mission.objective, 60)}\n`);
  }
  return 0;
}

export async function missionCommand({ args, stdout, stderr, dependencies }) {
  const { values, positionals } = parseArgs({
    args,
    options: { db: { type: 'string' }, json: { type: 'boolean', default: false } },
    allowPositionals: true,
  });
  const id = positionals[0];
  if (!id) {
    stderr.write('error: a mission id is required.\nhint: hane mission <id> (see hane missions)\n');
    return 1;
  }
  const { repository } = openContext({ values, dependencies });
  const mission = repository.findById(id);
  if (!mission) {
    stderr.write(`error: unknown mission "${id}".\nhint: hane missions\n`);
    return 1;
  }
  if (values.json) {
    stdout.write(`${JSON.stringify(mission, null, 2)}\n`);
    return 0;
  }
  stdout.write(`mission ${mission.id}\n`);
  stdout.write(`status: ${mission.status} · calls: ${mission.providerCalls}/${mission.maxProviderCalls}\n`);
  stdout.write(`provider: ${mission.providerLabel ?? 'not recorded'} · objective: ${mission.objective}\n\n`);
  for (const role of ROLE_SEQUENCE) {
    if (mission.outputs[role]) stdout.write(`--- ${role} ---\n${mission.outputs[role]}\n\n`);
  }
  stdout.write(`audit: ${mission.audit.length} entries\n`);
  return 0;
}

export async function retryCommand({ args, stdout, stderr, dependencies }) {
  const { values, positionals } = parseArgs({
    args,
    options: { provider: { type: 'string' }, 'max-calls': { type: 'string' }, 'max-tool-calls': { type: 'string' }, db: { type: 'string' }, json: { type: 'boolean', default: false } },
    allowPositionals: true,
  });
  const id = positionals[0];
  if (!id) {
    stderr.write('error: a mission id is required.\nhint: hane retry <id> (see hane missions)\n');
    return 1;
  }
  const context = openContext({ values, dependencies });
  const mission = context.repository.findById(id);
  if (!mission) {
    stderr.write(`error: unknown mission "${id}".\nhint: hane missions\n`);
    return 1;
  }
  if (mission.status === TASK_STATUS.AWAITING_APPROVAL) {
    stderr.write(`error: mission "${id}" awaits a human approval; retry cannot spend its budget.\nhint: hane approve ${id}\n`);
    return 1;
  }
  if (mission.status !== TASK_STATUS.NEEDS_ATTENTION && mission.status !== TASK_STATUS.FAILED) {
    stderr.write(`error: mission "${id}" is ${mission.status}; only needs_attention or failed missions can be retried.\n`);
    return 1;
  }

  const task = TaskRun.fromSnapshot(mission);
  if (values['max-calls'] !== undefined) {
    task.extendBudget(assertPositiveInteger(Number(values['max-calls']), 'max-calls'));
  }
  if (values['max-tool-calls'] !== undefined) {
    task.extendToolBudget(assertPositiveInteger(Number(values['max-tool-calls']), 'max-tool-calls'));
  }
  return resumeMission({ task, context, values, stdout, dependencies });
}

export async function approveCommand({ args, stdout, stderr, dependencies }) {
  const { values, positionals } = parseArgs({
    args,
    options: { provider: { type: 'string' }, 'max-calls': { type: 'string' }, 'max-tool-calls': { type: 'string' }, db: { type: 'string' }, json: { type: 'boolean', default: false } },
    allowPositionals: true,
  });
  const id = positionals[0];
  if (!id) {
    stderr.write('error: a mission id is required.\nhint: hane approve <id> (see hane missions)\n');
    return 1;
  }
  const context = openContext({ values, dependencies });
  const mission = context.repository.findById(id);
  if (!mission) {
    stderr.write(`error: unknown mission "${id}".\nhint: hane missions\n`);
    return 1;
  }
  if (mission.status !== TASK_STATUS.AWAITING_APPROVAL) {
    stderr.write(`error: mission "${id}" is ${mission.status}, not awaiting_approval.\nhint: hane retry <id> resumes interrupted missions\n`);
    return 1;
  }

  const task = TaskRun.fromSnapshot(mission);
  for (const role of REVISION_ROLES) delete task.outputs[role];
  const wantedMax = values['max-calls'] !== undefined
    ? assertPositiveInteger(Number(values['max-calls']), 'max-calls')
    : task.providerCalls + REVISION_ROLES.length;
  if (wantedMax > task.maxProviderCalls) task.extendBudget(wantedMax);
  if (values['max-tool-calls'] !== undefined) {
    task.extendToolBudget(assertPositiveInteger(Number(values['max-tool-calls']), 'max-tool-calls'));
  }

  if (!values.json) stdout.write(`approved: re-running ${REVISION_ROLES.join(' and ')} with ${task.maxProviderCalls - task.providerCalls} calls left.\n\n`);
  return resumeMission({ task, context, values, stdout, dependencies });
}

function openContext({ values, dependencies }) {
  const dbPath = values.db ?? defaultDatabasePath();
  if (values.db) mkdirSync(path.dirname(values.db), { recursive: true });
  const database = dependencies.openDatabase(dbPath);
  return { dbPath, database, repository: dependencies.createTaskRepository(database) };
}

async function resumeMission({ task, context, values, stdout, dependencies }) {
  const providerConfigStore=dependencies.createProviderConfigStore(context.database);
  if (task.executionPlan && values.provider !== undefined) throw new TypeError('A resumed preset retains its recorded providers.');
  const roleProviders=task.executionPlan ? await resolveExecutionProviders({executionPlan:task.executionPlan,providerConfigStore,credentialManager:dependencies.credentialManager,createProvider:dependencies.createProvider}) : null;
  const config = resolveProviderConfig(providerConfigStore, roleProviders ? task.executionPlan.roles.planner.providerLabel : values.provider, task.providerLabel);
  const provider = roleProviders?.planner ?? await dependencies.createProvider({ config, credentialManager: dependencies.credentialManager });
  const agentStore=new SqliteAgentStore({database:context.database});
  const orchestrator = new Orchestrator({ provider, roleProviders, agentCapabilityCheck:(id,capability)=>agentStore.get(id)?.capabilities.includes(capability) === true, repository: context.repository });

  if (!values.json) {
    stdout.write(`hane · mission ${task.id}\n`);
    stdout.write(`provider: ${config.label} (${config.model}) · budget: ${task.maxProviderCalls} calls · db: ${context.dbPath}\n\n`);
  }
  // Evidence gathering is bounded by a counter that survives resumes, so a
  // mission can return here with none of it left and no failure to report.
  if (!values.json && task.workspaceRoot !== null
    && grantsForWorkspaceRead(task.capabilityGrants).length > 0
    && task.toolCalls >= task.maxToolCalls) {
    stdout.write(`warning: tool budget is spent (${task.toolCalls}/${task.maxToolCalls}); this resume can run no tools.\nhint: pass --max-tool-calls <higher> to raise it\n\n`);
  }
  const resumed = await orchestrator.resume(task, { onEvent: values.json ? null : createProgressReporter({ stdout }) });

  if (values.json) {
    stdout.write(`${JSON.stringify(resumed.snapshot(), null, 2)}\n`);
  } else {
    stdout.write(`\nstatus: ${resumed.status} · audit: ${resumed.audit.length} entries\n`);
    if (resumed.outputs.reviewer) stdout.write(`--- reviewer ---\n${resumed.outputs.reviewer}\n`);
  }
  return exitCodeForStatus(resumed.status);
}

function createProgressReporter({ stdout }) {
  return (event) => {
    const { providerCalls, maxProviderCalls } = event.task;
    if (event.type === 'role_saved') stdout.write(`[${providerCalls}/${maxProviderCalls}] ${event.role.padEnd(8)} saved (call ${providerCalls}/${maxProviderCalls})\n`);
    else if (event.type === 'role_skipped_budget') stdout.write(`[${providerCalls}/${maxProviderCalls}] ${event.role.padEnd(8)} skipped (budget exhausted)\n`);
    else if (event.type === 'role_failed') stdout.write(`[${providerCalls + 1}/${maxProviderCalls}] ${event.role.padEnd(8)} failed\n`);
  };
}

function truncate(text, width) {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}
