import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTitleEvent} from './creative-title-progress.mjs';
import {creativeTitles,titleState,validTitleName} from './title-model.mjs';
import {validateTitleEvent} from './creative-title-events.mjs';
import {createLearningTitles} from './learning-titles.mjs';
const fail=(message,status)=>Object.assign(Error(message),{status});

test('all adventure titles are reachable through validated events',()=>{
 for(const appId of ['word-tower','eiken-dungeon']){
  let state={},sequence=0;
  const push=payload=>{const event=validateTitleEvent({appId,eventId:`adventure-${++sequence}`,sessionId:'run-one',floor:1,itemId:'question-one',...payload},fail);state=applyTitleEvent(state,event,'2026-10-25');};
  for(let i=0;i<10;i++)push({kind:'run',sessionId:`run-${i}`,score:0});
  for(let i=0;i<200;i++)push({kind:'answer',correct:true,critical:i<50,itemId:'q'+i});
  for(let i=1;i<=20;i++)push({kind:'defeat',floor:i*5,noDamage:i===1,itemId:'enemy'+i});
  const titles=creativeTitles(appId,state),expected=appId==='word-tower'?18:15;assert.equal(titles.length,expected);assert.ok(titles.every(t=>t.unlocked));
  const other=appId==='word-tower'?'eiken-dungeon':'word-tower';assert.ok(creativeTitles(other).every(t=>!t.unlocked));
  for(const title of titles)assert.equal(validTitleName(title.id),title.name);
 }
});
test('boss rewards are derived from the floor, duplicate defeats do not inflate counts, and streaks stay within one run',()=>{
 const appId='word-tower';let s={};
 const push=e=>s=applyTitleEvent(s,{appId,sessionId:'one',floor:1,eventId:crypto.randomUUID(),...e},'2026-10-25');
 push({kind:'run',score:0});push({kind:'run',score:0});assert.equal(s.metrics.runs,1);
 push({kind:'defeat',noDamage:true});assert.equal(s.metrics.bosses||0,0);
 push({kind:'defeat',floor:5,noDamage:true});push({kind:'defeat',floor:5,noDamage:true});assert.equal(s.metrics.bosses,1);assert.equal(s.metrics.noDamageBoss,1);
 for(let i=0;i<9;i++)push({kind:'answer',correct:true,critical:false});
 push({kind:'answer',sessionId:'two',correct:true,critical:false});assert.equal(s.metrics.answerStreak,9);
 push({kind:'answer',correct:false,critical:true});assert.equal(s.metrics.critical||0,0);
 push({kind:'answer',correct:true,critical:true});assert.equal(s.metrics.answerStreak,9);assert.equal(s.metrics.critical,1);
});
test('saved best floors unlock arrival and endgame titles without inventing a Demon Lord clear',()=>{
 const selection={selectedId:'creative:word-tower:5'};
 const state=titleState({wallet:{wordTowerBest:50,eikenDungeonBest:25},selection});
 assert.equal(state.selectedTitle,'雲へ続く足跡');
 for(const [appId,expected] of [['word-tower',3],['eiken-dungeon',2]]){
  const unlocked=state.titles.filter(t=>t.appId===appId&&t.unlocked);assert.equal(unlocked.length,expected);assert.ok(unlocked.every(t=>t.metric==='bestFloor'));
 }
 const atFinalGate=titleState({wallet:{wordTowerBest:100}}).titles.filter(t=>t.appId==='word-tower');
 assert.equal(atFinalGate.find(t=>t.id==='creative:word-tower:16').unlocked,true);
 assert.equal(atFinalGate.find(t=>t.id==='creative:word-tower:17').unlocked,true);
 assert.equal(atFinalGate.find(t=>t.id==='creative:word-tower:18').unlocked,false);
 assert.equal(atFinalGate.find(t=>t.id==='creative:word-tower:17').done,1);
 assert.equal(atFinalGate.find(t=>t.id==='creative:word-tower:17').need,1);
});
test('defeating the floor 100 Demon Lord unlocks all three endgame titles',()=>{
 let state={};
 const push=e=>state=applyTitleEvent(state,{appId:'word-tower',sessionId:'final-run',eventId:crypto.randomUUID(),itemId:'final',floor:100,...e},'2026-11-01');
 push({kind:'run',score:100});
 let titles=creativeTitles('word-tower',state);assert.equal(titles.find(t=>t.id==='creative:word-tower:17').unlocked,true);assert.equal(titles.find(t=>t.id==='creative:word-tower:18').unlocked,false);
 push({kind:'defeat',noDamage:false});
 titles=creativeTitles('word-tower',state);for(const id of [16,17,18]){const title=titles.find(t=>t.id===`creative:word-tower:${id}`);assert.equal(title.unlocked,true);assert.equal(title.done,1);assert.equal(title.need,1);}
});
test('title reads include the existing wallet and expose the thirty-three adventure titles',async()=>{
 let requested=[];
 const api=createLearningTitles({base:'https://db',projectId:'p',accessToken:async()=>'t',verifyUser:async()=>({uid:'u'}),decodeFields:x=>x,fail,send:(res,status,body)=>Object.assign(res,{status,body}),fetch:async(url,o)=>{if(url.endsWith(':batchGet'))requested=JSON.parse(o.body).documents;return {ok:true,json:async()=>[{found:{name:'projects/p/databases/(default)/documents/users/u/apps/english-playroom',fields:{wordTowerBest:25}}}]};}});
 const r={};await api.handle({method:'GET'},r);assert.equal(r.status,200);assert.ok(requested.some(x=>x.endsWith('/apps/english-playroom')));
 assert.equal(r.body.titles.filter(t=>['word-tower','eiken-dungeon'].includes(t.appId)).length,33);
 assert.equal(r.body.titles.find(t=>t.id==='creative:word-tower:11').unlocked,true);
});
test('adventure event validation rejects absent identity, invalid floors and missing answer/defeat conditions',()=>{
 const base={appId:'word-tower',kind:'answer',eventId:'adventure-event',sessionId:'run',floor:1,itemId:'q',correct:true,critical:false};
 for(const patch of [{sessionId:''},{floor:0},{floor:1.5},{floor:100001},{correct:undefined},{critical:undefined},{kind:'defeat',noDamage:undefined}])assert.throws(()=>validateTitleEvent({...base,...patch},fail));
});
