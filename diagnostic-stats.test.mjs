import test from 'node:test';
import assert from 'node:assert/strict';
import {DIAGNOSTIC_SCALE,createDiagnosticStats,normalizeDiagnostic,summarizeMembers} from './diagnostic-stats.mjs';

const value=(v)=>{
 if(v===null)return {nullValue:null};
 if(typeof v==='string')return {stringValue:v};
 if(typeof v==='number')return {doubleValue:v};
 if(Array.isArray(v))return {arrayValue:{values:v.map(value)}};
 return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,n])=>[k,value(n)]))}};
};
const encodeFields=obj=>Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,value(v)]));
const decodeValue=v=>{
 if('nullValue'in v)return null;
 if('stringValue'in v)return v.stringValue;
 if('integerValue'in v)return Number(v.integerValue);
 if('doubleValue'in v)return Number(v.doubleValue);
 if('timestampValue'in v)return v.timestampValue;
 if('arrayValue'in v)return (v.arrayValue.values||[]).map(decodeValue);
 if('mapValue'in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decodeValue(x)]));
 return undefined;
};
const decodeFields=fields=>Object.fromEntries(Object.entries(fields).map(([k,x])=>[k,decodeValue(x)]));
const result=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
const name=uid=>'projects/p/databases/(default)/documents/users/'+uid+'/apps/english-playroom';
const previousDate='2026-11-16T13:00:00.000Z';
const nowDate='2026-11-16T13:05:00.000Z';
const record=(score,atMs=1000,grade='4級',scaleVersion=DIAGNOSTIC_SCALE)=>({
 id:'attempt-'+atMs,score,atMs,grade,scaleVersion,vocabCorrect:7,grammarCorrect:6,vocabTotal:10,grammarTotal:10
});
function harness({snapshot=null,queryRows=[],batchRows=[],queryStatus=200,commitStatus=200,
 allowed=['A','B','ADMIN'],excluded=['ADMIN'],now=Date.parse(nowDate),authFails=false}={}){
 let stored=snapshot,reads={snapshot:0,batch:0,query:0,commit:0},reqs=[],response;
 const handle=createDiagnosticStats({
  base:'https://firestore.test',projectId:'p',accessToken:async()=> 'token',
  verifyAdmin:async()=>{if(authFails)throw Object.assign(Error('no admin'),{status:403});},
  activeIds:async()=>allowed,adminIds:async()=>excluded,
  decodeFields,encodeFields,now:()=>now,
  fail:(message,status)=>Object.assign(Error(message),{status}),
  send:(_res,status,data)=>{response={status,...data};},
  fetchImpl:async(url,opt)=>{
    reqs.push({url,opt});
    if(url.endsWith('/analytics/level-diagnostic-summary-v1')){
      reads.snapshot++;
      return stored?result(200,{fields:encodeFields(stored),updateTime:'2026-11-16T13:03:00Z'}):result(404,{});
    }
    if(url.endsWith(':batchGet')){
      reads.batch++;
      const asked=new Set(JSON.parse(opt.body).documents);
      return result(200,batchRows.filter(x=>asked.has(name(x.uid))).map(x=>({found:{name:name(x.uid),fields:encodeFields(x.fields)}})));
    }
    if(url.endsWith(':runQuery')){
      reads.query++;
      return queryStatus===200?result(200,queryRows.map(x=>({document:{name:name(x.uid),fields:encodeFields(x.fields)}}))):
        result(queryStatus,{error:{status:queryStatus===400?'FAILED_PRECONDITION':'RESOURCE_EXHAUSTED'}});
    }
    if(url.endsWith(':commit')){
      reads.commit++;
      if(commitStatus!==200)return result(commitStatus,{error:{status:'ABORTED'}});
      stored=decodeFields(JSON.parse(opt.body).writes[0].update.fields);
      return result(200,{});
    }
    throw Error('unexpected URL '+url);
  }
 });
 return {request:async method=>{await handle({method},{});return response;},
   get stored(){return stored;},reads,reqs};
}

test('pilot-2 record with answer counts replaces old pilot-1 and preserves grade distribution',()=>{
 assert.equal(normalizeDiagnostic(record(500,10,'2級','pilot-1')),null);
 const data=summarizeMembers({A:record(100,100,'4級'),B:record(500,200,'2級'),C:record(900,300,'準1級程度')});
 assert.equal(data.averageScore,500);
 assert.equal(data.medianScore,500);
 assert.equal(data.minimumScore,100);
 assert.equal(data.maximumScore,900);
 assert.equal(data.gradeCounts['2級'],1);
 assert.equal(data.averageVocabCorrect,7);
 assert.equal(data.averageGrammarCorrect,6);
 assert.equal(data.averageVocabScore,null);
});

test('first refresh migrates prior aggregate using one-time batch wallet reads',async()=>{
 const h=harness({snapshot:{schemaVersion:1,scaleVersion:'pilot-1',participantCount:2},
  batchRows:[{uid:'A',fields:{assessmentLatest:record(200)}},
             {uid:'B',fields:{assessmentLatest:record(400)}},
             {uid:'ADMIN',fields:{assessmentLatest:record(900)}}]});
 const v=await h.request('POST');
 assert.equal(v.status,200);
 assert.equal(v.summary.participantCount,2);
 assert.equal(v.summary.averageScore,300);
 assert.equal(v.summary.source,'initialBackfill');
 assert.equal(v.summary.sourceReads,2);
 assert.equal(h.reads.batch,1);
 assert.equal(h.reads.query,0);
 assert.equal(h.reads.commit,1);
 assert.equal(Object.keys(h.stored.members).length,2);
 assert.deepEqual(JSON.parse(h.reqs.find(x=>x.url.endsWith(':batchGet')).opt.body).documents,[name('A'),name('B')]);
});

