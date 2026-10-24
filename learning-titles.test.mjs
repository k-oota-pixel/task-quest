import test from 'node:test';import assert from 'node:assert/strict';
import {titleState,activityTitles,TITLE_CONTENTS} from './title-model.mjs';
import {createLearningTitles} from './learning-titles.mjs';
import {createLearningActivity} from './learning-activity.mjs';
import catalog from './retry-title-catalog.json' with {type:'json'};
test('all individual activities have four tiers; group games excluded',()=>{
 assert.equal(TITLE_CONTENTS.length,15);assert.ok(!TITLE_CONTENTS.some(x=>['word-wolf','eigo-meter'].includes(x.id)));
 for(const {id} of TITLE_CONTENTS){assert.equal(activityTitles(id,10).filter(t=>t.unlocked).length,2);assert.equal(activityTitles(id,0).filter(t=>t.unlocked).length,0);}
});
test('retry titles and selected title migrate using distinct answered questions, with no badges',()=>{
 const ids=Object.keys(catalog.questions).filter(id=>catalog.questions[id]==='4級').slice(0,50);
 const retry={state:{records:Object.fromEntries(ids.map(id=>[id,{attempts:100}]))},profile:{equippedTitle:'g4-50'}};
 const state=titleState({retry});assert.equal(state.selectedTitle,'ことばのタネ');assert.equal(state.titles.find(t=>t.id==='retry:g4-50').done,50);assert.equal(state.titles.find(t=>t.id==='retry:g4-100').unlocked,false);
 assert.equal(titleState({retry,selection:{selectedId:''}}).selectedTitle,'');assert.ok(!JSON.stringify(state).includes('badge'));
});
const fail=(message,status)=>Object.assign(Error(message),{status});
test('selection validates earned titles, clears selection and exposes only pet name and selected title',async()=>{
 let selectedId='ateru:1',writes=0;const docs=[{found:{name:'projects/p/databases/(default)/documents/learning_activity/u',fields:{contents:{ateru:{titleCount:1}}}}}];
 const api=createLearningTitles({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async()=>({uid:'u'}),decodeFields:x=>x,readJson:async()=>({selectedId}),fail,send:(r,status,body)=>Object.assign(r,{status,body}),fetch:async(url,opt)=>{if(opt.method==='PATCH'){writes++;assert.equal(JSON.parse(opt.body).fields.selectedId.stringValue,selectedId);return {ok:true};}return {ok:true,json:async()=>docs};}});
 let r={};await api.handle({method:'POST'},r);assert.equal(r.status,200);assert.equal(writes,1);
 selectedId='ateru:100';r={};await api.handle({method:'POST'},r);assert.equal(r.status,400);assert.equal(writes,1);
 selectedId='';r={};await api.handle({method:'POST'},r);assert.equal(r.status,200);assert.equal(r.body.selectedTitle,'');
 docs.push({found:{name:'projects/p/databases/(default)/documents/user_titles/u',fields:{selectedTitle:'アテル・はじめの一歩'}}});
 assert.deepEqual(await api.decorate([{uid:'u',petName:'もこ',coinsToday:3}]),[{petName:'もこ',coinsToday:3,title:'アテル・はじめの一歩'}]);
});
test('milestone notification uses the atomic increment result rather than a later racing read',async()=>{
 let calls=0;const api=createLearningActivity({base:'https://db',projectId:'p',accessToken:async()=>'token',verifyUser:async()=>({uid:'u'}),readJson:async()=>({appId:'ateru'}),invalidate(){},fail,send:(r,status,body)=>Object.assign(r,{status,body}),fetch:async(url,opt)=>{calls++;const writes=JSON.parse(opt.body).writes;assert.equal(writes[0].updateTransforms[2].increment.integerValue,'1');return {ok:true,json:async()=>({writeResults:[{transformResults:[{},{},{integerValue:'10'}]}]})};}});
 const r={};await api({method:'POST',headers:{'content-type':'application/json'}},r);assert.equal(calls,1);assert.equal(r.body.freshTitles[0].id,'ateru:10');
});
