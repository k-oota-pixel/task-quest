import test from 'node:test';
import assert from 'node:assert/strict';
import {createLearningTitles} from './learning-titles.mjs';
import {createTitleEvents} from './creative-title-events.mjs';
import {createLearningActivity} from './learning-activity.mjs';
import {creativeTitleCount,titleCountTransforms} from './title-count-summary.mjs';
import {fixtureTitleAuthority,titleAuthority} from './title-authority.mjs';
const prefix='projects/p/databases/(default)/documents/';
const fail=(message,status)=>Object.assign(Error(message),{status});
const send=(r,status,body)=>Object.assign(r,{status,body});
const decode=v=>v.mapValue?Object.fromEntries(Object.entries(v.mapValue.fields).map(([k,x])=>[k,decode(x)])):v.arrayValue?(v.arrayValue.values||[]).map(decode):v.integerValue!==undefined?Number(v.integerValue):v.booleanValue!==undefined?v.booleanValue:v.stringValue;
function summaryHarness(wallet={},options={}){
 let writes=0,walletVersion=0,reads=0,batches=0;
 const api=createLearningTitles({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async()=>({uid:'u'}),decodeFields:x=>x,readJson:async()=>({}),fail,send,fetch:async(url,opt={})=>{
  if(!opt.method){reads++;return {ok:true,json:async()=>({fields:structuredClone(wallet),updateTime:String(walletVersion)})};}
  if(url.endsWith(':batchGet')){
   batches++;
      const batch=JSON.parse(opt.body);
   if(batch.documents.length>1)assert.deepEqual(batch.newTransaction,{readOnly:{}});
   const snapshotVersion=String(walletVersion);
   const documents=[['users/u/apps/english-playroom',structuredClone(wallet)],['user_titles/u',{selectedId:''}],['users/u/apps/eiken-retry',options.retry||{}],['title_progress/u/activities/word-breaker',{metrics:{runs:1}}]];
   if(options.afterSnapshot?.(wallet))walletVersion++;
   return {ok:true,json:async()=>documents.map(([name,fields])=>({found:{name:prefix+name,fields,updateTime:snapshotVersion}}))};
  }
  if(opt.method==='PATCH'){
   if(options.failPatch)return {ok:false};
   if(new URL(url).searchParams.get('currentDocument.updateTime')!==String(walletVersion))return {ok:false,status:412};
   const fields=JSON.parse(opt.body).fields;writes++;
   assert.equal(Object.hasOwn(fields,'titleCountRevision'),false);
   for(const [k,v] of Object.entries(fields))wallet[k]=decode(v);
   walletVersion++;
   return {ok:true};
  }
  if(url.endsWith(':commit')){
   const write=JSON.parse(opt.body).writes[0];
   assert.equal(write.update.name,prefix+'users/u/apps/english-playroom');
   wallet.titleCountRevision=(wallet.titleCountRevision||0)+1;
   const added=write.updateTransforms.find(transform=>transform.fieldPath==='earnedTitleIds')?.appendMissingElements.values.map(decode)||[];
   wallet.earnedTitleIds=[...new Set([...(wallet.earnedTitleIds||[]),...added])];writes++;return {ok:true};
  }
  throw Error(url);
 }});
 return {api,wallet,get writes(){return writes;},get reads(){return reads;},get batches(){return batches;}};
}
test('legacy summary is migrated; unchanged full reads do not write the wallet again',async()=>{
 const h=summaryHarness({unlockedTitleCount:0});
 const state=await h.api.read('u');
 assert.ok(state.unlockedTitleCount>0);
 assert.equal(h.wallet.unlockedTitleCount,state.unlockedTitleCount);
 assert.equal(h.wallet.titleCountSummaryVersion,1);assert.equal(h.wallet.titleCountSyncedRevision,0);
 assert.equal(h.wallet.titleCollectionVersion,1);assert.equal(h.batches,1);
 assert.equal(h.writes,1);await h.api.read('u');assert.equal(h.writes,1);
 assert.equal(h.reads,2);assert.equal(h.batches,1);
});
test('a concurrent award prevents an older full read from overwriting the wallet',async()=>{
 let awarded=false;
 const h=summaryHarness({titleCountRevision:7},{afterSnapshot:wallet=>{
  if(awarded)return false;
  awarded=true;wallet.titleCountRevision++;return true;
 }});
 await h.api.read('u');
 assert.equal(h.wallet.titleCountSyncedRevision,8);
 assert.equal(h.wallet.titleCountRevision,8);
 assert.equal(h.writes,1);
});
test('failed summary persistence is reported rather than presenting unsaved points',async()=>{
 const h=summaryHarness({},{failPatch:true});
 await assert.rejects(()=>h.api.read('u'),/集約情報/);
});
test('empty notebook history does not write a title record',async()=>{
 const h=summaryHarness({titleCountRevision:2});
 const r={};await h.api.handle({method:'GET',url:'/api/learning/titles?view=retry'},r);
 assert.equal(r.status,200);assert.equal(h.wallet.titleCountRevision,2);assert.equal(h.writes,0);
});
test('signed awards and selection cannot be forged or transferred between users',async()=>{
 const authority=titleAuthority('secret');
 const token=authority.award('u','weekly:coins');
 assert.equal(authority.verifyAward('u',token),'weekly:coins');
 assert.equal(authority.verifyAward('other',token),'');
 assert.equal(authority.verifyAward('u',token.replace('coins','ateru')),'');
 assert.equal(authority.verifySelection('u',{selectedTitleId:'weekly:coins',selectedTitleProof:authority.selection('u','weekly:ateru')}),false);
});
test('migrated title listing ignores forged awards and uses one wallet read',async()=>{
 const authority=await fixtureTitleAuthority();
 const wallet={titleCollectionVersion:1,titleCollectionProof:authority.marker('u'),
  earnedTitleIds:[authority.award('u','weekly:coins'),authority.award('other','weekly:ateru'),'weekly:today|forged'],
  selectedTitleId:'weekly:coins',selectedTitleProof:authority.selection('u','weekly:coins')};
 const h=summaryHarness(wallet);
 const result=await h.api.read('u');
 assert.equal(result.unlockedTitleCount,1);
 assert.equal(result.selectedId,'weekly:coins');
 assert.equal(h.reads,1);assert.equal(h.batches,0);assert.equal(h.writes,0);
});
test('creative acquisitions count atomically; duplicates and unchanged repeats do not add writes',async()=>{
 const docs=new Map();let body={appId:'word-breaker',eventId:'event-0001',kind:'run',course:'basic',score:10,combo:5},walletWrites=0,version=0;
 const api=createTitleEvents({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async()=>({uid:'u'}),decodeFields:fields=>decode({mapValue:{fields}}),readJson:async()=>body,fail,send,fetch:async(url,opt)=>{
  if(opt.method!=='POST')return {ok:false,status:404};const b=JSON.parse(opt.body);
  if(url.endsWith(':batchGet'))return {ok:true,json:async()=>b.documents.map(name=>docs.has(name)?{found:docs.get(name)}:{missing:name})};
  const invalidations=b.writes.filter(w=>w.update.name.endsWith('/apps/english-playroom'));
  walletWrites+=invalidations.length;
  for(const w of invalidations){
   assert.deepEqual(w.updateTransforms.map(x=>x.fieldPath),['unlockedTitleCount','titleCountRevision','titleCountSyncedRevision','earnedTitleIds']);
   assert.ok(Number(w.updateTransforms[0].increment.integerValue)>0);
   assert.ok(w.updateTransforms.at(-1).appendMissingElements.values.every(value=>value.stringValue.includes('|')));
   assert.deepEqual(w.updateMask.fieldPaths,[]);
  }
  for(const w of b.writes)docs.set(w.update.name,{...w.update,updateTime:String(++version)});
  return {ok:true};
 }});
 let r={};await api({method:'POST'},r);assert.equal(r.status,200);assert.ok(r.body.freshTitles.length);assert.equal(walletWrites,1);
 r={};await api({method:'POST'},r);assert.equal(r.body.duplicate,true);assert.equal(walletWrites,1);
 body={...body,eventId:'event-0002'};r={};await api({method:'POST'},r);assert.equal(r.status,200);assert.equal(r.body.freshTitles.length,0);assert.equal(walletWrites,1);
 body={appId:'ateru',batchId:'batch-0001',events:[{eventId:'event-0003',kind:'run',score:5}]};r={};await api({method:'POST'},r);assert.equal(r.status,200);assert.ok(r.body.freshTitles.length);assert.equal(walletWrites,2);
 r={};await api({method:'POST'},r);assert.equal(r.body.duplicate,true);assert.equal(walletWrites,2);
});
test('retry writes a signed title only at a milestone and other activities add no wallet write',async()=>{
 for(const appId of ['eiken-retry','ateru']){
  let commits=0;
  const api=createLearningActivity({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async()=>({uid:'u'}),readJson:async()=>({batchId:'batch-0001',events:[{appId,eventId:'event-0001'}]}),invalidate(){},fail,send,fetch:async(url,opt)=>{
   commits++;const writes=JSON.parse(opt.body).writes;
   if(commits===2)assert.equal(writes[0].updateTransforms[0].appendMissingElements.values.length,1);
   else assert.equal(writes.filter(w=>w.update.name.endsWith('/apps/english-playroom')).length,0);
   return {ok:true,json:async()=>({writeResults:[{}, {transformResults:[{},{},{integerValue:'1'}]}]})};
  }});
  const r={};await api({method:'POST',headers:{'content-type':'application/json'}},r);assert.equal(r.status,200);assert.equal(commits,appId==='eiken-retry'?2:1);
 }
});

test('exact awards include the master title and preserve the revision gap',()=>{
 const before=[{id:'creative:ateru:1',appId:'ateru',unlocked:true},{id:'creative:ateru:2',appId:'ateru',unlocked:false}];
 const after=before.map(title=>({...title,unlocked:true}));
 const delta=creativeTitleCount('ateru',after)-creativeTitleCount('ateru',before);
 assert.equal(delta,2);
 for(const [revision,synced] of [[9,9],[9,7]]){
  const wallet={titleCountRevision:revision,titleCountSyncedRevision:synced,unlockedTitleCount:8};
  for(const {fieldPath,increment} of titleCountTransforms(delta))wallet[fieldPath]+=Number(increment.integerValue);
  assert.equal(wallet.unlockedTitleCount,10);
  assert.equal(wallet.titleCountRevision-wallet.titleCountSyncedRevision,revision-synced);
 }
 assert.deepEqual(titleCountTransforms(0),[]);
});
