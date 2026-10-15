import { randomUUID } from 'node:crypto';
import { openHaneDatabase } from './sqlite-database.js';
import { migrate } from './migrations.js';
import { assertTeam } from '../teams/team.js';
import { TeamError } from '../teams/domain.js';
import { TASK_STATUS } from '../contracts.js';

const FIELDS = 'id,name,description,leader_agent_id AS leaderAgentId,created_at AS createdAt,updated_at AS updatedAt,archived_at AS archivedAt,pinned_at AS pinnedAt,revision';

/**
 * An execution the scheduler can pick up on its own. `draft` is absent: a mission
 * stored and never started holds nothing open, and refusing to archive a Team
 * because someone wrote an objective once would trap it forever. A run parked on
 * a human decision (`awaiting_approval`, `needs_attention`) is absent too, and
 * not by accident: retrying reads the composition the run recorded when it was
 * created, so a later edit or archive reaches none of it — which is exactly what
 * `test/team-runtime.test.js` holds the runtime to.
 */
const OPEN_STATUSES = Object.freeze([
  TASK_STATUS.PLANNED, TASK_STATUS.EXECUTING, TASK_STATUS.REVIEWING,
]);

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
  activeExecution(id) {
    const row = this.database.prepare(
      `SELECT id,status FROM task_runs WHERE team_id=? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')}) LIMIT 1`
    ).get(id, ...OPEN_STATUSES);
    return row ?? null;
  }
  save(candidate, options = {}) {
    const team = assertTeam(candidate), db = this.database;
    const expectedRevision = options.expectedRevision;
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) throw new TeamError(400,'expectedRevision must be a non-negative integer.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get(team.id);
      const now = new Date().toISOString();
      if (current) {
        if (current.members.some(id => !team.members.includes(id))) throw new TeamError(409,'Persisted team members cannot be removed.');
        if (current.archivedAt) throw new TeamError(409,'Restore the archived team before you change it.');
        if (expectedRevision !== undefined && expectedRevision !== current.revision) throw new TeamError(409,'This team changed since it was read. Reload it before saving.');
        if (team.members.some(id => !current.members.includes(id))) {
          if (this.activeExecution(team.id)) throw new TeamError(409,'The team has an execution in progress. Add the agent once it ends.');
        }
      }
      const agents = team.members.map(id => {
        const agent = db.prepare('SELECT id,exclusive FROM agents WHERE id=?').get(id);
        if (!agent) throw new TeamError(400,'Unknown team member: ' + id);
        if (db.prepare('SELECT 1 FROM team_members WHERE agent_id=? AND team_id!=? AND (exclusive=1 OR ?=1)').get(id,team.id,agent.exclusive)) throw new TeamError(409,'Exclusive agent belongs to another team.');
        return agent;
      });
      db.prepare(`INSERT INTO teams (id,name,description,leader_agent_id,created_at,updated_at,revision) VALUES (?,?,?,?,?,?,1)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,leader_agent_id=excluded.leader_agent_id,updated_at=excluded.updated_at,revision=teams.revision+1`)
        .run(team.id,team.name,team.description,team.leaderAgentId,now,now);
      db.prepare('DELETE FROM team_members WHERE team_id=?').run(team.id);
      const insert = db.prepare('INSERT INTO team_members (team_id,agent_id,position,exclusive) VALUES (?,?,?,?)');
      agents.forEach((agent,position) => insert.run(team.id,agent.id,position,agent.exclusive));
      for (const change of this.#changes(current,team,now)) this.#record(change);
      db.exec('COMMIT'); return this.get(team.id);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  setMember(id,agentId,add) {
    const team = this.get(id);
    if (!team) throw new TeamError(404,'Unknown team.');
    if (!add) throw new TeamError(409,'Persisted team members cannot be removed.');
    if (team.members.includes(agentId)) throw new TeamError(409,'The agent is already a member of this team.');
    return this.save({ ...team,members:[...team.members,agentId],leaderAgentId:team.leaderAgentId });
  }
  setLeader(id,leaderAgentId) {
    const team = this.get(id);
    if (!team) throw new TeamError(404,'Unknown team.');
    return this.save({ ...team,leaderAgentId });
  }
  pin(id,pinned = true) {
    const now = new Date().toISOString();
    const changed = this.database.prepare('UPDATE teams SET pinned_at=?,updated_at=?,revision=revision+1 WHERE id=?').run(pinned ? now : null,now,id).changes;
    if (!changed) throw new TeamError(404,'Unknown team.');
    this.#record({ teamId:id,type:pinned ? 'pinned' : 'unpinned',at:now });
    return this.get(id);
  }
  archive(id) {
    if (this.activeExecution(id)) throw new TeamError(409,'The team has an execution running. Cancel or finish it before archiving.');
    const now = new Date().toISOString();
    const changed = this.database.prepare('UPDATE teams SET archived_at=COALESCE(archived_at,?),updated_at=?,revision=revision+1 WHERE id=?').run(now,now,id).changes;
    if (!changed) throw new TeamError(404,'Unknown team.');
    this.#record({ teamId:id,type:'archived',at:now });
    return this.get(id);
  }
  restore(id) {
    const team = this.get(id);
    if (!team) throw new TeamError(404,'Unknown team.');
    if (!team.archivedAt) throw new TeamError(400,'This team is not archived.');
    const now = new Date().toISOString();
    this.database.prepare('UPDATE teams SET archived_at=NULL,updated_at=?,revision=revision+1 WHERE id=?').run(now,id);
    this.#record({ teamId:id,type:'restored',at:now });
    return this.get(id);
  }
  events(id) {
    if (!this.get(id)) throw new TeamError(404,'Unknown team.');
    return this.database.prepare(
      'SELECT id,type,agent_id AS agentId,detail_json AS detail,created_at AS createdAt FROM team_events WHERE team_id=? ORDER BY rowid'
    ).all(id).map(event => ({ ...event,detail:JSON.parse(event.detail) }));
  }
  remove(id) {
    if (this.database.prepare('SELECT 1 FROM task_runs WHERE team_id=? LIMIT 1').get(id)) throw new TeamError(409,'Team has execution history; archive it instead.');
    return this.database.prepare('DELETE FROM teams WHERE id=?').run(id).changes > 0;
  }
  executions(id) {
    if (!this.get(id)) throw new TeamError(404,'Unknown team.');
    return this.database.prepare('SELECT id,objective,status FROM task_runs WHERE team_id=? ORDER BY rowid DESC').all(id);
  }
  // The trail records what actually moved. A save that changes nothing records
  // nothing, so a retried request does not fill the history with duplicates.
  #changes(current,team,at) {
    if (!current) return [{ teamId:team.id,type:'created',at,detail:{ name:team.name } }];
    const changes = [];
    if (current.name !== team.name) changes.push({ teamId:team.id,type:'renamed',at,detail:{ from:current.name,to:team.name } });
    if (current.description !== team.description) changes.push({ teamId:team.id,type:'description_changed',at });
    for (const [position,agentId] of team.members.entries()) {
      if (!current.members.includes(agentId)) changes.push({ teamId:team.id,type:'member_added',agentId,at,detail:{ position } });
    }
    if (current.leaderAgentId !== team.leaderAgentId) changes.push({
      teamId:team.id,type:team.leaderAgentId ? 'leader_set' : 'leader_cleared',agentId:team.leaderAgentId,at,
      detail:{ from:current.leaderAgentId,to:team.leaderAgentId },
    });
    return changes;
  }
  #record({ teamId,type,agentId = null,detail = {},at }) {
    this.database.prepare('INSERT INTO team_events (id,team_id,type,agent_id,detail_json,created_at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(),teamId,type,agentId,JSON.stringify(detail),at);
  }
}
