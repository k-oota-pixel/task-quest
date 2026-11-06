import test from 'node:test';import assert from 'node:assert/strict';
import {createLearningActivity} from './learning-activity.mjs';
import {challengePeriods} from './challenge-model.mjs';
test('activity is a single server-timestamped summary write for the authenticated user',async()=>{
 let writes=0,invalidated='';const handle=createLearningActivity({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async()=>({uid:'student'}),send:(r,status,body)=>Object.assign(r,{status,body}),fail:(m,status)=>Object.assign(Error(m),{status}),invalidate:uid=>invalidated=uid,fetch:async(url,opt)=>{writes++;assert.equal(url,'https://db/documents:commit');const body=JSON.parse(opt.body);assert.equal(body.writes.length,1);assert.equal(body.writes[0].update.name,'projects/p/databases/(default)/documents/learning_activity/student');assert.equal(body.writes[0].updateTransforms[0].setToServerValue,'REQUEST_TIME');return {ok:true};}});
 const r={};await handle({method:'POST'},r);assert.equal(r.status,200);assert.equal(writes,1);assert.equal(invalidated,'student');const bad={};await handle({method:'GET'},bad);assert.equal(bad.status,405);assert.equal(writes,1);
});
test('signed-out clients cannot write activity records',async()=>{
 const handle=createLearningActivity({verifyUser:async()=>{throw Object.assign(Error('login'),{status:401});},send:(r,status)=>r.status=status,fail:(m,status)=>Object.assign(Error(m),{status})});const r={};await handle({method:'POST'},r);assert.equal(r.status,401);
});
test('content timestamps share the same write and unknown content ids are rejected',async()=>{
 let appId='listening-training',writes=0;const handle=createLearningActivity({base:'https://db',projectId:'p',accessToken:async()=>'t',verifyUser:async()=>({uid:'u'}),readJson:async()=>({appId}),send:(r,status)=>r.status=status,fail:(m,status)=>Object.assign(Error(m),{status}),invalidate(){},fetch:async(url,opt)=>{writes++;const body=JSON.parse(opt.body);assert.equal(body.writes.length,4);assert.equal(body.writes[0].currentDocument.exists,false);assert.equal(body.writes[0].update.fields.counts.mapValue.fields['listening-training'].integerValue,'1');assert.equal(body.writes[1].updateTransforms.length,4);assert.match(body.writes[1].updateTransforms[3].fieldPath,/^dailyCounts/);assert.equal(body.writes[1].updateTransforms[1].fieldPath,'contents.`listening-training`.lastLearningAt');return {ok:true};}});
 const req={method:'POST',headers:{'content-type':'application/json'}},r={};await handle(req,r);assert.equal(r.status,200);assert.equal(writes,1);appId='unknown.bad';const bad={};await handle(req,bad);assert.equal(bad.status,400);assert.equal(writes,1);
});

test('typing defense milestones only accept one deterministic stage receipt per mode and JST day',async()=>{
 const day=challengePeriods().day,stem='ptd-hard-'+day+'-stage-2';
 const valid={batchId:stem,events:[{eventId:stem+'-clear',appId:'pet-typing-defense-hard'}]};
 let body=valid,commits=0,changed=0;const receipts=new Set();
 const handle=createLearningActivity({
  base:'https://db',projectId:'p',accessToken:async()=>'t',
  verifyUser:async()=>({uid:'learner'}),readJson:async()=>body,
  send:(r,status,value)=>Object.assign(r,{status,value}),
  fail:(message,status)=>Object.assign(Error(message),{status}),
  invalidate(){},onDailyCountsChanged:()=>changed++,
  fetch:async(url,opt)=>{
   commits++;
   const writes=JSON.parse(opt.body).writes,receipt=writes[0].update.name;
   assert.ok(writes[1].updateTransforms.some(t=>t.fieldPath.includes('pet-typing-defense-hard')));
   if(receipts.has(receipt))return {ok:false,status:409,json:async()=>({error:{status:'ALREADY_EXISTS'}})};
   receipts.add(receipt);
   return {ok:true,status:200,json:async()=>({writeResults:[{}, {transformResults:[]}]})};
  }
 });
 const req={method:'POST',headers:{authorization:'Bearer demo','content-type':'application/json'}};
 const first={};await handle(req,first);assert.equal(first.status,200);assert.equal(changed,1);
 const replay={};await handle(req,replay);assert.equal(replay.status,200);assert.equal(replay.value.duplicate,true);assert.equal(changed,1);
 for(const invalid of [
  {...valid,batchId:'ptd-hard-'+day+'-stage-3'},
  {...valid,events:[{eventId:'ptd-hard-'+day+'-stage-6-clear',appId:'pet-typing-defense-hard'}]},
  {...valid,events:[{eventId:stem+'-clear',appId:'pet-typing-defense-normal'}]},
  {...valid,events:[...valid.events,...valid.events]}
 ]){
  body=invalid;const result={};await handle(req,result);assert.equal(result.status,400);
 }
 body={appId:'pet-typing-defense-normal'};
 const unbounded={};await handle(req,unbounded);assert.equal(unbounded.status,400);
 assert.equal(commits,2,'only one successful commit and one duplicate are sent');
});
