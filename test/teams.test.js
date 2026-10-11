import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertAgent } from '../src/teams/agent.js';
import { assertTeam } from '../src/teams/team.js';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';
import { SqliteAgentStore } from '../src/storage/sqlite-agent-store.js';
import { SqliteTeamStore } from '../src/storage/sqlite-team-store.js';
import { SqliteTaskRepository } from '../src/storage/sqlite-task-repository.js';
import { TaskRun } from '../src/task-run.js';
function fixture(t) { const db=openHaneDatabase(':memory:');t.after(()=>db.close());return {db,agents:new SqliteAgentStore({database:db}),teams:new SqliteTeamStore({database:db})}; }
const agent = (more={}) => ({id:randomUUID(),name:'Agent',...more});
const team = members => ({id:randomUUID(),name:'Team',members});
test('agent validation rejects secrets, invalid identifiers and text, and freezes metadata',()=>{
  const a=assertAgent(agent({name:'  My Agent  '}));assert.equal(a.name,'My Agent');assert.ok(Object.isFrozen(a));
  for(const data of [agent({name:'x'}),agent({name:'x'.repeat(81)}),agent({instructions:'x'.repeat(12001)}),agent({id:null}),agent({providerLabel:'bad label'}),agent({exclusive:'yes'})])assert.throws(()=>assertAgent(data));
  for(const field of ['apiKey','secret','token','credential','credentials','password'])assert.throws(()=>assertAgent(agent({[field]:'never persist'})),/Credentials/);
});
test('team validation enforces unique ordered members and membership of its optional leader',()=>{
  const ids=Array.from({length:8},()=>randomUUID());const result=assertTeam({...team(ids),leaderAgentId:ids[2]});assert.deepEqual(result.members,ids);assert.ok(Object.isFrozen(result.members));
  for(const members of [[],[...ids,randomUUID()],[ids[0],ids[0]]])assert.throws(()=>assertTeam(team(members)));
  assert.throws(()=>assertTeam({...team(ids),leaderAgentId:randomUUID()}),/leader/);
});
test('SQLite checks provider references, exclusivity, member order and rollback',t=>{
  const {db,agents,teams}=fixture(t),a=agents.upsert(agent({exclusive:true})),b=agents.upsert(agent());
  assert.throws(()=>agents.upsert(agent({providerLabel:'missing'})),/Unknown provider/);
  const first=teams.save({...team([a.id,b.id]),leaderAgentId:a.id});assert.deepEqual(first.members,[a.id,b.id]);
  const second=teams.save(team([b.id]));assert.throws(()=>teams.save({...second,members:[b.id,a.id]}),/Exclusive/);assert.deepEqual(teams.get(second.id).members,[b.id]);
  assert.throws(()=>agents.upsert({...b,exclusive:true}),/multiple teams/);assert.equal(agents.get(b.id).exclusive,false);
  assert.throws(()=>teams.save({...first,name:'Changed',members:[a.id,b.id,randomUUID()]}),/Unknown team member/);assert.equal(teams.get(first.id).name,'Team');
  assert.throws(()=>teams.setMember(first.id,a.id,false),/cannot be removed/);assert.equal(teams.get(first.id).leaderAgentId,a.id);assert.throws(()=>teams.save({...first,members:[b.id],leaderAgentId:null}),/cannot be removed/);assert.throws(()=>agents.remove(b.id),/Remove/);
  assert.throws(()=>db.prepare('INSERT INTO team_members(team_id,agent_id,position,exclusive) VALUES(?,?,?,?)').run(second.id,b.id,8,0));
});
test('eight members pass, ninth fails and removing a last member preserves the team',t=>{
  const {agents,teams}=fixture(t);const ids=Array.from({length:9},()=>agents.upsert(agent()).id);const group=teams.save(team(ids.slice(0,8)));
  assert.throws(()=>teams.setMember(group.id,ids[8],true),/1-8/);assert.equal(teams.get(group.id).members.length,8);
  const solo=teams.save(team([ids[8]]));assert.throws(()=>teams.setMember(solo.id,ids[8],false),/cannot be removed/);assert.equal(teams.get(solo.id).members.length,1);
});
test('execution links survive reconstruction, are immutable and prevent history deletion',t=>{
  const {db,agents,teams}=fixture(t),a=agents.upsert(agent()),group=teams.save(team([a.id])),repository=new SqliteTaskRepository({database:db});
  const task=new TaskRun({id:randomUUID(),objective:'Audit this team',teamId:group.id});repository.save(task.snapshot());
  const saved=repository.findById(task.id);assert.equal(saved.teamId,group.id);assert.equal(saved.audit[0].detail.teamId,group.id);assert.equal(TaskRun.fromSnapshot(saved).teamId,group.id);
  assert.throws(()=>repository.save({...saved,teamId:null}),/cannot change the team/);assert.throws(()=>teams.remove(group.id),/archive/);
  assert.throws(()=>db.prepare('DELETE FROM teams WHERE id=?').run(group.id),/FOREIGN KEY/);teams.archive(group.id);assert.equal(teams.executions(group.id)[0].id,task.id);assert.throws(()=>teams.requireActive(group.id),/active/);
  const legacy=new TaskRun({id:randomUUID(),objective:'Legacy execution'});repository.save(legacy.snapshot());assert.equal(Object.hasOwn(repository.findById(legacy.id),'teamId'),false);
});
test('team and agent data survive closing and reopening the actual SQLite file',t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'hane-teams-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const filename=path.join(dir,'teams.sqlite');
  let db=openHaneDatabase(filename);let agents=new SqliteAgentStore({database:db}),teams=new SqliteTeamStore({database:db});const a=agents.upsert(agent({instructions:'Preserve these instructions'})),g=teams.save(team([a.id]));db.close();
  db=openHaneDatabase(filename);try{agents=new SqliteAgentStore({database:db});teams=new SqliteTeamStore({database:db});assert.equal(agents.get(a.id).instructions,'Preserve these instructions');assert.deepEqual(teams.get(g.id).members,[a.id]);}finally{db.close();}
});
