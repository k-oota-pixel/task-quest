import assert from 'node:assert/strict';
import {summarizeRecords,createWordBreakerRecords} from './word-breaker-records.mjs';
const summary=summarizeRecords([
 {uid:'a',petName:'もこ',wordBreakerBests:{junior1:{score:12},high2:{score:10}}},
 {uid:'b',petName:'  えまめん ',email:'private@example.com',wordBreakerBests:{junior1:{score:20}}},
 {uid:'c',petName:'ふわ',wordBreakerBests:{junior1:{score:20},junior2:{score:3}}},
 {uid:'d',wordBreakerBests:{high1:{score:8}}},
 {uid:'e',petName:'bad',wordBreakerBests:{basic:{score:Infinity},junior3:{score:-1}}},
 {uid:'f',petName:'float',wordBreakerBests:{junior3:{score:2.5}}}
]);
assert.deepEqual(summary.junior1,{score:20,petNames:['えまめん','ふわ'],leaderCount:2});
assert.equal(summary.high1.petNames[0],'名前未設定のペット');
assert.equal(summary.basic.score,0);assert.equal(summary.junior3.score,0);
assert.ok(!JSON.stringify(summary).includes('secret'));assert.ok(!JSON.stringify(summary).includes('private@'));

function decode(v){
 if(!v||typeof v!=='object')return null;if('stringValue'in v)return v.stringValue;if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return Number(v.doubleValue);if('booleanValue'in v)return !!v.booleanValue;if('nullValue'in v)return null;
 if('arrayValue'in v)return (v.arrayValue.values||[]).map(decode);if('mapValue'in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));return null;
}
const decodeFields=fields=>Object.fromEntries(Object.entries(fields||{}).map(([k,v])=>[k,decode(v)]));
let time=100000,summaryDoc=null,summaryUpdate=0,batchReads=0,summaryReads=0,summaryWrites=0;
const base='https://firestore.googleapis.com/v1/projects/test/databases/(default)';
const api=createWordBreakerRecords({
 base,activeIds:async()=>['a','b','a'],accessToken:async()=>'hidden',decodeFields,
 send:(res,status,body)=>Object.assign(res,{status,body}),fail:(message,status)=>Object.assign(Error(message),{status}),now:()=>time,webApiKey:'test-key',
 fetch:async(url,options={})=>{
  const u=String(url);
  if(u.startsWith('https://identitytoolkit.googleapis.com/'))return {ok:true,status:200,json:async()=>({users:[{localId:'a'}]})};
  if(u===base+'/documents/users/a/apps/english-playroom')return {ok:true,status:200,json:async()=>({fields:{petName:{stringValue:'もこ'},wordBreakerBests:{mapValue:{fields:{junior1:{mapValue:{fields:{score:{integerValue:'50'}}}}}}}}})};
  if(u.includes('/documents:batchGet')){
   batchReads++;const body=JSON.parse(options.body);assert.equal(body.documents.length,2);assert.deepEqual(body.mask.fieldPaths,['petName','wordBreakerBests']);
   return {ok:true,status:200,json:async()=>[
    {found:{name:body.documents[0],fields:{petName:{stringValue:'もこ'},wordBreakerBests:{mapValue:{fields:{junior1:{mapValue:{fields:{score:{integerValue:'12'}}}}}}}}}},
    {found:{name:body.documents[1],fields:{petName:{stringValue:'えまめん'},wordBreakerBests:{mapValue:{fields:{junior1:{mapValue:{fields:{score:{integerValue:'20'}}}}}}}}}}
   ]};
  }
  if(u.startsWith(base+'/documents/leaderboards/word-breaker')){
   if((options.method||'GET')==='PATCH'){
    summaryWrites++;const body=JSON.parse(options.body);summaryDoc=body.fields;summaryUpdate++;return {ok:true,status:200,json:async()=>({fields:summaryDoc,updateTime:`t${summaryUpdate}`})};
   }
   summaryReads++;if(!summaryDoc)return {ok:false,status:404,json:async()=>({})};return {ok:true,status:200,json:async()=>({fields:summaryDoc,updateTime:`t${summaryUpdate}`})};
  }
  throw new Error('unexpected '+u);
 }
});
const first=await api.snapshot();assert.equal(first.courses.junior1.score,20);assert.equal(batchReads,1);assert.equal(summaryReads,1);assert.equal(summaryWrites,1);
await api.snapshot();assert.equal(batchReads,1);assert.equal(summaryReads,1);
time+=60001;const next=await api.snapshot();assert.equal(next.courses.junior1.score,20);assert.equal(batchReads,1);assert.equal(summaryReads,2);assert.equal(summaryWrites,1);
const post={};await api.handle({method:'POST',headers:{'content-type':'application/json',authorization:'Bearer token'},body:{course:'junior1'}},post);assert.equal(post.status,200);assert.equal(post.body.record.score,50);assert.equal(summaryWrites,2);
const get={};await api.handle({method:'GET',headers:{}},get);assert.equal(get.status,200);assert.deepEqual(get.body.courses.junior1,{score:50,petNames:['もこ'],leaderCount:1});assert.equal(summaryReads,2);
assert.ok(!JSON.stringify(get.body).includes('"uid"'));
const bad={};await api.handle({method:'POST',headers:{'content-type':'application/json',authorization:'Bearer token'},body:{course:'bad'}},bad);assert.equal(bad.status,400);
console.log('Records: one-time bootstrap, one-document reads, cached GETs, verified publish, ties and private-field exclusion passed');
