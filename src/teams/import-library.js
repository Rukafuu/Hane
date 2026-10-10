import { createHash, randomUUID } from 'node:crypto';
import { assertAgent } from './agent.js';
import { assertTeam } from './team.js';
import { assertId, assertObject, TeamError } from './domain.js';

// An additive import is one transaction. A durable receipt makes retries after
// a lost HTTP response safe; existing teams and execution links are untouched.
export function importLibrary(database, body, options={}) {
  assertObject(body); assertId(body.importId, 'importId');
  if (!Array.isArray(body.agents) || !Array.isArray(body.teams) || body.agents.length > 200 || body.teams.length > 200) throw new TeamError(400, 'Invalid import size.');
  const digest = options.digest ?? createHash('sha256').update(JSON.stringify({agents:body.agents,teams:body.teams})).digest('hex');
  database.exec('BEGIN IMMEDIATE');
  try {
    const receipt = database.prepare('SELECT digest,result_json FROM library_imports WHERE id=?').get(body.importId);
    if (receipt) {
      if (receipt.digest !== digest) throw new TeamError(409, 'This importId was already used for different data.');
      database.exec('COMMIT'); return JSON.parse(receipt.result_json);
    }
    const agentIds = new Map(), teamIds = new Map();
    const sourceId = (item,map) => {
      assertObject(item);
      if (typeof item.id !== 'string' || !item.id || item.id.length > 256 || map.has(item.id)) throw new TeamError(400, 'Invalid or duplicate source id.');
      const id = randomUUID(); map.set(item.id,id); return id;
    };
    const agents = body.agents.map(item => assertAgent({...item,id:sourceId(item,agentIds)}));
    const teams = body.teams.map(item => {
      const id = sourceId(item,teamIds);
      if (!Array.isArray(item.members) || item.members.some(member => !agentIds.has(member))) throw new TeamError(400, 'Unknown imported member.');
      if (item.leaderAgentId && !agentIds.has(item.leaderAgentId)) throw new TeamError(400, 'Unknown imported leader.');
      if (item.archived !== undefined && typeof item.archived !== 'boolean') throw new TeamError(400, 'archived must be boolean.');
      return {...assertTeam({...item,id,members:item.members.map(member=>agentIds.get(member)),leaderAgentId:item.leaderAgentId ? agentIds.get(item.leaderAgentId) : null}),archived:item.archived === true};
    });
    const now = new Date().toISOString();
    const insertAgent = database.prepare('INSERT INTO agents (id,name,description,instructions,provider_label,exclusive,created_at,updated_at,visual_json,capabilities_json,instruction_files_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const agent of agents) {
      if (agent.providerLabel && !database.prepare('SELECT 1 FROM provider_configs WHERE label=?').get(agent.providerLabel)) throw new TeamError(409, 'Unknown provider: '+agent.providerLabel+'. Configure it before importing.');
      insertAgent.run(agent.id,agent.name,agent.description,agent.instructions,agent.providerLabel,Number(agent.exclusive),now,now,JSON.stringify(agent.visual),JSON.stringify(agent.capabilities),JSON.stringify(agent.instructionFiles));
    }
    const insertTeam = database.prepare('INSERT INTO teams (id,name,description,leader_agent_id,created_at,updated_at,archived_at) VALUES (?,?,?,?,?,?,?)');
    const insertMember = database.prepare('INSERT INTO team_members (team_id,agent_id,position,exclusive) VALUES (?,?,?,?)');
    const exclusive = new Map(agents.map(agent=>[agent.id,agent.exclusive]));
    const assigned = new Set();
    for (const team of teams) {
      insertTeam.run(team.id,team.name,team.description,team.leaderAgentId,now,now,team.archived ? now : null);
      team.members.forEach((id,position) => {
        if (exclusive.get(id) && assigned.has(id)) throw new TeamError(409, 'An exclusive agent belongs to multiple imported teams.');
        assigned.add(id); insertMember.run(team.id,id,position,Number(exclusive.get(id)));
      });
    }
    const result = {importId:body.importId,agentIds:Object.fromEntries(agentIds),teamIds:Object.fromEntries(teamIds)};
    database.prepare('INSERT INTO library_imports (id,digest,result_json,created_at) VALUES (?,?,?,?)').run(body.importId,digest,JSON.stringify(result),now);
    database.exec('COMMIT'); return result;
  } catch (error) {
    database.exec('ROLLBACK');
    // A constraint message names tables and columns, and two imports racing on
    // the same importId hit one; the client gets its own refusal instead.
    if (error?.code === 'ERR_SQLITE_ERROR' && /constraint failed/i.test(String(error?.message ?? ''))) throw new TeamError(409, 'This import collides with data already stored. Send a new importId.');
    throw error;
  }
}
