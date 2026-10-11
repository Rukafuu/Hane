import assert from 'node:assert/strict';
import test from 'node:test';
import {validateTeamDraft,teamPresetState} from '../src/team-flow.js';
const agents=Array.from({length:9},(_,i)=>({id:String(i),name:'Agent '+i,provider:'local'}));
const providers=[{label:'local'}];
test('Team drafts reject blank names, repeated/foreign members, ninth participant and removal, but accept optional leadership',()=>{
 const draft={name:'My Team',members:['0'],leader:''};
 assert.equal(validateTeamDraft(draft,agents),'');
 for(const patch of [{name:' '},{name:'a'.repeat(81)},{members:[]},{members:['0','0']},{members:['foreign']},{members:agents.map(a=>a.id)},{leader:'1'}])assert.ok(validateTeamDraft({...draft,...patch},agents));
 assert.ok(validateTeamDraft(draft,agents,['0','1']));
 assert.equal(validateTeamDraft({...draft,members:['0','1'],leader:'1'},agents,['0']),'');
 assert.ok(validateTeamDraft(draft,[{...agents[0],exclusive:true,groupId:'other'}]));
});
test('one and two agents can form a Team without making the three-stage preset compatible',()=>{
 for(const count of [1,2]){const team={members:agents.slice(0,count).map(a=>a.id)};const state=teamPresetState(team,agents,{},providers);assert.equal(state.compatible,false);assert.equal(state.missing,3-count);assert.equal(state.ready,false);}
});
test('a preset needs explicit distinct bindings and available provider metadata; it never selects agents or grants access',()=>{
 const team={members:['0','1','2']},bindings={planner:'0',executor:'1',reviewer:'2'};
 for(const roles of [{},{...bindings,reviewer:'1'},{...bindings,reviewer:'3'}])assert.equal(teamPresetState(team,agents,roles,providers).ready,false);
 assert.equal(teamPresetState(team,agents,bindings,providers).ready,true);
 assert.equal(teamPresetState(team,agents,bindings,[]).ready,false);
 const unconfigured=agents.map(a=>({...a,provider:''}));
 assert.equal(teamPresetState(team,unconfigured,bindings,[...providers,{label:'other'}]).ready,false);
 assert.equal(teamPresetState(team,unconfigured,bindings,[...providers,{label:'other'}],'local').ready,true);
 assert.deepEqual(bindings,{planner:'0',executor:'1',reviewer:'2'});
 assert.deepEqual(team,{members:['0','1','2']});
});
