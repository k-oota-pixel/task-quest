import test from 'node:test';
import assert from 'node:assert/strict';
import {createTitlePopularity} from './title-popularity.mjs';
import {titleAuthority} from './title-authority.mjs';

test('one masked wallet read per registered user; signed duplicates counted once; missing account stays in denominator',async()=>{
 const authority=titleAuthority('popularity-test-key'),ids=['u1','u2','disabled'];
 const wallets={
  u1:{titleCollectionVersion:1,titleCollectionProof:authority.marker('u1'),earnedTitleIds:[
   authority.award('u1','retry:g2-50'),authority.award('u1','retry:g2-50'),
   authority.award('u1','eiken-retry:1'),authority.award('u1','nonexistent-title')]},
  u2:{titleCollectionVersion:1,titleCollectionProof:authority.marker('u2'),earnedTitleIds:[
   authority.award('u2','retry:g2-50'),authority.award('u1','retry:g2-50')]}
 };
 let calls=0;
 const request=async(_url,options)=>{
  calls++;
  const body=JSON.parse(options.body);
  assert.deepEqual(body.mask.fieldPaths,['earnedTitleIds','titleCollectionVersion','titleCollectionProof']);
  return {ok:true,json:async()=>body.documents.map(name=>{
   const uid=name.split('/users/')[1].split('/')[0];
   return wallets[uid]?{found:{name,fields:wallets[uid]}}:{missing:name};
  })};
 };
 const job=createTitlePopularity({
  base:'https://test.invalid',projectId:'test',accessToken:async()=> 'token',
  registeredIds:async()=>ids,decodeFields:fields=>fields,
  getAuthority:async()=>authority,fetch:request,now:()=>Date.parse('2026-11-16T21:10:00Z')
 });
 const result=await job.exportSnapshot();
 assert.equal(calls,1);
 assert.equal(result.totalRegistered,3);
 assert.equal(result.pendingInitializations,1);
 assert.equal(result.asOfDate,'2026-11-17');
 assert.equal(result.titles['retry:g2-50'],2);
 assert.equal(result.titles['eiken-retry:1'],1);
 assert.equal(result.titles['retry:g3-50'],0);
 assert.equal(result.titles['nonexistent-title'],undefined);
});

test('a missing batchGet document prevents publication of an incomplete snapshot',async()=>{
 const job=createTitlePopularity({
  base:'https://test.invalid',projectId:'test',accessToken:async()=> 'token',
  registeredIds:async()=>['u1'],decodeFields:fields=>fields,
  fetch:async()=>({ok:true,json:async()=>[]})
 });
 await assert.rejects(job.exportSnapshot(),/一部が取得できません/);
});
