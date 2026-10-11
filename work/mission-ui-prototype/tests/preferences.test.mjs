import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accentText, appearanceStyle, normalizeAppearance, normalizeGeneral, validateLibrary, readPreference, writePreference } from '../src/preferences.js';
import { createMission } from '../src/api.js';
test('corrupted preferences fall back and reject invalid CSS values',()=>{ assert.equal(normalizeAppearance(null).theme,'midnight');assert.equal(normalizeAppearance({theme:'forest',accent:'url(secret)',font:'unknown'}).accent,'#7cb58d');assert.equal(normalizeGeneral({maxToolCalls:0,maxProviderCalls:2.5}).maxToolCalls,8); });
test('groups reuse global agents, reject duplicates and enforce eight members',()=>{const agents=Array.from({length:9},(_,i)=>({id:String(i),name:`Agent ${i}`}));const group={id:'g',name:'Group',members:agents.slice(0,8).map(a=>a.id),leader:'0',runs:['real-run']};assert.equal(validateLibrary({agents,groups:[group]}).groups[0].members.length,8);assert.throws(()=>validateLibrary({agents,groups:[{...group,members:agents.map(a=>a.id)}]}));assert.throws(()=>validateLibrary({agents,groups:[{...group,members:['0','0']}]}));});
test('exclusive agents cannot leak into another group',()=>{assert.throws(()=>validateLibrary({agents:[{id:'a',name:'A',groupId:'g'}],groups:[{id:'g',name:'G',members:[]},{id:'other',name:'Other',members:['a']}]}));});
test('backup strips unknown fields including secrets and invalid image URLs',()=>{const lib=validateLibrary({agents:[{id:'a',name:'A',token:'secret',image:'https://external/track'}],groups:[]});assert.equal(lib.agents[0].token,undefined);assert.equal(lib.agents[0].image,null);});
test('storage denial is recoverable instead of crashing',()=>{globalThis.localStorage={getItem(){throw new Error('denied');},setItem(){throw new Error('full');}};assert.deepEqual(readPreference('test',[]),[]);assert.equal(writePreference('test',{}),false);delete globalThis.localStorage;});
test('execution sends configured budgets with explicit capability grants',async()=>{const original=globalThis.fetch;let payload;globalThis.fetch=async(_,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({id:'run'})};};try{await createMission('Real objective','local',[{name:'workspace.read',scope:'.'}],{maxProviderCalls:5,maxToolCalls:7});assert.equal(payload.maxProviderCalls,5);assert.equal(payload.maxToolCalls,7);assert.equal(payload.provider,'local');assert.deepEqual(payload.capabilities,[{name:'workspace.read',scope:'.'}]);}finally{globalThis.fetch=original;}});

test('accent text stays readable for pale, dark and mid-tone custom colors without changing preferences',()=>{
  const luminance=hex=>{const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
  for(const accent of ['#ed799a','#78a9ff','#7cb58d','#000000','#ffffff','#777777','#a78bfa','#004466','#ffcc00']) {
    const appearance=normalizeAppearance({accent,font:'mono',textSize:'large'}),before={...appearance};
    const style=appearanceStyle(appearance),fg=luminance(style['--accent-ink']),bg=luminance(accent);
    assert.ok((Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)>=4.5,accent);
    assert.deepEqual(appearance,before);assert.equal(style['--user-accent'],accent);
  }
  assert.equal(accentText('#000000'),'#ffffff');
});
