import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { defaultDatabasePath } from '../storage/sqlite-database.js';
import { createMissionServer } from '../server/mission-server.js';
import { resolveWorkspaceRoot } from '../workspace-scope.js';
import { detectWsl } from '../machine/detect.js';

export async function serveMissionCommand({ args, stdout, stderr, dependencies }) {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: 'string', default: '7788' },
      host: { type: 'string', default: '127.0.0.1' },
      db: { type: 'string' },
      provider: { type: 'string' },
      workspace: { type: 'string' },
      'ui-origin': { type: 'string', multiple: true },
      'github-client-id': { type: 'string' },
    },
    allowPositionals: true,
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    stderr.write('error: --port must be a valid port number.\nhint: hane serve --port 7788\n');
    return 1;
  }

  // The workspace root is a decision of this machine, never a value a browser
  // invents, so it is resolved here once and offered to every mission as the
  // default. Resolve before anything is opened or bound: a bad root is a usage
  // error, not a half-started server.
  let defaultWorkspaceRoot = null;
  if (values.workspace !== undefined) {
    try {
      defaultWorkspaceRoot = resolveWorkspaceRoot(values.workspace);
    } catch (error) {
      stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\nhint: hane serve --workspace <dir>\n`);
      return 1;
    }
  }

  const allowedOrigins = ['http://localhost:5173','http://127.0.0.1:5173', ...(values['ui-origin'] ?? [])];
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.origin !== origin) throw new Error('--ui-origin must be an exact loopback HTTP origin.');
  }
  const dbPath = values.db ?? defaultDatabasePath();
  if (values.db) mkdirSync(path.dirname(values.db), { recursive: true });

  const database = dependencies.openDatabase(dbPath);
  const repository = dependencies.createTaskRepository(database);
  const providerConfigStore = dependencies.createProviderConfigStore(database);
  const onboardingStore = dependencies.createOnboardingStore?.(database) ?? {
    getGitHub: () => null,
    saveGitHub: () => { throw new Error('GitHub onboarding storage is unavailable.'); },
  };
  const skillStore = dependencies.createSkillStore?.(database) ?? null;
  const profileStore = dependencies.createProfileStore?.(database, path.join(path.dirname(path.resolve(dbPath)), path.basename(dbPath) + '.profiles'), path.resolve(dbPath)) ?? null;
  const server = createMissionServer({
    profileStore,
    allowedOrigins,
    repository,
    providerConfigStore,
    onboardingStore,
    skillStore,
    credentialManager: dependencies.credentialManager,
    createProvider: dependencies.createProvider,
    defaultProvider: values.provider ?? null,
    defaultWorkspaceRoot,
    bindHost: values.host,
    detectMachine: dependencies.detectMachine ?? detectWsl,
    githubClientId: values['github-client-id'] ?? null,
  });

  try {
    await new Promise((resolve, reject) => server.once('error', reject).listen(port, values.host, resolve));
  } catch (error) {
    stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const address = server.address();
  stdout.write(`hane serve · http://${address.address}:${address.port}\ndb: ${dbPath}\nroutes: GET /api/missions · GET /api/missions/:id · POST /api/missions · GET /api/events · GET /api/providers · GET /api/skills · GET /api/workspace · GET /api/machine · GET /api/onboarding\n`);
  if (!values.provider) stdout.write('provider: auto (single configured provider)\n');
  else stdout.write(`provider: ${values.provider}\n`);
  stdout.write(`github: ${values['github-client-id'] ? 'device flow enabled' : 'not configured (pass --github-client-id)'}\n`);
  stdout.write(`workspace: ${defaultWorkspaceRoot ?? 'no default (pass --workspace <dir>; POST /api/missions must then send workspaceRoot)'}\n`);
  stdout.write('Ctrl+C to stop.\n');

  const addSignalListener = dependencies.addSignalListener ?? ((name, handler) => process.on(name, handler));
  return await new Promise((resolve) => {
    let settled = false;
    const shutdown = () => {
      if (settled) return;
      settled = true;
      stdout.write('\nshutting down.\n');
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      server.close(() => resolve(0));
    };
    addSignalListener('SIGINT', shutdown);
    addSignalListener('SIGTERM', shutdown);
    server.once('close', () => { if (!settled) { settled = true; resolve(0); } });
  });
}
