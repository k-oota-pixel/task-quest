import test from 'node:test';
import assert from 'node:assert/strict';
import {adventureLeaders,createAdventureRankings,TOWER_SEASON} from './adventure-rankings.mjs';

const send=(response,status,body)=>Object.assign(response,{status,body});
const fail=(message,status)=>Object.assign(Error(message),{status});

test('keeps only ranks 1-3 while preserving ties and excludes old tower seasons',()=>{
 const players=[
  {uid:'a',petName:'A',wordTowerBest:50,wordTowerSeason:TOWER_SEASON,eikenDungeonBest:10},
  {uid:'b',petName:'B',wordTowerBest:40,wordTowerSeason:TOWER_SEASON,eikenDungeonBest:30},
  {uid:'c',petName:'C',wordTowerBest:30,wordTowerSeason:TOWER_SEASON},
  {uid:'d',petName:'D',wordTowerBest:30,wordTowerSeason:TOWER_SEASON},
  {uid:'e',petName:'E',wordTowerBest:20,wordTowerSeason:TOWER_SEASON},
  {uid:'old',petName:'OLD',wordTowerBest:99,wordTowerSeason:'old-season'},
  {uid:'b',petName:'duplicate',wordTowerBest:99,wordTowerSeason:TOWER_SEASON}
 ];
 assert.deepEqual(adventureLeaders(players,'tower').map(row=>[row.uid,row.floor,row.rank]),[['a',50,1],['b',40,2],['c',30,3],['d',30,3]]);
 assert.equal(adventureLeaders(players,'dungeon')[0].uid,'b');
 assert.equal(adventureLeaders([{uid:'x',wordTowerBest:10,wordTowerSeason:TOWER_SEASON}],'tower')[0].petName,'名前未設定のペット');
 assert.equal(adventureLeaders([{uid:'old',wordTowerBest:100,wordTowerSeason:'old-season'}],'tower').length,0);
});

test('normal GET restores one current-season summary document once, then serves the unified ranking file',async()=>{
 let summaryReads=0,scans=0,t=0;
 const stored={schemaVersion:2,towerSeason:TOWER_SEASON,tower:[{uid:'u',petName:'もこ',floor:50},{uid:'v',petName:'まる',floor:40},{uid:'w',petName:'ぽち',floor:30}],dungeon:[{uid:'v',petName:'まる',floor:25}]};
 const api=createAdventureRankings({
  base:'https://firestore.googleapis.com/v1/projects/p/databases/(default)',
  activeIds:async()=>{scans++;return ['should-not-scan'];},accessToken:async()=>'token',decodeFields:value=>value,send,fail,now:()=>t,
  decorate:async rows=>rows.map(({uid,...row})=>({...row,title:uid==='u'?'魔王の塔の覇者':'称号なし'})),
  fetch:async(url,options={})=>{
   const target=String(url);
   if(target.includes('/documents/leaderboards/adventure')&&options.method!=='PATCH'){summaryReads++;return {ok:true,status:200,json:async()=>({fields:stored,updateTime:'v1'})};}
   throw Error('unexpected request '+target);
  }
 });
 const get=async mode=>{const response={};await api.handle({method:'GET',url:'/?mode='+mode,headers:{}},response);return response;};
 let response=await get('tower');assert.equal(response.status,200);assert.equal(response.body.leaders.length,3);assert.deepEqual(response.body.leaders[0],{petName:'もこ',floor:50,rank:1,title:'魔王の塔の覇者'});
 response=await get('dungeon');assert.equal(response.body.leaders[0].petName,'まる');assert.equal(summaryReads,1);assert.equal(scans,0);
 t=60001;await get('tower');assert.equal(summaryReads,1);assert.equal(scans,0);
 assert.equal((await get('unknown')).status,400);
});

test('old-season summary is rebuilt and tower rows only use the current season',async()=>{
 let writes=0,scans=0;
 const base='https://firestore.googleapis.com/v1/projects/p/databases/(default)',prefix='projects/p/databases/(default)/documents/';
 const api=createAdventureRankings({
  base,activeIds:async()=>{scans++;return ['new','old'];},accessToken:async()=>'token',decodeFields:value=>value,send,fail,
  fetch:async(url,options={})=>{
   const target=String(url),method=options.method||'GET';
   if(target.includes('/documents:batchGet'))return {ok:true,status:200,json:async()=>[
    {found:{name:prefix+'users/new/apps/english-playroom',fields:{petName:'NEW',wordTowerBest:7,wordTowerSeason:TOWER_SEASON,eikenDungeonBest:3}}},
    {found:{name:prefix+'users/old/apps/english-playroom',fields:{petName:'OLD',wordTowerBest:99,wordTowerSeason:'old-season',eikenDungeonBest:8}}}
   ]};
   if(target.includes('/documents/leaderboards/adventure')&&method==='GET')return {ok:true,status:200,json:async()=>({fields:{schemaVersion:1,tower:[{uid:'old',petName:'OLD',floor:99}],dungeon:[]},updateTime:'old-v1'})};
   if(target.includes('/documents/leaderboards/adventure')&&method==='PATCH'){writes++;return {ok:true,status:200,json:async()=>({updateTime:'new-v1'})};}
   throw Error('unexpected request '+target);
  }
 });
 const response={};await api.handle({method:'GET',url:'/?mode=tower',headers:{}},response);
 assert.equal(response.status,200);assert.deepEqual(response.body.leaders.map(row=>[row.petName,row.floor]),[['NEW',7]]);assert.equal(scans,1);assert.equal(writes,1);
});

