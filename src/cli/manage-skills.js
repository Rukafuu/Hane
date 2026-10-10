import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { defaultDatabasePath } from '../storage/sqlite-database.js';
import { loadLocalSkillManifest } from '../skills/local-skill-loader.js';

export async function skillsInstallCommand({ args, stdout, dependencies }) {
  const { values, positionals } = parseArgs({ args, options: { db: { type: 'string' } }, allowPositionals: true });
  if (positionals.length !== 1) throw new TypeError('usage: hane skills install <directory> [--db <path>]');
  const dbPath = values.db ?? defaultDatabasePath();
  if (values.db) mkdirSync(path.dirname(values.db), { recursive: true });
  const loaded = await loadLocalSkillManifest(positionals[0]);
  const database = dependencies.openDatabase(dbPath);
  const store = dependencies.createSkillStore(database);
  const saved = store.install(loaded);
  stdout.write(`installed skill: ${saved.name} (${saved.id}@${saved.version})\n`);
  stdout.write('note: local skills are instructions only; installing one grants no tools or permissions.\n');
  database.close();
  return 0;
}

export async function skillsListCommand({ args, stdout, dependencies }) {
  const { values } = parseArgs({ args, options: { db: { type: 'string' } } });
  const database = dependencies.openDatabase(values.db ?? defaultDatabasePath());
  const skills = dependencies.createSkillStore(database).list();
  if (skills.length === 0) stdout.write('no local skills installed.\n');
  else for (const skill of skills) stdout.write(`${skill.id} · ${skill.version} · ${skill.name}${skill.tags.length ? ` · ${skill.tags.join(', ')}` : ''}\n`);
  database.close();
  return 0;
}
