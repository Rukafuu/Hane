import { DEFAULT_UI_ORIGINS } from './ui-origins.js';
import { createTeamsApi } from './teams-api.js';
import { SqliteAgentStore } from '../storage/sqlite-agent-store.js';
import { SqliteTeamStore } from '../storage/sqlite-team-store.js';
import { assertId } from '../teams/domain.js';
import { createProfileApi } from "./profile-api.js";
import { createServer } from 'node:http';
import { Orchestrator } from '../orchestrator.js';
import { TASK_STATUS, assertObjective, assertPositiveInteger } from '../contracts.js';
import { assertCapabilityGrants, assertEnforceableScopes, grantsNeedWorkspaceRoot } from '../capabilities.js';
import { resolveWorkspaceRoot } from '../workspace-scope.js';
import { TaskRun, DEFAULT_MAX_PROVIDER_CALLS } from '../task-run.js';
import { ProviderConfigError, CredentialMissingError } from '../providers/provider-factory.js';
import { resolveProviderConfig } from '../cli/run-mission.js';
import { GitHubAuthorizationPendingError, pollGitHubDeviceAuthorization, startGitHubDeviceAuthorization } from '../integrations/github-device-flow.js';
import { createRequestGuard, isLoopbackHost, RequestGuardError } from './request-guard.js';

const MAX_BODY_BYTES = 64 * 1024;
const SSE_HEARTBEAT_MS = 25_000;
const REVISION_ROLES = Object.freeze(['executor', 'reviewer']);
/** A server built without a probe says so, rather than implying an empty box. */
const NOT_DETECTED_MACHINE = Object.freeze({
  backend: 'wsl',
  available: false,
  reason: 'not_detected',
  detail: 'This server was started without a machine probe.',
  wslVersion: null,
  hint: null,
  distros: Object.freeze([]),
});

/**
 * Local-only HTTP API over the mission store. Binds are the caller's concern
 * (the CLI pins 127.0.0.1); the server itself exposes no secrets — provider
 * configs are listed without credentials and provider resolution happens
 * through the credential manager at mission start.
 *
 * Every route sits behind `createRequestGuard`, mounted here rather than in the
 * CLI, because the browser boundary is a property of the server: an embedder
 * that builds this server by hand gets the same refusal a page would hit, and
 * cannot forget to turn it on. `allowedOrigins` defaults to the two origins the
 * bundled UI is served from during development, so an embedder that passes
 * nothing still accepts its own page.
 * @param {{ repository: object, providerConfigStore: object,
 *           credentialManager: object, createProvider: Function,
 *           defaultProvider?: string | null,
 *           defaultWorkspaceRoot?: string | null,
 *           detectMachine?: (() => Promise<object>) | null,
 *           bindHost?: string }} dependencies
 *           `bindHost` is what the CLI passed to `listen`; a server told it bound
 *           away from loopback stops checking `Host`, or it would refuse its own
 *           clients. A server that was never told assumes `127.0.0.1`.
 * @returns {import('node:http').Server}
 */
