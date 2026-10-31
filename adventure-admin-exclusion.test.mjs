import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdventureRankings} from './adventure-rankings.mjs';
const send=(res,status,body)=>Object.assign(res,{status,body}),fail=(message,status)=>Object.assign(Error(message),{status});
test('admin is removed from old summaries, eligible player fills third place, and POST cannot reinsert admin',async()=>{
 const base='https://firestore.googleapis.com/v1/projects/p/databases/(default)',prefix='projects/p/databases/(default)/documents/';
 let scans=0,writes=0;const stored={schemaVersion:1,tower:[{uid:'admin',petName:'admin',floor:90},{uid:'a',petName:'A',floor:50},{uid:'b',petName:'B',floor:40}],dungeon:[{uid:'admin',petName:'admin',floor:90}]};
 let cachedFile={fetchedAt:0,tower:[{petName:'admin',floor:90}],dungeon:[]};
 const api=createAdventureRankings({base,excludedIds:async()=>['admin'],activeIds:async()=>['admin','a','b','c'],accessToken:async()=>'token',decodeFields:v=>v,send,fail,
 rankingStore:{async getSection(key,{load,valid}){if(!valid(cachedFile))cachedFile=await load();return cachedFile;},async setSection(key,value){cachedFile=value;}},
 fetch:async(url,options={})=>{const target=String(url);
 if(target.includes('identitytoolkit'))return {ok:true,json:async()=>({users:[{localId:'admin'}]})};
 if(target.includes('documents:batchGet')){scans++;const names=JSON.parse(options.body).documents;assert.ok(names.every(n=>!n.includes('/users/admin/')));return {ok:true,json:async()=>['a','b','c'].map((uid,i)=>({found:{name:prefix+`users/${uid}/apps/english-playroom`,fields:{petName:uid.toUpperCase(),wordTowerBest:50-i*10,eikenDungeonBest:10}}}))};}
 if(target.includes('/leaderboards/adventure')){if(options.method==='PATCH'){writes++;return {ok:true,json:async()=>({updateTime:'v2'})};}return {ok:true,json:async()=>({fields:stored,updateTime:'v1'})};}
 throw Error('Unexpected '+target);}});
 const res={};await api.handle({method:'GET',url:'/?mode=tower',headers:{}},res);assert.equal(res.status,200);assert.deepEqual(res.body.leaders.map(r=>r.petName),['A','B','C']);assert.deepEqual(res.body.leaders.map(r=>r.rank),[1,2,3]);assert.equal(scans,1);assert.equal(writes,1);
 assert.equal(await api.publish({uid:'admin',mode:'tower',floor:999,petName:'admin'}),null);
 const post={};await api.handle({method:'POST',url:'/',headers:{authorization:'Bearer admin','content-type':'application/json'},body:{mode:'tower',expectedFloor:999}},post);assert.equal(post.status,200);assert.equal(post.body.excluded,true);assert.equal(writes,1);
});

