import test from 'node:test';
import assert from 'node:assert/strict';
import {createMaterialRankings,dailyMaterialTransforms,rankMaterialRows} from './material-rankings.mjs';
import {RANKING_ONLY_CONTENTS,TITLE_CONTENTS,weeklyTitles,weeklyTitleName} from './title-model.mjs';
const fail=(message,status)=>Object.assign(Error(message),{status});
const day='2026-11-06',previous=['2026-11-02','2026-11-03','2026-11-04','2026-11-05'];
test('append a per-day counter to the existing activity transform, not an extra document',()=>{
 const transforms=dailyMaterialTransforms(new Map([['ateru',3],['basic-grammar',15],['unknown',7]]),'2026-11-06');
 assert.deepEqual(transforms.map(t=>[t.fieldPath,t.increment.integerValue]),[
  ['dailyCounts.`2026-11-06`.`ateru`','3'],['dailyCounts.`2026-11-06`.`basic-grammar`','15']
 ]);
});
test('daily material rankings cache and current-day invalidation; closed days are final',async()=>{
 const store=new Map(),archives=new Map(),archiveReads=[],events=[],time=Date.parse('2026-11-06T10:00:00+09:00');
 const rankingStore={
  async getSection(k,{load,valid}={}){const v=store.get(k);if(v&&(!valid||valid(v)))return structuredClone(v);if(!load)return null;const next=await load();store.set(k,next);return structuredClone(next);},
  async setSection(k,v){store.set(k,structuredClone(v));}
 };
 const prefix='projects/p/databases/(default)/documents/';
 const read=async(url,options={})=>{
  if(url.endsWith(':runQuery')){
   const query=JSON.parse(options.body).structuredQuery,field=query.orderBy[0].field.fieldPath;
   events.push(field);const found=field.includes('ateru');
   const which=(field.match(/2026-11-\d{2}/)||[])[0];
   return {ok:true,json:async()=>found&&[day,...previous].includes(which)?[
    {document:{name:prefix+'learning_activity/u',fields:{dailyCounts:{[which]:{ateru:7}}}}},
    {document:{name:prefix+'learning_activity/v',fields:{dailyCounts:{[which]:{ateru:2}}}}}
   ]:[]};
  }
  if(url.endsWith(':batchGet')){
   const names=JSON.parse(options.body).documents;
   return {ok:true,json:async()=>names.map(name=>({found:{name,fields:{petName:name.includes('/u/')?'ウサギ':'イヌ'}}}))};
  }
  if(url.includes('/leaderboards/coin-day-')){
   const theDay=url.split('coin-day-')[1].split('?')[0];
   const archived=archives.get(theDay)||{today:theDay,leaders:[{uid:'u'},{uid:'v'},{uid:'w'}]};
   if(options.method==='PATCH'){
    const winners=JSON.parse(options.body).fields.materialWinners.mapValue.fields;
    archives.set(theDay,{...archived,materialWinners:Object.fromEntries(Object.entries(winners).map(([app,value])=>[app,value.stringValue]))});
    return {ok:true,status:200};
   }
   archiveReads.push(theDay);
   return previous.includes(theDay)?{ok:true,status:200,json:async()=>({fields:archived})}:{ok:false,status:404};
  }
  if(url.includes('/leaderboards/daily-coins'))return {ok:false,status:404};
  throw Error('Unexpected '+url);
 };
 const createRankings=()=>createMaterialRankings({base:'https://db',projectId:'p',accessToken:async()=>'token',decodeFields:x=>x,verifyUser:async()=>({uid:'u'}),send:(r,status,value)=>Object.assign(r,{status,value}),fail,excludedIds:async()=>[],
  fetch:read,rankingStore,now:()=>time});
 const rankings=createRankings();
 const first=await rankings.getBoard('ateru',day);assert.equal(first.leaders[0].count,7);assert.equal(first.leaders[0].petName,'ウサギ');
 assert.equal(events.length,1);
 const repeated=await rankings.getBoard('ateru',day);assert.deepEqual(first,repeated);assert.equal(events.length,1);
 rankings.changed(['ateru'],day);await rankings.getBoard('ateru',day);assert.equal(events.length,2);
 const standings=await rankings.userWeekly('u');assert.equal(standings.progress.ateru,4);assert.equal(standings.progress.coins,4);
 const prior=events.length;await rankings.userWeekly('v');assert.equal(events.length,prior);
 assert.equal(archives.size,4);
 assert.deepEqual(archiveReads,previous);
 store.clear();
 archiveReads.length=0;
 const restarted=createRankings();
 assert.deepEqual(await restarted.userWeekly('u'),standings);
 assert.deepEqual(archiveReads,previous);
 assert.equal(events.length,prior,'durable daily archives eliminate material queries after restart');
 const res={};await rankings.handle({method:'GET',url:'/api/learning/material-rankings?appId=ateru'},res);
 assert.equal(res.status,200);assert.equal(res.value.leaders.length,2);
 assert.equal(res.value.leaders[0].uid,'u','pet-view action must receive the ranked user ID');
});
test('single top position is stable when counts tie',()=>{
 const rows=rankMaterialRows([{uid:'b',petName:'B',count:6},{uid:'a',petName:'A',count:6},{uid:'c',petName:'C',count:4}]);
 assert.deepEqual(rows.map(x=>x.uid),['a','b','c']);assert.equal(rows[0].rank,1);
});

