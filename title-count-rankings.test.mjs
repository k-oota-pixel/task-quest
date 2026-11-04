import test from 'node:test';
import assert from 'node:assert/strict';
import {createTitleCountRankings,topTitleCounts} from './title-count-rankings.mjs';

const fail=(message,status)=>Object.assign(Error(message),{status});
const decode=value=>value?.mapValue?Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([k,v])=>[k,decode(v)])):value?.arrayValue?(value.arrayValue.values||[]).map(decode):value?.integerValue!==undefined?Number(value.integerValue):value?.stringValue!==undefined?value.stringValue:value;
test('sort title counts and deduplicate users',()=>{
 const rows=topTitleCounts([{uid:'a',petName:'A',unlockedTitleCount:3},{uid:'a',petName:'A',unlockedTitleCount:5},{uid:'b',petName:'B',unlockedTitleCount:4},{uid:'c',petName:'C',unlockedTitleCount:2},{uid:'d',petName:'D',unlockedTitleCount:1}]);
 assert.deepEqual(rows.map(row=>[row.uid,row.unlockedTitleCount]),[['a',5],['b',4],['c',2]]);
});
test('first lookup creates a durable summary; later viewers use cache with no Firestore reads',async()=>{
 const wallet=new Map([['a',{petName:'あ',unlockedTitleCount:10}],['b',{petName:'び',unlockedTitleCount:8}],['c',{petName:'し',unlockedTitleCount:6}],['admin',{petName:'管理者',unlockedTitleCount:999}]]);
 let stored=null,version=0,reads=0,batchReads=0,writes=0;
 const cache=new Map();
 const rankingStore={
  getSection:async(key,{load,valid})=>{let v=cache.get(key);if(!v||!valid(v)){v=await load();cache.set(key,v);}return structuredClone(v);},
  setSection:async(key,v)=>{cache.set(key,structuredClone(v));return structuredClone(v);}
 };
 const request=async(url,options={})=>{
  if(String(url).includes('/documents/leaderboards/titleCounts')){
   if(options.method==='PATCH'){
    const u=new URL(url);
    if(stored&&(u.searchParams.get('currentDocument.updateTime')!==stored.updateTime))return {ok:false,status:412,json:async()=>({})};
    if(!stored&&u.searchParams.get('currentDocument.exists')!=='false')return {ok:false,status:412,json:async()=>({})};
    writes++;stored={fields:JSON.parse(options.body).fields,updateTime:String(++version)};
    return {ok:true,status:200,json:async()=>({updateTime:stored.updateTime})};
   }
   reads++;return stored?{ok:true,status:200,json:async()=>stored}:{ok:false,status:404,json:async()=>({})};
  }
  if(String(url).endsWith('/documents:batchGet')){
   batchReads++;
   const body=JSON.parse(options.body);
   return {ok:true,status:200,json:async()=>body.documents.map(name=>{
    const uid=decodeURIComponent(name.split('/users/')[1].split('/apps/')[0]),w=wallet.get(uid);
    return {found:{name,fields:{petName:{stringValue:w.petName},unlockedTitleCount:{integerValue:String(w.unlockedTitleCount)}}}};
   })};
  }
  throw Error('Unexpected URL '+url);
 };
 const api=createTitleCountRankings({
  base:'https://example.com/v1/projects/p/databases/(default)',projectId:'p',accessToken:async()=>'token',
  activeIds:async()=>['a','b','c','admin'],excludedIds:async()=>['admin'],
  decodeFields:fields=>Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,decode(v)])),
  verifyUser:async()=>({uid:'a'}),send:(r,status,body)=>Object.assign(r,{status,body}),fail,
  fetch:request,rankingStore,now:()=>1_000_000
 });
 const first=await api.snapshot();
 assert.deepEqual(first.leaders.map(x=>x.petName),['あ','び','し']);
 assert.equal(first.leaders.some(x=>x.uid),false);
 assert.equal(writes,1);assert.equal(reads,1);assert.equal(batchReads,1);
 const again=await api.snapshot();assert.deepEqual(again,first);
 assert.equal(reads,1);assert.equal(batchReads,1);
 const changed=await api.publish({uid:'c',petName:'し',unlockedTitleCount:11});
 assert.equal(changed,true);assert.equal(writes,2);
 const after=await api.snapshot();assert.equal(after.leaders[0].petName,'し');
 assert.equal(reads,1);assert.equal(batchReads,1);
 assert.equal(await api.publish({uid:'c',petName:'し',unlockedTitleCount:11}),false);
 assert.equal(writes,2);
 const response={};await api.handle({method:'GET'},response);
 assert.equal(response.status,200);assert.equal(reads,1);assert.equal(response.body.leaders[0].unlockedTitleCount,11);
});
