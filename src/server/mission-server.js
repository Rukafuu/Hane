import { createServer } from 'node:http';
import { Orchestrator } from '../orchestrator.js';
import { TASK_STATUS, assertObjective, assertPositiveInteger } from '../contracts.js';
import { assertCapabilityGrants, grantsNeedWorkspaceRoot } from '../capabilities.js';
import { resolveWorkspaceRoot } from '../workspace-scope.js';
import { TaskRun } from '../task-run.js';
import { ProviderConfigError, CredentialMissingError } from '../providers/provider-factory.js';
import { resolveProviderConfig } from '../cli/run-mission.js';

const MAX_BODY_BYTES = 64 * 1024;
const SSE_HEARTBEAT_MS = 25_000;
const REVISION_ROLES = Object.freeze(['executor', 'reviewer']);

/**
 * Local-only HTTP API over the mission store. Binds are the caller's concern
 * (the CLI pins 127.0.0.1); the server itself exposes no secrets — provider
 * configs are listed without credentials and provider resolution happens
 * through the credential manager at mission start.
 * @param {{ repository: object, providerConfigStore: object,
 *           credentialManager: object, createProvider: Function,
 *           defaultProvider?: string | null }} dependencies
 * @returns {import('node:http').Server}
 */
export function createMissionServer({ repository, providerConfigStore, credentialManager, createProvider, defaultProvider = null }) {
  const sseClients = new Set();
  const running = new Map();
  const heartbeat = setInterval(() => {
    for (const response of sseClients) response.write(': ping\n\n');
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref?.();

  const broadcast = (event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const response of sseClients) response.write(payload);
  };

  const server = createServer((request, response) => {
    handle({ request, response, repository, providerConfigStore, credentialManager, createProvider, defaultProvider, sseClients, broadcast, running })
      .catch((error) => {
        if (!response.headersSent) {
          respondJson(response, 500, { error: error instanceof Error ? error.message : 'Internal server error.' });
        } else {
          response.end();
        }
      });
  });
  server.on('close', () => clearInterval(heartbeat));
  return server;
}

async function handle(context) {
  const { request, response } = context;
  const url = new URL(request.url, 'http://127.0.0.1');
  const { pathname } = url;

  if (pathname === '/api/missions' && request.method === 'GET') {
    return respondJson(response, 200, { missions: context.repository.list() });
  }

  if (pathname === '/api/missions' && request.method === 'POST') {
    return startMission(context);
  }

  const missionMatch = pathname.match(/^\/api\/missions\/([\w-]+)$/);
  if (missionMatch && request.method === 'GET') {
    const mission = context.repository.findById(missionMatch[1]);
    return mission
      ? respondJson(response, 200, mission)
      : respondJson(response, 404, { error: `Unknown mission "${missionMatch[1]}".` });
  }

  const actionMatch = pathname.match(/^\/api\/missions\/([\w-]+)\/(approve|retry|cancel)$/);
  if (actionMatch && request.method === 'POST') {
    if (actionMatch[2] === 'cancel') return cancelMission({ ...context, id: actionMatch[1] });
    return resumeMission({ ...context, id: actionMatch[1], action: actionMatch[2] });
  }

  if (pathname === '/api/events' && request.method === 'GET') {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    response.write('retry: 2000\n\n');
    context.sseClients.add(response);
    request.on('close', () => context.sseClients.delete(response));
    return;
  }

  if (pathname === '/api/providers' && request.method === 'GET') {
    return respondJson(response, 200, { providers: context.providerConfigStore.list() });
  }

  if (pathname.startsWith('/api/')) {
    return respondJson(response, 404, { error: `No route for ${request.method} ${pathname}.` });
  }
  return respondJson(response, 404, { error: 'Not found.' });
}

async function startMission({ request, response, repository, providerConfigStore, credentialManager, createProvider, defaultProvider, broadcast, running }) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return respondJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid JSON body.' });
  }
  let objective;
  let maxProviderCalls = 3;
  let capabilityGrants;
  let workspaceRoot = null;
  try {
    objective = assertObjective(body?.objective);
    if (body?.maxProviderCalls !== undefined) maxProviderCalls = assertPositiveInteger(body.maxProviderCalls, 'maxProviderCalls');
    capabilityGrants = assertCapabilityGrants(body?.capabilities);
    workspaceRoot = typeof body?.workspaceRoot === 'string' && body.workspaceRoot.trim() !== '' ? body.workspaceRoot.trim() : null;
    if (grantsNeedWorkspaceRoot(capabilityGrants) && workspaceRoot === null) {
      throw new TypeError('workspace capabilities require a workspaceRoot.');
    }
    // The path arrives from a browser, so it is validated here instead of
    // failing later inside the run.
    if (workspaceRoot !== null) resolveWorkspaceRoot(workspaceRoot);
  } catch (error) {
    return respondJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid mission request.' });
  }

  let provider;
  let providerLabel;
  try {
    ({ provider, label: providerLabel } = await resolveProvider({ providerConfigStore, credentialManager, createProvider, requestedLabel: body?.provider ?? defaultProvider }));
  } catch (error) {
    if (error instanceof UnknownProviderError) return respondJson(response, 404, { error: error.message });
    if (error instanceof CredentialMissingError || error instanceof ProviderConfigError) return respondJson(response, 409, { error: error.message });
    throw error;
  }

  const missionId = crypto.randomUUID();
  const orchestrator = new Orchestrator({ provider, repository, idFactory: () => missionId });
  const onEvent = (event) => broadcast({ ...event, missionId });

  respondJson(response, 202, { id: missionId, objective, status: 'queued', maxProviderCalls, capabilityGrants, workspaceRoot });

  const controller = new AbortController();
  running.set(missionId, controller);
  try {
    await orchestrator.start({ objective, maxProviderCalls, providerLabel, capabilityGrants, workspaceRoot, signal: controller.signal, onEvent });
  } catch (error) {
    broadcast({ type: 'server_error', missionId, message: error instanceof Error ? error.message : 'Unknown failure.' });
  } finally {
    if (running.get(missionId) === controller) running.delete(missionId);
  }
}

