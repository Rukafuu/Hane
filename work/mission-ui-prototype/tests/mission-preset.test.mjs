import assert from 'node:assert/strict';
import test from 'node:test';
import {createMission} from '../src/api.js';
test('mission API carries explicit role assignments and team context without granting capabilities',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let payload,headers;
 globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/missions');payload=JSON.parse(options.body);headers=options.headers;return {ok:true,json:async()=>({id:'queued'})};};
 const assignments={planner:'one',executor:'two',reviewer:'three'};
 await createMission('Test preset',null,[],{teamId:'team',roleAssignments:assignments,maxProviderCalls:10});
 assert.deepEqual(payload,{objective:'Test preset',teamId:'team',roleAssignments:assignments,maxProviderCalls:10});assert.equal(headers['x-hane-request'],'1');
 await createMission('Legacy execution','provider');assert.deepEqual(payload,{objective:'Legacy execution',provider:'provider'});
});
test('actor execution reaches the server, and a budget below the actor share is left to the backend',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let payload;
 globalThis.fetch=async(url,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({id:'queued'})};};
 await createMission('Equipe em atores',null,[],{teamId:'team',executionMode:'actor',maxToolCalls:8});
 assert.deepEqual(payload,{objective:'Equipe em atores',teamId:'team',executionMode:'actor',maxToolCalls:8});
 await createMission('Equipe com orçamento do usuário',null,[],{teamId:'team',executionMode:'actor',maxProviderCalls:12});
 assert.equal(payload.maxProviderCalls,12);
 await createMission('Sequência',null,[],{teamId:'team',maxProviderCalls:3});
 assert.equal(payload.executionMode,undefined);assert.equal(payload.maxProviderCalls,3);
});
