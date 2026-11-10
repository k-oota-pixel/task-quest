import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminMessagePages} from './admin-message-pages.mjs';

test('history migrates to 50-item documents, archives remain intact after new message',async()=>{
 const docs=new Map(),counts={headReads:0,legacyReads:0,commits:0};
 let clock=1700000000000;
 const original=Array.from({length:53},(_,i)=>({id:'m'+i,uid:'user1',message:'Message '+i,createdAt:new Date(clock-i*1000).toISOString()}));
 const service=createAdminMessagePages({
  base:'https://firestore.test',projectId:'test',accessToken:async()=> 'token',
  encodeFields:x=>x,decodeFields:x=>x,now:()=>clock++,
  getProfiles:async()=>new Map([['user1',{codeName:'ABC',nickname:'たろう',petName:'もんた'}]]),
  fetchImpl:async(input,opt={})=>{
   const url=new URL(String(input)),path=url.pathname;
   if(path.includes('/admin_message_pages/')){
    const id=path.split('/').at(-1);if(id==='current')counts.headReads++;
    return docs.has(id)?{ok:true,json:async()=>docs.get(id)}:{status:404};
   }
   if(path.endsWith('/developerMessages')){
    counts.legacyReads++;
    const start=Number(url.searchParams.get('pageToken')||'0');
    const slice=original.slice(start,start+50).map(m=>({name:'projects/test/databases/(default)/documents/developerMessages/'+m.id,fields:{uid:m.uid,message:m.message,createdAt:m.createdAt}}));
    return {ok:true,json:async()=>({documents:slice,nextPageToken:start+50<original.length?String(start+50):''})};
   }
   if(path.endsWith('documents:commit')){
    counts.commits++;
    for(const write of JSON.parse(opt.body).writes){
     const id=write.update.name.split('/').at(-1);
     const previous=docs.get(id);
     if(write.currentDocument?.exists===false&&previous)return {ok:false,status:412,json:async()=>({})};
     if(write.currentDocument?.updateTime&&previous?.updateTime!==write.currentDocument.updateTime)return {ok:false,status:412,json:async()=>({})};
     docs.set(id,{fields:write.update.fields,updateTime:'t'+counts.commits});
    }
    return {ok:true,json:async()=>({})};
   }
   throw Error('Unexpected URL '+url);
  }
 });
 let a=await service.list('');
 assert.equal(a.messages.length,50);assert.equal(a.nextPageToken,'arch_000001');
 assert.equal(a.messages[0].sender.petName,'もんた');
 let old=await service.list(a.nextPageToken);
 assert.equal(old.messages.length,3);assert.equal(old.nextPageToken,null);
 assert.equal(counts.legacyReads,2);
 const before=counts.headReads;
 await service.list('');
 assert.equal(counts.headReads-before,1);
 assert.equal(counts.legacyReads,2,'cached pages require no original document reads');
 await service.append({id:'m-new',uid:'user1',message:'New message',createdAt:new Date(clock).toISOString()});
 a=await service.list('');
 assert.equal(a.messages.length,1);
 assert.equal(a.messages[0].id,'m-new');
 const archived=await service.list(a.nextPageToken);
 assert.equal(archived.messages.length,50);
 assert.equal(archived.nextPageToken,'arch_000001');
 const oldest=await service.list(archived.nextPageToken);
 assert.equal(oldest.messages.length,3);
 assert.equal(counts.legacyReads,2);
});
