import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrations.js';

/**
 * Opens the shared Hane SQLite database with the PRAGMAs and schema every
 * store relies on. The schema itself is owned by the numbered migrations.
 * @param {string} filename
 * @returns {InstanceType<typeof DatabaseSync>}
 */
export function openHaneDatabase(filename) {
  const database = new DatabaseSync(filename);
  // Write-ahead logging lets the serve process read while a CLI or a second
  // connection writes; busy_timeout keeps a brief write lock from surfacing as
  // "database is locked". Both are no-ops on ':memory:', which tests use.
  database.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return migrate(database);
}

/** @returns {string} the package-owned database path, independent of the current working directory. */
export function defaultDatabasePath() {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(moduleDirectory, '..', '..');
  const directory = path.join(root, 'outputs');
  mkdirSync(directory, { recursive: true });
  return path.join(directory, 'hane.sqlite');
}
