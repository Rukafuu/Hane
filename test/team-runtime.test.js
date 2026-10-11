import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openHaneDatabase} from '../src/storage/sqlite-database.js';
import {SqliteAgentStore} from '../src/storage/sqlite-agent-store.js';
import {SqliteTeamStore} from '../src/storage/sqlite-team-store.js';
import {SqliteTaskRepository} from '../src/storage/sqlite-task-repository.js';
import {SqliteProviderConfigStore} from '../src/storage/sqlite-provider-config-store.js';
import {SqliteOnboardingStore} from '../src/storage/sqlite-onboarding-store.js';
import {buildExecutionPlan,resolveExecutionProviders} from '../src/teams/execution-plan.js';
import {createMissionServer} from '../src/server/mission-server.js';
import {createProviderFromConfig} from '../src/providers/provider-factory.js';
import {Orchestrator} from '../src/orchestrator.js';
import {TaskRun} from '../src/task-run.js';
import {runMissionCommand} from '../src/cli/run-mission.js';
import {retryCommand} from '../src/cli/mission-lifecycle.js';

function fixture(t) {
 const db=openHaneDatabase(':memory:'); t.after(()=>db.close());
 const agents=new SqliteAgentStore({database:db}), teams=new SqliteTeamStore({database:db}), repository=new SqliteTaskRepository({database:db}), providers=new SqliteProviderConfigStore({database:db});
 const configs=['plan','execute','review'].map(label=>providers.upsert({label,baseUrl:'http://127.0.0.1:9000/v1',model:label+'-model',credentialReference:'local-agent-orchestrator/'+label}));
 const members=configs.map(c=>agents.upsert({id:randomUUID(),name:'Agent '+c.label,instructions:'Authored '+c.label,providerLabel:c.label,capabilities:['workspace.read'],instructionFiles:[{id:randomUUID(),name:'Reference',text:'Untrusted reference '+c.label}]}));
 const team=teams.save({id:randomUUID(),name:'Test team',members:members.map(a=>a.id)});
 const assignments=Object.fromEntries(['planner','executor','reviewer'].map((role,i)=>[role,members[i].id]));
 const context={teamId:team.id,roleAssignments:assignments,teamStore:teams,agentStore:agents,providerConfigStore:providers};
 return {db,agents,teams,repository,providers,configs,members,team,assignments,context,plan:buildExecutionPlan(context)};
}
const doubles=(calls)=>Object.fromEntries(['planner','executor','reviewer'].map(role=>[role,{async complete(request){calls.push(request);return role==='reviewer'?'verdict: approved':role+' result';}}]));

test('preset validation rejects missing, repeated and foreign members before provider creation',t=>{
 const f=fixture(t);
 for(const roleAssignments of [{planner:f.members[0].id}, {...f.assignments,executor:f.members[0].id}, {...f.assignments,reviewer:randomUUID()}, {...f.assignments,extra:f.members[0].id}]) assert.throws(()=>buildExecutionPlan({...f.context,roleAssignments}));
 assert.throws(()=>buildExecutionPlan({...f.context,teamId:null}));
 assert.ok(Object.isFrozen(f.plan.roles.executor.instructionFiles[0]));
 assert.equal(JSON.stringify(f.plan).includes('credentialReference'),false);
 assert.equal(JSON.stringify(f.plan).includes('visual'),false);
});

test('three providers receive authored behavior, documents and prior outputs; SQLite snapshot remains immutable',async t=>{
 const f=fixture(t), calls=[], roleProviders=doubles(calls);
 const task=await new Orchestrator({provider:roleProviders.planner,roleProviders,repository:f.repository}).start({objective:'Verify routing',teamId:f.team.id,executionPlan:f.plan});
 assert.equal(task.status,'completed'); assert.equal(task.providerCalls,3);
 for(let i=0;i<3;i++){assert.match(calls[i].instruction,new RegExp(f.members[i].name)); assert.match(calls[i].instruction,new RegExp(f.members[i].instructions)); assert.equal(calls[i].referenceDocuments[0].text,f.members[i].instructionFiles[0].text);}
 assert.equal(calls[1].priorOutputs.planner,'planner result');
 const stored=f.repository.findById(task.id); assert.deepEqual(stored.executionPlan,f.plan);
 assert.equal(stored.audit.filter(e=>e.type==='agent_handoff').length,2);
 assert.deepEqual(stored.audit.filter(e=>e.type==='provider_call_reserved').map(e=>e.detail.agentId),f.members.map(a=>a.id));
 assert.throws(()=>f.repository.save({...stored,executionPlan:{...f.plan,roles:{...f.plan.roles,planner:{...f.plan.roles.planner,name:'Changed'}}}}),/cannot change the execution plan/);
 f.agents.upsert({...f.members[1],name:'Edited agent',instructions:'New behavior'}); f.teams.archive(f.team.id);
 const restored=TaskRun.fromSnapshot(stored);assert.equal(restored.executionPlan.roles.executor.name,'Agent execute');
 await assert.rejects(()=>new Orchestrator({provider:roleProviders.planner}).resume(restored),/all three role providers/);
});

