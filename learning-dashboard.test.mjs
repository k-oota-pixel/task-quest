import test from 'node:test';import assert from 'node:assert/strict';import {createLearningDashboard} from './learning-dashboard.mjs';
const base={base:'https://db',projectId:'p',accessToken:async()=>'t',verifyUser:async()=>({uid:'self'}),decodeFields:x=>x,send:(r,status,body)=>Object.assign(r,{status,body}),fail:(m,status)=>Object.assign(Error(m),{status})};
test('dashboard reads only authenticated learner and returns all stored progress',async()=>{
 let reads=0;const handle=createLearningDashboard({...base,fetch:async(url,opts)=>{reads++;const docs=JSON.parse(opts.body).documents;assert.equal(docs.length,12);assert(docs.every(x=>x.includes('/self/')||x.endsWith('/self')));return {ok:true,json:async()=>[{found:{name:docs[0],fields:{coins:7}}},{found:{name:docs.at(-1),fields:{contents:{ateru:{lastLearningAt:'2026-10-21'}}}}}]};}});
 const r={};await handle({method:'GET',url:'/?uid=other'},r);assert.equal(r.status,200);assert.equal(reads,1);assert.equal(r.body.apps['english-playroom'].coins,7);assert(r.body.activity.contents.ateru);
});
test('signed out and unsupported requests cannot read records',async()=>{
 let reads=0;const handle=createLearningDashboard({...base,verifyUser:async()=>{throw base.fail('login',401);},fetch:async()=>{reads++;}});
 const r={};await handle({method:'GET'},r);assert.equal(r.status,401);await handle({method:'POST'},r);assert.equal(r.status,405);assert.equal(reads,0);
});
test('upstream failures are retryable errors rather than empty progress',async()=>{
 const handle=createLearningDashboard({...base,fetch:async()=>({ok:false})}),r={};await handle({method:'GET'},r);assert.equal(r.status,502);assert(r.body.error);
});
