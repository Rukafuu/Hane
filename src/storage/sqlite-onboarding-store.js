import { migrate } from './migrations.js';

/** Stores non-secret onboarding connection metadata. OAuth tokens stay in the Credential Manager. */
export class SqliteOnboardingStore {
  constructor({ database }) {
    if (!database) throw new TypeError('a database handle is required.');
    this.database = migrate(database);
  }

  getGitHub() {
    const row = this.database.prepare(`
      SELECT account_label AS accountLabel, scopes_json AS scopesJson, connected_at AS connectedAt
      FROM onboarding_connections WHERE kind = 'github'
    `).get();
    if (!row) return null;
    return { accountLabel: row.accountLabel, scopes: JSON.parse(row.scopesJson), connectedAt: row.connectedAt };
  }

  saveGitHub({ accountLabel, scopes, connectedAt = new Date().toISOString() }) {
    if (typeof accountLabel !== 'string' || accountLabel.trim().length === 0) throw new TypeError('accountLabel is required.');
    if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string')) throw new TypeError('scopes must be an array of strings.');
    this.database.prepare(`
      INSERT INTO onboarding_connections (kind, account_label, scopes_json, connected_at)
      VALUES ('github', ?, ?, ?)
      ON CONFLICT(kind) DO UPDATE SET account_label = excluded.account_label,
        scopes_json = excluded.scopes_json, connected_at = excluded.connected_at
    `).run(accountLabel.trim(), JSON.stringify(scopes), connectedAt);
    return this.getGitHub();
  }
}
