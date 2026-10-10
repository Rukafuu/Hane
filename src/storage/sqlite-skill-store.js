import { migrate } from './migrations.js';
import { assertSkillManifest } from '../skills/skill-manifest.js';

/** Persists an installed snapshot; source files are never executed or trusted at run time. */
export class SqliteSkillStore {
  constructor({ database }) {
    if (!database) throw new TypeError('a database handle is required.');
    this.database = migrate(database);
  }

  install({ manifest, sourcePath, contentHash, installedAt = new Date().toISOString() }) {
    const skill = assertSkillManifest(manifest);
    if (typeof sourcePath !== 'string' || sourcePath.length === 0) throw new TypeError('sourcePath is required.');
    if (typeof contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(contentHash)) throw new TypeError('contentHash must be a SHA-256 hex digest.');
    this.database.prepare(`
      INSERT INTO installed_skills (id, version, name, description, instructions, tags_json, source_path, content_hash, installed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET version = excluded.version, name = excluded.name,
        description = excluded.description, instructions = excluded.instructions, tags_json = excluded.tags_json,
        source_path = excluded.source_path, content_hash = excluded.content_hash, installed_at = excluded.installed_at
    `).run(skill.id, skill.version, skill.name, skill.description, skill.instructions, JSON.stringify(skill.tags), sourcePath, contentHash, installedAt);
    return this.findById(skill.id);
  }

  list() {
    return this.database.prepare('SELECT id, version, name, description, tags_json AS tagsJson, content_hash AS contentHash, installed_at AS installedAt FROM installed_skills ORDER BY name COLLATE NOCASE, id').all()
      .map((row) => ({ id: row.id, version: row.version, name: row.name, description: row.description, tags: JSON.parse(row.tagsJson), contentHash: row.contentHash, installedAt: row.installedAt }));
  }

  findById(id) {
    const row = this.database.prepare('SELECT id, version, name, description, instructions, tags_json AS tagsJson, source_path AS sourcePath, content_hash AS contentHash, installed_at AS installedAt FROM installed_skills WHERE id = ?').get(id);
    return row ? { id: row.id, version: row.version, name: row.name, description: row.description, instructions: row.instructions, tags: JSON.parse(row.tagsJson), sourcePath: row.sourcePath, contentHash: row.contentHash, installedAt: row.installedAt } : null;
  }
}
