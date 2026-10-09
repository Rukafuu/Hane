import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { defaultDatabasePath } from '../storage/sqlite-database.js';
import { createMissionServer } from '../server/mission-server.js';

export async function serveMissionCommand({ args, stdout, stderr, dependencies }) {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: 'string', default: '7788' },
      host: { type: 'string', default: '127.0.0.1' },
      db: { type: 'string' },
      provider: { type: 'string' },
    },
    allowPositionals: true,
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    stderr.write('error: --port must be a valid port number.\nhint: hane serve --port 7788\n');
    return 1;
  }
  const dbPath = values.db ?? defaultDatabasePath();
  if (values.db) mkdirSync(path.dirname(values.db), { recursive: true });

  const database = dependencies.openDatabase(dbPath);
  const repository = dependencies.createTaskRepository(database);
  const providerConfigStore = dependencies.createProviderConfigStore(database);
  const server = createMissionServer({
    repository,
    providerConfigStore,
    credentialManager: dependencies.credentialManager,
    createProvider: dependencies.createProvider,
    defaultProvider: values.provider ?? null,
  });

  try {
    await new Promise((resolve, reject) => server.once('error', reject).listen(port, values.host, resolve));
  } catch (error) {
    stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const address = server.address();
  stdout.write(`hane serve · http://${address.address}:${address.port}\ndb: ${dbPath}\nroutes: GET /api/missions · GET /api/missions/:id · POST /api/missions · GET /api/events · GET /api/providers\n`);
  if (!values.provider) stdout.write('provider: auto (single configured provider)\n');
  else stdout.write(`provider: ${values.provider}\n`);
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