test('tools require both the executor capability and mission grant; planner and reviewer never receive tools',async t=>{
 const f=fixture(t),root=mkdtempSync(path.join(tmpdir(),'hane-preset-'));t.after(()=>rmSync(root,{recursive:true,force:true}));writeFileSync(path.join(root,'evidence.txt'),'real bytes');
 for(const allowed of [false,true]){
  const calls=[],roleProviders=doubles(calls);let turns=0;
  roleProviders.executor.completeTurn=async ({messages,tools})=>{turns++; if(turns===1)return {content:null,toolCalls:[{source:'native',id:'read1',name:'read_file',arguments:{path:'evidence.txt'},raw:'{"path":"evidence.txt"}'}]}; assert.ok(messages.some(m=>m.role==='tool' && m.content.includes('real bytes')));return {content:'Evidence gathered',toolCalls:[]};};
  const plan=buildExecutionPlan(f.context); const candidate={...plan,roles:{...plan.roles,executor:{...plan.roles.executor,capabilities:allowed?['workspace.read']:[]}}};
  const task=await new Orchestrator({provider:roleProviders.planner,roleProviders}).start({objective:'Read evidence',teamId:f.team.id,executionPlan:candidate,workspaceRoot:root,capabilityGrants:[{name:'workspace.read',scope:'.'}]});
  assert.equal(task.status,'completed');assert.equal(task.toolCalls,allowed?1:0);assert.equal(turns,allowed?2:0);
  if(allowed) assert.equal(task.audit.find(e=>e.type==='tool_read').detail.agentId,f.members[1].id);
 }
});

test('a model change refuses resume before credential retrieval',async t=>{
 const f=fixture(t);f.providers.upsert({...f.configs[1],model:'changed-model'});let created=0;
 await assert.rejects(()=>resolveExecutionProviders({executionPlan:f.plan,providerConfigStore:f.providers,createProvider:()=>{created++;}}),/recorded provider\/model/);
 assert.equal(created,0);
});

async function settle(repository,id,minCalls=0){for(let n=0;n<150;n++){const task=repository.findById(id);if(task && task.providerCalls>=minCalls && ['completed','failed','needs_attention','awaiting_approval'].includes(task.status))return task;await new Promise(r=>setTimeout(r,10));}throw Error('Mission did not settle');}

test('HTTP uses distinct local OpenAI gateways and resume keeps original instructions after edits/archive',async t=>{
 const f=fixture(t), received=[], gateway=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const payload=JSON.parse(body);received.push(payload);res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:payload.model==='review-model'?'verdict: approved':'Actual local HTTP '+payload.model}}]}));});
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>gateway.close(r)));
 for(const c of f.configs)f.providers.upsert({...c,baseUrl:'http://127.0.0.1:'+gateway.address().port+'/v1'});
 const server=createMissionServer({repository:f.repository,providerConfigStore:f.providers,onboardingStore:new SqliteOnboardingStore({database:f.db}),credentialManager:{get:async()=> 'synthetic-test-secret'},createProvider:createProviderFromConfig});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const post=async(route,body)=>fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('/api/missions',{objective:'Invalid binding',roleAssignments:f.assignments})).status,400);
 let response=await post('/api/missions',{objective:'HTTP preset execution',teamId:f.team.id,roleAssignments:f.assignments,maxProviderCalls:1});assert.equal(response.status,202);const queued=await response.json();
 let task=await settle(f.repository,queued.id);assert.equal(task.status,'needs_attention');assert.equal(received.length,1);
 f.agents.upsert({...f.members[1],instructions:'EDITED MUST NOT BE USED',name:'Edited executor'}); f.teams.archive(f.team.id);
 response=await post('/api/missions/'+task.id+'/retry',{maxProviderCalls:5,provider:'plan'});assert.equal(response.status,400);assert.equal(received.length,1);
 response=await post('/api/missions/'+task.id+'/retry',{maxProviderCalls:5});assert.equal(response.status,202); task=await settle(f.repository,task.id,3);assert.equal(task.status,'completed');
 assert.deepEqual(received.map(p=>p.model),['plan-model','execute-model','review-model']);
 assert.match(received[1].messages[0].content,/Authored execute/);assert.equal(received[1].messages[0].content.includes('EDITED'),false);
 assert.ok(received[1].messages.some(m=>m.role==='user' && m.content.includes('untrustedReferenceDocuments')));
 assert.equal(JSON.stringify(task).includes('synthetic-test-secret'),false);
});