export function createMissionServer({ repository, providerConfigStore, onboardingStore, skillStore = null, credentialManager, createProvider, defaultProvider = null, defaultWorkspaceRoot = null, detectMachine = null, profileStore = null, agentStore = null, teamStore = null, allowedOrigins = DEFAULT_UI_ORIGINS, avatarLimits, bindHost = '127.0.0.1', githubClientId = null, githubFlow = { start: startGitHubDeviceAuthorization, poll: pollGitHubDeviceAuthorization } }) {
  agentStore ??= repository.database ? new SqliteAgentStore({database:repository.database}) : null;
  teamStore ??= repository.database ? new SqliteTeamStore({database:repository.database}) : null;
  const teamsApi = createTeamsApi({agentStore,teamStore,readJsonBody,respondJson});
  const guard = createRequestGuard({ allowedOrigins, allowAnyHost: !isLoopbackHost(bindHost) });
  const sseClients = new Set();
  // The probes spawn wsl.exe, so they are not taken at bind time and never
  // taken per request: the first caller of /api/machine pays for one probe and
  // every later caller reads the same answer. A serve process is short-lived
  // enough that "as of the first question" is the honest scope.
  let machineProbe = null;
  const machineReport = async () => {
    if (!detectMachine) return NOT_DETECTED_MACHINE;
    machineProbe ??= Promise.resolve().then(detectMachine).then(
      (report) => report ?? NOT_DETECTED_MACHINE,
      () => ({ ...NOT_DETECTED_MACHINE, reason: 'wsl_command_failed', detail: 'The machine probe threw; nothing about the box is known.' }),
    );
    return await machineProbe;
  };
  const profileApi = profileStore ? createProfileApi({ store: profileStore, allowedOrigins, avatarLimits, closeStreams: () => { for (const client of sseClients) client.end(); sseClients.clear(); } }) : null;
  const streamRequests = new WeakMap();
  const running = new Map();
  const pendingGitHubAuthorizations = new Map();
  const heartbeat = setInterval(() => {
    for (const response of sseClients) { if (profileApi && !profileApi.authenticated(streamRequests.get(response))) { response.end(); sseClients.delete(response); } else response.write(': ping\n\n'); }
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref?.();

  const broadcast = (event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const response of sseClients) { if (profileApi && !profileApi.authenticated(streamRequests.get(response))) { response.end(); sseClients.delete(response); } else response.write(payload); }
  };

  const server = createServer((request, response) => {
    streamRequests.set(response, request);
    Promise.resolve().then(async () => {
      // The profile surface validates browser requests with its own rules until
      // the fusion ADR-0002 asks for lands (see the measured divergences there):
      // an avatar upload carries an image body, which this guard answers 415 for,
      // and a page with an opaque origin may read but never mutate here.
      if (profileApi && await profileApi.handle(request, response)) return;
      guard(request);
      const isAuthorized = () => !profileApi || profileApi.authenticated(request);
      if (await teamsApi({request,response,isAuthorized})) return;
      return handle({ isAuthorized: () => !profileApi || profileApi.authenticated(request), request, response, repository, teamStore, providerConfigStore, onboardingStore, skillStore, credentialManager, createProvider, defaultProvider, defaultWorkspaceRoot, machineReport, githubClientId, githubFlow, pendingGitHubAuthorizations, sseClients, broadcast, running });
    })
      .catch((error) => {
        if (!response.headersSent) {
          respondJson(response, error instanceof RequestGuardError ? error.status : 500, { error: error instanceof Error ? error.message : 'Internal server error.' });
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

  if (pathname === '/api/skills' && request.method === 'GET') {
    return respondJson(response, 200, { skills: context.skillStore?.list() ?? [] });
  }

  // The browser cannot name a path, so it asks whether this server already
  // owns a workspace root instead of inventing one. Metadata only: no
  // provider config, no credential reference, no secret.
  if (pathname === '/api/workspace' && request.method === 'GET') {
    const root = context.defaultWorkspaceRoot ?? null;
    return respondJson(response, 200, { available: root !== null, root });
  }

  // Metadata about the box that could carry writes and commands. Detection
  // only: this route installs nothing, and it never reports a capability the
  // sandbox seam does not actually execute.
  if (pathname === '/api/machine' && request.method === 'GET') {
    return respondJson(response, 200, await context.machineReport());
  }

  if (pathname === '/api/onboarding' && request.method === 'GET') {
    return respondJson(response, 200, { github: context.onboardingStore?.getGitHub() ?? null, githubAvailable: Boolean(context.githubClientId) });
  }

  if (pathname === '/api/onboarding/github/device' && request.method === 'POST') {
    return startGitHubAuthorization(context);
  }

  const githubPoll = pathname.match(/^\/api\/onboarding\/github\/device\/([\w-]+)\/poll$/);
  if (githubPoll && request.method === 'POST') return pollGitHubAuthorization({ ...context, authorizationId: githubPoll[1] });

  if (pathname.startsWith('/api/')) {
    return respondJson(response, 404, { error: `No route for ${request.method} ${pathname}.` });
  }
  return respondJson(response, 404, { error: 'Not found.' });
}

async function startGitHubAuthorization({ response, githubClientId, githubFlow, pendingGitHubAuthorizations }) {
  try {
    const authorization = await githubFlow.start({ clientId: githubClientId });
    const id = crypto.randomUUID();
    pendingGitHubAuthorizations.set(id, { deviceCode: authorization.deviceCode, expiresAt: Date.now() + authorization.expiresIn * 1000 });
    return respondJson(response, 201, { id, userCode: authorization.userCode, verificationUri: authorization.verificationUri, interval: authorization.interval, expiresIn: authorization.expiresIn });
  } catch (error) {
    return respondJson(response, 409, { error: error instanceof Error ? error.message : 'Could not start GitHub authorization.' });
  }
}

async function pollGitHubAuthorization({ response, authorizationId, githubClientId, githubFlow, pendingGitHubAuthorizations, credentialManager, onboardingStore }) {
  const pending = pendingGitHubAuthorizations.get(authorizationId);
  if (!pending || pending.expiresAt <= Date.now()) {
    pendingGitHubAuthorizations.delete(authorizationId);
    return respondJson(response, 410, { error: 'GitHub authorization expired. Start again.' });
  }
  try {
    const connection = await githubFlow.poll({ clientId: githubClientId, deviceCode: pending.deviceCode });
    await credentialManager.set('local-agent-orchestrator/github', connection.accessToken);
    const github = onboardingStore.saveGitHub({ accountLabel: connection.login, scopes: connection.scopes });
    pendingGitHubAuthorizations.delete(authorizationId);
    return respondJson(response, 200, { status: 'connected', github });
  } catch (error) {
    if (error instanceof GitHubAuthorizationPendingError) return respondJson(response, 202, { status: 'pending' });
    pendingGitHubAuthorizations.delete(authorizationId);
    return respondJson(response, 409, { error: error instanceof Error ? error.message : 'GitHub authorization failed.' });
  }
}

async function startMission({ request, response, repository, teamStore, providerConfigStore, credentialManager, createProvider, defaultProvider, defaultWorkspaceRoot, broadcast, running, isAuthorized = () => true }) {
  let body;
  try {
    body = await readJsonBody(request);
    if (!isAuthorized()) return respondJson(response,401,{error:"Seu Hane está bloqueado."});
  } catch (error) {
    return respondJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid JSON body.' });
  }
  let objective;
  let teamId = null;
  let maxProviderCalls = DEFAULT_MAX_PROVIDER_CALLS;
  let maxToolCalls;
  let capabilityGrants;
  let workspaceRoot = null;
  try {
    objective = assertObjective(body?.objective);
    if (body?.teamId != null) {
      teamId = assertId(body.teamId,'teamId');
      if (!teamStore) throw new TypeError('Teams storage is unavailable.');
      teamStore.requireActive(teamId);
    }
    if (body?.maxProviderCalls !== undefined) maxProviderCalls = assertPositiveInteger(body.maxProviderCalls, 'maxProviderCalls');
    if (body?.maxToolCalls !== undefined) maxToolCalls = assertPositiveInteger(body.maxToolCalls, 'maxToolCalls');
    capabilityGrants = assertEnforceableScopes(assertCapabilityGrants(body?.capabilities));
    const requestedRoot = typeof body?.workspaceRoot === 'string' && body.workspaceRoot.trim() !== '' ? body.workspaceRoot.trim() : null;
    // The browser has no way to name a directory on this machine — its folder
    // picker only yields a display name — so the root the server was started
    // with stands in whenever the request omits one.
    workspaceRoot = requestedRoot ?? defaultWorkspaceRoot ?? null;
    if (grantsNeedWorkspaceRoot(capabilityGrants) && workspaceRoot === null) {
      throw new TypeError('workspace capabilities require a workspaceRoot, or a server default from hane serve --workspace <dir>.');
    }
    // The path arrives from a browser, so it is validated here instead of
    // failing later inside the run, and the mission keeps the resolved root it
    // will actually be enforced against.
    if (workspaceRoot !== null) workspaceRoot = resolveWorkspaceRoot(workspaceRoot);
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

  if (!isAuthorized()) return respondJson(response,401,{error:"Seu Hane está bloqueado."});
  if (teamId) {
    try { teamStore.requireActive(teamId); }
    catch (error) { return respondJson(response,400,{error:error.message}); }
  }
  const missionId = crypto.randomUUID();
  const orchestrator = new Orchestrator({ provider, repository, idFactory: () => missionId });
  const onEvent = (event) => broadcast({ ...event, missionId });

  respondJson(response, 202, { id: missionId, objective, status: 'queued', maxProviderCalls, maxToolCalls, capabilityGrants, workspaceRoot, ...(teamId ? {teamId} : {}) });

  const controller = new AbortController();
  running.set(missionId, controller);
  try {
    await orchestrator.start({ objective, teamId, maxProviderCalls, maxToolCalls, providerLabel, capabilityGrants, workspaceRoot, signal: controller.signal, onEvent });
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

async function resumeMission({ request, response, repository, providerConfigStore, credentialManager, createProvider, defaultProvider, broadcast, running, id, action, isAuthorized = () => true }) {
  let body = {};
  try {
    body = await readJsonBody(request);
    if (!isAuthorized()) return respondJson(response,401,{error:"Seu Hane está bloqueado."});
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
    if (body?.maxToolCalls !== undefined) {
      task.extendToolBudget(assertPositiveInteger(body.maxToolCalls, 'maxToolCalls'));
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

  if (!isAuthorized()) return respondJson(response,401,{error:"Seu Hane está bloqueado."});
  const orchestrator = new Orchestrator({ provider, repository });
  const onEvent = (event) => broadcast({ ...event, missionId: id });

  respondJson(response, 202, { id, objective: mission.objective, status: 'resuming', maxProviderCalls: task.maxProviderCalls, maxToolCalls: task.maxToolCalls });

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
