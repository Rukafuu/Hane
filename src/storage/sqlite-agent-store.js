import { randomUUID } from 'node:crypto';
import { openHaneDatabase } from './sqlite-database.js';
import { migrate } from './migrations.js';
import { assertAgent } from '../teams/agent.js';
import { TeamError } from '../teams/domain.js';
const FIELDS = 'id, name, description, instructions, provider_label AS providerLabel, exclusive, created_at AS createdAt, updated_at AS updatedAt, visual_json, capabilities_json, is_initial, instruction_files_json';
const decode = row => {
  if (!row) return null;
  const {visual_json,capabilities_json,is_initial,instruction_files_json,...agent}=row;
  return {...agent,exclusive:Boolean(row.exclusive),instructionFiles:JSON.parse(instruction_files_json),visual:JSON.parse(visual_json),capabilities:JSON.parse(capabilities_json),isInitial:Boolean(is_initial)};
};
export class SqliteAgentStore {
  constructor(options) {
    const database = typeof options === 'string' ? openHaneDatabase(options) : options?.database;
    if (!database) throw new TypeError('a SQLite database handle or filename is required.');
    this.database = migrate(database);
  }
  ensureInitial() {
    const existing=this.database.prepare('SELECT id FROM agents WHERE is_initial=1').get();
    return existing ? this.get(existing.id) : this.upsert({id:randomUUID(),name:'Hane',description:'Seu agente pessoal',instructions:'Ajude o usuário com clareza. Preserve suas permissões e seja honesto sobre o que foi verificado.',isInitial:true});
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
      db.prepare(`INSERT INTO agents (id,name,description,instructions,provider_label,exclusive,created_at,updated_at,visual_json,capabilities_json,is_initial,instruction_files_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,
        instructions=excluded.instructions,provider_label=excluded.provider_label,exclusive=excluded.exclusive,updated_at=excluded.updated_at,visual_json=excluded.visual_json,capabilities_json=excluded.capabilities_json,instruction_files_json=excluded.instruction_files_json`)
        .run(agent.id,agent.name,agent.description,agent.instructions,agent.providerLabel,Number(agent.exclusive),now,now,JSON.stringify(agent.visual),JSON.stringify(agent.capabilities),Number(agent.isInitial),JSON.stringify(agent.instructionFiles));
      db.prepare('UPDATE team_members SET exclusive=? WHERE agent_id=?').run(Number(agent.exclusive),agent.id);
      db.exec('COMMIT'); return this.get(agent.id);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  remove(id) {
    if (this.get(id)?.isInitial) throw new TeamError(409,'The onboarding agent can be edited but cannot be deleted.');
    if (this.database.prepare('SELECT 1 FROM conversations WHERE agent_id=? LIMIT 1').get(id) || this.database.prepare('SELECT 1 FROM conversation_messages WHERE agent_id=? LIMIT 1').get(id)) throw new TeamError(409,'This agent has conversation history and cannot be deleted.');
    if (this.database.prepare('SELECT 1 FROM team_members WHERE agent_id=? LIMIT 1').get(id)) throw new TeamError(409,'Remove the agent from its teams first.');
    return this.database.prepare('DELETE FROM agents WHERE id=?').run(id).changes > 0;
  }
}
