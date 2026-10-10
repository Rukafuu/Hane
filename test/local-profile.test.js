import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { request as httpRequest } from 'node:http';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';
import { SqliteProfileStore } from '../src/storage/sqlite-profile-store.js';
import { SqliteTaskRepository } from '../src/storage/sqlite-task-repository.js';
import { SqliteProviderConfigStore } from '../src/storage/sqlite-provider-config-store.js';
import { createMissionServer } from '../src/server/mission-server.js';
import { LocalProfileAuth } from '../src/profile/local-auth.js';
import { processAvatar, avatarFile } from '../src/profile/avatar.js';

async function harness(t,filename) {
 const directory=filename?path.dirname(filename):fs.mkdtempSync(path.join(os.tmpdir(),'hane-profile-test-'));
 const database=openHaneDatabase(filename||path.join(directory,'profile.sqlite'));
 const store=new SqliteProfileStore({database,dataDirectory:path.join(directory,'photos')});
 const repository=new SqliteTaskRepository({database});
 const providerConfigStore=new SqliteProviderConfigStore({database});
 const server=createMissionServer({repository,providerConfigStore,profileStore:store,credentialManager:{get:async()=>null},createProvider:()=>{throw new Error('No provider should execute during onboarding');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;let cookie='';let closed=false;
 async function close(){if(closed)return;closed=true;server.closeAllConnections();await new Promise(r=>server.close(r));database.close();}
 t.after(async()=>{await close();if(!filename)fs.rmSync(directory,{recursive:true,force:true});});
 async function request(route,{method='GET',body,headers={},useCookie=true,raw=false,remember=true}={}){
  const response=await fetch(base+route,{method,headers:{...(method==='GET'?{}:{'content-type':'application/json','x-hane-request':'1'}),...(useCookie&&cookie?{cookie}:{}),...headers},body:body===undefined?undefined:raw?body:JSON.stringify(body)});
  if(remember&&response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  const bytes=await response.arrayBuffer();const type=response.headers.get('content-type');
  return {status:response.status,headers:response.headers,data:type?.includes('application/json')?JSON.parse(Buffer.from(bytes).toString()):Buffer.from(bytes)};
 }
 return {store,database,repository,server,base,request,close,directory,cookie:()=>cookie};
}
const fields={displayName:'Meu espaço',email:''};
const password='uma senha de teste 2026';

test('profile is optional to legacy runtime, singleton, validated and resumes onboarding',async t=>{
 const h=await harness(t);
 assert.equal((await h.request('/api/profile/session')).data.exists,false);
 assert.equal((await h.request('/api/missions')).status,200);
 assert.equal((await h.request('/api/profile',{method:'POST',body:{displayName:'  '}})).status,400);
 assert.equal((await h.request('/api/profile',{method:'POST',body:{...fields,email:'invalid'}})).status,400);
 const created=await h.request('/api/profile',{method:'POST',body:fields});
 assert.equal(created.status,201);assert.equal(created.data.profile.passwordEnabled,false);assert.equal(created.data.profile.email,null);
 assert.match(created.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
 assert.equal((await h.request('/api/profile',{method:'POST',body:fields})).status,409);
 assert.equal((await h.request('/api/profile/onboarding',{method:'POST',body:{step:3,completed:true}})).status,400);
 assert.equal((await h.request('/api/profile/onboarding',{method:'POST',body:{step:2}})).data.profile.onboardingStep,2);
 assert.equal((await h.request('/api/profile/session')).data.profile.onboardingStep,2);
 assert.equal((await h.request('/api/profile/onboarding',{method:'POST',body:{step:3}})).status,200);
 assert.equal((await h.request('/api/profile/onboarding',{method:'POST',body:{step:3,completed:true}})).data.profile.onboardingCompleted,true);
 const updated=await h.request('/api/profile',{method:'PATCH',body:{displayName:'Novo nome',email:'local@example.test'}});
 assert.equal(updated.data.profile.displayName,'Novo nome');
 const exported=await h.request('/api/profile/export');assert.equal(exported.data.profile.email,'local@example.test');
 assert.deepEqual(Object.keys(exported.data.profile).sort(),['createdAt','displayName','email','id','onboardingCompleted','updatedAt']);
 await h.request('/api/profile/lock',{method:'POST',body:{}});
 assert.equal((await h.request('/api/missions')).status,401);
 assert.equal((await h.request('/api/profile/unlock',{method:'POST',body:{}})).status,200);
 assert.equal(h.repository.list().length,0);
});

test('backend sessions protect runtime and metadata, reject untrusted origins and revoke SSE',async t=>{
 const h=await harness(t);await h.request('/api/profile',{method:'POST',body:fields});
 for(const route of ['/api/profile','/api/profile/export','/api/profile/avatar','/api/missions','/api/providers','/api/workspace','/api/skills','/api/onboarding','/api/events'])assert.equal((await h.request(route,{useCookie:false})).status,401,route);
 assert.equal((await h.request('/api/missions',{method:'POST',body:{objective:'should not run'},useCookie:false})).status,401);
 for(const origin of ['https://evil.example','null','http://localhost:9999'])assert.equal((await h.request('/api/profile/session',{headers:{origin}})).status,403);
 assert.equal((await h.request('/api/profile/session',{headers:{origin:'http://localhost:5173'}})).status,200);
 const rebindingStatus=await new Promise((resolve,reject)=>{const req=httpRequest(h.base+'/api/profile/session',{headers:{host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(rebindingStatus,403);
 assert.equal((await h.request('/api/profile/lock',{method:'POST',body:{},headers:{'x-hane-request':''}})).status,403);
 const stream=await fetch(h.base+'/api/events',{headers:{cookie:h.cookie()}});const reader=stream.body.getReader();await reader.read();
 const originalCookie=h.cookie();await h.request('/api/profile/lock',{method:'POST',body:{}});
 assert.equal((await reader.read()).done,true);
 assert.equal((await h.request('/api/missions',{headers:{cookie:originalCookie}})).status,401);
 assert.equal((await h.request('/api/profile/session')).data.profile,null);
});

test('password derives Argon2id, requires reauthentication, rotates sessions and limits attempts',async t=>{
 const h=await harness(t);
 assert.equal((await h.request('/api/profile',{method:'POST',body:{...fields,passwordEnabled:true,password:'short',confirmPassword:'short'}})).status,400);
 const created=await h.request('/api/profile',{method:'POST',body:{...fields,passwordEnabled:true,password,confirmPassword:password}});
 assert.equal(created.status,201);assert.match(h.store.secret().verifier,/^\$argon2id\$v=19\$/);for(const parameter of ['m=65536','t=3','p=1'])assert.ok(h.store.secret().verifier.includes(parameter));
 assert.ok(!JSON.stringify(created.data).includes('verifier'));assert.ok(!h.store.secret().verifier.includes(password));
 const oldCookie=h.cookie();
 assert.equal((await h.request('/api/profile/password',{method:'POST',body:{enabled:false,currentPassword:'wrong'}})).status,401);
 assert.equal(h.store.get().passwordEnabled,true);
 assert.equal((await h.request('/api/profile/password',{method:'POST',body:{enabled:true,currentPassword:password,password:password+' new',confirmPassword:password+' new'}})).status,200);
 assert.equal((await h.request('/api/profile',{headers:{cookie:oldCookie}})).status,401);
 await h.request('/api/profile/lock',{method:'POST',body:{}});
 assert.equal((await h.request('/api/profile/unlock',{method:'POST',body:{password}})).status,401);
 assert.equal((await h.request('/api/profile/unlock',{method:'POST',body:{password:password+' new'}})).status,200);
 assert.equal((await h.request('/api/profile/password',{method:'POST',body:{enabled:false,currentPassword:password+' new'}})).status,200);
 assert.equal(h.store.secret(),undefined);
 await h.request('/api/profile/password',{method:'POST',body:{enabled:true,password,confirmPassword:password}});
 await h.request('/api/profile/lock',{method:'POST',body:{}});
 for(let i=0;i<5;i++)assert.equal((await h.request('/api/profile/unlock',{method:'POST',body:{password:'wrong'}})).status,401);
 assert.equal((await h.request('/api/profile/unlock',{method:'POST',body:{password}})).status,429);
 assert.equal(h.store.secret().attempts,5);assert.ok(h.store.secret().blockedUntil>Date.now());
});

test('profile, onboarding, verifier and cooldown survive restart; runtime records are preserved',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hane-profile-restart-'));t.after(async()=>{await h.close();fs.rmSync(directory,{recursive:true,force:true});});
 const filename=path.join(directory,'persist.sqlite');let h=await harness(t,filename);
 // Store independent legacy data before profile creation and migration use.
 h.database.exec("CREATE TABLE legacy_evidence (value TEXT); INSERT INTO legacy_evidence VALUES ('preserve me');");
 const created=await h.request('/api/profile',{method:'POST',body:{...fields,passwordEnabled:true,password,confirmPassword:password}});
 const id=created.data.profile.id;await h.request('/api/profile/onboarding',{method:'POST',body:{step:2}});
 const cookie=h.cookie();const verifier=h.store.secret().verifier;
 for(let i=0;i<5;i++)h.store.recordFailure(Date.now());const blocked=h.store.secret().blockedUntil;
 await h.close();h=await harness(t,filename);
 assert.equal(h.store.get().id,id);assert.equal(h.store.get().onboardingStep,2);assert.equal(h.store.secret().verifier,verifier);assert.equal(h.store.secret().blockedUntil,blocked);
 assert.equal((await h.request('/api/profile',{headers:{cookie}})).status,401);
 assert.equal((await h.request('/api/profile/unlock',{method:'POST',body:{password}})).status,429);
 assert.equal(h.database.prepare('SELECT value FROM legacy_evidence').get().value,'preserve me');
 h.store.clearFailures();assert.equal((await h.request('/api/profile/unlock',{method:'POST',body:{password}})).data.profile.onboardingStep,2);
});

test('sessions expire according to backend clock and never persist bearer tokens',async t=>{
 const h=await harness(t);h.store.create(fields);let now=1000;
 const auth=new LocalProfileAuth({store:h.store,now:()=>now,sessionMs:5000});let cookie;
 auth.issue({setHeader:(name,value)=>{cookie=value.split(';')[0];}});
 const request={headers:{cookie}};assert.equal(auth.authenticated(request),true);
 assert.ok(![...auth.sessions.keys()].includes(cookie.split('=')[1]));now=6000;assert.equal(auth.authenticated(request),false);
});

test('photos decode true PNG JPEG WebP, strip metadata, cap dimensions and are replaced locally',async t=>{
 const h=await harness(t);await h.request('/api/profile',{method:'POST',body:fields});
 let previous;
 for(const format of ['png','jpeg','webp']){
  const input=await sharp({create:{width:320,height:160,channels:3,background:'#ed799a'}}).withExif({IFD0:{Artist:'private metadata'}}).toFormat(format).toBuffer();
  const uploaded=await h.request('/api/profile/avatar',{method:'POST',body:input,raw:true,headers:{'content-type':`image/${format}`}});
  assert.equal(uploaded.status,200);const reference=uploaded.data.profile.avatarPath;assert.match(reference,/^[a-f0-9-]+\.webp$/);
  const file=avatarFile(h.store.dataDirectory,reference);assert.ok(fs.existsSync(file));if(previous)assert.equal(fs.existsSync(previous),false);previous=file;
  const image=await h.request('/api/profile/avatar');assert.equal(image.headers.get('x-content-type-options'),'nosniff');
  const meta=await sharp(image.data).metadata();assert.equal(meta.format,'webp');assert.equal(meta.width,256);assert.equal(meta.height,256);assert.equal(meta.exif,undefined);assert.equal(meta.icc,undefined);
 }
 for(const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),Buffer.from([137,80,78,71,13,10,26,10])])assert.equal((await h.request('/api/profile/avatar',{method:'POST',body:bytes,raw:true,headers:{'content-type':'image/png'}})).status,400);
 assert.equal(h.store.get().avatarPath,path.basename(previous));
 const input=await sharp({create:{width:100,height:100,channels:3,background:'red'}}).png().toBuffer();
 await assert.rejects(processAvatar(input,{maxBytes:100000,maxPixels:100,maxDimension:8192,outputSize:256}),/imagem/);
 await assert.rejects(processAvatar(input,{maxBytes:10,maxPixels:16000000,maxDimension:8192,outputSize:256}),/imagem/);
 await assert.rejects(processAvatar(input,{maxBytes:100000,maxPixels:16000000,maxDimension:50,outputSize:256}),/imagem/);
 assert.throws(()=>avatarFile(h.store.dataDirectory,'../secret'),/Foto/);
 await h.request('/api/profile/avatar',{method:'DELETE'});assert.equal(h.store.get().avatarPath,null);assert.equal(fs.existsSync(previous),false);
});

test('oversized photo returns a recoverable 413 and keeps the previous profile',async t=>{
 const h=await harness(t);await h.request('/api/profile',{method:'POST',body:fields});
 const response=await h.request('/api/profile/avatar',{method:'POST',body:Buffer.alloc(5*1024*1024+1),raw:true,headers:{'content-type':'image/png'}});
 assert.equal(response.status,413);assert.equal(h.store.get().avatarPath,null);
 assert.equal((await h.request('/api/profile')).status,200);
});

test('lock during a slow profile request prevents its eventual write',async t=>{
 const h=await harness(t);await h.request('/api/profile',{method:'POST',body:fields});
 const body=JSON.stringify({displayName:'Should not save',email:''});
 let ready;const arrived=new Promise(r=>{ready=r;});h.server.once('request',()=>ready());
 const response=new Promise((resolve,reject)=>{
  const req=httpRequest(h.base+'/api/profile',{method:'PATCH',headers:{cookie:h.cookie(),'content-type':'application/json','x-hane-request':'1','content-length':Buffer.byteLength(body)}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.write(body.slice(0,10));
  arrived.then(async()=>{try{await h.request('/api/profile/lock',{method:'POST',body:{}});req.end(body.slice(10));}catch(e){req.destroy();reject(e);}});
 });
 assert.equal(await response,401);assert.equal(h.store.get().displayName,fields.displayName);
});

test('password activation returns recovery once and never stores or exports its plaintext',async t=>{
 const h=await harness(t);const result=await h.request('/api/profile',{method:'POST',body:{...fields,passwordEnabled:true,password,confirmPassword:password}});
 const code=result.data.recoveryCode;assert.match(code,/^(?:[A-F0-9]{8}-){7}[A-F0-9]{8}$/);assert.equal(result.data.profile.recoveryAvailable,true);
 const verifier=h.store.recovery().verifier;assert.match(verifier,/^[a-f0-9]{64}$/);assert.notEqual(verifier,code.replaceAll('-','').toLowerCase());
 const auth=new LocalProfileAuth({store:h.store});assert.equal(auth.verifyRecovery(code.toLowerCase().replaceAll('-',' ')).recoveryVerifier,verifier);
 for(const route of ['/api/profile','/api/profile/session','/api/profile/export'])assert.ok(!JSON.stringify((await h.request(route)).data).includes(code));
 assert.ok(!fs.readFileSync(path.join(h.directory,'profile.sqlite')).includes(Buffer.from(code)));
});

test('recovery preserves profile data, revokes sessions and SSE, consumes code and requires fresh login',async t=>{
 const h=await harness(t);const created=await h.request('/api/profile',{method:'POST',body:{...fields,passwordEnabled:true,password,confirmPassword:password}});
 const code=created.data.recoveryCode;const oldCookie=h.cookie();const id=h.store.get().id;
 await h.request('/api/profile/onboarding',{method:'POST',body:{step:2}});
 h.database.prepare('INSERT INTO provider_configs (label,base_url,model,credential_reference) VALUES (?,?,?,?)').run('preserved','https://example.test','test-model','test-reference');
 const input=await sharp({create:{width:64,height:64,channels:3,background:'pink'}}).png().toBuffer();await h.request('/api/profile/avatar',{method:'POST',body:input,raw:true,headers:{'content-type':'image/png'}});const avatar=h.store.get().avatarPath;
 assert.equal((await h.request('/api/profile/recover',{method:'POST',body:{code,password:'too short',confirmPassword:'different'}})).status,400);
 assert.equal(new LocalProfileAuth({store:h.store}).verifyRecovery(code).recoveryVerifier,h.store.recovery().verifier);
 const stream=await fetch(h.base+'/api/events',{headers:{cookie:oldCookie}});const reader=stream.body.getReader();await reader.read();
 const recovered=await h.request('/api/profile/recover',{method:'POST',useCookie:false,body:{code,password:password+' recovered',confirmPassword:password+' recovered'}});
 assert.equal(recovered.status,200);assert.equal(recovered.data.locked,true);assert.ok(recovered.data.recoveryCode);assert.notEqual(recovered.data.recoveryCode,code);assert.equal(recovered.data.profile,undefined);
 assert.equal((await reader.read()).done,true);
 assert.equal((await h.request('/api/profile',{headers:{cookie:oldCookie}})).status,401);
 assert.equal((await h.request('/api/profile/session')).data.authenticated,false);
 assert.equal(h.store.get().id,id);assert.equal(h.store.get().avatarPath,avatar);assert.equal(h.store.get().onboardingStep,2);assert.equal(h.store.get().displayName,fields.displayName);
 assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM provider_configs').get().n,1);
 assert.equal((await h.request('/api/profile/recover',{method:'POST',body:{code,password,confirmPassword:password}})).status,401);
 assert.equal((await h.request('/api/profile/unlock',{method:'POST',body:{password}})).status,401);
 assert.equal((await h.request('/api/profile/unlock',{method:'POST',body:{password:password+' recovered'}})).status,200);
});

test('regeneration requires current password and all password changes rotate recovery material',async t=>{
 const h=await harness(t);await h.request('/api/profile',{method:'POST',body:fields});
 assert.equal((await h.request('/api/profile/recovery-code',{method:'POST',body:{}})).status,409);
 const enabled=await h.request('/api/profile/password',{method:'POST',body:{enabled:true,password,confirmPassword:password}});const original=enabled.data.recoveryCode;assert.ok(original);
 const verifier=h.store.recovery().verifier;
 assert.equal((await h.request('/api/profile/recovery-code',{method:'POST',body:{currentPassword:password},useCookie:false})).status,401);
 assert.equal((await h.request('/api/profile/recovery-code',{method:'POST',body:{currentPassword:'wrong'}})).status,401);assert.equal(h.store.recovery().verifier,verifier);
 const generated=await h.request('/api/profile/recovery-code',{method:'POST',body:{currentPassword:password}});assert.equal(generated.status,200);assert.notEqual(generated.data.recoveryCode,original);
 assert.throws(()=>new LocalProfileAuth({store:h.store}).verifyRecovery(original),/inválido/);
 const changed=await h.request('/api/profile/password',{method:'POST',body:{enabled:true,currentPassword:password,password:password+' changed',confirmPassword:password+' changed'}});assert.equal(changed.status,200);assert.ok(changed.data.recoveryCode);
 assert.throws(()=>new LocalProfileAuth({store:h.store}).verifyRecovery(generated.data.recoveryCode),/inválido/);
 await h.request('/api/profile/password',{method:'POST',body:{enabled:false,currentPassword:password+' changed'}});assert.equal(h.store.recovery(),undefined);assert.equal(h.store.get().recoveryAvailable,false);
});

test('recovery attempts are independent from login cooldown and persist across restart',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hane-recovery-restart-'));let h; t.after(async()=>{await h.close();fs.rmSync(directory,{recursive:true,force:true});});const filename=path.join(directory,'profile.sqlite');h=await harness(t,filename);
 const created=await h.request('/api/profile',{method:'POST',body:{...fields,passwordEnabled:true,password,confirmPassword:password}});const code=created.data.recoveryCode;
 let now=1000;let auth=new LocalProfileAuth({store:h.store,now:()=>now});
 for(let i=0;i<5;i++)assert.throws(()=>auth.verifyRecovery('incorrect'),e=>e.status===401);
 assert.throws(()=>auth.verifyRecovery(code),e=>e.status===429);
 assert.equal((await h.request('/api/profile/unlock',{method:'POST',body:{password}})).status,200);
 const block=h.store.recovery().blockedUntil;await h.close();h=await harness(t,filename);assert.equal(h.store.recovery().blockedUntil,block);
 auth=new LocalProfileAuth({store:h.store,now:()=>now});assert.throws(()=>auth.verifyRecovery(code),e=>e.status===429);
 now=block+1;const expected=auth.verifyRecovery(code);assert.ok(expected);
 for(let i=0;i<5;i++)h.store.recordFailure(Date.now());assert.ok(auth.verifyRecovery(code));
 const restored=await h.request('/api/profile/recover',{method:'POST',body:{code,password:password+' restored',confirmPassword:password+' restored'}});assert.equal(restored.status,200);assert.equal(h.store.secret().attempts,0);
});

test('a code cannot commit two recoveries or survive a concurrent password change',async t=>{
 const h=await harness(t);const created=await h.request('/api/profile',{method:'POST',body:{...fields,passwordEnabled:true,password,confirmPassword:password}});const code=created.data.recoveryCode;
 const results=await Promise.all([1,2].map(i=>h.request('/api/profile/recover',{method:'POST',useCookie:false,body:{code,password:password+i,confirmPassword:password+i}})));
 assert.equal(results.filter(r=>r.status===200).length,1);assert.ok(results.filter(r=>r.status!==200).every(r=>[401,429].includes(r.status)));
 const saved=results.find(r=>r.status===200);const auth=new LocalProfileAuth({store:h.store});const expected=auth.verifyRecovery(saved.data.recoveryCode);
 const next=auth.newRecoveryCode();h.store.setPassword(await auth.hash(password+' changed'),next.verifier);
 assert.equal(h.store.recoverPassword(expected,await auth.hash(password+' stale'),auth.newRecoveryCode().verifier),false);
 assert.equal(await auth.verify(password+' changed'),true);
});

test('legacy password profiles require authenticated generation; migration does not invent a recovery key',async t=>{
 const h=await harness(t);const auth=new LocalProfileAuth({store:h.store});h.store.create(fields,await auth.hash(password));assert.equal(h.store.get().recoveryAvailable,false);
 assert.equal((await h.request('/api/profile/recover',{method:'POST',body:{code:'0'.repeat(64),password,confirmPassword:password}})).status,401);
 assert.equal((await h.request('/api/profile/unlock',{method:'POST',body:{password}})).status,200);
 assert.equal((await h.request('/api/profile/recovery-code',{method:'POST',body:{currentPassword:password}})).status,200);
});
