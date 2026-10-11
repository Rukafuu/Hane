import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { nativePickerCommand, workspaceSelection, createWorkspacePicker } from '../src/server/workspace-picker.js';
import { createMissionServer } from '../src/server/mission-server.js';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';
import { SqliteTaskRepository } from '../src/storage/sqlite-task-repository.js';
import { SqliteProviderConfigStore } from '../src/storage/sqlite-provider-config-store.js';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'hane-picker-')));
  fs.mkdirSync(path.join(root,'src'));
  fs.writeFileSync(path.join(root,'src','olá.txt'),'private content is not returned by selection');
  fs.writeFileSync(path.join(root,'.env'),'SECRET=not returned');
  fs.mkdirSync(path.join(root,'.ssh'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}

test('native dialogs use constant argv on Windows, macOS and Linux',()=>{
  const windows = nativePickerCommand('file','win32');
  assert.equal(windows.command,'powershell.exe');
  assert.ok(windows.args.includes('-STA'));
  assert.match(Buffer.from(windows.args.at(-1),'base64').toString('utf16le'),/OpenFileDialog/);
  assert.match(Buffer.from(nativePickerCommand('directory','win32').args.at(-1),'base64').toString('utf16le'),/FolderBrowserDialog/);
  assert.match(nativePickerCommand('directory','darwin').args.at(-1),/choose folder/);
  assert.ok(nativePickerCommand('directory','linux').args.includes('--directory'));
  assert.throws(()=>nativePickerCommand('file; malicious','win32'),/arquivo ou pasta/);
});

test('file selection grants only its path; folder selection grants its subtree without returning contents',t=>{
  const root=fixture(t);
  const file=workspaceSelection(path.join(root,'src','olá.txt'),'file',root);
  assert.equal(file.scope,'src/olá.txt');assert.equal(file.root,root);assert.equal(file.name,'olá.txt');
  assert.equal('content' in file,false);
  assert.equal(workspaceSelection(path.join(root,'src'),'directory',root).scope,'src');
  const fresh=workspaceSelection(path.join(root,'src','olá.txt'),'file');
  assert.equal(fresh.root,path.join(root,'src'));assert.equal(fresh.scope,'olá.txt');
  assert.equal(workspaceSelection(root,'directory').scope,'.');
  assert.throws(()=>workspaceSelection(path.join(root,'.env'),'file',root),/sensíveis/);
  assert.throws(()=>workspaceSelection(path.join(root,'.ssh'),'directory'),/sensíveis/);
  assert.throws(()=>workspaceSelection('relative.txt','file'),/caminho local/);
  assert.throws(()=>workspaceSelection(path.join(root,'src'),'file'),/disponível/);
});

test('authenticated HTTP picker rejects third-party pages, validates kind and returns cancellation',async t=>{
  const root=fixture(t),database=openHaneDatabase(':memory:');
  let calls=0, selected=null;
  const repository=new SqliteTaskRepository({database});
  const server=createMissionServer({repository,providerConfigStore:new SqliteProviderConfigStore({database}),credentialManager:{},createProvider:()=>{},defaultWorkspaceRoot:root,pickWorkspace:async()=>{calls++;return selected;}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));database.close();});
  const url='http://127.0.0.1:'+server.address().port+'/api/workspace/select';
  const post=(body,origin='http://localhost:5173')=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-hane-request':'1',origin},body:JSON.stringify(body)});
  assert.equal((await post({kind:'file'},'https://attacker.example')).status,403);assert.equal(calls,0);
  assert.equal((await post({kind:'wrong'})).status,400);assert.equal(calls,0);
  assert.deepEqual(await (await post({kind:'file'})).json(),{selection:null});
  selected=path.join(root,'src','olá.txt');
  const response=await post({kind:'file'});assert.equal(response.status,200);
  assert.equal((await response.json()).selection.scope,'src/olá.txt');
  assert.equal(repository.list().length,0,'selection does not execute a mission');
  selected=path.join(root,'.env');assert.equal((await post({kind:'file'})).status,403);
});

test('only one dialog opens; session is checked again before revealing a selection',async t=>{
  const root=fixture(t);let finish;let authorized=true;let count=0;const replies=[];
  const handler=createWorkspacePicker({defaultRoot:root,pick:()=>{count++;return new Promise(resolve=>{finish=resolve;});},readJsonBody:async()=>({kind:'file'}),respondJson:(_response,status,body)=>replies.push({status,body})});
  const request={url:'/api/workspace/select',method:'POST'};
  const response={on(){},off(){},writableEnded:false};
  const first=handler({request,response,isAuthorized:()=>authorized});
  await new Promise(resolve=>setImmediate(resolve));
  await handler({request,response,isAuthorized:()=>authorized});assert.equal(count,1);assert.equal(replies[0].status,409);
  authorized=false;finish(path.join(root,'src','olá.txt'));await first;
  assert.equal(replies[1].status,401);assert.equal('selection' in replies[1].body,false);
  await handler({request,response,isAuthorized:()=>authorized});assert.equal(replies[2].status,401);assert.equal(count,1);
});
