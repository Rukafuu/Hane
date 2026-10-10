import { runMissionCommand } from './run-mission.js';
import { missionsCommand, missionCommand, retryCommand, approveCommand } from './mission-lifecycle.js';
import { serveMissionCommand } from './serve-mission.js';
import { providerAddCommand, providerListCommand, providerRemoveCommand, providerSetSecretCommand } from './manage-providers.js';
import { openHaneDatabase } from '../storage/sqlite-database.js';
import { SqliteTaskRepository } from '../storage/sqlite-task-repository.js';
import { SqliteProviderConfigStore } from '../storage/sqlite-provider-config-store.js';
import { WindowsCredentialManager } from '../credentials/windows-credential-manager.js';
import { createProviderFromConfig } from '../providers/provider-factory.js';

export function createDefaultDependencies() {
  return {
    openDatabase: (filename) => openHaneDatabase(filename),
    createTaskRepository: (database) => new SqliteTaskRepository({ database }),
    createProviderConfigStore: (database) => new SqliteProviderConfigStore({ database }),
    credentialManager: new WindowsCredentialManager(),
    createProvider: createProviderFromConfig,
  };
}

const USAGE = `usage: hane <command> [options]

commands:
  provider add --label <name> --base-url <url> --model <id> [--max-tokens N]
  provider list
  provider remove <label>
  provider set-secret <label>
  run "<objective>" [--provider <label>] [--max-calls N] [--max-tool-calls N] [--db <path>] [--workspace <dir>] [--capability <name>=<scope>] [--json]
  missions [--db <path>]
  mission <id> [--db <path>] [--json]
  retry <id> [--provider <label>] [--max-calls N] [--max-tool-calls N] [--db <path>] [--json]
  approve <id> [--provider <label>] [--max-calls N] [--max-tool-calls N] [--db <path>] [--json]
  serve [--port N] [--host <addr>] [--db <path>] [--provider <label>] [--workspace <dir>]
`;

/**
 * Dispatches a CLI invocation and returns an exit code. It never terminates the
 * process; bin/hane.js owns process lifetime.
 * @param {{ argv?: string[], stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream,
 *           stdin?: NodeJS.ReadableStream, dependencies?: ReturnType<typeof createDefaultDependencies> }} options
 * @returns {Promise<number>}
 */
export async function runCli({ argv = [], stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, dependencies = createDefaultDependencies() } = {}) {
  const [command, subcommand, ...rest] = argv;
  try {
    if (command === 'provider') {
      switch (subcommand) {
        case 'add': return await providerAddCommand({ args: rest, stdout, stderr, dependencies });
        case 'list': return await providerListCommand({ args: rest, stdout, dependencies });
        case 'remove': return await providerRemoveCommand({ args: rest, stdout, stderr, dependencies });
        case 'set-secret': return await providerSetSecretCommand({ args: rest, stdin, stdout, stderr, dependencies });
        default:
          stderr.write(`error: unknown provider command "${subcommand ?? ''}".\n${USAGE}`);
          return 1;
      }
    }
    if (command === 'run') return await runMissionCommand({ args: argv.slice(1), stdout, stderr, dependencies });
    if (command === 'missions') return await missionsCommand({ args: argv.slice(1), stdout, dependencies });
    if (command === 'mission') return await missionCommand({ args: argv.slice(1), stdout, stderr, dependencies });
    if (command === 'retry') return await retryCommand({ args: argv.slice(1), stdout, stderr, dependencies });
    if (command === 'approve') return await approveCommand({ args: argv.slice(1), stdout, stderr, dependencies });
    if (command === 'serve') return await serveMissionCommand({ args: argv.slice(1), stdout, stderr, dependencies });
    stderr.write(`error: unknown command "${command ?? ''}".\n${USAGE}`);
    return 1;
  } catch (error) {
    stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
