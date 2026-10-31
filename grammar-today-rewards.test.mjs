import test from 'node:test';
import assert from 'node:assert/strict';
import {createTitleEvents,validateTitleEvent} from './creative-title-events.mjs';
import {applyTitleEvent} from './creative-title-progress.mjs';
import {creativeTitles} from './title-model.mjs';
import {challengePeriods} from './challenge-model.mjs';
import units from './grammar-reward-units.json' with {type:'json'};
const fail=(message,status)=>Object.assign(Error(message),{status});
const decode=v=>v.mapValue?Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)])):v.arrayValue?(v.arrayValue.values||[]).map(decode):v.integerValue!==undefined?Number(v.integerValue):v.booleanValue!==undefined?v.booleanValue:v.stringValue??null;
const day=challengePeriods().day;
function fixture(){
 const docs=new Map();let reads=0,commits=0,revision=0,conflict=false,body;
 const prefix='projects/p/databases/(default)/documents/';
 const handle=createTitleEvents({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async()=>({uid:'learner'}),readJson:async()=>body,decodeFields:f=>decode({mapValue:{fields:f}}),fail,send:(r,status,data)=>Object.assign(r,{status,data}),fetch:async(url,o)=>{
  const b=JSON.parse(o.body);
  if(url.endsWith('batchGet')){reads++;return {ok:true,json:async()=>b.documents.map(name=>docs.has(name)?{found:docs.get(name)}:{missing:name})};}
  if(conflict){conflict=false;return {ok:false,status:409};}
  for(const w of b.writes){const d=docs.get(w.update.name);if(w.currentDocument?.exists===false&&d||w.currentDocument?.updateTime&&w.currentDocument.updateTime!==d?.updateTime)return {ok:false,status:409};}
  commits++;
  for(const w of b.writes){const name=w.update.name,old=docs.get(name)?.fields||{};const fields=w.updateMask?{...old,...w.update.fields}:w.update.fields;for(const t of w.updateTransforms||[])if(t.increment)fields[t.fieldPath]={integerValue:String(Number(old[t.fieldPath]?.integerValue||0)+Number(t.increment.integerValue))};docs.set(name,{name,fields,updateTime:String(++revision)});}
  return {ok:true};
 }});
 return {docs,get reads(){return reads;},get commits(){return commits;},conflict(){conflict=true;},data(path){return decode({mapValue:{fields:docs.get(prefix+path)?.fields||{}}});},async send(appId,events,batchId='batch-000001'){
  body={appId,batchId,events:events.map((e,i)=>({eventId:batchId+'-'+i,...e}))};const res={};await handle({method:'POST'},res);return res;
 }};
}
const answers=(app='basic-grammar',score=3,start=0,course=day)=>Array.from({length:5},(_,i)=>({kind:'question',itemId:'1:'+(start+i),correct:i<score,course}));
test('3 of 5 first answers earns exactly one coin atomically; retry has no reads or writes',async()=>{
 const f=fixture();f.conflict();const r=await f.send('basic-grammar',answers());assert.equal(r.status,200);assert.equal(r.data.awardedCoins,1);
 const wallet=f.data('users/learner/apps/english-playroom');assert.equal(wallet.coins,1);assert.equal(wallet.coinsEarnedToday,1);assert.equal(wallet.titleCountRevision,1);
 const before=[f.reads,f.commits];const duplicate=await f.send('basic-grammar',answers());assert.equal(duplicate.data.duplicate,true);assert.deepEqual([f.reads,f.commits],before);
 await f.send('basic-grammar',answers('basic-grammar',5),'batch-000002');assert.equal(f.data('users/learner/apps/english-playroom').coins,1);
});
test('2 correct does not earn a coin, and correcting retries cannot replace first results',async()=>{
 const f=fixture();await f.send('grammar',answers('grammar',2));await f.send('grammar',answers('grammar',5),'batch-000002');assert.equal(f.data('users/learner/apps/english-playroom').coins,undefined);
 await f.send('grammar',answers('grammar',3,5),'batch-000003');assert.equal(f.data('users/learner/apps/english-playroom').coins,1);
});
test('partial sets carry across units; the two materials have separate coin claims',async()=>{
 const f=fixture();await f.send('basic-grammar',answers().slice(0,3));assert.equal(f.data('users/learner/apps/english-playroom').coins,undefined);
 await f.send('basic-grammar',[0,1].map(i=>({kind:'question',itemId:'2:'+i,correct:false,course:day})),'batch-000002');assert.equal(f.data('users/learner/apps/english-playroom').coins,1);
 await f.send('grammar',answers('grammar',3),'batch-000003');assert.equal(f.data('users/learner/apps/english-playroom').coins,2);
});
test('old offline answers never earn new-day coins; next day resets first-answer results',async()=>{
 const f=fixture();const r=await f.send('grammar',answers('grammar',5,0,'2000-01-01'));assert.equal(r.data.awardedCoins,0);
 await f.send('grammar',answers('grammar',3),'batch-000002');assert.equal(f.data('users/learner/apps/english-playroom').coins,1);
 let state=applyTitleEvent({}, {appId:'grammar',kind:'question',itemId:'1:0',correct:false,course:'2000-01-01'},'2000-01-01');
 state=applyTitleEvent(state,{appId:'grammar',kind:'question',itemId:'1:0',correct:true,course:day},day);assert.deepEqual(state.rewardAnswers,{'1:0':true});
});
test('TODAY grants titles and never modifies the coin balance',async()=>{
 const f=fixture();const e={kind:'read',itemId:'article-1',grade:'5級',course:day};const r=await f.send('today',[e]);assert.equal(r.data.awardedCoins,0);assert.equal(f.data('users/learner/apps/english-playroom').coins,undefined);assert.ok(r.data.freshTitles.some(t=>t.name==='ニュースの入口'));
 await f.send('today',[{...e,grade:'4級'}],'batch-000002');assert.equal(f.data('title_progress/learner/activities/today').metrics.comparedArticles,1);
});
test('invalid questions and excessive requests are rejected before accessing Firebase',async()=>{
 const f=fixture();for(const itemId of ['0:0','13:0','1:20','01:0','1:00']){const r=await f.send('basic-grammar',[{kind:'question',itemId,correct:true,course:day}]);assert.equal(r.status,400);}assert.equal(f.reads,0);
 for(let i=0;i<30;i++)await f.send('today',[{kind:'read',itemId:'article-'+i,grade:'5級',course:day}],'batch-'+String(i).padStart(6,'0'));
 const before=f.reads,r=await f.send('today',[{kind:'read',itemId:'over-limit',grade:'5級',course:day}],'batch-over-limit');assert.equal(r.status,429);assert.equal(f.reads,before);
});
test('all 45 new titles are reachable, using actual question totals and distinct articles',()=>{
 for(const appId of ['basic-grammar','grammar']){
  let s={};for(const u of units[appId])for(let i=0;i<u.total;i++){
   const e={appId,kind:'question',itemId:u.number+':'+i,correct:false,course:day};s=applyTitleEvent(s,e,day);s=applyTitleEvent(s,{...e,correct:true},day);
  }
  for(let i=0;i<30;i++){const d='2026-09-'+String(i+1).padStart(2,'0');s=applyTitleEvent(s,{appId,kind:'question',itemId:'1:0',correct:true,course:d},d);}
  assert.equal(creativeTitles(appId,s).filter(t=>t.unlocked).length,15);
 }
 let s={};for(let i=0;i<100;i++){const d=new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10);for(const grade of ['5級','4級'])s=applyTitleEvent(s,{appId:'today',kind:'read',itemId:'article-'+i,grade,course:i<6?'2026-01-01':d},d);}
 assert.equal(creativeTitles('today',s).filter(t=>t.unlocked).length,15);
});