test('CLI supports explicit bindings and retries the recorded composition',async t=>{
 const f=fixture(t),calls=[],streams={stdout:{write(){}},stderr:{write(){}}};
 const dependencies={openDatabase:()=>f.db,createTaskRepository:()=>f.repository,createProviderConfigStore:()=>f.providers,credentialManager:{},createProvider:async({config})=>({complete:async r=>{calls.push({config,r});return r.role==='reviewer'?'verdict: approved':'CLI result';}})};
 assert.equal(await runMissionCommand({...streams,dependencies,args:['--team',f.team.id,'--planner',f.members[0].id,'--executor',f.members[1].id,'--reviewer',f.members[2].id,'--max-calls','1','CLI objective']}),2);
 const id=f.repository.list()[0].id; f.agents.upsert({...f.members[1],instructions:'Edited'});
 assert.equal(await retryCommand({...streams,dependencies,args:[id,'--max-calls','5']}),0);
 assert.equal(calls[1].config.label,'execute');assert.match(calls[1].r.instruction,/Authored execute/);
});

test('revoking executor capability during inference denies its pending tool request',async t=>{
 const f=fixture(t),root=mkdtempSync(path.join(tmpdir(),'hane-preset-revoke-'));t.after(()=>rmSync(root,{recursive:true,force:true}));writeFileSync(path.join(root,'private.txt'),'must not be read');
 const roleProviders=doubles([]);let turns=0;
 roleProviders.executor.completeTurn=async({messages})=>{
  if(++turns===1){f.agents.upsert({...f.members[1],capabilities:[]});return {content:null,toolCalls:[{source:'native',id:'pending',name:'read_file',arguments:{path:'private.txt'},raw:'{}'}]};}
  assert.ok(messages.some(m=>m.role==='tool' && m.content.includes('agent_capability_revoked')));assert.equal(JSON.stringify(messages).includes('must not be read'),false);
  return {content:'Access revoked; no evidence read',toolCalls:[]};
 };
 const task=await new Orchestrator({provider:roleProviders.planner,roleProviders,agentCapabilityCheck:(id,name)=>f.agents.get(id)?.capabilities.includes(name)}).start({objective:'Verify revocation',teamId:f.team.id,executionPlan:f.plan,workspaceRoot:root,capabilityGrants:[{name:'workspace.read',scope:'.'}]});
 assert.equal(task.status,'completed');assert.equal(task.audit.some(e=>e.type==='tool_read'),false);assert.equal(task.audit.find(e=>e.type==='tool_call_refused').detail.agentId,f.members[1].id);
});

test('configured presets preserve human approval, provider budget and cancellation',async t=>{
 const f=fixture(t),calls=[],roleProviders=doubles(calls);let reviews=0;
 roleProviders.reviewer.complete=async r=>{calls.push(r);return ++reviews===1?'verdict: revise':'verdict: approved';};
 const orchestrator=new Orchestrator({provider:roleProviders.planner,roleProviders,repository:f.repository});
 const task=await orchestrator.start({objective:'Approval flow',teamId:f.team.id,executionPlan:f.plan,maxProviderCalls:3});assert.equal(task.status,'awaiting_approval');
 const resumed=TaskRun.fromSnapshot(f.repository.findById(task.id));delete resumed.outputs.executor;delete resumed.outputs.reviewer;resumed.extendBudget(5);
 await orchestrator.resume(resumed);assert.equal(resumed.status,'completed');assert.equal(calls.length,5);assert.equal(calls.filter(r=>r.role==='planner').length,1);
 const controller=new AbortController();roleProviders.executor.complete=async()=>{controller.abort(new Error('test cancellation'));throw controller.signal.reason;};
 const cancelled=await orchestrator.start({objective:'Cancel preset',teamId:f.team.id,executionPlan:f.plan,signal:controller.signal});assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.outputs.executor,undefined);assert.equal(cancelled.audit.find(e=>e.type==='mission_cancelled').detail.reason,'test cancellation');
});
