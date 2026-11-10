import test from 'node:test';
import assert from 'node:assert/strict';
import {createShopGifts} from './shop-gifts.mjs';

const giftId='00000000-0000-4000-8000-000000000001';
const body={giftId,recipientUid:'bob',recipientPetName:'ポチ',recipientNickname:'太郎',itemId:'red-ribbon',messageId:'thanks'};
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture({coins=40,owned=[],conflict=false}={}){
 const alice='users/alice/apps/english-playroom',bob='users/bob/apps/english-playroom';
 const docs=new Map([
  [alice,{fields:{coins,nickname:'あかり',petName:'さくら',petShop:{ownedItems:[],equipped:{}}},updateTime:'v1'}],
  [bob,{fields:{coins:80,nickname:'太郎',petName:'ポチ',petShop:{ownedItems:owned,equipped:{backgrounds:'forest-bg'}}},updateTime:'v1'}]
 ]);
 const counts={reads:0,commits:0,writes:0};let conflicted=false;const writesLog=[];
 const fetchImpl=async(url,options={})=>{
  if(url.endsWith(':commit')){
   counts.commits++;
   const writes=JSON.parse(options.body).writes;writesLog.push(writes);
   if(conflict&&!conflicted){
    conflicted=true;
    docs.get(alice).updateTime='v2';docs.get(alice).fields.coins-=10;
    return {ok:false,status:409,json:async()=>({error:{status:'FAILED_PRECONDITION'}})};
   }
   for(const w of writes){
    const key=w.update.name.split('/documents/')[1],prev=docs.get(key);
    if((w.currentDocument.exists===false&&prev)||(w.currentDocument.updateTime&&w.currentDocument.updateTime!==prev?.updateTime))
     return {ok:false,status:409,json:async()=>({error:{status:'FAILED_PRECONDITION'}})};
   }
   for(const w of writes){
    const key=w.update.name.split('/documents/')[1],prev=docs.get(key);
    docs.set(key,{fields:{...prev?.fields,...w.update.fields},updateTime:'v'+counts.commits});
   }
   counts.writes+=writes.length;
   return {ok:true,json:async()=>({})};
  }
  counts.reads++;
  const key=url.split('/documents/')[1],doc=docs.get(key);
  return doc?{ok:true,status:200,json:async()=>clone(doc)}:{ok:false,status:404,json:async()=>({})};
 };
 const common={base:'https://firestore.test',projectId:'test',accessToken:async()=> 'token',readJson:async req=>req.body,
  send:(res,status,payload)=>Object.assign(res,{status,payload}),encodeFields:x=>x,decodeFields:x=>x,
  searchUsers:async()=>[{uid:'bob',nickname:'太郎',petName:'ポチ'}],fetchImpl};
 function user(uid){return createShopGifts({...common,verifyUser:async()=>({uid})});}
 async function call(uid,route,payload){
  const res={};const path='/api/shop/gifts/'+route;
  await user(uid).handle({method:route==='search'?'GET':'POST',url:path,headers:{'content-type':'application/json'},body:payload},res,path);
  return res;
 }
 return {docs,counts,writesLog,alice,bob,call};
}
test('gift send is atomic: two document reads, three writes and exactly one charge',async()=>{
 const f=fixture(),result=await f.call('alice','send',body);
 assert.equal(result.status,200);assert.equal(f.counts.reads,2);assert.equal(f.counts.writes,3);
 assert.equal(f.docs.get(f.alice).fields.coins,35);
 const target=f.docs.get(f.bob).fields;
 assert.deepEqual(target.petShop.ownedItems,['red-ribbon']);assert.equal(target.petShop.equipped.backgrounds,'forest-bg');
 assert.equal(target.giftUnreadCount,1);assert.equal(target.giftInbox[0].opened,false);
 assert.equal(f.writesLog[0].length,3);
 const again=await f.call('alice','send',body);
 assert.equal(again.status,200);assert.equal(again.payload.alreadySent,true);
 assert.equal(f.docs.get(f.alice).fields.coins,35);assert.equal(f.counts.writes,3);
});
test('already-owned, insufficient-coins and stale recipient name are rejected without writes',async()=>{
 for(const options of [{owned:['red-ribbon']},{coins:3},{}]){
  const f=fixture(options),payload=options.owned||options.coins?body:{...body,recipientNickname:'違う名前'};
  const r=await f.call('alice','send',payload);
  assert.equal(r.status,409);assert.equal(f.counts.writes,0);assert.equal(f.docs.get(f.alice).fields.coins,options.coins??40);
 }
});
test('open, one preset reply and sender acknowledgement update the existing user docs',async()=>{
 const f=fixture();await f.call('alice','send',body);
 let r=await f.call('bob','reply',{giftId,replyId:'thanks'});assert.equal(r.status,409);
 r=await f.call('bob','open',{giftId});assert.equal(r.status,200);
 assert.equal(f.docs.get(f.bob).fields.giftUnreadCount,0);
 r=await f.call('bob','reply',{giftId,replyId:'thanks'});assert.equal(r.status,200);
 assert.equal(f.docs.get(f.alice).fields.giftUnreadReplyCount,1);
 r=await f.call('bob','reply',{giftId,replyId:'happy'});assert.equal(r.payload.alreadyReplied,true);
 r=await f.call('alice','seen',{giftId});assert.equal(r.status,200);
 assert.equal(f.docs.get(f.alice).fields.giftUnreadReplyCount,0);
 assert.equal(f.counts.writes,7);
});
test('concurrent wallet change re-reads and charges the up-to-date balance only',async()=>{
 const f=fixture({conflict:true}),result=await f.call('alice','send',body);
 assert.equal(result.status,200);assert.equal(f.counts.commits,2);
 assert.equal(f.docs.get(f.alice).fields.coins,25);assert.equal(f.counts.writes,3);
});