test('missing summary bootstraps once, then POST publishes trusted saved best',async()=>{
 let created=false,writes=0,scans=0,batchReads=0;
 const base='https://firestore.googleapis.com/v1/projects/p/databases/(default)',prefix='projects/p/databases/(default)/documents/';
 const api=createAdventureRankings({
  base,activeIds:async()=>{scans++;return ['u1','u2','u3'];},accessToken:async()=>'server-token',decodeFields:value=>value,send,fail,
  decorate:async rows=>rows.map(({uid,...row})=>({...row,title:'称号なし'})),webApiKey:'test-key',
  fetch:async(url,options={})=>{
   const target=String(url),method=options.method||'GET';
   if(target.includes('identitytoolkit.googleapis.com'))return {ok:true,status:200,json:async()=>({users:[{localId:'u4'}]})};
   if(target.endsWith('/documents/users/u4/apps/english-playroom'))return {ok:true,status:200,json:async()=>({fields:{petName:'D',wordTowerBest:35,wordTowerSeason:TOWER_SEASON,eikenDungeonBest:4}})};
   if(target.includes('/documents:batchGet')){batchReads++;return {ok:true,status:200,json:async()=>[
    {found:{name:prefix+'users/u1/apps/english-playroom',fields:{petName:'A',wordTowerBest:50,wordTowerSeason:TOWER_SEASON,eikenDungeonBest:5}}},
    {found:{name:prefix+'users/u2/apps/english-playroom',fields:{petName:'B',wordTowerBest:40,wordTowerSeason:TOWER_SEASON,eikenDungeonBest:15}}},
    {found:{name:prefix+'users/u3/apps/english-playroom',fields:{petName:'C',wordTowerBest:30,wordTowerSeason:TOWER_SEASON,eikenDungeonBest:25}}}
   ]};}
   if(target.includes('/documents/leaderboards/adventure')&&method==='GET')return created?{ok:true,status:200,json:async()=>({fields:{schemaVersion:2,towerSeason:TOWER_SEASON,tower:[{uid:'u1',petName:'A',floor:50,rank:1},{uid:'u2',petName:'B',floor:40,rank:2},{uid:'u3',petName:'C',floor:30,rank:3}],dungeon:[{uid:'u3',petName:'C',floor:25,rank:1},{uid:'u2',petName:'B',floor:15,rank:2},{uid:'u1',petName:'A',floor:5,rank:3}]},updateTime:'v1'})}:{ok:false,status:404,json:async()=>({})};
   if(target.includes('/documents/leaderboards/adventure')&&method==='PATCH'){created=true;writes++;return {ok:true,status:200,json:async()=>({updateTime:'v'+writes})};}
   throw Error('unexpected request '+target);
  }
 });
 const first={};await api.handle({method:'GET',url:'/?mode=tower',headers:{}},first);assert.equal(first.status,200);assert.equal(first.body.leaders.length,3);assert.equal(scans,1);assert.equal(batchReads,1);assert.equal(writes,1);
 const second={};await api.handle({method:'GET',url:'/?mode=dungeon',headers:{}},second);assert.equal(scans,1);assert.equal(batchReads,1);assert.equal(writes,1);
 const pending={};await api.handle({method:'POST',url:'/api/adventure/rankings',headers:{authorization:'Bearer client-token','content-type':'application/json'},body:{mode:'tower',expectedFloor:36}},pending);
 assert.equal(pending.status,202);assert.equal(pending.body.pending,true);assert.equal(writes,1);
 const post={};await api.handle({method:'POST',url:'/api/adventure/rankings',headers:{authorization:'Bearer client-token','content-type':'application/json'},body:{mode:'tower',expectedFloor:35}},post);
 assert.equal(post.status,200);assert.equal(post.body.ok,true);assert.deepEqual(post.body.record.map(row=>[row.petName,row.floor,row.rank]),[['A',50,1],['B',40,2],['D',35,3]]);assert.equal(writes,2);
});
