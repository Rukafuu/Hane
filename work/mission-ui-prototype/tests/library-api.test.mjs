import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchLibrary, changeLibrary, importBrowserLibrary, unavailableNotice } from '../src/library-api.js';
import { createMission } from '../src/api.js';
function setup(t,handler,denied=false) {
 const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage,values=new Map(),calls=[];
 globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>{if(denied)throw new Error('Storage denied');values.set(key,value);}};
 globalThis.fetch=async(path,options={})=>{const call={path,method:options.method||'GET',body:options.body?JSON.parse(options.body):undefined,headers:options.headers};calls.push(call);const result=await handler(call);return {ok:result.status<400,status:result.status,json:async()=>result.body};};
 t.after(()=>{globalThis.fetch=oldFetch;globalThis.localStorage=oldStorage;});return {values,calls};
}
const a={id:'agent',name:'Local Agent',description:'',instructions:'Preserve my prompt',provider:'',exclusive:false,groupId:'',color:'#ed799a',shape:'pebble',image:null};
const g={id:'group',name:'Local Team',description:'',members:['agent'],leader:'agent',runs:['old-run'],color:'#ed799a'};
test('library loads full prompts and authoritative history, never the browser domain cache',async t=>{
 const fixture=setup(t,({path})=>({status:200,body:({'/api/agents':{agents:[{id:'agent',name:a.name}]},'/api/agents/agent':{...a,exclusive:true},'/api/teams':{teams:[{...g,leaderAgentId:'agent',archivedAt:null}]},'/api/teams/group/executions':{executions:[{id:'real-run'}]}})[path]}));
 fixture.values.set('hane-library',JSON.stringify({agents:[{id:'fake',name:'Browser'}],groups:[]}));
 const library=await fetchLibrary();assert.equal(library.agents[0].instructions,a.instructions);assert.equal(library.agents[0].groupId,'group');assert.deepEqual(library.groups[0].runs,['real-run']);assert.equal(library.groups[0].leader,'agent');
});
test('CRUD uses the server generated id, guarded JSON and browser only visuals',async t=>{
 const fixture=setup(t,call=>({status:201,body:{...call.body,id:'server-id'}}));
 const result=await changeLibrary({agents:[],groups:[]},{agents:[a],groups:[]});
 assert.equal(result.library.agents[0].id,'server-id');assert.equal(result.library.agents[0].instructions,a.instructions);
 assert.equal(fixture.calls[0].headers['x-hane-request'],'1');assert.equal(fixture.calls[0].body.id,undefined);assert.equal(fixture.calls[0].body.color,undefined);
 assert.equal(fixture.values.has('hane-library'),false);assert.equal(JSON.parse(fixture.values.get('hane-library-visuals')).agents['server-id'].color,a.color);
});
test('group removal archives without deleting exclusive agents or execution references',async t=>{
 const fixture=setup(t,()=>({status:200,body:{...g,leaderAgentId:'agent',archivedAt:'2026-10-10'}}));
 const result=await changeLibrary({agents:[{...a,exclusive:true,groupId:'group'}],groups:[g]},{agents:[{...a,exclusive:true,groupId:'group'}],groups:[]});
 assert.equal(fixture.calls[0].path,'/api/teams/group/archive');assert.equal(result.library.groups[0].archivedAt,'2026-10-10');assert.deepEqual(result.library.groups[0].runs,['old-run']);assert.equal(result.library.agents[0].groupId,'group');
});
test('a rejected mutation leaves browser data intact',async t=>{
 const fixture=setup(t,()=>({status:409,body:{error:'Agent belongs to a team'}}));
 await assert.rejects(changeLibrary({agents:[a],groups:[g]},{agents:[],groups:[g]}),/belongs to a team/);assert.equal(fixture.values.size,0);
});
test('lost import response reuses a durable id; original drafts and old history are preserved',async t=>{
 let failed=false;
 const fixture=setup(t,call=>{if(!failed){failed=true;throw new Error('Lost response');}return {status:200,body:{agentIds:{agent:'new-agent'},teamIds:{group:'new-team'}}};});
 const original={agents:[{...a,image:'data:image/gif;base64,YQ=='}],groups:[g,{id:'empty',name:'Empty Draft',members:[],runs:['unlinked']}]};
 const raw=JSON.stringify(original);fixture.values.set('hane-library',raw);
 await assert.rejects(importBrowserLibrary(original),/Lost response/);await importBrowserLibrary(original);
 assert.equal(fixture.calls[0].body.importId,fixture.calls[1].body.importId);assert.equal(fixture.calls[1].body.teams.length,1);
 assert.equal(fixture.calls[1].body.teams[0].runs,undefined);assert.equal(fixture.calls[1].body.agents[0].image,undefined);
 assert.equal(fixture.values.get('hane-library'),raw);assert.equal(JSON.parse(fixture.values.get('hane-library-visuals')).agents['new-agent'].image,original.agents[0].image);
 assert.equal(fixture.values.get('hane-library-imports').includes(a.instructions),false);
});
test('migration does not send data when its retry journal cannot be saved',async t=>{
 const fixture=setup(t,()=>{throw new Error('Must not call');},true);
 await assert.rejects(importBrowserLibrary({agents:[a],groups:[g]}),/Nenhum dado foi enviado/);assert.equal(fixture.calls.length,0);
});
test('mission creation sends an explicit team link and does not infer agent execution',async t=>{
 const fixture=setup(t,()=>({status:202,body:{id:'run',teamId:'group'}}));
 await createMission('Goal','provider',[],{teamId:'group',maxProviderCalls:3});assert.equal(fixture.calls[0].body.teamId,'group');assert.equal(fixture.calls[0].body.agents,undefined);
});

