import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';
import { SqliteTaskRepository } from '../src/storage/sqlite-task-repository.js';
import { SqliteProviderConfigStore } from '../src/storage/sqlite-provider-config-store.js';
import { SqliteAgentStore } from '../src/storage/sqlite-agent-store.js';
import { SqliteSettingsStore } from '../src/storage/sqlite-settings-store.js';
import { createSettingsApi } from '../src/server/settings-api.js';
import { createMissionServer } from '../src/server/mission-server.js';
async function harness(t,{fetchImpl=fetch,authorized=true}={}) {
 const database=openHaneDatabase(':memory:');const repository=new SqliteTaskRepository({database});const providers=new SqliteProviderConfigStore({database});const secrets=new Map();
 const api=createSettingsApi({database,repository,providerConfigStore:providers,credentialManager:{get:async id=>secrets.get(id)||null,set:async(id,value)=>secrets.set(id,value)},fetchImpl,readJsonBody:async req=>{let raw='';for await(const chunk of req)raw+=chunk;return JSON.parse(raw||'{}');},respondJson:(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));}});
 const server=createServer(async(req,res)=>{await api({request:req,response:res,isAuthorized:()=>authorized});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));database.close();});
 return {database,providers,secrets,call:async(path,method='GET',body)=>{const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/settings/'+path,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json()};}};
}
test('settings refuse locked sessions before reading or changing data',async t=>{const h=await harness(t,{authorized:false});assert.equal((await h.call('memory','PUT',{content:'private'})).status,401);assert.equal(new SqliteSettingsStore(h.database).listMemory().length,0);});
test('provider metadata and credential stay separate; test uses models without generation',async t=>{
 let requested;const h=await harness(t,{fetchImpl:async(url,options)=>{requested={url,options};return Response.json({data:[{id:'configured'}]});}});
 assert.equal((await h.call('providers','PUT',{label:'unit',baseUrl:'https://provider.example/v1',model:'configured'})).status,200);
 assert.equal((await h.call('providers/unit/secret','POST',{secret:'test-only-value'})).status,200);
 const result=await h.call('providers/unit/test','POST');assert.equal(result.data.connected,true);assert.equal(result.data.modelAvailable,true);assert.equal(requested.url,'https://provider.example/v1/models');assert.equal(requested.options.body,undefined);
 assert.equal(JSON.stringify(h.providers.list()).includes('test-only-value'),false);const archive=await h.call('export');assert.equal(JSON.stringify(archive).includes('test-only-value'),false);assert.equal(JSON.stringify(archive).includes('credentialReference'),false);
 assert.equal((await h.call('providers/unit','DELETE')).status,200);assert.equal(h.secrets.size,1);
});
test('memories persist and respect shared/agent/team isolation and validation',async t=>{
 const h=await harness(t);const agent=new SqliteAgentStore({database:h.database}).ensureInitial();
 const shared=await h.call('memory','PUT',{content:'Shared context',scope:'shared'});assert.equal(shared.status,200);
 assert.equal((await h.call('memory','PUT',{scope:'agent',targetId:agent.id,content:'Personal context'})).status,200);
 assert.equal((await h.call('memory','PUT',{scope:'agent',targetId:'missing',content:'No'})).status,400);
 const store=new SqliteSettingsStore(h.database);assert.equal(store.context(agent.id,null).length,2);assert.equal(store.context('other',null).length,1);
 assert.equal((await h.call('memory','PUT',{scope:'shared',content:'x'.repeat(4001)})).status,400);
 await h.call('memory','DELETE',{id:shared.data.memories[0].id});assert.equal(store.context('other',null).length,0);
});
test('system diagnostics measure SQLite and export contains real conversation content only',async t=>{
 const h=await harness(t);const data=(await h.call('system')).data;assert.equal(data.integrity,'ok');assert.equal(data.counts.settings_memory,0);assert.ok(data.databaseBytes>0);
 h.database.prepare("INSERT INTO local_profiles (id,installation_slot,display_name,email,created_at,updated_at) VALUES ('private',1,'User','','now','now')").run();
 h.database.prepare("INSERT INTO local_profile_secrets(profile_id,password_verifier) VALUES ('private','must-not-export')").run();
 assert.equal(JSON.stringify(await h.call('export')).includes('must-not-export'),false);
});
test('MCP performs real HTTP initialize/discovery and refuses tool call without approval',async t=>{
 const methods=[];const remote=createServer(async(req,res)=>{if(req.method==='DELETE'){res.writeHead(204);res.end();return;}let raw='';for await(const c of req)raw+=c;const msg=JSON.parse(raw);methods.push(msg.method);if(msg.method==='notifications/initialized'){res.writeHead(202);res.end();return;}const result=msg.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}}}:msg.method==='tools/list'?{tools:[{name:'echo',inputSchema:{type:'object',properties:{text:{type:'string'}}}}]}:{content:[{type:'text',text:msg.params.arguments.text}]};res.writeHead(200,{'content-type':'application/json','mcp-session-id':'fixture-session'});res.end(JSON.stringify({jsonrpc:'2.0',id:msg.id,result}));});await new Promise(resolve=>remote.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>remote.close(resolve)));
 const h=await harness(t);const config=(await h.call('mcp','PUT',{name:'Local test service',url:'http://127.0.0.1:'+remote.address().port+'/mcp'})).data.server;
 assert.equal((await h.call('mcp/'+config.id+'/call','POST',{name:'echo',arguments:{text:'hello'}})).status,403);assert.equal(methods.length,0);
 assert.equal((await h.call('mcp/'+config.id+'/discover','POST',{})).data.tools[0].name,'echo');
 const call=await h.call('mcp/'+config.id+'/call','POST',{name:'echo',arguments:{text:'hello'},approved:true});assert.equal(call.data.result.content[0].text,'hello');assert.ok(methods.includes('tools/call'));const audit=(await h.call('mcp-audit')).data.calls;assert.equal(audit[0].status,'completed');assert.equal(audit[0].tool,'echo');assert.equal(JSON.stringify(audit).includes('hello'),false);
 assert.equal((await h.call('mcp','PUT',{name:'unsafe',url:'https://user:secret@example.com/mcp'})).status,400);
});
test('new settings routes inherit the mission server origin guard',async t=>{
 const database=openHaneDatabase(':memory:');const repository=new SqliteTaskRepository({database});const server=createMissionServer({repository,providerConfigStore:new SqliteProviderConfigStore({database}),credentialManager:{get:async()=>null},createProvider:()=>{throw Error('unused');}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));database.close();});
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/settings/memory',{method:'PUT',headers:{origin:'https://untrusted.example','content-type':'application/json','x-hane-request':'1'},body:JSON.stringify({scope:'shared',content:'No'})});assert.equal(response.status,403);assert.equal(new SqliteSettingsStore(database).listMemory().length,0);
});

test('malformed external model responses never echo private response text',async t=>{
 const h=await harness(t,{fetchImpl:async()=>new Response('private-response-that-must-not-leak',{headers:{'content-type':'application/json'}})});
 await h.call('providers','PUT',{label:'invalid-json',baseUrl:'https://provider.example/v1',model:'configured'});await h.call('providers/invalid-json/secret','POST',{secret:'test-value'});
 const result=await h.call('providers/invalid-json/test','POST');assert.equal(result.status,400);assert.equal(JSON.stringify(result).includes('private-response-that-must-not-leak'),false);assert.equal(result.data.error,'Resposta JSON inválida.');
});