class UnknownProviderError extends Error {}

async function resolveProvider({ providerConfigStore, credentialManager, createProvider, requestedLabel }) {
  if (requestedLabel && !providerConfigStore.findByLabel(requestedLabel)) {
    throw new UnknownProviderError(`Unknown provider "${requestedLabel}". hint: hane provider list`);
  }
  const config = resolveProviderConfig(providerConfigStore, requestedLabel);
  return { provider: await createProvider({ config, credentialManager }), label: config.label };
}

async function resumeMission({ request, response, repository, providerConfigStore, credentialManager, createProvider, defaultProvider, broadcast, running, id, action }) {
  let body = {};
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return respondJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid JSON body.' });
  }
  const mission = repository.findById(id);
  if (!mission) return respondJson(response, 404, { error: `Unknown mission "${id}".` });
  if (running.has(id)) return respondJson(response, 409, { error: `Mission "${id}" is already running.` });

  const task = TaskRun.fromSnapshot(mission);
  try {
    if (action === 'approve') {
      if (mission.status !== TASK_STATUS.AWAITING_APPROVAL) {
        return respondJson(response, 409, { error: `Mission "${id}" is ${mission.status}, not awaiting_approval. hint: POST /api/missions/${id}/retry resumes interrupted missions` });
      }
      for (const role of REVISION_ROLES) delete task.outputs[role];
      const wantedMax = body?.maxProviderCalls !== undefined
        ? assertPositiveInteger(body.maxProviderCalls, 'maxProviderCalls')
        : task.providerCalls + REVISION_ROLES.length;
      if (wantedMax > task.maxProviderCalls) task.extendBudget(wantedMax);
    } else {
      if (mission.status !== TASK_STATUS.NEEDS_ATTENTION && mission.status !== TASK_STATUS.FAILED) {
        return respondJson(response, 409, { error: `Mission "${id}" is ${mission.status}; only needs_attention or failed missions can be retried.` });
      }
      if (body?.maxProviderCalls !== undefined) task.extendBudget(assertPositiveInteger(body.maxProviderCalls, 'maxProviderCalls'));
    }
  } catch (error) {
    return respondJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid mission action.' });
  }

  let provider;
  try {
    ({ provider } = await resolveProvider({ providerConfigStore, credentialManager, createProvider, requestedLabel: body?.provider ?? mission.providerLabel ?? defaultProvider }));
  } catch (error) {
    if (error instanceof UnknownProviderError) return respondJson(response, 404, { error: error.message });
    if (error instanceof CredentialMissingError || error instanceof ProviderConfigError) return respondJson(response, 409, { error: error.message });
    throw error;
  }

  const orchestrator = new Orchestrator({ provider, repository });
  const onEvent = (event) => broadcast({ ...event, missionId: id });

  respondJson(response, 202, { id, objective: mission.objective, status: 'resuming', maxProviderCalls: task.maxProviderCalls });

  const controller = new AbortController();
  running.set(id, controller);
  try {
    await orchestrator.resume(task, { onEvent, signal: controller.signal });
  } catch (error) {
    broadcast({ type: 'server_error', missionId: id, message: error instanceof Error ? error.message : 'Unknown failure.' });
  } finally {
    if (running.get(id) === controller) running.delete(id);
  }
}

function cancelMission({ response, repository, broadcast, running, id }) {
  const mission = repository.findById(id);
  if (!mission) return respondJson(response, 404, { error: `Unknown mission "${id}".` });
  const controller = running.get(id);
  if (!controller) return respondJson(response, 409, { error: `Mission "${id}" is ${mission.status}, not running.` });
  controller.abort(new Error('user_requested'));
  broadcast({ type: 'mission_cancellation_requested', missionId: id, task: mission });
  return respondJson(response, 202, { id, status: 'cancelling' });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body exceeds 64 KB.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim().length === 0) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('Request body is not valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function respondJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}
