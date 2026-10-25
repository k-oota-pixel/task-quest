import test from 'node:test';import assert from 'node:assert/strict';
import {createAdminPetNameReset} from './admin-pet-name-reset.mjs';
function fixture({denied=false,conflicts=0,hatched=true}={}){
 const writes=[],invalidated=[];let reads=0;
 const fail=(m,status)=>Object.assign(new Error(m),{status});
 const handle=createAdminPetNameReset({base:'https://firestore.test',projectId:'fixture',verifyAdmin:async()=>{if(denied)throw fail('Forbidden',403);return {uid:'admin'};},accessToken:async()=>'fixture',readJson:async req=>req.body,send:(r,status,body)=>Object.assign(r,{status,body}),fail,invalidate:uid=>invalidated.push(uid),fetchImpl:async(url,options)=>{
  if(!url.endsWith(':commit')){reads++;return {ok:true,json:async()=>({updateTime:'v'+reads,fields:{petHatched:{booleanValue:hatched},petGeneration:{integerValue:'3'}}})};}
  writes.push(JSON.parse(options.body));return writes.length<=conflicts?{ok:false,status:409,json:async()=>({})}:{ok:true};
 }});
 return {writes,invalidated,get reads(){return reads;},call:async(body={uid:'learner'},method='POST')=>{const res={};await handle({method,headers:{'content-type':'application/json'},body},res);return res;}};
}
test('admin reset changes only pet name and reset notice, preserves coins and pet state',async()=>{
 const f=fixture(),r=await f.call();assert.equal(r.status,200);
 const w=f.writes[0].writes[0];assert.deepEqual(w.updateMask.fieldPaths,['petName','petNameResetGeneration']);
 assert.deepEqual(w.update.fields,{petName:{nullValue:null},petNameResetGeneration:{integerValue:'3'}});
 assert.deepEqual(w.currentDocument,{updateTime:'v1'});assert.deepEqual(f.invalidated,['learner']);
 assert.ok(w.update.name.endsWith('/users/learner/apps/english-playroom'));
});
test('authorization, method and target checks prevent writes',async()=>{
 const denied=fixture({denied:true});assert.equal((await denied.call()).status,403);assert.equal(denied.reads,0);
 const f=fixture();for(const uid of ['', '../other','a/b','a?x','a#x','a%2fb',null])assert.equal((await f.call({uid})).status,400);
 assert.equal((await f.call({uid:'learner'},'GET')).status,405);assert.equal(f.reads,0);assert.equal(f.writes.length,0);
 const egg=fixture({hatched:false});assert.equal((await egg.call()).status,400);assert.equal(egg.writes.length,0);
});
test('concurrent changes retry with fresh precondition and stop after three conflicts',async()=>{
 const f=fixture({conflicts:1});assert.equal((await f.call()).status,200);assert.equal(f.writes.length,2);assert.equal(f.writes[1].writes[0].currentDocument.updateTime,'v2');
 const blocked=fixture({conflicts:5});assert.equal((await blocked.call()).status,409);assert.equal(blocked.writes.length,3);assert.equal(blocked.invalidated.length,0);
});
