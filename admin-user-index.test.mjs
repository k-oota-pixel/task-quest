import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminUserIndex} from './admin-user-index.mjs';

test('first admin lookup builds index once; following reads fetch only one document',async()=>{
 const indexPath='https://firestore.test/documents/admin_search_index/current';
 let document=null,reads=0,profileReads=0,commits=0,authLists=0;
 const profiles={u1:{nickname:'モンスター',petName:'もんた',coins:23},u2:{nickname:'きらり',petName:'キラ',coins:34}};
 const api=createAdminUserIndex({
  base:'https://firestore.test',projectId:'test',
  accessToken:async()=> 'token',verifyAdmin:async()=>true,verifyUser:async()=>({uid:'u1'}),
  encodeFields:x=>x,decodeFields:x=>x,send:(res,status,body)=>Object.assign(res,{status,body}),
  fail:(msg,status)=>Object.assign(new Error(msg),{status}),
  now:()=>1700000000000,
  fetchImpl:async(input,opt={})=>{
   const url=String(input);const path=new URL(url).pathname;
   if(url===indexPath){reads++;return document?{ok:true,json:async()=>document}:{status:404};}
   if(path.includes('accounts:batchGet')){authLists++;return {ok:true,json:async()=>({users:[{localId:'u1'},{localId:'u2'}]})};}
   if(path.endsWith('documents:runQuery'))return {ok:true,json:async()=>[
    {document:{name:'projects/test/databases/(default)/documents/code_accounts/a',fields:{uid:'u1',codeName:'AB123',loginId:'code1'}}},
    {document:{name:'projects/test/databases/(default)/documents/code_accounts/b',fields:{uid:'u2',codeName:'CD456',loginId:'code2'}}}
   ]};
   if(path.endsWith('documents:batchGet'))return {ok:true,json:async()=>Object.entries(profiles).map(([uid,fields])=>({found:{name:'projects/test/databases/(default)/documents/users/'+uid+'/apps/english-playroom',fields}}))};
   if(path.endsWith('documents:commit')){
    commits++;const body=JSON.parse(opt.body);
    const write=body.writes[0];
    if(write.currentDocument?.updateTime && write.currentDocument.updateTime!==document?.updateTime)return {ok:false,status:412,json:async()=>({})};
    document={fields:write.update.fields,updateTime:'v'+commits};return {ok:true,json:async()=>({})};
   }
   if(path.includes('/users/u1/apps/english-playroom')){profileReads++;return {ok:true,json:async()=>({fields:profiles.u1})};}
   if(path.includes('/users/u2/apps/english-playroom')){profileReads++;return {ok:true,json:async()=>({fields:profiles.u2})};}
   throw Error('Unexpected '+url);
  }
 });
 const a={};await api.get({method:'GET',url:'/api/admin/search-index'},a);
 assert.equal(a.status,200);assert.equal(a.body.users.length,2);
 assert.equal(a.body.users[0].petName,'もんた');
 assert.equal(authLists,1);assert.equal(commits,1);
 const before=reads,b={};
 await api.get({method:'GET',url:'/api/admin/search-index'},b);
 assert.equal(b.status,200);assert.equal(reads-before,1);assert.equal(authLists,1);assert.equal(commits,1);
 const details={};await api.lookup({method:'GET',url:'/api/admin/search-user?uid=u1'},details);
 assert.equal(details.status,200);assert.equal(details.body.coins,23);assert.equal(profileReads,1);
 profiles.u1.petName='新しいペット';
 await api.sync('u1');
 const c={};await api.get({method:'GET',url:'/api/admin/search-index'},c);
 assert.equal(c.body.users.find(u=>u.uid==='u1').petName,'新しいペット');
 assert.equal(commits,2);
});


test('gift pet-name searches reuse one index read for 60 seconds and invalidate after a profile sync',async()=>{
 let time=100000,indexReads=0,profileName='ポチ';
 let saved={updateTime:'v1',fields:{users:[
   {uid:'a',petName:'ぺっと',nickname:'あお'},
   {uid:'b',petName:'ポチ',nickname:'びー'}
 ]}};
 const api=createAdminUserIndex({
  base:'https://firestore.test',projectId:'test',
  accessToken:async()=>'token',verifyAdmin:async()=>true,verifyUser:async()=>({uid:'a'}),
  encodeFields:x=>x,decodeFields:x=>x,send:(res,status,body)=>Object.assign(res,{status,body}),
  fail:(message,status)=>Object.assign(new Error(message),{status}),now:()=>time,
  fetchImpl:async(url,options={})=>{
   if(url==='https://firestore.test/documents/admin_search_index/current'){
    indexReads++;return {ok:true,status:200,json:async()=>structuredClone(saved)};
   }
   if(url.includes('/users/b/apps/english-playroom')){
    return {ok:true,status:200,json:async()=>({fields:{petName:profileName,nickname:'びー'}})};
   }
   if(url.endsWith('/documents:commit')){
    const write=JSON.parse(options.body).writes[0];
    saved={updateTime:'v2',fields:structuredClone(write.update.fields)};
    return {ok:true,status:200,json:async()=>({})};
   }
   throw Error('unexpected '+url);
  }
 });
 let result=await api.searchGift('ポ','a');
 assert.deepEqual(result,[{uid:'b',petName:'ポチ',nickname:'びー'}]);
 await api.searchGift('ポ','a');
 assert.equal(indexReads,1);
 time+=60001;await api.searchGift('ポ','a');
 assert.equal(indexReads,2);
 profileName='もも';
 await api.sync('b');
 result=await api.searchGift('ポ','a');
 assert.deepEqual(result,[]);
 assert.equal(indexReads,4); // cached search read, sync read, fresh search read
});
