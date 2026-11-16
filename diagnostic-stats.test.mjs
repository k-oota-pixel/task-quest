import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnosticStats,summarizeDiagnostic,DIAGNOSTIC_SCALE} from './diagnostic-stats.mjs';

const row=(score,grade='4級基礎',extra={})=>({
  assessmentLatest:{score,grade,scaleVersion:DIAGNOSTIC_SCALE,vocabScore:score+10,grammarScore:score-10,
    atMs:1000+score,...extra}
});
function output(){
  let answer;
  const send=(_res,status,data)=>{answer={status,...data};};
  return {send,get:()=>answer};
}
const field=value=> {
  if(value===null)return {nullValue:null};
  if(typeof value==='string')return {stringValue:value};
  if(typeof value==='number')return {integerValue:String(value)};
  if(Array.isArray(value))return {arrayValue:{values:value.map(field)}};
  return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,field(v)]))}};
};
const unfield=v=>{
  if(!v)return null;
  if('stringValue'in v)return v.stringValue;
  if('integerValue'in v)return Number(v.integerValue);
  if('nullValue'in v)return null;
  if('arrayValue'in v)return (v.arrayValue.values||[]).map(unfield);
  if('mapValue'in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,unfield(x)]));
};
const encodeFields=v=>Object.fromEntries(Object.entries(v).map(([k,x])=>[k,field(x)]));
const decodeFields=v=>Object.fromEntries(Object.entries(v).map(([k,x])=>[k,unfield(x)]));
const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
const name=uid=>'projects/p/databases/(default)/documents/users/'+uid+'/apps/english-playroom';
const make=({fetchImpl,verifyAdmin=async()=>{},activeIds=async()=>['student1','student2','admin'],
    adminIds=async()=>['admin'],now=()=>1234567890000}={})=>{
  const out=output();
  const handle=createDiagnosticStats({base:'https://db',projectId:'p',accessToken:async()=> 'token',
    verifyAdmin,activeIds,adminIds,encodeFields,decodeFields,fetchImpl,now,send:out.send,
    fail:(message,status)=>Object.assign(new Error(message),{status})});
  return {handle,out};
};

test('summary uses latest matching scale, median, means and histogram',()=>{
 const s=summarizeDiagnostic([row(100,'4級基礎'),row(350,'3級上位'),row(900,'準1級程度'),row(300,'2級標準',{scaleVersion:'old'}),{}],
  {updatedAt:'2026-11-16T00:00:00.000Z',sourceReads:3});
 assert.equal(s.participantCount,3);
 assert.equal(s.averageScore,450);
 assert.equal(s.medianScore,350);
 assert.equal(s.minimumScore,100);
 assert.equal(s.maximumScore,900);
 assert.equal(s.averageVocabScore,460);
 assert.equal(s.averageGrammarScore,440);
 assert.equal(s.gradeCounts['準1級程度'],1);
 assert.equal(s.gradeCounts['4級'],1);
 assert.equal(s.scoreBands.reduce((sum,x)=>sum+x.count,0),3);
});

test('GET returns saved snapshot using one document read only',async()=>{
 let calls=0;
 const {handle,out}=make({fetchImpl:async(url,options)=>{
  calls++;assert.match(url,/level-diagnostic-summary-v1$/);assert.equal(options.method,undefined);
  return response(200,{fields:encodeFields({schemaVersion:1,scaleVersion:DIAGNOSTIC_SCALE,participantCount:2})});
 }});
 await handle({method:'GET'},{});
 assert.equal(calls,1);assert.equal(out.get().status,200);
 assert.equal(out.get().summary.participantCount,2);
});

test('POST queries current diagnostics, excludes admin and saves anonymous single document',async()=>{
 const calls=[],snapshot=[];
 const {handle,out}=make({fetchImpl:async(url,options)=>{
  calls.push([url,options.method||'GET']);
  if(url.endsWith(':runQuery'))return response(200,[
    {document:{name:name('student1'),fields:encodeFields(row(220,'4級標準'))}},
    {document:{name:name('admin'),fields:encodeFields(row(990,'準1級程度'))}},
    {document:{name:name('student2'),fields:encodeFields(row(420,'3級基礎'))}}
  ]);
  if(url.endsWith(':commit')){snapshot.push(JSON.parse(options.body));return response(200,{});}
  throw Error('unexpected '+url);
 }});
 await handle({method:'POST'},{});
 assert.equal(out.get().status,200);
 assert.equal(out.get().summary.participantCount,2);
 assert.equal(out.get().summary.averageScore,320);
 assert.equal(out.get().summary.sourceReads,3);
 assert.equal(snapshot.length,1);
 assert.equal(snapshot[0].writes.length,1);
 assert.doesNotMatch(JSON.stringify(snapshot[0]),/student1|student2|admin|assessmentLatest/);
 assert.equal(calls.filter(([,method])=>method==='POST').length,2);
});

