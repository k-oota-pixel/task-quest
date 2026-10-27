import test from 'node:test';
import assert from 'node:assert/strict';
import {createMaterialOpen,createMaterialUsage,USAGE_CONTENTS} from './material-usage.mjs';

test('admin report counts activity receipts and includes all tracked materials',async()=>{
 let reads=0;
 const handle=createMaterialUsage({base:'https://db',accessToken:async()=>'token',verifyAdmin:async()=>{},decodeFields:fields=>({day:fields.day?.stringValue||'',counts:Object.fromEntries(Object.entries(fields.counts?.mapValue?.fields||{}).map(([id,value])=>[id,Number(value.integerValue)||0]))}),send:(res,status,body)=>Object.assign(res,{status,body}),fail:(message,status)=>Object.assign(Error(message),{status}),now:()=>Date.parse('2026-10-27T03:00:00Z'),fetch:async(url,options={})=>{reads++;if(url.endsWith('/documents:runQuery')){assert.equal(options.method,'POST');return {ok:true,json:async()=>[{document:{name:'projects/p/databases/(default)/documents/learning_activity/u/events/abcdefgh',fields:{day:{stringValue:'2026-10-27'},counts:{mapValue:{fields:{ateru:{integerValue:'3'}}}}}}}]};}assert.ok(url.includes('/documents/material_activity_events'));return {ok:false,status:404};}});
 const res={};await handle({method:'GET'},res);
 assert.equal(res.status,200);assert.equal(res.body.rows.length,USAGE_CONTENTS.length);
 assert.deepEqual(res.body.rows.find(row=>row.id==='ateru'),{id:'ateru',label:'アテル',today:3,total:3});
 assert.equal(res.body.rows.find(row=>row.id==='word-wolf').total,0);assert.equal(reads,2);
});

test('legacy page-open endpoint is a no-op and rejects other methods',async()=>{
 const handle=createMaterialOpen({send:(res,status,body)=>Object.assign(res,{status,body})});
 const post={};await handle({method:'POST'},post);assert.equal(post.status,200);assert.deepEqual(post.body,{ok:true,deprecated:true});
 const get={};await handle({method:'GET'},get);assert.equal(get.status,405);
});
