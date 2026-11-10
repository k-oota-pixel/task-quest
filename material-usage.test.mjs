import test from 'node:test';
import assert from 'node:assert/strict';
import {createMaterialUsage,createMaterialOpen,USAGE_CONTENTS} from './material-usage.mjs';
const decodeValue=v=>'integerValue'in v?Number(v.integerValue):'timestampValue'in v?v.timestampValue:'stringValue'in v?v.stringValue:'mapValue'in v?Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decodeValue(x)])):null;
const decodeFields=fields=>Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,decodeValue(v)]));
const receipt=(id,count,recordedAt)=>({name:'projects/test/databases/(default)/documents/learning_activity/u/events/'+id,
 fields:{day:{stringValue:'2026-11-10'},counts:{mapValue:{fields:{ateru:{integerValue:String(count)}}}},
 ...(recordedAt?{recordedAt:{timestampValue:recordedAt}}:{})}});
test('migration reads old events once and subsequent reads use only recordedAt range',async()=>{
 let now=Date.parse('2026-11-10T03:00:00Z'),stored=null,queries=0,writes=0;
 const receipts=[receipt('old',2),receipt('recent',3,'2026-11-10T02:59:30.000Z')];
 const usage=createMaterialUsage({base:'https://db',projectId:'test',accessToken:async()=>'token',
  verifyAdmin:async()=>{},decodeFields,now:()=>now,fail:(m,status)=>Object.assign(Error(m),{status}),
  send:(res,status,body)=>Object.assign(res,{status,body}),
  fetch:async(url,options={})=>{
   if(url.endsWith('/documents/analytics/material-usage-snapshot-v2'))return stored?{ok:true,json:async()=>stored}:{ok:false,status:404};
   if(url.endsWith('/documents:commit')){writes++;stored={fields:JSON.parse(options.body).writes[0].update.fields,updateTime:'rev'+writes};return {ok:true,json:async()=>({})};}
   if(url.endsWith('/documents:runQuery')){
    queries++;const q=JSON.parse(options.body).structuredQuery;
    if(q.from[0].collectionId!=='events')return {ok:true,json:async()=>[]};
    let found=receipts;
    if(q.where){const [low,high]=q.where.compositeFilter.filters.map(f=>f.fieldFilter.value.timestampValue);
     found=found.filter(r=>r.fields.recordedAt?.timestampValue>=low&&r.fields.recordedAt?.timestampValue<high);}
    return {ok:true,json:async()=>found.map(document=>({document}))};
   }
   if(url.includes('/documents/material_activity_events'))return {ok:false,status:404};
   throw Error('Unexpected URL '+url);
  }});
 const first={};await usage({method:'GET'},first);
 assert.equal(first.status,200);assert.equal(first.body.rows.length,USAGE_CONTENTS.length);
 assert.equal(first.body.rows.find(x=>x.id==='ateru').total,2);assert.equal(writes,1);
 now+=7200000;
 const second={};await usage({method:'GET'},second);
 assert.equal(second.status,200);assert.equal(second.body.rows.find(x=>x.id==='ateru').total,5);
 assert.equal(writes,2);assert.equal(queries,3);
 const third={};await usage({method:'GET'},third);
 assert.equal(third.body.rows.find(x=>x.id==='ateru').total,5);assert.equal(writes,2);assert.equal(queries,3);
});
test('old page-open endpoint is a no-op',async()=>{
 const open=createMaterialOpen({send:(res,status,body)=>Object.assign(res,{status,body})});
 const post={};await open({method:'POST'},post);
 assert.equal(post.status,200);assert.deepEqual(post.body,{ok:true,deprecated:true});
 const get={};await open({method:'GET'},get);assert.equal(get.status,405);
});
