import { createSettingsApi } from './settings-api.js';
import { createWorkspacePicker } from './workspace-picker.js';
import { handleInstructionFile } from './instruction-files-api.js';
import { createConversationsApi } from './conversations-api.js';
import { DEFAULT_UI_ORIGINS } from './ui-origins.js';
import { createTeamsApi } from './teams-api.js';
import { SqliteAgentStore } from '../storage/sqlite-agent-store.js';
import { SqliteTeamStore } from '../storage/sqlite-team-store.js';
import { assertId, TeamError } from '../teams/domain.js';
import { createProfileApi } from "./profile-api.js";
import { createServer } from 'node:http';
import { buildExecutionPlan, resolveExecutionProviders, assertPlanUnchanged } from '../teams/execution-plan.js';
import { Orchestrator } from '../orchestrator.js';
import { TASK_STATUS, assertObjective, assertPositiveInteger } from '../contracts.js';
import { assertCapabilityGrants, assertEnforceableScopes, grantsNeedWorkspaceRoot } from '../capabilities.js';
import { resolveWorkspaceRoot } from '../workspace-scope.js';
import { TaskRun, DEFAULT_ACTOR_MAX_PROVIDER_CALLS, DEFAULT_MAX_PROVIDER_CALLS, DEFAULT_MAX_PROVIDER_CALLS_PER_ACTOR, EXECUTION_MODES } from '../task-run.js';
import { ActorOrchestrator } from '../actors/orchestrator.js';
import { assertActorDag } from '../actors/dag.js';
import { resolveActorRoster } from '../actors/roster-providers.js';
import { createActorMissionApi } from './actor-mission-api.js';
import { SqliteActorTaskStore } from '../storage/sqlite-actor-task-store.js';
import { SqliteMailboxStore } from '../storage/sqlite-mailbox-store.js';
import { SqliteStateStore } from '../storage/sqlite-state-store.js';
import { SqliteMissionEventStore } from '../storage/sqlite-mission-events.js';
import { ProviderConfigError, CredentialMissingError } from '../providers/provider-factory.js';
import { resolveProviderConfig } from '../cli/run-mission.js';
import { GitHubAuthorizationPendingError, pollGitHubDeviceAuthorization, startGitHubDeviceAuthorization } from '../integrations/github-device-flow.js';
import { createRequestGuard, isLoopbackHost, RequestGuardError } from './request-guard.js';

const MAX_BODY_BYTES = 64 * 1024;
const SSE_HEARTBEAT_MS = 25_000;
const REVISION_ROLES = Object.freeze(['executor', 'reviewer']);
// The execution budget belongs to the backend: the route declares the ceiling and
// a client may only choose a value inside it. These are call budgets, unrelated to
// the eight-member group rule.
const BUDGET_CEILINGS = Object.freeze({ maxProviderCalls: 64, maxToolCalls: 24 });

