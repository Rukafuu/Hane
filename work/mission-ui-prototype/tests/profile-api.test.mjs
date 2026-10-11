import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalProfile, fetchProfileSession } from '../src/profile-api.js';

function respondWith(t, body, status, type='application/json') {
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(body,{status,headers:{'content-type':type}});
 t.after(()=>{globalThis.fetch=oldFetch;});
}

test('empty and HTML proxy failures report backend availability instead of a JSON parser error',async t=>{
 for(const [body,status,type] of [['',500,'text/plain'],['<html>Bad gateway</html>',502,'text/html']]) {
  await t.test(String(status),async t=>{
   respondWith(t,body,status,type);
   await assert.rejects(createLocalProfile({displayName:'Test'}),error=>error.status===status && /server is unavailable/.test(error.message));
  });
 }
});
test('invalid successful responses do not count as a created profile',async t=>{
 respondWith(t,'',200);
 await assert.rejects(createLocalProfile({displayName:'Test'}),/invalid response/);
});
test('structured API errors keep their message and HTTP status',async t=>{
 respondWith(t,JSON.stringify({error:'Origin is not allowed.'}),403);
 await assert.rejects(fetchProfileSession(),error=>error.status===403 && error.message==='Origin is not allowed.');
});
test('successful profile responses preserve profile and one-time recovery data',async t=>{
 const data={profile:{id:'test-profile'},recoveryCode:'test-only-code'};
 respondWith(t,JSON.stringify(data),201);
 assert.deepEqual(await createLocalProfile({displayName:'Test'}),data);
});
