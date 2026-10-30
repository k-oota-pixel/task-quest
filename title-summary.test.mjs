import test from 'node:test';
import assert from 'node:assert/strict';
import {createLearningTitles} from './learning-titles.mjs';
import {createTitleEvents} from './creative-title-events.mjs';
import {createLearningActivity} from './learning-activity.mjs';
const prefix='projects/p/databases/(default)/documents/';
const fail=(message,status)=>Object.assign(Error(message),{status});
const send=(r,status,body)=>Object.assign(r,{status,body});
const decode=v=>v.mapValue?Object.fromEntries(Object.entries(v.mapValue.fields).map(([k,x])=>[k,decode(x)])):v.arrayValue?(v.arrayValue.values||[]).map(decode):v.integerValue!==undefined?Number(v.integerValue):v.booleanValue!==undefined?v.booleanValue:v.stringValue;
function summaryHarness(wallet={},options={}){
 let writes=0;
 const api=createLearningTitles({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async()=>({uid:'u'}),decodeFields:x=>x,readJson:async()=>({}),fail,send,fetch:async(url,opt={})=>{
  if(url.endsWith(':batchGet')){
   const documents=[['users/u/apps/english-playroom',structuredClone(wallet)],['user_titles/u',{selectedId:''}],['title_progress/u/activities/word-breaker',{metrics:{runs:1}}]];
   options.afterSnapshot?.(wallet);
   return {ok:true,json:async()=>documents.map(([name,fields])=>({found:{name:prefix+name,fields}}))};
  }
  if(opt.method==='PATCH'){
   if(options.failPatch)return {ok:false};
   const fields=JSON.parse(opt.body).fields;writes++;
   assert.equal(Object.hasOwn(fields,'titleCountRevision'),false);
   for(const [k,v] of Object.entries(fields))wallet[k]=decode(v);
   return {ok:true};
  }
  if(url.endsWith(':commit')){
   const write=JSON.parse(opt.body).writes[0];
   assert.equal(write.update.name,prefix+'users/u/apps/english-playroom');
   wallet.titleCountRevision=(wallet.titleCountRevision||0)+1;return {ok:true};
  }
  throw Error(url);
 }});
 return {api,wallet,get writes(){return writes;}};
}
test('legacy summary is migrated; unchanged full reads do not write the wallet again',async()=>{
 const h=summaryHarness({unlockedTitleCount:0});
 const state=await h.api.read('u');
 assert.ok(state.unlockedTitleCount>0);
 assert.equal(h.wallet.unlockedTitleCount,state.unlockedTitleCount);
 assert.equal(h.wallet.titleCountSummaryVersion,1);assert.equal(h.wallet.titleCountSyncedRevision,0);
 assert.equal(h.writes,1);await h.api.read('u');assert.equal(h.writes,1);
});
test('a concurrent acquisition remains dirty instead of being cleared by an older full read',async()=>{
 const h=summaryHarness({titleCountRevision:7},{afterSnapshot:wallet=>wallet.titleCountRevision++});
 await h.api.read('u');
 assert.equal(h.wallet.titleCountSyncedRevision,7);
 assert.equal(h.wallet.titleCountRevision,8);
});
test('failed summary persistence is reported rather than presenting unsaved points',async()=>{
 const h=summaryHarness({},{failPatch:true});
 await assert.rejects(()=>h.api.read('u'),/集約情報/);
});
test('notebook cloud-save view invalidates the saved count after reading the saved history',async()=>{
 const h=summaryHarness({titleCountRevision:2});
 const r={};await h.api.handle({method:'GET',url:'/api/learning/titles?view=retry'},r);
 assert.equal(r.status,200);assert.equal(h.wallet.titleCountRevision,3);
});
test('creative acquisitions invalidate atomically, duplicates and unchanged repeats do not add writes',async()=>{
 const docs=new Map();let body={appId:'word-breaker',eventId:'event-0001',kind:'run',course:'basic',score:10,combo:5},walletWrites=0,version=0;
 const api=createTitleEvents({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async()=>({uid:'u'}),decodeFields:fields=>decode({mapValue:{fields}}),readJson:async()=>body,fail,send,fetch:async(url,opt)=>{
  const b=JSON.parse(opt.body);
  if(url.endsWith(':batchGet'))return {ok:true,json:async()=>b.documents.map(name=>docs.has(name)?{found:docs.get(name)}:{missing:name})};
  const invalidations=b.writes.filter(w=>w.update.name.endsWith('/apps/english-playroom'));
  walletWrites+=invalidations.length;
  for(const w of invalidations){assert.equal(w.updateTransforms[0].fieldPath,'titleCountRevision');assert.equal(w.updateTransforms[0].increment.integerValue,'1');assert.deepEqual(w.updateMask.fieldPaths,[]);}
  for(const w of b.writes)docs.set(w.update.name,{...w.update,updateTime:String(++version)});
  return {ok:true};
 }});
 let r={};await api({method:'POST'},r);assert.equal(r.status,200);assert.ok(r.body.freshTitles.length);assert.equal(walletWrites,1);
 r={};await api({method:'POST'},r);assert.equal(r.body.duplicate,true);assert.equal(walletWrites,1);
 body={...body,eventId:'event-0002'};r={};await api({method:'POST'},r);assert.equal(r.status,200);assert.equal(r.body.freshTitles.length,0);assert.equal(walletWrites,1);
 body={appId:'ateru',batchId:'batch-0001',events:[{eventId:'event-0003',kind:'run',score:5}]};r={};await api({method:'POST'},r);assert.equal(r.status,200);assert.ok(r.body.freshTitles.length);assert.equal(walletWrites,2);
 r={};await api({method:'POST'},r);assert.equal(r.body.duplicate,true);assert.equal(walletWrites,2);
});
test('retry activity invalidation shares the existing atomic batch, other activity adds no wallet write',async()=>{
 for(const appId of ['eiken-retry','ateru']){
  let commits=0;
  const api=createLearningActivity({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async()=>({uid:'u'}),readJson:async()=>({batchId:'batch-0001',events:[{appId,eventId:'event-0001'}]}),invalidate(){},fail,send,fetch:async(url,opt)=>{
   commits++;const writes=JSON.parse(opt.body).writes;
   assert.equal(writes.filter(w=>w.update.name.endsWith('/apps/english-playroom')).length,appId==='eiken-retry'?1:0);
   return {ok:true,json:async()=>({})};
  }});
  const r={};await api({method:'POST',headers:{'content-type':'application/json'}},r);assert.equal(r.status,200);assert.equal(commits,1);
 }
});