function assertBudget(value, name) {
  const calls = assertPositiveInteger(value, name);
  if (calls > BUDGET_CEILINGS[name]) throw new TypeError(`${name} must not exceed ${BUDGET_CEILINGS[name]}.`);
  return calls;
}
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
 * cannot forget to turn it on. `allowedOrigins` defaults to the four origins the
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
export function createMissionServer({ repository, providerConfigStore, onboardingStore, skillStore = null, credentialManager, createProvider, defaultProvider = null, defaultWorkspaceRoot = null, pickWorkspace, detectMachine = null, profileStore = null, agentStore = null, teamStore = null, allowedOrigins = DEFAULT_UI_ORIGINS, avatarLimits, bindHost = '127.0.0.1', githubClientId = null, githubFlow = { start: startGitHubDeviceAuthorization, poll: pollGitHubDeviceAuthorization } }) {
  agentStore ??= repository.database ? new SqliteAgentStore({database:repository.database}) : null;
  teamStore ??= repository.database ? new SqliteTeamStore({database:repository.database}) : null;
  const settingsApi = createSettingsApi({database:repository.database,repository,providerConfigStore,credentialManager,readJsonBody,respondJson});
  const workspacePicker = createWorkspacePicker({pick:pickWorkspace, defaultRoot:defaultWorkspaceRoot, readJsonBody, respondJson});
  const conversationsApi = createConversationsApi({database:repository.database,agentStore,teamStore,providerConfigStore,credentialManager,createProvider,defaultProvider,defaultWorkspaceRoot,readJsonBody,respondJson});
  const teamsApi = createTeamsApi({agentStore,teamStore,readJsonBody,respondJson});
  const guard = createRequestGuard({ allowedOrigins, allowAnyHost: !isLoopbackHost(bindHost), requireExplicitRequest: Boolean(profileStore) });
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
  const profileApi = profileStore ? createProfileApi({ store: profileStore, allowedOrigins, requestGuard: guard, avatarLimits, closeStreams: () => { for (const client of sseClients) client.end(); sseClients.clear(); } }) : null;
  const streamRequests = new WeakMap();
  const running = new Map();
  // Hane is created once per serve process, at the first authorized request that
  // finds a profile. Serving every later request used to re-read that row.
  let initialAgentEnsured = false;
  const pendingGitHubAuthorizations = new Map();
  // Reaching one stream is that stream's problem: a storage fault or a socket that
  // died mid-write closes that client and keeps the serve process alive, because an
  // uncaught error here arrives outside any request and ends the process.
  const forEachStream = (send) => {
    for (const response of sseClients) {
      try {
        if (profileApi && !profileApi.authenticated(streamRequests.get(response))) { response.end(); sseClients.delete(response); continue; }
        send(response);
      } catch {
        try { response.end(); } catch { /* the socket is already gone */ }
        sseClients.delete(response);
      }
    }
  };
  const heartbeat = setInterval(() => forEachStream((response) => response.write(': ping\n\n')), SSE_HEARTBEAT_MS);
  heartbeat.unref?.();

  const broadcast = (event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    forEachStream((response) => response.write(payload));
  };

  // The actor runtime's windows read the same tables the scheduler writes, so the
  // stores are built once here rather than per request. Without a database there
  // is no actor mission to read and the routes say 503 rather than pretending.
  const actorStores = repository.database ? {
    tasks: new SqliteActorTaskStore({ database: repository.database }),
    mailbox: new SqliteMailboxStore({ database: repository.database }),
    state: new SqliteStateStore({ database: repository.database }),
    events: new SqliteMissionEventStore({ database: repository.database }),
  } : null;
  const actorApi = createActorMissionApi({
    repository, agentStore, ...(actorStores ?? {}), readJsonBody, respondJson, broadcast,
  });

  const server = createServer((request, response) => {
    streamRequests.set(response, request);
    Promise.resolve().then(async () => {
      // Enforce the same browser boundary before every route, including profile.
      guard(request);
      if (profileApi && await profileApi.handle(request, response)) return;
      const isAuthorized = () => !profileApi || profileApi.authenticated(request);
      if (!initialAgentEnsured && profileStore?.get() && isAuthorized() && agentStore) { agentStore.ensureInitial(); initialAgentEnsured = true; }
      if (await settingsApi({request,response,isAuthorized})) return;
      if (await workspacePicker({request,response,isAuthorized})) return;
      if (await handleInstructionFile({request,response,isAuthorized,readJsonBody,respondJson})) return;
      if (await conversationsApi.handle({request,response,isAuthorized})) return;
      if (await teamsApi({request,response,isAuthorized})) return;
      if (await actorApi({ request, response, isAuthorized })) return;
      return handle({ isAuthorized: () => !profileApi || profileApi.authenticated(request), request, response, repository, agentStore, teamStore, providerConfigStore, onboardingStore, skillStore, credentialManager, createProvider, defaultProvider, defaultWorkspaceRoot, machineReport, githubClientId, githubFlow, pendingGitHubAuthorizations, sseClients, broadcast, running, actorStores });
    })
      .catch((error) => {
        if (!response.headersSent) {
          // A refusal the server named keeps its status and its own text; an
          // unexpected fault keeps neither, because its message can carry SQL,
          // paths or a username.
          const named = error instanceof RequestGuardError || error instanceof TeamError;
          respondJson(response, named ? error.status : 500, { error: named ? error.message : 'Internal server error.' });
        } else {
          response.end();
        }
      });
  });
  server.on('close', () => { clearInterval(heartbeat); conversationsApi.close(); });
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

async function startMission({ request, response, repository, agentStore, teamStore, providerConfigStore, credentialManager, createProvider, defaultProvider, defaultWorkspaceRoot, broadcast, running, actorStores = null, isAuthorized = () => true }) {
  let body;
  try {
    body = await readJsonBody(request);
    if (!isAuthorized()) return respondJson(response,401,{error:"Seu Hane está bloqueado."});
  } catch (error) {
    return respondJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid JSON body.' });
  }
  let objective;
  let teamId = null;
  let missionTeam = null;
  let maxProviderCalls = DEFAULT_MAX_PROVIDER_CALLS;
  let maxToolCalls;
  let capabilityGrants;
  let workspaceRoot = null;
  let executionMode = 'sequential';
  let maxProviderCallsPerActor = DEFAULT_MAX_PROVIDER_CALLS_PER_ACTOR;
  let actorTasks = null;
  let planAgentId = null;
  let reviewerAgentId = null;
  try {
    objective = assertObjective(body?.objective);
    if (body?.executionMode !== undefined) {
      if (!EXECUTION_MODES.includes(body.executionMode)) {
        throw new TypeError(`executionMode must be one of ${EXECUTION_MODES.join(', ')}.`);
      }
      executionMode = body.executionMode;
    }
    if (body?.teamId != null) {
      teamId = assertId(body.teamId,'teamId');
      if (!teamStore) throw new TypeError('Teams storage is unavailable.');
      missionTeam = teamStore.requireActive(teamId);
    }
    if (body?.maxProviderCalls !== undefined) maxProviderCalls = assertBudget(body.maxProviderCalls, 'maxProviderCalls');
    if (body?.maxToolCalls !== undefined) maxToolCalls = assertBudget(body.maxToolCalls, 'maxToolCalls');
    if (body?.maxProviderCallsPerActor !== undefined) {
      maxProviderCallsPerActor = assertPositiveInteger(body.maxProviderCallsPerActor, 'maxProviderCallsPerActor');
    }
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
    if (executionMode === 'actor') {
      // Actors work the whole group: there is no role to cast, so the Team is the
      // roster and the plan is the schedule. A request that names roles is asking
      // for the sequential preset under an actor label, and saying which one it
      // means is cheaper than guessing.
      if (teamId === null) throw new TypeError('executionMode "actor" runs a Team: teamId is required.');
      if (!actorStores) throw new TypeError('Actor missions need a SQLite-backed server.');
      if (body?.roleAssignments !== undefined) {
        throw new TypeError('An actor execution works the whole Team; roleAssignments belong to the sequential preset.');
      }
      if (body?.provider !== undefined && !providerConfigStore.findByLabel(body.provider)) {
        throw new UnknownProviderError(`Unknown provider "${body.provider}". hint: hane provider list`);
      }
      // A crew cannot live on a sequential budget: three teammates with a six-call
      // share each need more than ten calls to ever get a turn. An explicit
      // `maxProviderCalls` in the request is the user's authorization and wins.
      if (body?.maxProviderCalls === undefined) maxProviderCalls = DEFAULT_ACTOR_MAX_PROVIDER_CALLS;
      if (maxProviderCallsPerActor > maxProviderCalls) {
        throw new TypeError(`maxProviderCallsPerActor (${maxProviderCallsPerActor}) cannot exceed the mission's maxProviderCalls (${maxProviderCalls}).`);
      }
      planAgentId = body?.planAgentId ?? missionTeam.leaderAgentId ?? null;
      reviewerAgentId = body?.reviewerAgentId ?? missionTeam.leaderAgentId ?? null;
      if (reviewerAgentId === null) {
        throw new TypeError('An actor mission needs a reviewer: send reviewerAgentId, or set a leader for the Team.');
      }
      for (const [name, value] of [['planAgentId', planAgentId], ['reviewerAgentId', reviewerAgentId]]) {
        if (!missionTeam.members.includes(value)) {
          throw new TypeError(`${name} must be a member of the Team working this mission.`);
        }
      }
      // A plan the user authored is validated before the mission exists, because a
      // cycle discovered after the 202 is wreckage the user has to read.
      actorTasks = body?.tasks ?? null;
      if (actorTasks !== null) assertActorDag({ tasks: actorTasks, agentIds: missionTeam.members });
    }
  } catch (error) {
    if (error instanceof UnknownProviderError) return respondJson(response, 404, { error: error.message });
    return respondJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid mission request.' });
  }

  let provider;
  let providerLabel;
  let executionPlan = null, roleProviders = null;
  let actorRoster = null, actorProviders = null;
  try {
    if (executionMode === 'actor') {
      const resolved = await resolveActorRoster({
        agentIds: missionTeam.members,
        agentStore,
        providerConfigStore,
        credentialManager,
        createProvider,
        fallbackProvider: body?.provider ?? defaultProvider,
      });
      actorRoster = resolved.roster;
      actorProviders = resolved.providers;
      // The ledger names one provider, and an actor mission has several. The
      // author's label is the honest choice: it is the model that wrote the plan,
      // and a resume reads it as the fallback for a member that lost its own.
      const author = actorRoster.find((agent) => agent.agentId === (planAgentId ?? actorRoster[0].agentId));
      providerLabel = author?.providerLabel ?? actorRoster[0].providerLabel;
    } else if (body?.roleAssignments !== undefined) {
      executionPlan = buildExecutionPlan({teamId,roleAssignments:body.roleAssignments,teamStore,agentStore,providerConfigStore,fallbackProvider:body?.provider ?? defaultProvider});
      roleProviders = await resolveExecutionProviders({executionPlan,providerConfigStore,credentialManager,createProvider});
      assertPlanUnchanged(executionPlan,{teamStore,agentStore,providerConfigStore,fallbackProvider:body?.provider ?? defaultProvider});
      provider = roleProviders.planner;
      providerLabel = executionPlan.roles.planner.providerLabel;
    } else ({ provider, label: providerLabel } = await resolveProvider({ providerConfigStore, credentialManager, createProvider, requestedLabel: body?.provider ?? defaultProvider }));
  } catch (error) {
    if (error instanceof TeamError) return respondJson(response,error.status,{error:error.message});
    if (error instanceof TypeError) return respondJson(response,400,{error:error.message});
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
  const onEvent = (event) => broadcast({ ...event, missionId });
  const controller = new AbortController();

  if (executionMode === 'actor') {
    const orchestrator = new ActorOrchestrator({
      providers: actorProviders,
      database: repository.database,
      repository,
      agentCapabilityCheck: agentStore ? (id, capability) => agentStore.get(id)?.capabilities.includes(capability) === true : null,
      idFactory: () => missionId,
    });
    respondJson(response, 202, {
      id: missionId, objective, status: 'queued', executionMode, teamId,
      maxProviderCalls, maxProviderCallsPerActor, maxToolCalls, capabilityGrants, workspaceRoot,
      providerLabel,
      actors: actorRoster.map(({ agentId, name, providerLabel: label, model }) => ({ agentId, name, providerLabel: label, model })),
      ...(actorTasks ? { tasks: actorTasks } : {}),
    });
    running.set(missionId, controller);
    try {
      await orchestrator.start({
        objective, teamId, executionPlan: null, tasks: actorTasks, planAgentId, reviewerAgentId,
        roster: actorRoster, providerLabel, maxProviderCalls, maxProviderCallsPerActor,
        ...(maxToolCalls === undefined ? {} : { maxToolCalls }),
        capabilityGrants, workspaceRoot, signal: controller.signal, onEvent,
      });
    } catch (error) {
      broadcast({ type: 'server_error', missionId, message: error instanceof Error ? error.message : 'Unknown failure.' });
    } finally {
      if (running.get(missionId) === controller) running.delete(missionId);
    }
    return;
  }

  const orchestrator = new Orchestrator({ provider, roleProviders, agentCapabilityCheck:agentStore ? (id,capability)=>agentStore.get(id)?.capabilities.includes(capability) === true : null, repository, idFactory: () => missionId });

  respondJson(response, 202, { id: missionId, objective, status: 'queued', executionMode, maxProviderCalls, maxToolCalls, capabilityGrants, workspaceRoot, ...(executionPlan ? {executionPlan} : {}), ...(teamId ? {teamId} : {}) });

  running.set(missionId, controller);
  try {
    await orchestrator.start({ objective, teamId, executionPlan, maxProviderCalls, maxToolCalls, providerLabel, capabilityGrants, workspaceRoot, signal: controller.signal, onEvent });
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

async function resumeMission({ request, response, repository, agentStore, teamStore, providerConfigStore, credentialManager, createProvider, defaultProvider, broadcast, running, actorStores = null, id, action, isAuthorized = () => true }) {
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
        ? assertBudget(body.maxProviderCalls, 'maxProviderCalls')
        : Math.min(task.providerCalls + REVISION_ROLES.length, BUDGET_CEILINGS.maxProviderCalls);
      if (wantedMax > task.maxProviderCalls) task.extendBudget(wantedMax);
    } else {
      if (mission.status !== TASK_STATUS.NEEDS_ATTENTION && mission.status !== TASK_STATUS.FAILED) {
        return respondJson(response, 409, { error: `Mission "${id}" is ${mission.status}; only needs_attention or failed missions can be retried.` });
      }
      if (body?.maxProviderCalls !== undefined) task.extendBudget(assertBudget(body.maxProviderCalls, 'maxProviderCalls'));
    }
    if (body?.maxToolCalls !== undefined) {
      task.extendToolBudget(assertBudget(body.maxToolCalls, 'maxToolCalls'));
    }
  } catch (error) {
    return respondJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid mission action.' });
  }

  let provider, roleProviders = null, actorRoster = null, actorProviders = null;
  try {
    if (task.mode === 'actor') {
      // An actor mission resumes against its Team: the members are the roster, and
      // each brings the provider it was configured with. A mission that outlived
      // its group is refused rather than run by whoever is left.
      if (!actorStores || !teamStore || task.teamId === null) {
        throw new ProviderConfigError('An actor mission resumes against its Team and the actor storage it was booked in.');
      }
      const team = teamStore.requireActive(task.teamId);
      ({ roster: actorRoster, providers: actorProviders } = await resolveActorRoster({
        agentIds: team.members,
        agentStore,
        providerConfigStore,
        credentialManager,
        createProvider,
        fallbackProvider: body?.provider ?? mission.providerLabel ?? defaultProvider,
      }));
    } else if (task.executionPlan) {
      if (body?.provider !== undefined || body?.roleAssignments !== undefined) throw new TypeError('A resumed preset retains its recorded agents and providers.');
      roleProviders = await resolveExecutionProviders({executionPlan:task.executionPlan,providerConfigStore,credentialManager,createProvider});
      provider = roleProviders.planner;
    } else ({ provider } = await resolveProvider({ providerConfigStore, credentialManager, createProvider, requestedLabel: body?.provider ?? mission.providerLabel ?? defaultProvider }));
  } catch (error) {
    if (error instanceof TeamError) return respondJson(response,error.status,{error:error.message});
    if (error instanceof TypeError) return respondJson(response,400,{error:error.message});
    if (error instanceof UnknownProviderError) return respondJson(response, 404, { error: error.message });
    if (error instanceof CredentialMissingError || error instanceof ProviderConfigError) return respondJson(response, 409, { error: error.message });
    throw error;
  }

  if (!isAuthorized()) return respondJson(response,401,{error:"Seu Hane está bloqueado."});
  if (running.has(id)) return respondJson(response,409,{error:'Mission is already running.'});
  const onEvent = (event) => broadcast({ ...event, missionId: id });
  const controller = new AbortController();
  const capabilityCheck = agentStore ? (id,capability)=>agentStore.get(id)?.capabilities.includes(capability) === true : null;

  if (task.mode === 'actor') {
    const orchestrator = new ActorOrchestrator({
      providers: actorProviders, database: repository.database, repository,
      agentCapabilityCheck: capabilityCheck,
    });
    respondJson(response, 202, {
      id, objective: mission.objective, status: 'resuming', executionMode: 'actor',
      maxProviderCalls: task.maxProviderCalls, maxProviderCallsPerActor: task.maxProviderCallsPerActor,
      maxToolCalls: task.maxToolCalls,
      actors: actorRoster.map(({ agentId, name, providerLabel: label, model }) => ({ agentId, name, providerLabel: label, model })),
    });
    running.set(id, controller);
    try {
      await orchestrator.resume(task, {
        roster: actorRoster,
        reviewerAgentId: actorReviewerOf(mission.audit),
        onEvent,
        signal: controller.signal,
      });
    } catch (error) {
      broadcast({ type: 'server_error', missionId: id, message: error instanceof Error ? error.message : 'Unknown failure.' });
    } finally {
      if (running.get(id) === controller) running.delete(id);
    }
    return;
  }

  const orchestrator = new Orchestrator({ provider, roleProviders, agentCapabilityCheck:capabilityCheck, repository });

  respondJson(response, 202, { id, objective: mission.objective, status: 'resuming', maxProviderCalls: task.maxProviderCalls, maxToolCalls: task.maxToolCalls });

  running.set(id, controller);
  try {
    await orchestrator.resume(task, { onEvent, signal: controller.signal });
  } catch (error) {
    broadcast({ type: 'server_error', missionId: id, message: error instanceof Error ? error.message : 'Unknown failure.' });
  } finally {
    if (running.get(id) === controller) running.delete(id);
  }
}

/**
 * The reviewer a stored actor mission was working with. No `actor_tasks` column
 * names who signs off, so the audit line the orchestrator wrote is the only record
 * of it — and a Team whose leader changed since then still has to be reviewed by
 * the teammate this mission was started with, not by whoever leads now.
 */
function actorReviewerOf(audit) {
  for (let index = (audit?.length ?? 0) - 1; index >= 0; index -= 1) {
    const entry = audit[index];
    if (entry?.type === 'actor_reviewer_bound' && typeof entry.detail?.reviewerAgentId === 'string') {
      return entry.detail.reviewerAgentId;
    }
  }
  return null;
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

function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body exceeds '+maxBytes+' bytes.'));
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
