import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminData} from './admin-data.mjs';
function fixture(){
 let time=100000,reads=0,authReads=0,authorized=true;
 const api=createAdminData({base:'https://firestore.test/db',projectId:'test',accessToken:async()=> 'access',verifyAdmin:async()=>{if(!authorized)throw Object.assign(Error('forbidden'),{status:403});},send:(res,status,body)=>Object.assign(res,{status,body}),fail:(m,status)=>Object.assign(Error(m),{status}),decodeFields:x=>x,normalizeNickname:x=>String(x||''),validNickname:x=>!!x,now:()=>time,fetch:async(url,opt)=>{
   const u=new URL(url);
   if(u.hostname==='identitytoolkit.googleapis.com'){
     authReads++;assert.equal(u.searchParams.get('maxResults'),'10');
     const offset=u.searchParams.get('nextPageToken')==='next'?10:0;
     return {ok:true,json:async()=>({users:Array.from({length:10},(_,i)=>({localId:'u'+(i+offset),email:'must-not-leak@example.test'})),nextPageToken:offset?'':'next'})};
   }
   if(u.pathname.endsWith('documents:batchGet')){
     const docs=JSON.parse(opt.body).documents;reads+=docs.length;assert.equal(docs.length,8);assert.ok(docs.every(d=>d.includes('/users/u0/apps/')));
     return {ok:true,json:async()=>docs.map(name=>({found:{name,fields:{coins:7,submissions:2}}}))};
   }
   reads++;assert.deepEqual(u.searchParams.getAll('mask.fieldPaths'),['nickname','coins']);
   return {ok:true,json:async()=>({fields:{nickname:'Test',coins:7}})};
 }});
 return {api,call:async url=>{const res={};await api.handle({method:'GET',url},res);return res;},get reads(){return reads;},get authReads(){return authReads;},advance:()=>time+=61000,deny:()=>authorized=false};
}
test('10-person server pagination; 20 refreshes reuse cache; concurrent requests coalesce',async()=>{
 const f=fixture();const results=await Promise.all(Array.from({length:20},()=>f.call('/api/admin/users?limit=10')));
 assert.ok(results.every(r=>r.status===200&&r.body.users.length===10));assert.equal(f.reads,10);assert.equal(f.authReads,1);
 assert.ok(results[0].body.users.every(u=>!('apps'in u)&&!('email'in u)));
 await f.call('/api/admin/users?limit=10&pageToken=next');assert.equal(f.reads,20);
 f.advance();await f.call('/api/admin/users?limit=10');assert.equal(f.reads,30);
 assert.equal((await f.call('/api/admin/users?limit=100')).status,400);
});
test('session check reads zero Firestore docs; cached responses still require admin',async()=>{
 const f=fixture();await f.call('/api/admin/session');assert.equal(f.reads,0);assert.equal(f.authReads,0);
 await f.call('/api/admin/users');f.deny();assert.equal((await f.call('/api/admin/users')).status,403);assert.equal(f.reads,10);
});
test('single-user detail is lazy, cached, and coin updates patch only that user',async()=>{
 const f=fixture();await f.call('/api/admin/users');assert.equal(f.reads,10);
 const detail=await f.call('/api/admin/user?uid=u0');assert.equal(f.reads,18);assert.equal(Object.keys(detail.body.apps).length,8);
 await f.call('/api/admin/user?uid=u0');assert.equal(f.reads,18);
 f.api.updateCoins('u0',107);const page=await f.call('/api/admin/users');assert.equal(page.body.users[0].coins,107);assert.equal(page.body.users[1].coins,7);
 assert.equal((await f.call('/api/admin/user?uid=u0')).body.apps['english-playroom'].coins,107);assert.equal(f.reads,18);
 assert.equal((await f.call('/api/admin/user?uid=bad%2Fpath')).status,400);
});
