import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminData} from './admin-data.mjs';
test('screen logs require admin, cap ten users, read only retry data and cache reads',async()=>{
 let reads=0,authorized=true;
 const api=createAdminData({base:'https://db.test',projectId:'test',accessToken:async()=> 'token',verifyAdmin:async()=>{if(!authorized)throw Object.assign(Error('denied'),{status:403});},send:(res,status,body)=>Object.assign(res,{status,body}),fail:(message,status)=>Object.assign(Error(message),{status}),decodeFields:x=>x,fetch:async(url,opt)=>{
  reads++;const body=JSON.parse(opt.body);assert.deepEqual(body.mask.fieldPaths,['state.screenLogs']);assert.equal(body.documents.length,1);assert.match(body.documents[0],/\/apps\/eiken-retry$/);
  return {ok:true,json:async()=>[{found:{fields:{state:{screenLogs:[{id:'one',count:2,totalMs:5000}]}}}}]};
 }});
 const call=async query=>{const res={};await api.handle({method:'GET',url:'/api/admin/retry-screen-logs?uids='+query},res);return res;};
 assert.equal(reads,0);const result=await call('u1,u2');assert.equal(result.status,200);assert.equal(result.body.users[0].logs[0].count,2);assert.equal(reads,2);
 await call('u1,u2');assert.equal(reads,2);
 assert.equal((await call(Array.from({length:11},(_,i)=>'u'+i).join(','))).status,400);assert.equal(reads,2);
 authorized=false;assert.equal((await call('u1')).status,403);assert.equal(reads,2);
});
