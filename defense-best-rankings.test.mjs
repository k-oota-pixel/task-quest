import test from 'node:test';
import assert from 'node:assert/strict';
import {defenseTopThree,createDefenseBestRankings} from './defense-best-rankings.mjs';
const send=(res,status,body)=>Object.assign(res,{status,body});
const fail=(message,status)=>Object.assign(Error(message),{status});
const directStore=()=>{let value;return {async getSection(_key,{load,valid}){if(!value||!valid(value))value=await load();return value;},async setSection(_key,next){value=next;}};};

test('best stages keep every tie at rank three and mark a completed final stage',()=>{
 const rows=defenseTopThree([
  {uid:'a',floor:5,petName:'A'},{uid:'b',floor:5,petName:'B'},
  {uid:'c',floor:3,petName:'C'},{uid:'d',floor:3,petName:'D'},
  {uid:'e',floor:2,petName:'E'}]);
 assert.deepEqual(rows.map(x=>[x.uid,x.floor,x.rank,x.cleared===true]),
  [['a',5,1,true],['b',5,1,true],['c',3,3,false],['d',3,3,false]]);
});

test('legacy daily stage counts seed best records once and a saved stage updates shared file',async()=>{
 const prefix='projects/p/databases/(default)/documents/';
 let batchReads=0,activityReads=0,walletReads=0;
 const records={
  a:{dailyCounts:{'2026-11-06':{'pet-typing-defense-normal':5}},typingDefenseBestHard:1,typingDefenseBestEasy:2},
  b:{typingDefenseBestNormal:5,typingDefenseBestHard:4,typingDefenseBestEasy:4},
  c:{dailyCounts:{'2026-11-07':{'pet-typing-defense-normal':3}},typingDefenseBestHard:2},
  d:{typingDefenseBestNormal:1,typingDefenseBestEasy:3}
 };
 const api=createDefenseBestRankings({
  base:'https://firestore.googleapis.com/v1/projects/p/databases/(default)',projectId:'p',
  accessToken:async()=>'token',activeIds:async()=>Object.keys(records),excludedIds:async()=>[],
  decodeFields:x=>x,send,fail,rankingStore:directStore(),
  decorate:async rows=>rows.map(({uid,...row})=>({...row,title:'称号 '+uid})),
  fetch:async(url,opts={})=>{
   assert.match(String(url),/documents:batchGet/);
   batchReads++;
   const documents=JSON.parse(opts.body).documents;
   const readingActivity=documents.some(name=>name.includes('/learning_activity/'));
   if(readingActivity)activityReads+=documents.length;else walletReads+=documents.length;
   return {ok:true,status:200,json:async()=>documents.map(name=>{
    const uid=readingActivity?name.split('/learning_activity/')[1]:name.split('/users/')[1].split('/')[0];
    return {found:{name,fields:readingActivity?records[uid]:{petName:'ペット'+uid}}};
   })};
  }
 });
 let res={};
 await api.handle({method:'GET',url:'/?mode=normal'},res);
 assert.equal(res.status,200);
 assert.deepEqual(res.body.leaders.map(x=>[x.petName,x.floor,x.rank,x.cleared===true]),[
  ['ペットa',5,1,true],['ペットb',5,1,true],['ペットc',3,3,false]]);
 assert.equal(res.body.leaders[0].title,'称号 a');
 res={};await api.handle({method:'GET',url:'/?mode=hard'},res);
 assert.deepEqual(res.body.leaders.map(x=>[x.petName,x.floor,x.rank]),[
  ['ペットb',4,1],['ペットc',2,2],['ペットa',1,3]]);
 res={};await api.handle({method:'GET',url:'/?mode=easy'},res);
 assert.deepEqual(res.body.leaders.map(x=>[x.petName,x.floor,x.rank]),[
  ['ペットb',4,1],['ペットd',3,2],['ペットa',2,3]]);
 assert.equal(activityReads,4,'all three boards share one bootstrap');
 const readsAfterLoad=batchReads;
 res={};await api.handle({method:'GET',url:'/?mode=normal'},res);
 assert.equal(batchReads,readsAfterLoad,'a ranking view requires no Firestore reads after bootstrap');
 await api.publish({uid:'d',mode:'normal',stage:5});
 res={};await api.handle({method:'GET',url:'/?mode=normal'},res);
 assert.deepEqual(res.body.leaders.map(x=>[x.petName,x.floor,x.rank]),[
  ['ペットa',5,1],['ペットb',5,1],['ペットd',5,1]]);
 assert.equal(activityReads,4,'publishing a new best does not rescan players');
 assert.ok(walletReads<10);
 res={};await api.handle({method:'GET',url:'/?mode=invalid'},res);
 assert.equal(res.status,400);
});
