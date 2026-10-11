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
  assert.equal((await h.request('/api/teams','POST',{name:'Too Many',members:ids})).status,400);
  assert.equal((await h.request('/api/teams')).body.teams.length,0);
  const made=await h.request('/api/teams','POST',{name:'My Team',members:ids.slice(0,8),leaderAgentId:ids[0]});assert.equal(made.status,201);const url='/api/teams/'+made.body.id;
  assert.equal((await h.request(url+'/members/'+ids[8],'PUT')).status,400);
  assert.equal((await h.request(url,'PUT',{members:ids})).status,400);
  assert.deepEqual((await h.request(url)).body.members,ids.slice(0,8));
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
  assert.equal((await h.request('/api/library/import','POST',{importId:randomUUID(),agents:[],teams:[]},{origin:'http://localhost:5173','x-hane-request':'1'})).status,401);assert.equal((await h.request('/api/teams')).status,401);assert.equal((await h.request('/api/agents','POST',{name:'Blocked'},{origin:'http://localhost:5173','x-hane-request':'1'})).status,401);
});
test('restart preserves teams, and a linked preset execution reaches SQLite and SSE',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'hane-team-http-')),filename=path.join(dir,'teams.sqlite');let h=await harness(filename);t.after(async()=>{if(h)await h.close();rmSync(dir,{recursive:true,force:true});});
  const a=await h.request('/api/agents','POST',{name:'Persisted Agent'}),g=await h.request('/api/teams','POST',{name:'Persisted Team',members:[a.body.id]});
  await h.close();h=await harness(filename);assert.deepEqual((await h.request('/api/teams/'+g.body.id)).body.members,[a.body.id]);
  assert.equal((await h.request('/api/missions','POST',{objective:'Invalid team',teamId:randomUUID()})).status,400);
  const stream=await fetch(h.base+'/api/events'),reader=stream.body.getReader();let evidence='';
  const collect=(async()=>{while(true){const {done,value}=await reader.read();if(done)break;evidence+=new TextDecoder().decode(value);if(evidence.includes('run_finished'))break;}})();
  const started=await h.request('/api/missions','POST',{objective:'Execute the linked preset',teamId:g.body.id});assert.equal(started.status,202);await collect;await reader.cancel();
  const run=(await h.request('/api/missions/'+started.body.id)).body;assert.equal(run.status,'completed');assert.equal(run.teamId,g.body.id);assert.equal((await h.request('/api/missions')).body.missions.find(item=>item.id===run.id).teamId,g.body.id);assert.deepEqual(Object.keys(run.outputs).sort(),['executor','planner','reviewer']);assert.ok(evidence.includes(g.body.id));
  assert.equal(h.database.prepare('SELECT team_id FROM task_runs WHERE id=?').get(run.id).team_id,g.body.id);
  assert.equal((await h.request('/api/teams/'+g.body.id+'/executions')).body.executions[0].id,run.id);
  assert.equal((await h.request('/api/teams/'+g.body.id,'DELETE')).status,409);
  assert.equal((await h.request('/api/teams/'+g.body.id+'/archive','POST')).status,200);
  assert.equal((await h.request('/api/missions','POST',{objective:'Archived team',teamId:g.body.id})).status,400);
});
test('CLI creates eight-member teams, rejects ninth and persists the execution link',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'hane-team-cli-')),filename=path.join(dir,'cli.sqlite'),handles=[];
  t.after(async()=>{
    for(const db of handles){try{db.close();}catch{/* the command that opened it already closed it */}}
    // Windows keeps the -wal and -shm sidecars mapped for a moment after the last close,
    // the same reason test/migrations.test.js retries its cleanup.
    for(let attempt=0;attempt<8;attempt+=1){
      try { rmSync(dir,{recursive:true,force:true}); return; }
      catch { await new Promise(resolve=>setTimeout(resolve,60)); }
    }
  });
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

