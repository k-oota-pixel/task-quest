import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestVerifier,isAdministrator} from './request-auth.mjs';
const fail=(message,status)=>Object.assign(Error(message),{status});

test('concurrent and repeated checks in one request share authentication and admission',async()=>{
 let authentications=0,reads=0;
 const user={uid:'student'},verify=createRequestVerifier({verifyRawUser:async()=>{authentications++;return user;},admission:async()=>{reads+=2;return {resetRequired:false};},fail}),req={};
 const results=await Promise.all([verify(req),verify(req),verify(req)]);await verify(req);
 assert.ok(results.every(value=>value===user));assert.equal(authentications,1);assert.equal(reads,2);
});
test('a new request immediately sees account resets and changed registration state',async()=>{
 let reads=0,resetRequired=false,denied=false;
 const verify=createRequestVerifier({verifyRawUser:async()=>({uid:'student'}),admission:async()=>{reads+=2;if(denied)throw fail('login required',401);return {resetRequired};},fail});
 await verify({});resetRequired=true;await assert.rejects(verify({}),{status:403});resetRequired=false;denied=true;await assert.rejects(verify({}),{status:401});assert.equal(reads,6);
});
test('separate users and separate requests cannot reuse another result',async()=>{
 let reads=0;const verify=createRequestVerifier({verifyRawUser:async req=>({uid:req.uid}),admission:async()=>{reads+=2;return {};},fail});
 assert.equal((await verify({uid:'one'})).uid,'one');assert.equal((await verify({uid:'two'})).uid,'two');assert.equal((await verify({uid:'one'})).uid,'one');assert.equal(reads,6);
});
test('failed authentication or admission remains denied, and is not repeated inside the request',async()=>{
 let checks=0,reads=0;
 const verify=createRequestVerifier({verifyRawUser:async req=>{checks++;if(req.disabled)throw fail('disabled',401);return {uid:'student'};},admission:async()=>{reads+=2;throw fail('registration required',403);},fail});
 const disabled={disabled:true};await assert.rejects(verify(disabled),{status:401});await assert.rejects(verify(disabled),{status:401});assert.equal(checks,1);assert.equal(reads,0);
 const req={};await assert.rejects(verify(req),{status:403});await assert.rejects(verify(req),{status:403});assert.equal(checks,2);assert.equal(reads,2);
});
test('administrator hints use the same verified-email policy as privileged endpoints',()=>{
 assert.equal(isAdministrator({email:'TEACHER@example.test',emailVerified:true},'teacher@example.test'),true);
 for(const user of [{email:'student@example.test',emailVerified:true},{email:'teacher@example.test',emailVerified:false},{email:'teacher@example.test',emailVerified:'true'},null])assert.equal(isAdministrator(user,'teacher@example.test'),false);
 assert.equal(isAdministrator({email:'teacher@example.test',emailVerified:true},''),false);
});
