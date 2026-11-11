import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminData} from './admin-data.mjs';
function fixture(verifyDetailAdmin){
 let time=100000,summaries=0,queries=0,codeQueries=0,codeRequested=0,authReads=0,details=0,authorized=true;
 const stamp=i=>new Date(1700000000000+i*1000).toISOString();
 const records=Array.from({length:20},(_,i)=>({name:'projects/test/databases/(default)/documents/learning_activity/u'+i,fields:{uid:'u'+i,lastLearningAt:stamp(i)}})).reverse();
 const api=createAdminData({base:'https://firestore.test/db',projectId:'test',accessToken:async()=> 'access',verifyAdmin:async()=>{if(!authorized)throw Object.assign(Error('forbidden'),{status:403});},verifyDetailAdmin,send:(res,status,body)=>Object.assign(res,{status,body}),fail:(m,status)=>Object.assign(Error(m),{status}),decodeFields:x=>x,normalizeNickname:x=>String(x||''),validNickname:x=>!!x,now:()=>time,fetch:async(url,opt)=>{
  const u=new URL(url);
  if(u.hostname==='identitytoolkit.googleapis.com'){authReads++;return {ok:true,json:async()=>({users:Array.from({length:22},(_,i)=>({localId:'u'+i,email:'private',lastLoginAt:String(3000-i),createdAt:String(1000-i)}))})};}
  if(u.pathname.endsWith('documents:runQuery')){
   const q=JSON.parse(opt.body).structuredQuery;
   if(q.from[0].collectionId==='code_accounts'){
    if(q.where?.fieldFilter?.op!=='IN')return {ok:true,json:async()=>[]};
    const ids=q.where.fieldFilter.value.arrayValue.values.map(value=>value.stringValue);codeQueries++;codeRequested+=ids.length;assert.ok(ids.length<=6);assert.equal(q.limit,ids.length);
    return {ok:true,json:async()=>ids.map(uid=>({document:{name:'projects/test/databases/(default)/documents/code_accounts/'+uid,fields:{uid,loginId:'id-'+uid,codeName:'code-'+uid}}}))};
   }
   if(q.from[0].collectionId==='apps'){queries++;assert.equal(q.where.fieldFilter.field.fieldPath,'petName');assert.equal(q.where.fieldFilter.op,'EQUAL');assert.equal(q.limit,100);return {ok:true,json:async()=>[{document:{name:'projects/test/databases/(default)/documents/users/u3/apps/english-playroom',fields:{petName:'Fluffy'}}}]};}
   queries++;assert.equal(q.from[0].collectionId,'learning_activity');let rows=records;if(!q.select){assert.equal(q.limit,7);assert.equal(q.orderBy[0].field.fieldPath,'lastLearningAt');assert.equal(q.orderBy[0].direction,'DESCENDING');if(q.startAt)rows=rows.filter(r=>r.fields.lastLearningAt<q.startAt.values[0].timestampValue);rows=rows.slice(0,q.limit);}return {ok:true,json:async()=>rows.map(document=>({document}))};
  }
  if(u.pathname.endsWith('documents:batchGet')){details++;const names=JSON.parse(opt.body).documents;assert.equal(names.length,9);return {ok:true,json:async()=>names.map(name=>({found:{name,fields:name.includes('/learning_activity/')?{contents:{'listening-training':{lastLearningAt:stamp(1)}}}:{coins:7,submissions:2}}}))};}
  if(u.pathname.includes('/learning_activity/'))return {ok:true,json:async()=>({fields:{lastLearningAt:stamp(Number(u.pathname.split('/').at(-1).slice(1)))}})};
  if(u.pathname.endsWith('/nickname_registry'))return {ok:true,json:async()=>({documents:[{fields:{uid:'u0',nickname:'Test u0'}}]})};
  summaries++;assert.deepEqual(u.searchParams.getAll('mask.fieldPaths'),['nickname','petName','coins']);return {ok:true,json:async()=>({fields:{nickname:'Test '+u.pathname.split('/')[4],petName:'Pet',coins:7}})};
 }});
 return {api,call:async url=>{const res={};await api.handle({method:'GET',url},res);return res;},stats:()=>({summaries,queries,codeQueries,codeRequested,authReads,details}),advance:()=>time+=61000,deny:()=>authorized=false};
}
test('global learning order wins over authentication time; paging only reads identity rows for the visible six users',async()=>{
 const f=fixture(),results=await Promise.all(Array.from({length:20},()=>f.call('/api/admin/users?limit=6')));
 assert.ok(results.every(r=>r.status===200&&r.body.users.length===6));assert.deepEqual(results[0].body.users.map(u=>u.uid),Array.from({length:6},(_,i)=>'u'+(19-i)));
 assert.deepEqual(f.stats(),{summaries:6,queries:1,codeQueries:1,codeRequested:6,authReads:0,details:0});
 assert.ok(results[0].body.users.every(u=>u.petName==='Pet'&&u.coins===7&&u.lastLearningAt&&!('lastLoginAt'in u)&&!('email'in u)&&!('apps'in u)&&u.loginId==='id-'+u.uid&&u.codeName==='code-'+u.uid));
 const second=await f.call('/api/admin/users?pageToken='+encodeURIComponent(results[0].body.nextPageToken));assert.deepEqual(second.body.users.map(u=>u.uid),Array.from({length:6},(_,i)=>'u'+(13-i)));
 const third=await f.call('/api/admin/users?pageToken='+encodeURIComponent(second.body.nextPageToken));assert.deepEqual(third.body.users.map(u=>u.uid),Array.from({length:6},(_,i)=>'u'+(7-i)));
 const fourth=await f.call('/api/admin/users?pageToken='+encodeURIComponent(third.body.nextPageToken));assert.deepEqual(fourth.body.users.map(u=>u.uid),['u1','u0','u20','u21']);assert.deepEqual(fourth.body.users.map(u=>u.lastLearningAt),[1700000001000,1700000000000,null,null]);assert.equal(fourth.body.nextPageToken,null);
 assert.deepEqual({codeQueries:f.stats().codeQueries,codeRequested:f.stats().codeRequested},{codeQueries:4,codeRequested:22});
 assert.equal((await f.call('/api/admin/users?limit=100')).status,400);assert.equal((await f.call('/api/admin/users?pageToken=bad')).status,400);
});
test('session check has no Firestore reads; cached lists still require admin authorization',async()=>{
 const f=fixture();await f.call('/api/admin/session');assert.deepEqual(f.stats(),{summaries:0,queries:0,codeQueries:0,codeRequested:0,authReads:0,details:0});await f.call('/api/admin/users');f.deny();assert.equal((await f.call('/api/admin/users')).status,403);
});
test('details remain lazy and cached; coin updates preserve names and learning times',async()=>{
 const f=fixture(),page=await f.call('/api/admin/users'),at=page.body.users[0].lastLearningAt;assert.equal(f.stats().details,0);
 const detail=await f.call('/api/admin/user?uid=u19');assert.ok(detail.body.activity.contents['listening-training'].lastLearningAt);assert.equal(Object.keys(detail.body.apps).length,8);await f.call('/api/admin/user?uid=u19');assert.equal(f.stats().details,1);
 f.api.updateCoins('u19',107);const updated=await f.call('/api/admin/users');assert.equal(updated.body.users[0].coins,107);assert.equal(updated.body.users[0].petName,'Pet');assert.equal(updated.body.users[0].lastLearningAt,at);
 f.api.invalidateLearning('u0');await f.call('/api/admin/users');assert.equal(f.stats().queries,2,'a newly active learner invalidates ordering even if previously on a different page');assert.equal(f.stats().codeQueries,1,'same visible identities remain cached independently from learning-order refreshes');
});

