import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminData} from './admin-data.mjs';

test('admin messages resolve sender code, nickname and pet name with one batched lookup per collection',async()=>{
  let authorized=true,batchReads=0,messageReads=0,notificationResets=0;
  const prefix='projects/test/databases/(default)/documents/';
  const key='a'.repeat(64);
  const documents=[
    {name:prefix+'developerMessages/msg1',fields:{uid:'userA',message:'Question 1',createdAt:'2026-11-06T01:00:00.000Z'}},
    {name:prefix+'developerMessages/msg2',fields:{uid:'userA',message:'Question 2',createdAt:'2026-11-06T01:01:00.000Z'}},
    {name:prefix+'developerMessages/msg3',fields:{uid:'legacyB',message:'Question 3',createdAt:'2026-11-06T01:02:00.000Z'}}
  ];
  const stored=new Map([
    [prefix+'account_uids/userA',{idKey:key}],
    [prefix+'code_accounts/'+key,{codeName:'AB3D7K'}],
    [prefix+'users/userA/apps/english-playroom',{nickname:'Alice',petName:'Fluffy'}],
    [prefix+'users/legacyB/apps/english-playroom',{nickname:'Bob',petName:'Rex'}]
  ]);
  const api=createAdminData({
    base:'https://firestore.test/db',projectId:'test',accessToken:async()=> 'access',
    verifyAdmin:async()=>{if(!authorized)throw Object.assign(Error('forbidden'),{status:403});return {uid:'admin'};},
    verifyUser:async()=>({uid:'admin'}),
    send:(res,status,body)=>Object.assign(res,{status,body}),
    fail:(message,status)=>Object.assign(Error(message),{status}),
    decodeFields:fields=>fields,normalizeNickname:value=>String(value||'').trim(),validNickname:value=>!!value,
    fetch:async(url,options={})=>{
      const u=new URL(url);
      if(u.pathname.endsWith('documents/developerMessages')){
        messageReads++;
        return {ok:true,json:async()=>({documents,nextPageToken:'next'})};
      }
      if(u.pathname.endsWith('documents:batchGet')){
        batchReads++;
        const payload=JSON.parse(options.body);
        assert.ok(payload.documents.length>=1);
        assert.ok(payload.documents.length<=100);
        return {ok:true,json:async()=>payload.documents.map(name=>stored.has(name)?{found:{name,fields:stored.get(name)}}:{missing:name})};
      }
      if(u.pathname.includes('/developerMessageNotifications/current')){
        assert.equal(options.method,'PATCH');
        notificationResets++;
        return {ok:true,status:200,json:async()=>({})};
      }
      throw Error('Unexpected request: '+url);
    }
  });
  const call=async path=>{const res={};await api.handle({method:'GET',url:path},res);return res;};
  const first=await call('/api/admin/contact-messages');
  assert.equal(first.status,200);
  assert.equal(first.body.messages.length,3);
  assert.deepEqual(first.body.messages[0].sender,{codeName:'AB3D7K',nickname:'Alice',petName:'Fluffy'});
  assert.deepEqual(first.body.messages[1].sender,first.body.messages[0].sender);
  assert.deepEqual(first.body.messages[2].sender,{codeName:'',nickname:'Bob',petName:'Rex'});
  assert.equal(batchReads,3,'index, code-account and profile reads are batched per page');
  assert.equal(notificationResets,1,'unread counter resets only on the first page');
  await call('/api/admin/contact-messages?pageToken=next');
  assert.equal(batchReads,3,'sender profiles are reused for later pages during cache TTL');
  assert.equal(messageReads,2);
  assert.equal(notificationResets,1);
  authorized=false;
  assert.equal((await call('/api/admin/contact-messages')).status,403,'sender identities remain admin-only');
});