test('typing defense normal and hard share daily ranking infrastructure and unlock separate weekly titles',()=>{
 const day='2026-11-06',allIds=RANKING_ONLY_CONTENTS.map(x=>x.id);
 assert.deepEqual(allIds,['pet-typing-defense-easy','pet-typing-defense-normal','pet-typing-defense-hard']);
 const ids=allIds.slice(1);
 assert.equal(TITLE_CONTENTS.some(x=>ids.includes(x.id)),false,'no extra per-user creative title progress reads');
 const updates=dailyMaterialTransforms(new Map([[ids[0],1],[ids[1],2]]),day);
 assert.deepEqual(updates.map(x=>x.fieldPath),ids.map(id=>'dailyCounts.`'+day+'`.`'+id+'`'));
 assert.deepEqual(updates.map(x=>x.increment.integerValue),['1','2']);
 const weekly=weeklyTitles({earnedIds:['weekly:'+ids[1]],progress:{[ids[0]]:3,[ids[1]]:4}});
 assert.equal(weekly.find(x=>x.id==='weekly:'+ids[0]).unlocked,false);
 assert.equal(weekly.find(x=>x.id==='weekly:'+ids[0]).done,3);
 assert.equal(weekly.find(x=>x.id==='weekly:'+ids[1]).unlocked,true);
 assert.equal(weekly.find(x=>x.id==='weekly:'+ids[1]).name,weeklyTitleName(ids[1]));
});

test('a completed week includes Sunday with one saved document per day',async()=>{
 const reads=[],winners=Object.fromEntries([...TITLE_CONTENTS,...RANKING_ONLY_CONTENTS].map(app=>[app.id,'']));
 const rankings=createMaterialRankings({base:'https://db',projectId:'p',accessToken:async()=>'token',decodeFields:x=>x,fail,
  now:()=>Date.parse('2026-11-16T01:00:00+09:00'),fetch:async url=>{
   const day=url.match(/coin-day-(\d{4}-\d{2}-\d{2})$/)?.[1];
   assert.ok(day,url);reads.push(day);
   return {ok:true,json:async()=>({fields:{today:day,materialWinners:{...winners,ateru:['09','10','11','15'].includes(day.slice(-2))?'u':''},
    leaders:day.endsWith('-15')?[{uid:'u'}]:[]}})};
  }});
 const totals=await rankings.completedWeek('2026-11-09');
 assert.deepEqual({...totals.u},{ateru:4,coins:1});
 assert.deepEqual(reads,['09','10','11','12','13','14','15'].map(day=>'2026-11-'+day));
});