test('A retakes, delta loads A only, replaces her existing contribution without recounting B',async()=>{
 const initial={...summarizeMembers({A:record(200,100,'4級'),B:record(400,200,'3級')},
    {through:previousDate,updatedAt:previousDate}),members:{A:record(200,100,'4級'),B:record(400,200,'3級')}};
 const h=harness({snapshot:initial,queryRows:[
   {uid:'A',fields:{assessmentLatest:record(700,400,'2級'),assessmentUpdatedAt:'2026-11-16T13:04:00Z'}}
 ]});
 const v=await h.request('POST');
 assert.equal(v.status,200);
 assert.equal(v.summary.source,'delta');
 assert.equal(v.summary.sourceReads,1);
 assert.equal(v.summary.participantCount,2);
 assert.equal(v.summary.averageScore,550);
 assert.equal(v.summary.medianScore,550);
 assert.equal(v.summary.gradeCounts['4級'],0);
 assert.equal(v.summary.gradeCounts['2級'],1);
 assert.equal(v.summary.scoreBands[2].count,0);
 assert.equal(v.summary.scoreBands[7].count,1);
 assert.equal(h.reads.batch,0);
 assert.equal(h.reads.query,1);
 assert.equal(h.reads.commit,1);
 const query=JSON.parse(h.reqs.find(x=>x.url.endsWith(':runQuery')).opt.body).structuredQuery;
 assert.equal(query.from[0].allDescendants,true);
 assert.equal(query.from[0].collectionId,'apps');
 assert.equal(query.where.compositeFilter.filters[0].fieldFilter.field.fieldPath,'assessmentUpdatedAt');
 assert.equal(query.select.fields[0].fieldPath,'assessmentLatest');
 assert.equal(h.stored.members.B.score,400);
 assert.equal(h.stored.members.A.score,700);
});

test('no updates means no snapshot write',async()=>{
 const previous={...summarizeMembers({A:record(300)},{through:previousDate}),members:{A:record(300)}};
 const h=harness({snapshot:previous});
 const v=await h.request('POST');
 assert.equal(v.summary.source,'unchanged');
 assert.equal(v.summary.sourceReads,0);
 assert.equal(h.reads.query,1);
 assert.equal(h.reads.commit,0);
});

test('same participant retakes multiple times: latest result replaces previous once',async()=>{
 const old={...summarizeMembers({A:record(300)},{through:previousDate}),members:{A:record(300)}};
 const h=harness({snapshot:old,queryRows:[
  {uid:'A',fields:{assessmentLatest:record(550,300),assessmentUpdatedAt:'2026-11-16T13:03:00Z'}},
  {uid:'A',fields:{assessmentLatest:record(800,400),assessmentUpdatedAt:'2026-11-16T13:04:00Z'}}
 ]});
 const v=await h.request('POST');
 assert.equal(v.summary.participantCount,1);
 assert.equal(v.summary.averageScore,800);
 assert.equal(v.summary.sourceReads,2);
});

test('GET returns public statistics without any member IDs or private records',async()=>{
 const h=harness({snapshot:{...summarizeMembers({A:record(250)},{through:previousDate}),members:{A:record(250)}}});
 const v=await h.request('GET');
 assert.equal(v.status,200);
 assert.equal(v.summary.participantCount,1);
 assert.equal('members'in v.summary,false);
 assert.doesNotMatch(JSON.stringify(v),/attempt-1000|\"A\"/);
 assert.equal(h.reads.snapshot,1);
 assert.equal(h.reads.query,0);
});

test('no index produces actionable error without whole-user fallback or writes',async()=>{
 const previous={...summarizeMembers({A:record(300)},{through:previousDate}),members:{A:record(300)}};
 const h=harness({snapshot:previous,queryStatus:400});
 const v=await h.request('POST');
 assert.equal(v.status,412);
 assert.match(v.error,/assessmentUpdatedAt/);
 assert.equal(h.reads.batch,0);
 assert.equal(h.reads.commit,0);
});

test('quota errors avoid retriggering a full scan',async()=>{
 const previous={...summarizeMembers({A:record(300)},{through:previousDate}),members:{A:record(300)}};
 const h=harness({snapshot:previous,queryStatus:429});
 const v=await h.request('POST');
 assert.equal(v.status,429);
 assert.equal(h.reads.batch,0);
 assert.equal(h.reads.commit,0);
});

test('concurrent aggregate update uses Firestore precondition',async()=>{
 const previous={...summarizeMembers({A:record(300)},{through:previousDate}),members:{A:record(300)}};
 const h=harness({snapshot:previous,queryRows:[
  {uid:'A',fields:{assessmentLatest:record(500),assessmentUpdatedAt:'2026-11-16T13:04:00Z'}}
 ],commitStatus:409});
 const v=await h.request('POST');
 assert.equal(v.status,409);
 const write=JSON.parse(h.reqs.find(x=>x.url.endsWith(':commit')).opt.body).writes[0];
 assert.equal(write.currentDocument.updateTime,'2026-11-16T13:03:00Z');
});

test('unauthorized request does not read from Firestore',async()=>{
 const h=harness({authFails:true});
 const v=await h.request('POST');
 assert.equal(v.status,403);
 assert.equal(h.reads.snapshot,0);
 assert.equal(h.reads.batch,0);
});
