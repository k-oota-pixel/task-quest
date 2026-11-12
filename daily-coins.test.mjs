import assert from 'node:assert/strict';
import {publishDailyCoinBoard,readDailyCoinBoard} from './daily-coins.mjs';

const common={
  uid:'learner',access:'token',today:'2026-10-21',
  getUserDoc:async()=>({coinEarnedDate:'2026-10-21',coinsEarnedToday:0}),
  queryDailyCoinWallets:async()=>{throw Object.assign(new Error('Firestore query failed'),{status:502});},
  decodeFields:fields=>fields,
  earnedCoinsToday:(data,today)=>data.coinEarnedDate===today?Number(data.coinsEarnedToday)||0:0,
  validPetName:name=>Boolean(String(name||'').trim()),
  log:()=>{}
};
const unavailable=await readDailyCoinBoard(common);
assert.deepEqual(unavailable,{today:'2026-10-21',coinsToday:0,top3:[],rankingAvailable:false});

const docs=[
  {name:'projects/p/databases/(default)/documents/users/a/apps/english-playroom',fields:{petName:'もこ',coinsToday:9}},
  {name:'projects/p/databases/(default)/documents/users/b/apps/english-playroom',fields:{petName:'えま',coinsToday:18}},
  {name:'projects/p/databases/(default)/documents/users/c/apps/english-playroom',fields:{petName:'ルル',coinsToday:12}},
  {name:'projects/p/databases/(default)/documents/users/d/apps/english-playroom',fields:{petName:'対象外',coinsToday:1}}
];
const ranked=await readDailyCoinBoard({...common,queryDailyCoinWallets:async()=>docs,decodeFields:x=>x,earnedCoinsToday:data=>data.coinsToday});
assert.equal(ranked.coinsToday,0);
assert.equal(ranked.rankingAvailable,true);
assert.deepEqual(ranked.top3,[{uid:'b',petName:'えま',coinsToday:18},{uid:'c',petName:'ルル',coinsToday:12},{uid:'a',petName:'もこ',coinsToday:9}]);
const decorated=await readDailyCoinBoard({...common,queryDailyCoinWallets:async()=>docs,decodeFields:x=>x,earnedCoinsToday:data=>data.coinsToday,
  decorate:leaders=>leaders.map(({uid,...entry})=>({...entry,title:'がんばり屋'}))});
assert.deepEqual(decorated.top3,[{petName:'えま',coinsToday:18,title:'がんばり屋',uid:'b'},
  {petName:'ルル',coinsToday:12,title:'がんばり屋',uid:'c'},
  {petName:'もこ',coinsToday:9,title:'がんばり屋',uid:'a'}]);
console.log('Daily coin board: wallet total survives ranking failure; successful rankings return the sorted top three with viewable pet IDs');

const counts={wallet:0,summary:0,write:0,decorated:[]};
let saved={value:{today:common.today,leaders:ranked.top3},updateTime:'first'};
let publicBoard={today:'2026-10-20',top3:ranked.top3,rankingAvailable:true};
const options={...common,rankingCache:{},rankingStore:{
  getSection:async()=>publicBoard,
  setSection:async(key,value)=>{publicBoard=value;}
},getUserDoc:async()=>{counts.wallet++;return {petName:'めい',coinEarnedDate:common.today,coinsEarnedToday:1};},
  readSummary:async()=>{counts.summary++;return saved;},
  writeSummary:async(access,value)=>{counts.write++;saved={value,updateTime:'next'};return saved;},
  decorate:async entries=>{counts.decorated.push(entries.map(entry=>entry.uid));return entries.map(entry=>({...entry,title:'称号'}));}
};
const award=(uid,petName,coinsEarnedToday)=>publishDailyCoinBoard({...options,uid,walletData:{petName,coinsEarnedToday,coinEarnedDate:common.today}});
assert.equal((await award('d','めい',1)).updated,false);
assert.deepEqual(counts,{wallet:0,summary:1,write:0,decorated:[['b','c','a']]});
assert.equal((await award('d','めい',2)).updated,false);
assert.equal((await award('a','もこ',10)).updated,true);
assert.equal((await award('d','めい',11)).updated,true);
assert.deepEqual(counts,{wallet:0,summary:1,write:2,decorated:[['b','c','a'],['d']]});
assert.equal((await publishDailyCoinBoard(options)).updated,false);
assert.equal(counts.wallet,1,'browser notifications must verify the saved wallet');