test('admin search resolves UIDs without extra scans and pet names with a bounded exact-match query',async()=>{
 const f=fixture();
 const uid=await f.call('/api/admin/users?search=u19');
 assert.equal(uid.status,200);assert.deepEqual(uid.body.users.map(u=>u.uid),['u19']);
 const before=f.stats().queries;
 const pet=await f.call('/api/admin/users?search=Fluffy');
 assert.equal(pet.status,200);assert.deepEqual(pet.body.users.map(u=>u.uid),['u3']);
 assert.equal(f.stats().queries,before+1,'one targeted pet-name collection-group query');
 await f.call('/api/admin/users?search=Fluffy');
 assert.equal(f.stats().queries,before+1,'pet-name query is cached for repeated searches');
});


test('compact recent-user list reads only learning activity, never six profiles or code records',async()=>{
 const f=fixture();
 const first=await f.call('/api/admin/users?limit=6&compact=1');
 assert.equal(first.status,200);
 assert.deepEqual(first.body.users.map(row=>row.uid),['u19','u18','u17','u16','u15','u14']);
 assert.ok(first.body.users.every(row=>!('coins' in row)&&!('nickname' in row)&&!('petName' in row)&&!('codeName' in row)));
 assert.deepEqual(f.stats(),{summaries:0,queries:1,codeQueries:0,codeRequested:0,authReads:0,details:0});
 const next=await f.call('/api/admin/users?limit=6&compact=1&pageToken='+encodeURIComponent(first.body.nextPageToken));
 assert.equal(next.status,200);assert.equal(next.body.users.length,6);
 assert.deepEqual(f.stats(),{summaries:0,queries:2,codeQueries:0,codeRequested:0,authReads:0,details:0});
 await f.call('/api/admin/users?limit=6&compact=1');
 assert.equal(f.stats().queries,2,'cached compact page avoids repeated Firebase reads');
});

test('user detail uses its own admin verifier even when cached',async()=>{
 let detailAuthorized=true;
 const f=fixture(async()=>{
  if(!detailAuthorized)throw Object.assign(Error('forbidden'),{status:403});
 });
 f.deny();
 assert.equal((await f.call('/api/admin/users')).status,403);
 assert.equal((await f.call('/api/admin/user?uid=u0')).status,200);
 assert.equal(f.stats().details,1);
 detailAuthorized=false;
 assert.equal((await f.call('/api/admin/user?uid=u0')).status,403);
 assert.equal(f.stats().details,1);
});