test('an exclusive browser reservation cannot silently become an unassigned server agent',async t=>{
 const fixture=setup(t,()=>{throw new Error('Must not send unresolved data');});
 await assert.rejects(importBrowserLibrary({agents:[{...a,groupId:'draft'}],groups:[{id:'draft',name:'Reserved Draft',members:[]}]}),/está reservado/);assert.equal(fixture.calls.length,0);
});

test('one unreadable agent is reported and left out instead of blanking every agent and group',async t=>{
 const map={'/api/agents':{agents:[{id:'good',name:'Good'},{id:'bad',name:'Bad'}]},'/api/agents/good':{...a,id:'good',name:'Good',instructions:'Keep my prompt'},'/api/teams':{teams:[{id:'group',name:'Local Team',description:'',members:['good'],leaderAgentId:'good',archivedAt:null}]},'/api/teams/group/executions':{executions:[{id:'real-run'}]}};
 setup(t,({path})=>path==='/api/agents/bad'?{status:400,body:{error:'id must be a uuid'}}:{status:200,body:map[path]});
 const library=await fetchLibrary();
 assert.deepEqual(library.agents.map(x=>x.id),['good']);assert.equal(library.agents[0].instructions,'Keep my prompt');
 assert.deepEqual(library.groups[0].runs,['real-run']);
 assert.deepEqual(library.unavailable,[{kind:'o agente',name:'Bad',reason:'id must be a uuid'}]);
 assert.match(unavailableNotice(library.unavailable),/o agente .Bad./);assert.match(unavailableNotice(library.unavailable),/restante da biblioteca/);
 assert.equal(unavailableNotice([]),'');
});

test('a group whose history is unreadable stays listed and names the gap',async t=>{
 const map={'/api/agents':{agents:[{id:'agent',name:a.name}]},'/api/agents/agent':{...a},'/api/teams':{teams:[{id:'group',name:'Local Team',description:'',members:['agent'],leaderAgentId:'agent',archivedAt:null}]}};
 setup(t,({path})=>path==='/api/teams/group/executions'?{status:500,body:{error:'caixa fora do ar'}}:{status:200,body:map[path]});
 const library=await fetchLibrary();
 assert.equal(library.groups.length,1);assert.deepEqual(library.groups[0].runs,[]);
 assert.equal(library.agents.length,1);
 assert.deepEqual(library.unavailable,[{kind:'o histórico do Team',name:'Local Team',reason:'caixa fora do ar'}]);
});
