import assert from 'node:assert/strict';
import {summarizeRecords,createWordBreakerRecords} from './word-breaker-records.mjs';
const summary=summarizeRecords([
 {petName:'もこ',wordBreakerBests:{junior1:{score:12},high2:{score:10}}},
 {petName:'  えまめん ',email:'private@example.com',uid:'secret',wordBreakerBests:{junior1:{score:20}}},
 {petName:'ふわ',wordBreakerBests:{junior1:{score:20},junior2:{score:3}}},
 {wordBreakerBests:{high1:{score:8}}},
 {petName:'bad',wordBreakerBests:{basic:{score:Infinity},junior3:{score:-1}}},
 {petName:'float',wordBreakerBests:{junior3:{score:2.5}}}
]);
assert.deepEqual(summary.junior1,{score:20,petNames:['えまめん','ふわ'],leaderCount:2});
assert.equal(summary.high1.petNames[0],'名前未設定のペット');
assert.equal(summary.basic.score,0);assert.equal(summary.junior3.score,0);
assert.ok(!JSON.stringify(summary).includes('secret'));assert.ok(!JSON.stringify(summary).includes('private@'));
let time=100000,calls=0,failNext=false;
const api=createWordBreakerRecords({
 base:'https://firestore.googleapis.com/v1/projects/test/databases/(default)',
 activeIds:async()=>['a','b','a'],accessToken:async()=>'hidden',decodeFields:x=>x,
 send:(res,status,body)=>Object.assign(res,{status,body}),fail:(message,status)=>Object.assign(Error(message),{status}),now:()=>time,
 fetch:async(url,options)=>{
  calls++;if(failNext)throw Error('secret service error');
  const body=JSON.parse(options.body);assert.equal(body.documents.length,2);
  assert.deepEqual(body.mask.fieldPaths,['petName','wordBreakerBests']);
  return {ok:true,json:async()=>[{found:{name:body.documents[0],fields:{petName:'A',wordBreakerBests:{basic:{score:42}}}}},{missing:body.documents[1]}]};
 }
});
const [first,second]=await Promise.all([api.snapshot(),api.snapshot()]);assert.equal(calls,1);assert.deepEqual(first,second);
await api.snapshot();assert.equal(calls,1);
time+=60001;await api.snapshot();assert.equal(calls,2);
const res={};await api.handle({method:'POST'},res);assert.equal(res.status,405);
time+=60001;failNext=true;const error={};await api.handle({method:'GET'},error);
assert.equal(error.status,503);assert.ok(!JSON.stringify(error).includes('secret'));
const n=calls;await api.handle({method:'GET'},{});assert.equal(calls,n);
time+=5001;failNext=false;const recovered={};await api.handle({method:'GET'},recovered);assert.equal(recovered.status,200);
assert.equal(recovered.body.courses.basic.score,42);
console.log('Records: existing scores, course isolation, ties, pet names, private field exclusion, cache/coalescing, failures and recovery passed');
