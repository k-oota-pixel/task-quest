import './title-summary.test.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {titleState,activityTitles,TITLE_CONTENTS,creativeTitles,creativeCatalog,validTitleName} from './title-model.mjs';
import {createLearningTitles} from './learning-titles.mjs';
import {fixtureTitleAuthority} from './title-authority.mjs';
import {createLearningActivity} from './learning-activity.mjs';
import catalog from './retry-title-catalog.json' with {type:'json'};
test('creative title catalogs replace generic tiers; retry retains its four tiers',()=>{assert.equal(TITLE_CONTENTS.length,23);assert.equal(TITLE_CONTENTS.some(({id})=>id==='pet-instructions'),false);for(const {id}of TITLE_CONTENTS){assert.equal(creativeTitles(id).length,id==='word-tower'?18:15);assert.equal(activityTitles(id,10).length,id==='eiken-retry'?4:0);}});
test('retry titles and selected title migrate using distinct answered questions, with no badges',()=>{
 const ids=Object.keys(catalog.questions).filter(id=>catalog.questions[id]==='4級').slice(0,50);
 const retry={state:{records:Object.fromEntries(ids.map(id=>[id,{attempts:100}]))},profile:{equippedTitle:'g4-50'}};
 const state=titleState({retry});assert.equal(state.selectedTitle,'ことばのタネ');assert.equal(state.titles.find(t=>t.id==='retry:g4-50').done,50);assert.equal(state.titles.find(t=>t.id==='retry:g4-100').unlocked,false);
 assert.equal(titleState({retry,selection:{selectedId:''}}).selectedTitle,'');assert.ok(!JSON.stringify(state).includes('badge'));
});
const fail=(message,status)=>Object.assign(Error(message),{status});
test('selection verifies signed ownership and stores only in the wallet',async()=>{
 const authority=await fixtureTitleAuthority();
 let selectedId='creative:ateru:1',writes=0;
 const wallet={titleCollectionVersion:1,titleCollectionProof:authority.marker('u'),
  earnedTitleIds:[authority.award('u',selectedId),authority.award('other','creative:ateru:15')]};
 const api=createLearningTitles({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async()=>({uid:'u'}),decodeFields:x=>x,readJson:async()=>({selectedId}),fail,send:(r,status,body)=>Object.assign(r,{status,body}),fetch:async(url,opt={})=>{
  assert.ok(url.includes('/users/u/apps/english-playroom'));
  if(opt.method==='PATCH'){writes++;const fields=JSON.parse(opt.body).fields;
   for(const [key,value] of Object.entries(fields))wallet[key]=value.stringValue;
   return {ok:true};
  }
  return {ok:true,json:async()=>({fields:wallet})};
 }});
 let r={};await api.handle({method:'POST'},r);assert.equal(r.status,200);assert.equal(writes,1);assert.ok(authority.verifySelection('u',wallet));
 selectedId='creative:ateru:15';r={};await api.handle({method:'POST'},r);assert.equal(r.status,400);assert.equal(writes,1);
 selectedId='';r={};await api.handle({method:'POST'},r);assert.equal(r.status,200);assert.equal(r.body.selectedTitle,'');assert.equal(writes,2);
});
test('leaderboard titles accept streamed Firestore batchGet results',async()=>{
 const prefix='projects/p/databases/(default)/documents/';
 const rows=[{found:{name:prefix+'user_titles/u1',fields:{selectedId:'creative:ateru:1'}}},{missing:prefix+'user_titles/u2'}];
 const api=createLearningTitles({base:'https://db',projectId:'p',accessToken:async()=>'token',decodeFields:x=>x,fail,fetch:async()=>({ok:true,text:async()=>rows.map(row=>JSON.stringify(row)).join('\n')})});
 const decorated=await api.decorate([{uid:'u1',petName:'もこ'},{uid:'u2',petName:'ぽち'}]);
 assert.deepEqual(decorated,[{petName:'もこ',uid:'u1',title:'見習い探偵、出動！'},{petName:'ぽち',uid:'u2',title:'称号なし'}]);
});
test('full title read returns and mirrors unlocked title count',async()=>{
 const prefix='projects/p/databases/(default)/documents/';
 const docs=[
  {found:{name:prefix+'learning_activity/u',fields:{}}},
  {found:{name:prefix+'users/u/apps/eiken-retry',fields:{}}},
  {found:{name:prefix+'user_titles/u',fields:{selectedId:''}}},
  {found:{name:prefix+'title_progress/u/activities/word-breaker',fields:{metrics:{runs:1}}}},
  {found:{name:prefix+'users/u/apps/english-playroom',fields:{}}}
 ];
 let mirrored=null;
 const api=createLearningTitles({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async()=>({uid:'u'}),decodeFields:x=>x,readJson:async()=>({}),fail,send:(r,status,body)=>Object.assign(r,{status,body}),fetch:async(url,opt={})=>{if(opt.method==='PATCH'&&url.includes('/apps/english-playroom')){mirrored=JSON.parse(opt.body).fields;return {ok:true};}return {ok:true,json:async()=>docs};}});
 const state=await api.read('u');assert.ok(state.unlockedTitleCount>=1);assert.equal(Number(mirrored.unlockedTitleCount.integerValue),state.unlockedTitleCount);
});
test('milestone notification uses the atomic increment result rather than a later racing read',async()=>{
 let calls=0,milestone=10;const api=createLearningActivity({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async()=>({uid:'u'}),readJson:async()=>({appId:'eiken-retry'}),invalidate(){},fail,send:(r,status,body)=>Object.assign(r,{status,body}),fetch:async(url,opt)=>{calls++;const writes=JSON.parse(opt.body).writes;const activity=writes.find(w=>w.update.name.endsWith('/learning_activity/u'));if(!activity){assert.ok(writes[0].updateTransforms[0].appendMissingElements.values.length);return {ok:true};}assert.equal(activity.updateTransforms[2].increment.integerValue,'1');return {ok:true,json:async()=>({writeResults:writes.map(w=>({transformResults:w===activity?[{},{},{integerValue:String(milestone)}]:[]}))})};}});
 const r={};await api({method:'POST',headers:{'content-type':'application/json'}},r);assert.equal(calls,2);assert.equal(r.body.freshTitles[0].id,'eiken-retry:10');for(const n of [1,50,100]){milestone=n;const unlocked={};await api({method:'POST',headers:{'content-type':'application/json'}},unlocked);assert.equal(unlocked.body.freshTitles[0].id,'eiken-retry:'+n);}
});

