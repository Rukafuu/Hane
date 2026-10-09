import { openHaneDatabase } from './sqlite-database.js';
import { migrate } from './migrations.js';
import { assertProviderConfig } from '../providers/provider-config.js';

/**
 * Declarative provider metadata only. There is deliberately no credential
 * column: the secret lives exclusively in the OS credential vault, addressed
 * by credential_reference.
 */
export class SqliteProviderConfigStore {
  constructor(options) {
    const database = typeof options === 'string' ? openHaneDatabase(options) : options?.database;
    if (!database) throw new TypeError('a SQLite database handle or filename is required.');
    this.database = migrate(database);
  }

  upsert(config) {
    const normalized = assertProviderConfig(config);
    this.database.prepare(`
      INSERT INTO provider_configs (label, base_url, model, credential_reference, max_tokens)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(label) DO UPDATE SET
        base_url = excluded.base_url,
        model = excluded.model,
        credential_reference = excluded.credential_reference,
        max_tokens = excluded.max_tokens
    `).run(normalized.label, normalized.baseUrl, normalized.model, normalized.credentialReference, normalized.maxTokens);
    return normalized;
  }

  list() {
    return this.database.prepare(`
      SELECT label, base_url AS baseUrl, model, credential_reference AS credentialReference,
             max_tokens AS maxTokens
      FROM provider_configs ORDER BY label
    `).all();
  }

  findByLabel(label) {
    return this.database.prepare(`
      SELECT label, base_url AS baseUrl, model, credential_reference AS credentialReference,
             max_tokens AS maxTokens
      FROM provider_configs WHERE label = ?
    `).get(label) ?? null;
  }

  remove(label) {
    return this.database.prepare('DELETE FROM provider_configs WHERE label = ?').run(label).changes > 0;
  }
}
