import test from 'node:test';import assert from 'node:assert/strict';
import {CHALLENGE_CONTENTS,challengePeriods,dailyChallengeTasks,challengeProgressWrites,challengeState} from './challenge-model.mjs';
import {createLearningChallenges} from './learning-challenges.mjs';
const fixed=Date.parse('2026-10-24T03:00:00Z'),periods=challengePeriods(fixed);
test('JST daily and Monday weekly boundaries, including a year boundary',()=>{
 assert.equal(challengePeriods(Date.parse('2026-10-25T14:59:59Z')).day,'2026-10-25');assert.equal(challengePeriods(Date.parse('2026-10-25T14:59:59Z')).week,'2026-10-19');assert.equal(challengePeriods(Date.parse('2026-10-25T15:00:00Z')).week,'2026-10-26');assert.equal(challengePeriods(Date.parse('2026-12-31T15:00:00Z')).week,'2026-12-28');
});
test('twelve eligible contents exclude group games and pet activities; stable balanced daily picks rotate',()=>{
 assert.equal(CHALLENGE_CONTENTS.length,12);for(const id of ['eigo-meter','word-wolf','pet-catch'])assert.ok(!CHALLENGE_CONTENTS.some(x=>x.id===id));
 for(let i=0;i<20;i++){const uid='u'+i,a=dailyChallengeTasks(uid,'2026-10-24'),b=dailyChallengeTasks(uid,'2026-10-25');assert.deepEqual(a,dailyChallengeTasks(uid,'2026-10-24'));assert.deepEqual(a.map(x=>x.group),['light','practice']);assert.notEqual(a[0].id,b[0].id);assert.notEqual(a[1].id,b[1].id);}
});
test('one completed action records both periods atomically; four distinct contents complete a week',()=>{
 const writes=challengeProgressWrites({uid:'u',appId:'reading-training',projectId:'p',now:fixed});assert.equal(writes.length,2);assert.match(writes[0].update.name,/daily-2026-10-24$/);assert.match(writes[1].update.name,/weekly-2026-10-19$/);assert.deepEqual(challengeProgressWrites({uid:'u',appId:'word-wolf',projectId:'p'}),[]);
 const completed=Object.fromEntries(CHALLENGE_CONTENTS.slice(0,4).map(x=>[x.id,'stamp']));assert.equal(challengeState('u',periods,{weekly:{completed}},fixed).weekly.complete,true);assert.equal(challengeState('u',periods,{weekly:{completed:{ateru:'stamp'}}},fixed).weekly.count,1);
});
test('existing server activity within the period counts; old and excluded activity does not',()=>{
 const state=challengeState('u',periods,{activity:{contents:{ateru:{lastLearningAt:'2026-10-24T00:00:00Z'},'basic-quest':{lastLearningAt:'2026-10-20T00:00:00Z'},'word-wolf':{lastLearningAt:'2026-10-24T00:00:00Z'},'eiken-retry':{lastLearningAt:'2026-10-10T00:00:00Z'}}}},fixed);assert.equal(state.weekly.count,2);
});
function harness({ready=true,conflict=false}={}){
 const docs=new Map(),prefix='projects/p/databases/(default)/documents/';let version=1,commits=0,awards=0;
 const put=(path,data)=>docs.set(path,{data,updateTime:String(++version)});const completed=Object.fromEntries(CHALLENGE_CONTENTS.map(x=>[x.id,'stamp']));
 if(ready){put('challenge_progress/self/periods/daily-'+periods.day,{completed});put('challenge_progress/self/periods/weekly-'+periods.week,{completed});}
 put('users/self/apps/english-playroom',{coins:11,petName:'keep',coinEarnedDate:periods.day,coinsEarnedToday:2});
 const decode=value=>value.integerValue!==undefined?Number(value.integerValue):value.stringValue??value.booleanValue??value.timestampValue;
 const fetch=async(url,opt={})=>{if(!url.endsWith('documents:commit')){const key=url.split('/documents/')[1],doc=docs.get(key);return doc?{ok:true,json:async()=>({fields:structuredClone(doc.data),updateTime:doc.updateTime})}:{ok:false,status:404};}
  const {writes}=JSON.parse(opt.body);commits++;if(conflict){conflict=false;const key='users/self/apps/english-playroom',w=docs.get(key);put(key,{...w.data,coins:w.data.coins+5});return {ok:false,status:409,json:async()=>({error:{status:'ABORTED'}})};}
  for(const w of writes){const key=w.update.name.slice(prefix.length),doc=docs.get(key);if((w.currentDocument?.exists===false&&doc)||(w.currentDocument?.updateTime&&w.currentDocument.updateTime!==doc?.updateTime))return {ok:false,status:409,json:async()=>({error:{status:'FAILED_PRECONDITION'}})};}
  for(const w of writes){const key=w.update.name.slice(prefix.length),old=docs.get(key)?.data||{},fields=Object.fromEntries(Object.entries(w.update.fields).map(([k,v])=>[k,decode(v)]));put(key,{...old,...fields});}
  return {ok:true,json:async()=>({})};
 };
 const handle=createLearningChallenges({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async req=>{if(req.signedOut)throw Object.assign(Error('login'),{status:401});return {uid:'self'};},decodeFields:x=>x,send:(r,status,body)=>Object.assign(r,{status,body}),fail:(m,status)=>Object.assign(Error(m),{status}),readJson:async req=>req.body,onAward:async()=>awards++,fetch,now:()=>fixed});
 const request=async(kind='daily',period=kind==='daily'?periods.day:periods.week)=>{const r={};await handle({method:'POST',headers:{'content-type':'application/json'},body:{kind,period,uid:'other',reward:9999}},r);return r;};return {request,handle,docs,get commits(){return commits;},get awards(){return awards;}};
}
test('concurrent same-period claims pay exactly once and preserve unrelated wallet data',async()=>{
 const h=harness();const results=await Promise.all([h.request(),h.request()]);assert(results.every(x=>x.status===200));assert.equal(results.reduce((n,x)=>n+x.body.awarded,0),10);const wallet=h.docs.get('users/self/apps/english-playroom').data;assert.equal(wallet.coins,21);assert.equal(wallet.coinsEarnedToday,12);assert.equal(wallet.petName,'keep');assert.equal(h.awards,1);assert.equal((await h.request()).body.awarded,0);assert.ok(![...h.docs.keys()].some(x=>x.includes('other')));
});
test('daily and weekly rewards total thirty and coexist with ordinary reward writes',async()=>{
 const h=harness({conflict:true});const results=await Promise.all([h.request('daily'),h.request('weekly')]);assert(results.every(x=>x.status===200));assert.equal(h.docs.get('users/self/apps/english-playroom').data.coins,46);assert.equal(h.docs.get('users/self/apps/english-playroom').data.coinsEarnedToday,32);assert.equal(h.awards,2);
});
test('incomplete, stale-period, unknown-kind, and signed-out requests cannot award coins',async()=>{
 const h=harness({ready:false});assert.equal((await h.request()).status,409);assert.equal((await h.request('daily','2026-10-23')).status,409);assert.equal((await h.request('bad')).status,400);const r={};await h.handle({method:'GET',signedOut:true},r);assert.equal(r.status,401);assert.equal(h.commits,0);
});
test('status reads do not award rewards and expose actionable daily tasks',async()=>{
 const h=harness(),r={};await h.handle({method:'GET'},r);assert.equal(r.status,200);assert.equal(r.body.daily.reward,10);assert.equal(r.body.weekly.reward,20);assert.equal(r.body.daily.tasks.length,2);assert.equal(r.body.daily.claimed,false);assert.equal(h.commits,0);
});
