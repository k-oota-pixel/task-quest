import test from 'node:test';
import assert from 'node:assert/strict';
import {defenseSettlementPlan,createDefenseSettlement} from './defense-settlement.mjs';

function harness(){
 const traffic=[],notifications=[];
 let conflict=false,receipt=null,dayValue='2026-11-09';
 const fetch=async(url,options={})=>{
  traffic.push({url,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
  if(url.endsWith('/documents:commit')){
   if(conflict)return {ok:false,status:409,json:async()=>({error:{status:'ALREADY_EXISTS'}})};
   return {ok:true,status:200,json:async()=>({writeResults:[]})};
  }
  if(url.includes('/typingDefenseRewards/')){
   if(receipt)return {ok:true,status:200,json:async()=>({fields:receipt,updateTime:'v3'})};
   return {ok:false,status:404};
  }
  const fields=url.includes('/learning_activity/')?
   {dailyCounts:{'2026-11-09':{'pet-typing-defense-normal':0}}}:
   {coins:100,coinsEarnedToday:3,coinEarnedDate:dayValue};
  return {ok:true,status:200,json:async()=>({fields,updateTime:url.includes('/learning_activity/')?'v2':'v1'})};
 };
 const handler=createDefenseSettlement({
  base:'https://firestore.invalid',projectId:'p',accessToken:async()=>'access',
  verifyUser:async()=>({uid:'test'}),send:(res,status,body)=>Object.assign(res,{status,body}),
  fail:(message,status=500)=>Object.assign(Error(message),{status}),
  readJson:async(req)=>req.body,decodeFields:x=>x,todayKey:()=>dayValue,
  earnedCoinsToday:fields=>fields.coinsEarnedToday||0,
  invalidate:uid=>notifications.push(['invalidate',uid]),
  onDailyCountsChanged:(apps,day)=>notifications.push(['day',apps,day]),
  onDefenseStageSaved:async info=>notifications.push(['stage',info]),
  publishCoinBoard:async info=>notifications.push(['coins',info]),
  fetch
 });
 return {handler,traffic,notifications,conflict(flag,entry=null){conflict=flag;receipt=entry}};
}
test('full runs retain easy +5, normal +25 and hard +50',()=>{
 assert.deepEqual(['easy','normal','hard'].map(mode=>defenseSettlementPlan(mode,25).coins),[5,25,50]);
 assert.equal(defenseSettlementPlan('easy',4).coins,0);
 assert.equal(defenseSettlementPlan('normal',7).stage,1);
 assert.equal(defenseSettlementPlan('hard',7).coins,14);
 assert.equal(defenseSettlementPlan('hard',26),null);
});
test('seven phases complete in one transaction with two reads and three writes',async()=>{
 const h=harness(),res={};
 await h.handler({method:'POST',body:{runId:'td-session-test-0001',mode:'normal',clearedPhases:7}},res);
 assert.equal(res.status,200);assert.equal(res.body.coinsAdded,7);
 const reads=h.traffic.filter(x=>x.method==='GET'),commits=h.traffic.filter(x=>x.method==='POST');
 assert.equal(reads.length,2);assert.equal(commits.length,1);
 assert.equal(commits[0].body.writes.length,3);
 const writes=commits[0].body.writes;
 assert.equal(writes[0].currentDocument.exists,false);
 assert.equal(writes[1].update.fields.coins.integerValue,'107');
 assert.equal(writes[1].update.fields.coinsEarnedToday.integerValue,'10');
 assert.ok(writes[2].updateTransforms.some(x=>x.fieldPath==='typingDefenseBestNormal'&&x.maximum.integerValue==='1'));
 assert.ok(writes[2].updateTransforms.some(x=>x.fieldPath.includes('dailyCounts.')&&x.maximum.integerValue==='1'));
 assert.equal(h.notifications.filter(x=>x[0]==='coins').length,1);
 assert.equal(h.notifications.filter(x=>x[0]==='stage').length,1);
});
test('no progress is a zero-cost settlement',async()=>{
 const h=harness(),res={};
 await h.handler({method:'POST',body:{runId:'td-session-test-0002',mode:'easy',clearedPhases:4}},res);
 assert.equal(res.status,200);assert.equal(res.body.coinsAdded,0);
 assert.equal(h.traffic.length,0);
});
test('duplicate request checks receipt and avoids paying twice',async()=>{
 const h=harness();h.conflict(true,{mode:'hard',clearedPhases:25});
 const res={};
 await h.handler({method:'POST',body:{runId:'td-session-test-0003',mode:'hard',clearedPhases:25}},res);
 assert.equal(res.status,200);assert.equal(res.body.duplicate,true);
 assert.equal(res.body.coinsAdded,0);
 assert.equal(h.traffic.filter(x=>x.method==='POST').length,1);
});
test('an existing run ID cannot be reused with a different result',async()=>{
 const h=harness();h.conflict(true,{mode:'normal',clearedPhases:1});
 const res={};
 await h.handler({method:'POST',body:{runId:'td-session-test-0004',mode:'normal',clearedPhases:3}},res);
 assert.equal(res.status,409);
});
