import test from 'node:test';import assert from 'node:assert/strict';
import {createLearningActivity} from './learning-activity.mjs';
test('activity is a single server-timestamped summary write for the authenticated user',async()=>{
 let writes=0,invalidated='';const handle=createLearningActivity({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async()=>({uid:'student'}),send:(r,status,body)=>Object.assign(r,{status,body}),fail:(m,status)=>Object.assign(Error(m),{status}),invalidate:uid=>invalidated=uid,fetch:async(url,opt)=>{writes++;assert.equal(url,'https://db/documents:commit');const body=JSON.parse(opt.body);assert.equal(body.writes.length,1);assert.equal(body.writes[0].update.name,'projects/p/databases/(default)/documents/learning_activity/student');assert.equal(body.writes[0].updateTransforms[0].setToServerValue,'REQUEST_TIME');return {ok:true};}});
 const r={};await handle({method:'POST'},r);assert.equal(r.status,200);assert.equal(writes,1);assert.equal(invalidated,'student');const bad={};await handle({method:'GET'},bad);assert.equal(bad.status,405);assert.equal(writes,1);
});
test('signed-out clients cannot write activity records',async()=>{
 const handle=createLearningActivity({verifyUser:async()=>{throw Object.assign(Error('login'),{status:401});},send:(r,status)=>r.status=status,fail:(m,status)=>Object.assign(Error(m),{status})});const r={};await handle({method:'POST'},r);assert.equal(r.status,401);
});