test('library import is additive, atomic and retryable across a server restart',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'hane-import-')),filename=path.join(dir,'library.sqlite');let h=await harness(filename);
  t.after(async()=>{if(h)await h.close();rmSync(dir,{recursive:true,force:true});});
  const original=await h.request('/api/agents','POST',{name:'Existing Agent'});
  const payload={importId:randomUUID(),agents:[{id:'browser-a',name:'Browser Agent',instructions:'Keep this prompt',exclusive:true}],teams:[{id:'browser-g',name:'Browser Team',members:['browser-a'],leaderAgentId:'browser-a',archived:true}]};
  const result=await h.request('/api/library/import','POST',payload);assert.equal(result.status,200);
  assert.equal((await h.request('/api/agents')).body.agents.length,2);
  assert.equal((await h.request('/api/agents/'+original.body.id)).body.name,'Existing Agent');
  const imported=(await h.request('/api/teams/'+result.body.teamIds['browser-g'])).body;
  assert.deepEqual(imported.members,[result.body.agentIds['browser-a']]);assert.equal(imported.leaderAgentId,imported.members[0]);assert.ok(imported.archivedAt);
  assert.deepEqual((await h.request('/api/teams/'+imported.id+'/executions')).body.executions,[]);
  await h.close();h=await harness(filename);
  assert.deepEqual((await h.request('/api/library/import','POST',payload)).body,result.body);
  assert.equal((await h.request('/api/teams')).body.teams.length,1);
  assert.equal((await h.request('/api/library/import','POST',{...payload,agents:[{...payload.agents[0],name:'Changed'}]})).status,409);
  assert.equal((await h.request('/api/agents/'+imported.members[0])).body.instructions,'Keep this prompt');
});
test('failed import rolls back every agent, team and receipt',async t=>{
  const h=await harness();t.after(()=>h.close());
  const payload={importId:randomUUID(),agents:[{id:'a',name:'Imported Agent',exclusive:true}],teams:[{id:'one',name:'Team One',members:['a']},{id:'two',name:'Team Two',members:['a']}]};
  assert.equal((await h.request('/api/library/import','POST',payload)).status,409);
  assert.equal((await h.request('/api/agents')).body.agents.length,0);
  assert.equal((await h.request('/api/teams')).body.teams.length,0);
  assert.equal(h.database.prepare('SELECT count(*) AS n FROM library_imports').get().n,0);
  const fixed={...payload,teams:payload.teams.slice(0,1)};
  assert.equal((await h.request('/api/library/import','POST',fixed)).status,200);
  assert.equal((await h.request('/api/library/import','POST',{importId:randomUUID(),agents:[{id:'b',name:'Missing Provider',providerLabel:'missing'}],teams:[]})).status,409);
  assert.equal((await h.request('/api/agents')).body.agents.length,1);
});
test('import validates source ids, credentials, leaders, size and browser boundary',async t=>{
  const h=await harness();t.after(()=>h.close());
  const valid={importId:randomUUID(),agents:[{id:'a',name:'Allowed Agent'}],teams:[]};
  const headers={origin:'http://localhost:5173','x-hane-request':'1'};
  assert.equal((await h.request('/api/library/import','POST',valid,{origin:'https://third-party.test'})).status,403);
  assert.equal((await h.request('/api/library/import','POST',valid,{origin:'http://localhost:5173'})).status,403);
  for (const invalid of [
    {...valid,agents:[...valid.agents,...valid.agents]},
    {...valid,agents:[{...valid.agents[0],token:'must not persist'}]},
    {...valid,teams:[{id:'g',name:'Empty Team',members:[]}]},
    {...valid,teams:[{id:'g',name:'Unknown Leader',members:['a'],leaderAgentId:'unknown'}]},
    {...valid,agents:Array.from({length:201},(_,i)=>({id:String(i),name:'Large Agent'}))},
  ]) assert.equal((await h.request('/api/library/import','POST',invalid,headers)).status,400);
  assert.equal((await h.request('/api/agents')).body.agents.length,0);
  const large={importId:randomUUID(),agents:Array.from({length:7},(_,i)=>({id:String(i),name:'Prompt Agent '+i,instructions:'x'.repeat(12000)})),teams:[]};
  assert.equal((await h.request('/api/library/import','POST',large,headers)).status,200);
});
test('the server owns the execution budget and refuses a client beyond its ceiling',async t=>{
  const h=await harness();t.after(()=>h.close());
  const provider=await h.request('/api/missions','POST',{objective:'Ask for an unreachable budget',maxProviderCalls:1_000_000_000});
  assert.equal(provider.status,400);assert.match(provider.body.error,/maxProviderCalls/);
  const tools=await h.request('/api/missions','POST',{objective:'Ask for too many tool calls',maxToolCalls:25});
  assert.equal(tools.status,400);assert.match(tools.body.error,/maxToolCalls/);
  assert.equal((await h.request('/api/missions')).body.missions.length,0);
});
test('an imported agent cannot claim the onboarding slot',async t=>{
  const h=await harness();t.after(()=>h.close());
  const imported=await h.request('/api/library/import','POST',{importId:randomUUID(),agents:[{id:'a',name:'Impostor',isInitial:true}],teams:[]});
  assert.equal(imported.status,200);
  assert.equal(h.database.prepare('SELECT is_initial FROM agents WHERE name=?').get('Impostor').is_initial,0);
});
test('an unexpected storage fault is refused without leaking its own message',async t=>{
  const h=await harness();t.after(()=>h.close());
  const id=randomUUID();
  h.database.prepare('INSERT INTO task_runs (id,objective,status,max_provider_calls,provider_calls) VALUES (?,?,?,?,?)').run(id,'Corrupted run','completed',10,1);
  h.database.prepare('INSERT INTO task_audit_entries (task_id,ordinal,at,type,detail_json) VALUES (?,?,?,?,?)').run(id,0,new Date().toISOString(),'started','{not json');
  const response=await h.request('/api/missions/'+id);
  assert.equal(response.status,500);
  assert.equal(response.body.error,'Internal server error.');
  assert.doesNotMatch(JSON.stringify(response.body),/json|parse|unexpected|detail|task/i);
});
