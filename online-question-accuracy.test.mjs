import test from 'node:test';
import assert from 'node:assert/strict';
import {accuracyBonusDamage,accuracyBonusPercent,buildOnlineAccuracySnapshot,createOnlineAccuracyProvider,validOnlineAccuracySnapshot} from './online-question-accuracy.mjs';

test('正答率の5段階：75、50、21、0及び未回答を正確に判定する',()=>{
 const cases=[
  [100,0],[75,0],[74.9,10],[50,10],[49.9,20],[21,20],
  [20.9,30],[20,30],[0,30],[null,35],[undefined,0],[NaN,0]
 ];
 for(const [rate,expected] of cases)assert.equal(accuracyBonusPercent(rate),expected,String(rate));
});
test('ボーナスダメージは防御適用後の基本ダメージを整数切り上げする',()=>{
 for(const [rate,damage,bonus] of [[75,10,0],[50,11,10],[21,12,20],[0,13,30],[null,14,35]]){
  assert.deepEqual(accuracyBonusDamage(10,rate),{baseDamage:10,bonusPercent:bonus,damage});
 }
 assert.equal(accuracyBonusDamage(1,50).damage,2);
 assert.equal(accuracyBonusDamage(12,null).damage,17);
});
test('出題一覧の全問を含み、リトライと対戦の初回正答件数を合算する',()=>{
 const index=[
  {id:'2025-2-g4-q01',grade:'4級'},{id:'2025-2-g4-q02',grade:'4級'},
  {id:'2025-2-g3-q01',grade:'3級'}, {id:'2025-2-pre2-q01',grade:'準2級'},
  {id:'2025-2-g2-q01',grade:'2級'}, {id:'2025-2-pre1-q01',grade:'準1級'}
 ];
 const snapshot=buildOnlineAccuracySnapshot(index,[
  {id:'2025-2-g4-q01',grade:'4級',attempts:10,correct:6},
  {id:'2025-2-g3-q01',grade:'3級',attempts:4,correct:0},
  {id:'2025-2-pre1-q01',grade:'準1級',attempts:10,correct:10}
 ],{
  '4':[{id:'2025-2-g4-q01',attempts:10,correct:8}],
  '3':[],
  pre2:[],
  '2':[]
 },'2026-11-13T00:00:00.000Z');
 assert.equal(snapshot.grades['4']['2025-2-g4-q01'],70);
 assert.equal(snapshot.grades['4']['2025-2-g4-q02'],null);
 assert.equal(snapshot.grades['3']['2025-2-g3-q01'],0);
 assert.equal(snapshot.grades.pre2['2025-2-pre2-q01'],null);
 assert.equal(Object.keys(snapshot.grades['4']).length,2);
 assert.equal(snapshot.grades['4']['2025-2-pre1-q01'],undefined);
 assert.equal(snapshot.sampleUnit,'first-answer-per-material');
});
test('サーバーの難易度表は静的JSONをキャッシュし、対戦ごとにDBを読まない',async()=>{
 let clock=0,fetches=0;
 const snapshot={schemaVersion:1,updatedAt:'2026-11-13T00:00:00Z',grades:{
  '4':Object.fromEntries([1,2,3,4].map(i=>['2025-2-g4-q0'+i,null])),
  '3':Object.fromEntries([1,2,3,4].map(i=>['2025-2-g3-q0'+i,null])),
  pre2:Object.fromEntries([1,2,3,4].map(i=>['2025-2-pre2-q0'+i,null])),
  '2':Object.fromEntries([1,2,3,4].map(i=>['2025-2-g2-q0'+i,null]))
 }};
 assert.equal(validOnlineAccuracySnapshot(snapshot),true);
 const service=createOnlineAccuracyProvider({now:()=>clock,ttlMs:100,request:async()=>{fetches++;return {ok:true,json:async()=>snapshot};}});
 const [a,b]=await Promise.all([service.get(),service.get()]);
 assert.equal(a,b);
 assert.equal(fetches,1);
 await service.get();assert.equal(fetches,1);
 clock=101;await service.get();assert.equal(fetches,2,'時間経過後だけ静的JSON再取得');
});