test('fallback batchGet reads only active non-admin members when collection group index unavailable',async()=>{
 const batches=[];
 const {handle,out}=make({fetchImpl:async(url,options)=>{
  if(url.endsWith(':runQuery'))return response(400,{error:{status:'FAILED_PRECONDITION'}});
  if(url.endsWith(':batchGet')){
   const docs=JSON.parse(options.body).documents;batches.push(docs);
   return response(200,[{found:{name:name('student1'),fields:encodeFields(row(200))}},
     {found:{name:name('student2'),fields:encodeFields(row(400))}}]);
  }
  if(url.endsWith(':commit'))return response(200,{});
  throw Error('unexpected '+url);
 }});
 await handle({method:'POST'},{});
 assert.deepEqual(batches.flat(),[name('student1'),name('student2')]);
 assert.equal(out.get().summary.source,'batchGet');
 assert.equal(out.get().summary.participantCount,2);
 assert.equal(out.get().summary.sourceReads,2);
});

test('query permission and internal errors fall back to per-user reads without extra writes',async()=>{
 for(const [status,reason] of [[403,'PERMISSION_DENIED'],[500,'INTERNAL']]){
  let batches=0,commits=0;
  const {handle,out}=make({fetchImpl:async(url,options)=>{
   if(url.endsWith(':runQuery'))return response(status,{error:{status:reason}});
   if(url.endsWith(':batchGet')){
    batches++;
    assert.deepEqual(JSON.parse(options.body).documents,[name('student1'),name('student2')]);
    return response(200,[{found:{name:name('student1'),fields:encodeFields(row(320))}},
      {found:{name:name('student2'),fields:encodeFields(row(420))}}]);
   }
   if(url.endsWith(':commit')){commits++;return response(200,{});}
   throw Error('Unexpected call '+url);
  }});
  await handle({method:'POST'},{});
  assert.equal(out.get().status,200);
  assert.equal(out.get().summary.participantCount,2);
  assert.equal(out.get().summary.averageScore,370);
  assert.equal(out.get().summary.source,'batchGet');
  assert.equal(batches,1);
  assert.equal(commits,1);
 }
});

test('Firestore quota exhaustion does not trigger full-user fallback',async()=>{
 let queryCalls=0,batchCalls=0,writeCalls=0;
 const {handle,out}=make({fetchImpl:async(url)=>{
  if(url.endsWith(':runQuery')){queryCalls++;return response(429,{error:{status:'RESOURCE_EXHAUSTED'}});}
  if(url.endsWith(':batchGet'))batchCalls++;
  if(url.endsWith(':commit'))writeCalls++;
  return response(500,{});
 }});
 await handle({method:'POST'},{});
 assert.equal(queryCalls,1);
 assert.equal(batchCalls,0);
 assert.equal(writeCalls,0);
 assert.equal(out.get().status,429);
});

test('unauthorized caller never reads the database',async()=>{
 let calls=0;
 const {handle,out}=make({verifyAdmin:async()=>{throw Object.assign(Error('forbidden'),{status:403});},
   fetchImpl:async()=>{calls++;throw Error('should not be called');}});
 await handle({method:'GET'},{});
 assert.equal(out.get().status,403);assert.equal(calls,0);
});

test('failed refresh does not write or fake success',async()=>{
 let writes=0;
 const {handle,out}=make({fetchImpl:async(url)=>{
  if(url.endsWith(':runQuery'))return response(500,{error:{status:'INTERNAL'}});
  if(url.endsWith(':commit'))writes++;
  return response(404,{});
 }});
 await handle({method:'POST'},{});
 assert.equal(out.get().status,502);assert.equal(writes,0);
});
