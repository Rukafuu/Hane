import { openHaneDatabase } from './sqlite-database.js';
import { migrate } from './migrations.js';
import { assertTeam } from '../teams/team.js';
import { TeamError } from '../teams/domain.js';
const FIELDS = 'id,name,description,leader_agent_id AS leaderAgentId,created_at AS createdAt,updated_at AS updatedAt,archived_at AS archivedAt';
export class SqliteTeamStore {
  constructor(options) {
    const database = typeof options === 'string' ? openHaneDatabase(options) : options?.database;
    if (!database) throw new TypeError('a SQLite database handle or filename is required.');
    this.database = migrate(database);
  }
  get(id) {
    const row = this.database.prepare('SELECT ' + FIELDS + ' FROM teams WHERE id=?').get(id);
    if (!row) return null;
    return { ...row, members: this.database.prepare('SELECT agent_id FROM team_members WHERE team_id=? ORDER BY position').all(id).map(m => m.agent_id) };
  }
  list() { return this.database.prepare('SELECT id FROM teams ORDER BY created_at,id').all().map(row => this.get(row.id)); }
  requireActive(id) {
    const team = this.get(id);
    if (!team || team.archivedAt) throw new TeamError(400,'teamId must name an existing active team.');
    return team;
  }
  save(candidate) {
    const team = assertTeam(candidate), db = this.database;
    db.exec('BEGIN IMMEDIATE');
    try {
      const agents = team.members.map(id => {
        const agent = db.prepare('SELECT id,exclusive FROM agents WHERE id=?').get(id);
        if (!agent) throw new TeamError(400,'Unknown team member: ' + id);
        if (db.prepare('SELECT 1 FROM team_members WHERE agent_id=? AND team_id!=? AND (exclusive=1 OR ?=1)').get(id,team.id,agent.exclusive)) throw new TeamError(409,'Exclusive agent belongs to another team.');
        return agent;
      });
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO teams (id,name,description,leader_agent_id,created_at,updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,leader_agent_id=excluded.leader_agent_id,updated_at=excluded.updated_at`)
        .run(team.id,team.name,team.description,team.leaderAgentId,now,now);
      db.prepare('DELETE FROM team_members WHERE team_id=?').run(team.id);
      const insert = db.prepare('INSERT INTO team_members (team_id,agent_id,position,exclusive) VALUES (?,?,?,?)');
      agents.forEach((agent,position) => insert.run(team.id,agent.id,position,agent.exclusive));
      db.exec('COMMIT'); return this.get(team.id);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  setMember(id,agentId,add) {
    const team = this.get(id);
    if (!team) throw new TeamError(404,'Unknown team.');
    const members = add ? [...team.members,agentId] : team.members.filter(member => member !== agentId);
    return this.save({ ...team,members,leaderAgentId:members.includes(team.leaderAgentId)?team.leaderAgentId:null });
  }
  setLeader(id,leaderAgentId) {
    const team = this.get(id);
    if (!team) throw new TeamError(404,'Unknown team.');
    return this.save({ ...team,leaderAgentId });
  }
  archive(id) {
    const now = new Date().toISOString();
    const changed = this.database.prepare('UPDATE teams SET archived_at=COALESCE(archived_at,?),updated_at=? WHERE id=?').run(now,now,id).changes;
    if (!changed) throw new TeamError(404,'Unknown team.');
    return this.get(id);
  }
  remove(id) {
    if (this.database.prepare('SELECT 1 FROM task_runs WHERE team_id=? LIMIT 1').get(id)) throw new TeamError(409,'Team has execution history; archive it instead.');
    return this.database.prepare('DELETE FROM teams WHERE id=?').run(id).changes > 0;
  }
  executions(id) {
    if (!this.get(id)) throw new TeamError(404,'Unknown team.');
    return this.database.prepare('SELECT id,objective,status FROM task_runs WHERE team_id=? ORDER BY rowid DESC').all(id);
  }
}
