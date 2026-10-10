import { openHaneDatabase } from './sqlite-database.js';
import { migrate } from './migrations.js';
import { assertAgent } from '../teams/agent.js';
import { TeamError } from '../teams/domain.js';
const FIELDS = 'id, name, description, instructions, provider_label AS providerLabel, exclusive, created_at AS createdAt, updated_at AS updatedAt';
const decode = row => row ? { ...row, exclusive: Boolean(row.exclusive) } : null;
export class SqliteAgentStore {
  constructor(options) {
    const database = typeof options === 'string' ? openHaneDatabase(options) : options?.database;
    if (!database) throw new TypeError('a SQLite database handle or filename is required.');
    this.database = migrate(database);
  }
  get(id) { return decode(this.database.prepare('SELECT ' + FIELDS + ' FROM agents WHERE id=?').get(id)); }
  list() { return this.database.prepare('SELECT ' + FIELDS + ' FROM agents ORDER BY created_at,id').all().map(decode); }
  upsert(candidate) {
    const agent = assertAgent(candidate), db = this.database;
    if (agent.providerLabel && !db.prepare('SELECT label FROM provider_configs WHERE label=?').get(agent.providerLabel)) throw new TeamError(409,'Unknown provider. Configure it with hane provider add.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const memberships = db.prepare('SELECT team_id FROM team_members WHERE agent_id=?').all(agent.id);
      if (agent.exclusive && memberships.length > 1) throw new TeamError(409,'An agent shared by multiple teams cannot become exclusive.');
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO agents (id,name,description,instructions,provider_label,exclusive,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,
        instructions=excluded.instructions,provider_label=excluded.provider_label,exclusive=excluded.exclusive,updated_at=excluded.updated_at`)
        .run(agent.id,agent.name,agent.description,agent.instructions,agent.providerLabel,Number(agent.exclusive),now,now);
      db.prepare('UPDATE team_members SET exclusive=? WHERE agent_id=?').run(Number(agent.exclusive),agent.id);
      db.exec('COMMIT'); return this.get(agent.id);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  remove(id) {
    if (this.database.prepare('SELECT 1 FROM team_members WHERE agent_id=? LIMIT 1').get(id)) throw new TeamError(409,'Remove the agent from its teams first.');
    return this.database.prepare('DELETE FROM agents WHERE id=?').run(id).changes > 0;
  }
}
