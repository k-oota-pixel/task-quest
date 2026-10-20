import assert from 'node:assert/strict';
import {readDailyCoinBoard} from './daily-coins.mjs';

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
assert.deepEqual(ranked.top3,[{petName:'えま',coinsToday:18},{petName:'ルル',coinsToday:12},{petName:'もこ',coinsToday:9}]);
console.log('Daily coin board: wallet total survives ranking failure; successful rankings return the sorted top three');
