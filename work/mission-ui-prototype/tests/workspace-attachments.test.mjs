import assert from 'node:assert/strict';
import test from 'node:test';
import {attachmentText, attachmentGrants} from '../src/workspace-attachments.js';
import {selectWorkspaceItem, createMission} from '../src/api.js';

test('removal revokes attachment grants; manual grants are retained and deduplicated',()=>{
 const file={kind:'file',scope:'src/a.txt',root:'/workspace',name:'a.txt'};
 const folder={kind:'directory',scope:'docs'};
 assert.deepEqual(attachmentGrants([file,folder,{text:'context'}]),[{name:'workspace.read',scope:'src/a.txt'},{name:'workspace.read',scope:'docs'}]);
 assert.deepEqual(attachmentGrants([]),[]);
 const manual=[{name:'workspace.read',scope:'src/a.txt'}];
 assert.deepEqual(attachmentGrants([file],manual),manual);assert.deepEqual(attachmentGrants([],manual),manual);
 assert.equal(attachmentText({text:'hello'}),'hello');assert.match(attachmentText(folder),/Pasta do workspace: "docs"/);
 assert.throws(()=>attachmentGrants(Array.from({length:13},(_,i)=>({scope:'file'+i}))),/12 permissões/);
});

test('the native picker and mission API carry the real root and scoped read grant',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,...options,body:JSON.parse(options.body)});return {ok:true,json:async()=>({selection:null})};};
 await selectWorkspaceItem('file','/workspace');
 assert.equal(calls[0].url,'/api/workspace/select');assert.deepEqual(calls[0].body,{kind:'file',root:'/workspace'});assert.equal(calls[0].headers['x-hane-request'],'1');
 await createMission('Read file',null,attachmentGrants([{scope:'file.txt'}]),{workspaceRoot:'/workspace'});
 assert.deepEqual(calls[1].body,{objective:'Read file',workspaceRoot:'/workspace',capabilities:[{name:'workspace.read',scope:'file.txt'}]});
});
