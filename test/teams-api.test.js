import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {openHaneDatabase} from '../src/storage/sqlite-database.js';
import {SqliteTaskRepository} from '../src/storage/sqlite-task-repository.js';
import {SqliteProviderConfigStore} from '../src/storage/sqlite-provider-config-store.js';
import {SqliteProfileStore} from '../src/storage/sqlite-profile-store.js';
import {createMissionServer} from '../src/server/mission-server.js';
import {runCli,createDefaultDependencies} from '../src/cli/main.js';
const provider={async complete({role}){return role==='reviewer'?'verdict: approved':role+' output';}};
async function harness(filename=':memory:',extra={}) {
  const database=openHaneDatabase(filename),repository=new SqliteTaskRepository({database}),configs=new SqliteProviderConfigStore({database});
  configs.upsert({label:'test',baseUrl:'https://unused.test/v1',model:'test',credentialReference:'local-agent-orchestrator/test'});
  const server=createMissionServer({repository,providerConfigStore:configs,credentialManager:{},createProvider:async()=>provider,...extra});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  return {base,database,request:async(url,method='GET',body,headers={})=>{
    const response=await fetch(base+url,{method,headers:{'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json()};
  },close:async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});database.close();}};
}
test('HTTP CRUD enforces limits, exclusivity and leader membership without exposing instruction lists',async t=>{
  const h=await harness();t.after(()=>h.close());const ids=[];
  for(let i=0;i<9;i++){const a=await h.request('/api/agents','POST',{name:'Agent '+i,instructions:'private prompt',exclusive:i===0});assert.equal(a.status,201);ids.push(a.body.id);}
  const listed=await h.request('/api/agents');assert.equal(listed.body.agents.length,9);assert.equal(Object.hasOwn(listed.body.agents[0],'instructions'),false);
  assert.equal((await h.request('/api/agents/'+ids[0])).body.instructions,'private prompt');
  assert.equal((await h.request('/api/agents','POST',{name:'Secret',apiKey:'forbidden'})).status,400);
  assert.equal((await h.request('/api/agents','POST',{name:'Provider',providerLabel:'absent'})).status,409);
  const made=await h.request('/api/teams','POST',{name:'My Team',members:ids.slice(0,8),leaderAgentId:ids[0]});assert.equal(made.status,201);const url='/api/teams/'+made.body.id;
  assert.equal((await h.request(url+'/members/'+ids[8],'PUT')).status,400);
  assert.equal((await h.request('/api/teams','POST',{name:'Other',members:[ids[0]]})).status,409);
  assert.equal((await h.request(url+'/leader','PUT',{leaderAgentId:ids[8]})).status,400);
  assert.equal((await h.request(url,'PUT',{})).status,400);
  assert.equal((await h.request('/api/teams/'+randomUUID())).status,404);
  const removed=await h.request(url+'/members/'+ids[0],'DELETE');assert.equal(removed.body.leaderAgentId,null);
  assert.equal((await h.request('/api/agents/'+ids[0],'DELETE')).status,200);
  assert.equal((await h.request(url,'PUT',{name:'Updated Team'})).body.name,'Updated Team');
  assert.equal((await h.request(url,'DELETE')).status,200);
});
test('new routes honor browser guard even without a personal profile',async t=>{
  const h=await harness();t.after(()=>h.close());
  assert.equal((await h.request('/api/agents','POST',{name:'Blocked'},{origin:'https://untrusted.test'})).status,403);
  assert.equal((await h.request('/api/agents','POST',{name:'Blocked'},{origin:'http://localhost:5173'})).status,403);
  assert.equal((await h.request('/api/agents','POST',{name:'Allowed'},{origin:'http://localhost:5173','x-hane-request':'1'})).status,201);
  const response=await fetch(h.base+'/api/teams',{method:'POST',body:'{bad',headers:{'content-type':'application/json'}});assert.equal(response.status,400);
});
test('team reads and mutations are denied when the personal profile has no authenticated session',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'hane-team-auth-'));const db=openHaneDatabase(':memory:');
  const profileStore=new SqliteProfileStore({database:db,dataDirectory:dir});
  profileStore.create({displayName:'Test Profile'});
  const h=await harness(':memory:',{profileStore});t.after(async()=>{await h.close();db.close();rmSync(dir,{recursive:true,force:true});});
  assert.equal((await h.request('/api/teams')).status,401);assert.equal((await h.request('/api/agents','POST',{name:'Blocked'},{origin:'http://localhost:5173','x-hane-request':'1'})).status,401);
});
test('restart preserves teams, and a linked preset execution reaches SQLite and SSE',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'hane-team-http-')),filename=path.join(dir,'teams.sqlite');let h=await harness(filename);t.after(async()=>{if(h)await h.close();rmSync(dir,{recursive:true,force:true});});
  const a=await h.request('/api/agents','POST',{name:'Persisted Agent'}),g=await h.request('/api/teams','POST',{name:'Persisted Team',members:[a.body.id]});
  await h.close();h=await harness(filename);assert.deepEqual((await h.request('/api/teams/'+g.body.id)).body.members,[a.body.id]);
  assert.equal((await h.request('/api/missions','POST',{objective:'Invalid team',teamId:randomUUID()})).status,400);
  const stream=await fetch(h.base+'/api/events'),reader=stream.body.getReader();let evidence='';
  const collect=(async()=>{while(true){const {done,value}=await reader.read();if(done)break;evidence+=new TextDecoder().decode(value);if(evidence.includes('run_finished'))break;}})();
  const started=await h.request('/api/missions','POST',{objective:'Execute the linked preset',teamId:g.body.id});assert.equal(started.status,202);await collect;await reader.cancel();
  const run=(await h.request('/api/missions/'+started.body.id)).body;assert.equal(run.status,'completed');assert.equal(run.teamId,g.body.id);assert.deepEqual(Object.keys(run.outputs).sort(),['executor','planner','reviewer']);assert.ok(evidence.includes(g.body.id));
  assert.equal(h.database.prepare('SELECT team_id FROM task_runs WHERE id=?').get(run.id).team_id,g.body.id);
  assert.equal((await h.request('/api/teams/'+g.body.id+'/executions')).body.executions[0].id,run.id);
  assert.equal((await h.request('/api/teams/'+g.body.id,'DELETE')).status,409);
  assert.equal((await h.request('/api/teams/'+g.body.id+'/archive','POST')).status,200);
  assert.equal((await h.request('/api/missions','POST',{objective:'Archived team',teamId:g.body.id})).status,400);
});
test('CLI creates eight-member teams, rejects ninth and persists the execution link',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'hane-team-cli-')),filename=path.join(dir,'cli.sqlite'),handles=[];t.after(()=>{for(const db of handles){if(db.isOpen)db.close();}rmSync(dir,{recursive:true,force:true});});
  const dependencies={...createDefaultDependencies(),openDatabase:file=>{const db=openHaneDatabase(file);handles.push(db);return db;},createProvider:async()=>provider};
  async function cli(args){let output='',error='';const code=await runCli({argv:[...args,'--db',filename,'--json'],stdout:{write:s=>output+=s},stderr:{write:s=>error+=s},dependencies});return {code,output:output?JSON.parse(output):null,error};}
  const ids=[];for(let i=0;i<9;i++){const result=await cli(['agent','add','--name','CLI Agent '+i]);assert.equal(result.code,0);ids.push(result.output.id);}
  const result=await cli(['team','add','--name','CLI Team',...ids.slice(0,8).flatMap(id=>['--member',id])]);assert.equal(result.code,0);const id=result.output.id;
  assert.equal((await cli(['team','member','add',id,ids[8]])).code,1);assert.equal((await cli(['team','leader','set',id,ids[8]])).code,1);assert.equal((await cli(['team','leader','set',id,ids[0]])).code,0);
  let db=openHaneDatabase(filename);new SqliteProviderConfigStore({database:db}).upsert({label:'test',baseUrl:'https://unused.test/v1',model:'test',credentialReference:'local-agent-orchestrator/test'});db.close();
  assert.equal((await cli(['run','CLI linked execution','--team',randomUUID()])).code,1);
  const run=await cli(['run','CLI linked execution','--team',id]);assert.equal(run.code,0);assert.equal(run.output.teamId,id);
  assert.equal((await cli(['team','remove',id])).code,1);assert.equal((await cli(['team','archive',id])).code,0);
  assert.equal((await cli(['team','show',id])).output.id,id);
});