test('master titles remain locked until all titles in their content group are unlocked',()=>{
 const before=titleState(),locked=before.titles.find(t=>t.id==='master:ateru');
 assert.equal(locked.unlocked,false);assert.equal(locked.done,0);assert.equal(locked.need,15);
 const metrics=Object.fromEntries(creativeCatalog.ateru.map(t=>[t.metric,100000]));
 const earned=titleState({progress:{ateru:{metrics}},selection:{selectedId:'master:ateru'}});
 const title=earned.titles.find(t=>t.id==='master:ateru');
 assert.equal(title.unlocked,true);assert.equal(title.done,15);assert.equal(title.category,'master');
 assert.equal(earned.selectedTitle,'真理を見抜く者');assert.equal(validTitleName(title.id),'真理を見抜く者');
 assert.equal(earned.titles.filter(t=>t.id==='master:ateru').length,1);
});

test('weekly titles stay locked without a durable award and unlock for four ranked days',()=>{
 const locked=titleState({weeklyProgress:{coins:4,ateru:3}});
 assert.equal(locked.titles.find(t=>t.id==='weekly:coins').unlocked,false);
 assert.equal(locked.titles.find(t=>t.id==='weekly:coins').done,4);
 const earned=titleState({weeklyEarnedIds:['weekly:coins'],weeklyProgress:{coins:4,ateru:3},selection:{selectedId:'weekly:coins'}});
 assert.equal(earned.titles.find(t=>t.id==='weekly:coins').unlocked,true);
 assert.equal(earned.selectedTitle,'黄金の四冠王');
 assert.equal(validTitleName('weekly:coins'),'黄金の四冠王');
});
test('weekly standings show progress without awarding during the current week',async()=>{
 const authority=await fixtureTitleAuthority();
 let weeklyCalls=0,awardWrites=0;
 const wallet={titleCollectionVersion:1,titleCollectionProof:authority.marker('u'),earnedTitleIds:[]};
 const api=createLearningTitles({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async()=>({uid:'u'}),decodeFields:x=>x,readJson:async()=>({}),fail,send:(res,status,body)=>Object.assign(res,{status,body}),
  weeklyProgress:async()=>{weeklyCalls++;return {week:'2026-11-02',progress:{coins:4,ateru:4}};},
  fetch:async(url,opt={})=>{
   if(url.endsWith('/apps/english-playroom'))return {ok:true,json:async()=>({fields:wallet})};
   if(url.endsWith(':commit')){
    awardWrites++;
    const [write]=JSON.parse(opt.body).writes;assert.ok(write.update.name.endsWith('/apps/english-playroom'));
    wallet.earnedTitleIds.push(...write.updateTransforms[0].appendMissingElements.values.map(value=>value.stringValue));
    return {ok:true};
   }
   throw Error('Unexpected URL '+url);
  }});
 let res={};await api.handle({method:'GET',url:'/api/learning/titles?view=collection'},res);
 assert.equal(res.status,200);assert.equal(weeklyCalls,0);assert.equal(awardWrites,0);
 res={};await api.handle({method:'GET',url:'/api/learning/titles?view=weekly'},res);
 assert.equal(res.status,200);assert.equal(weeklyCalls,1);assert.equal(awardWrites,0);
 assert.equal(res.body.titles.find(t=>t.id==='weekly:coins').done,4);
 assert.equal(res.body.titles.find(t=>t.id==='weekly:coins').unlocked,false);
});


test('expanded title group reads only that progress document, with no writes',async()=>{
 const prefix='projects/p/databases/(default)/documents/';
 const requested=[],methods=[];
 const api=createLearningTitles({base:'https://db',projectId:'p',accessToken:async()=>'t',
  verifyUser:async()=>({uid:'u'}),decodeFields:fields=>fields,
  send:(res,status,body)=>Object.assign(res,{status,body}),fail,
  fetch:async(url,o={})=>{
   methods.push(o.method||'GET');
   if(url.endsWith(':batchGet')){const docs=JSON.parse(o.body).documents;requested.push(...docs);return {ok:true,json:async()=>docs.map(name=>({found:{name,fields:{metrics:{runs:4,score:12}}}}))};}
   throw Error('Unexpected write or document read: '+url);
  }});
 const r={};await api.handle({method:'GET',url:'/api/learning/titles?view=app-progress&appId=word-breaker'},r);
 assert.equal(r.status,200);
 assert.deepEqual(requested,[prefix+'title_progress/u/activities/word-breaker']);
 assert.equal(r.body.appId,'word-breaker');
 assert.ok(r.body.titles.some(title=>Number.isFinite(title.done)&&title.done>0));
 assert.deepEqual(methods,['POST']);
});
