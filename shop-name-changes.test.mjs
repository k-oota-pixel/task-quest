import test from 'node:test';
import assert from 'node:assert/strict';
import {createShopNameChanges,normalizeShopName} from './shop-name-changes.mjs';
const registry=n=>'nickname_registry/'+Buffer.from(n.toLowerCase()).toString('base64url');
function fixture({coins=90,duplicate=false,conflict=false}={}){
 const docs=new Map([['users/u/apps/english-playroom',{updateTime:'v1',fields:{petHatched:{booleanValue:true},coins:{integerValue:String(coins)},nickname:{stringValue:'Old'},petName:{stringValue:'Cat'}}}],[registry('Old'),{updateTime:'old-v1',fields:{uid:{stringValue:'u'}}}]]);
 if(duplicate)docs.set(registry('New'),{updateTime:'other',fields:{uid:{stringValue:'other'}}});
 const commits=[];let failed=false;
 const rename=createShopNameChanges({base:'https://db',projectId:'p',fetchImpl:async(url,options)=>{
   if(!url.endsWith(':commit')){const doc=docs.get(url.split('/documents/')[1]);return {ok:!!doc,status:doc?200:404,json:async()=>structuredClone(doc)};}
   const body=JSON.parse(options.body);commits.push(body);
   if(conflict&&!failed){failed=true;const doc=docs.get('users/u/apps/english-playroom');doc.updateTime='v2';doc.fields.coins.integerValue='80';return {ok:false,status:409,json:async()=>({error:{status:'FAILED_PRECONDITION'}})};}
   for(const w of body.writes){if(w.delete)docs.delete(w.delete.split('/documents/')[1]);else{const key=w.update.name.split('/documents/')[1],prev=docs.get(key);docs.set(key,{updateTime:'next',fields:{...prev?.fields,...w.update.fields}});}}
   return {ok:true};
 }});
 return {rename,commits,docs};
}
test('pet rename charges exactly 30 and updates only the pet name and wallet',async()=>{
 const f=fixture();assert.deepEqual(await f.rename('token','u','pet','Luna'),{name:'Luna',coins:60});
 const writes=f.commits[0].writes;assert.equal(writes.length,1);assert.deepEqual(writes[0].updateMask.fieldPaths,['coins','petName']);assert.deepEqual(writes[0].currentDocument,{updateTime:'v1'});
});
test('user rename claims new name, releases owned old name, and charges atomically',async()=>{
 const f=fixture();await f.rename('token','u','user','New');assert.equal(f.commits.length,1);assert.equal(f.commits[0].writes.length,3);
 assert.equal(f.docs.has(registry('Old')),false);assert.equal(f.docs.get(registry('New')).fields.uid.stringValue,'u');assert.equal(f.docs.get('users/u/apps/english-playroom').fields.coins.integerValue,'60');
});
test('duplicate names, insufficient funds, same name, no pet and invalid input never commit',async()=>{
 for(const setup of [{duplicate:true},{coins:29}]){const f=fixture(setup);await assert.rejects(f.rename('t','u','user','New'));assert.equal(f.commits.length,0);}
 const f=fixture();await assert.rejects(f.rename('t','u','pet','Cat'));f.docs.get('users/u/apps/english-playroom').fields.petHatched.booleanValue=false;await assert.rejects(f.rename('t','u','pet','New'));assert.equal(f.commits.length,0);
 for(const [kind,name] of [['other','New'],['pet',''],['user','a\n'],['pet','a'.repeat(13)],['user','a'.repeat(21)]])assert.throws(()=>normalizeShopName(kind,name));
});
test('wallet contention rereads current balance before charging',async()=>{
 const f=fixture({conflict:true});assert.equal((await f.rename('t','u','pet','Luna')).coins,50);assert.equal(f.commits.length,2);assert.equal(f.commits[1].writes[0].currentDocument.updateTime,'v2');
});
test('normalized case-only rename keeps the same registry entry',async()=>{
 const f=fixture();await f.rename('t','u','user','ＯＬＤ');assert.equal(f.commits[0].writes.length,2);assert.equal(f.docs.has(registry('Old')),true);assert.equal(f.docs.get('users/u/apps/english-playroom').fields.nickname.stringValue,'OLD');
});
