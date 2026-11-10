import test from 'node:test';
import assert from 'node:assert/strict';
import {createPetFriends} from './pet-friends.mjs';

const clone=x=>structuredClone(x);
function fixture(){
 const profiles={
  alice:{nickname:'あかり',petName:'さくら',coins:999,petHatched:true,petAdult:true,petAppearance:{species:'cat'},petShop:{ownedItems:['frame1'],equipped:{frames:'frame1'}}},
  bob:{nickname:'ボブ',petName:'ぽち',coins:3,petHatched:true,petAdult:true,petAppearance:{species:'dog'},petShop:{ownedItems:[],equipped:{}}}
 };
 const docs=new Map(Object.entries(profiles).map(([uid,fields])=>['users/'+uid+'/apps/english-playroom',{fields:clone(fields),updateTime:'v0'}]));
 const count={reads:0,writes:0,commits:0};
 const api=createPetFriends({
  base:'https://firestore.test',projectId:'test',accessToken:async()=> 'token',
  verifyUser:async req=>({uid:req.uid}),readJson:async req=>req.body,encodeFields:x=>x,decodeFields:x=>x,
  send:(res,status,body)=>Object.assign(res,{status,body}),searchUsers:async(q,uid)=>Object.entries(profiles)
   .filter(([id,v])=>id!==uid&&(v.nickname.includes(q)||v.petName.includes(q)))
   .map(([id,v])=>({uid:id,nickname:v.nickname,petName:v.petName})),
  fetchImpl:async(url,opts={})=>{
   if(url.endsWith(':commit')){
    count.commits++;const writes=JSON.parse(opts.body).writes;
    for(const item of writes){
     const path=item.update.name.split('/documents/')[1],raw=docs.get(path);
     if((item.currentDocument.exists===false&&raw)||
        (item.currentDocument.updateTime&&item.currentDocument.updateTime!==raw?.updateTime))
      return {ok:false,status:409,json:async()=>({})};
    }
    for(const item of writes){
     const path=item.update.name.split('/documents/')[1],raw=docs.get(path);
     docs.set(path,{fields:{...raw?.fields,...clone(item.update.fields)},updateTime:'v'+count.commits});
    }
    count.writes+=writes.length;
    return {ok:true,status:200,json:async()=>({})};
   }
   count.reads++;
   const path=url.split('/documents/')[1],raw=docs.get(path);
   return raw?{ok:true,status:200,json:async()=>clone(raw)}:{ok:false,status:404,json:async()=>({})};
  }
 });
 async function call(uid,path,body){
  const res={};await api.handle({uid,url:'/api/friends'+path,method:body?'POST':'GET',headers:{'content-type':'application/json'},body},res,('/api/friends'+path).split('?')[0]);return res;
 }
 return {call,docs,count};
}
test('friend request and acceptance atomically update only two social documents',async()=>{
 const f=fixture();
 const sent=await f.call('alice','/request',{targetUid:'bob'});
 assert.equal(sent.status,200);assert.equal(f.count.reads,4);assert.equal(f.count.writes,2);
 const listing=await f.call('bob','');
 assert.equal(listing.status,200);assert.equal(f.count.reads,5);
 assert.equal(listing.body.incoming[0].nickname,'あかり');
 const reply=await f.call('bob','/respond',{senderUid:'alice',accept:true});
 assert.equal(reply.status,200);assert.equal(f.count.writes,4);
 const friends=await f.call('alice','');
 assert.equal(friends.body.friends.length,1);assert.equal(friends.body.friends[0].petName,'ぽち');
 assert.equal(friends.body.outgoing.length,0);
 assert.equal(f.docs.get('users/alice/apps/english-playroom').fields.coins,999);
 const remove=await f.call('alice','/remove',{targetUid:'bob'});
 assert.equal(remove.status,200);assert.equal(f.count.writes,6);
 assert.deepEqual((await f.call('bob','')).body.friends,[]);
});
test('rejecting a request deletes pending from both without creating friendship',async()=>{
 const f=fixture();
 await f.call('alice','/request',{targetUid:'bob'});
 let res=await f.call('bob','/respond',{senderUid:'alice',accept:false});
 assert.equal(res.status,200);
 assert.deepEqual((await f.call('alice','')).body.outgoing,[]);
 assert.deepEqual((await f.call('bob','')).body.friends,[]);
});
test('a repeated request is idempotent without extra writes',async()=>{
 const f=fixture();
 await f.call('alice','/request',{targetUid:'bob'});
 const before=f.count.writes;
 const res=await f.call('alice','/request',{targetUid:'bob'});
 assert.equal(res.body.alreadyRequested,true);assert.equal(f.count.writes,before);
});
test('pet profile costs one document read and never leaks private fields',async()=>{
 const f=fixture();
 let r=await f.call('alice','/pet?uid=bob');
 assert.equal(r.status,200);assert.equal(f.count.reads,1);
 assert.equal(r.body.petName,'ぽち');assert.equal(r.body.coins,undefined);
 const ownPrivacy=await f.call('bob','/privacy',{visible:false});
 assert.equal(ownPrivacy.status,200);
 r=await f.call('alice','/pet?uid=bob');
 assert.equal(r.status,403);
 r=await f.call('bob','/pet?uid=bob');
 assert.equal(r.status,200);
});
test('search supports nickname and pet names without Firestore list scanning',async()=>{
 const f=fixture();
 assert.deepEqual((await f.call('alice','/search?q=%E3%83%9C%E3%83%96')).body.users.map(x=>x.uid),['bob']);
 assert.deepEqual((await f.call('alice','/search?q=%E3%81%BD%E3%81%A1')).body.users.map(x=>x.uid),['bob']);
 assert.equal(f.count.reads,0);
});
