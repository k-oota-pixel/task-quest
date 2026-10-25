import test from 'node:test';
import assert from 'node:assert/strict';
import {adventureLeaders,createAdventureRankings} from './adventure-rankings.mjs';
test('separate mode scores, ties, valid scores, top ten and names',()=>{
 const players=[{uid:'b',petName:'B',wordTowerBest:20,eikenDungeonBest:2},{uid:'a',petName:' A ',wordTowerBest:20,eikenDungeonBest:30},{uid:'c',wordTowerBest:10},{uid:'d',wordTowerBest:-1},{uid:'b',wordTowerBest:99}];
 assert.deepEqual(adventureLeaders(players,'tower').map(p=>[p.uid,p.floor,p.rank]),[['a',20,1],['b',20,1],['c',10,3]]);assert.equal(adventureLeaders(players,'dungeon')[0].uid,'a');assert.equal(adventureLeaders(players,'tower')[2].petName,'名前未設定のペット');assert.equal(adventureLeaders(Array.from({length:15},(_,i)=>({uid:String(i),wordTowerBest:i+1})),'tower').length,10);
});
test('reads existing wallets, caches both modes, decorates titles, hides uid and rejects writes',async()=>{
 let reads=0,t=0;const base='https://firestore.googleapis.com/v1/projects/p/databases/(default)',prefix='projects/p/databases/(default)/documents/';
 const api=createAdventureRankings({base,activeIds:async()=>['u','v'],accessToken:async()=>'token',decodeFields:x=>x,send:(r,status,body)=>Object.assign(r,{status,body}),fail:(m,s)=>Object.assign(Error(m),{status:s}),now:()=>t,decorate:async rows=>rows.map(({uid,...r})=>({...r,title:uid==='u'?'魔王の塔の覇者':'称号なし'})),fetch:async(url,o)=>{reads++;const q=JSON.parse(o.body);assert.deepEqual(q.mask.fieldPaths,['petName','wordTowerBest','eikenDungeonBest']);return {ok:true,json:async()=>[{found:{name:prefix+'users/u/apps/english-playroom',fields:{petName:'もこ',wordTowerBest:50,eikenDungeonBest:10}}},{found:{name:prefix+'users/v/apps/english-playroom',fields:{petName:'まる',wordTowerBest:5,eikenDungeonBest:30}}},{found:{name:prefix+'users/stranger/apps/english-playroom',fields:{wordTowerBest:999}}}]};}});
 const get=async(mode,method='GET')=>{const r={};await api.handle({method,url:'/api/adventure/rankings?mode='+mode},r);return r;};
 let r=await get('tower');assert.equal(r.status,200);assert.deepEqual(r.body.leaders[0],{petName:'もこ',floor:50,rank:1,title:'魔王の塔の覇者'});r=await get('dungeon');assert.equal(r.body.leaders[0].petName,'まる');assert.equal(reads,1);t=60001;await get('tower');assert.equal(reads,2);assert.equal((await get('unknown')).status,400);assert.equal((await get('tower','POST')).status,405);
});
test('backend failures remain errors and concurrent clicks share one scan',async()=>{
 let reads=0,release;const api=createAdventureRankings({base:'https://db',activeIds:async()=>['u'],accessToken:async()=>'t',decodeFields:x=>x,decorate:async x=>x,send:(r,status,body)=>Object.assign(r,{status,body}),fail:(m,s)=>Object.assign(Error(m),{status:s}),fetch:async()=>{reads++;await new Promise(r=>release=r);return {ok:false};}});
 const a={},b={};const first=api.handle({method:'GET',url:'/?mode=tower'},a),second=api.handle({method:'GET',url:'/?mode=dungeon'},b);while(!release)await new Promise(r=>setImmediate(r));release();await Promise.all([first,second]);assert.equal(reads,1);assert.equal(a.status,503);assert.equal(b.status,503);
});
