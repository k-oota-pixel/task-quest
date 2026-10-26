import {activityTitles} from './title-model.mjs';
import {challengePeriods,isChallengeContent,challengeProgressWrites} from './challenge-model.mjs';
const CONTENT_IDS=new Set(['word-breaker','ateru','basic-quest','eiken-retry','task-quest','eiken-cloze','eiken-title','listening-training','pre2-interview-questions','eiken-pre2-interview-a','talk-quest','pet-catch','reading-training','pet-instructions','pet-chat']);
const encode=value=>typeof value==='string'?{stringValue:value}:typeof value==='number'?{integerValue:String(value)}:{nullValue:null};
const validId=value=>typeof value==='string'&&/^[\w-]{8,100}$/.test(value);
export function createLearningActivity({base,projectId,accessToken,verifyUser,send,fail,readJson,invalidate,fetch:request=fetch}){
 const verifiedTokens=new Map();
 async function verified(req){
  const key=String(req.headers?.authorization||''),entry=verifiedTokens.get(key);
  if(key&&entry&&entry.until>Date.now())return entry.promise;
  const promise=verifyUser(req);if(key){if(verifiedTokens.size>=2000)verifiedTokens.delete(verifiedTokens.keys().next().value);verifiedTokens.set(key,{until:Date.now()+60000,promise});promise.catch(()=>verifiedTokens.delete(key));}return promise;
 }
 async function handleBatch(user,body,res){
  if(typeof body.batchId!=='string'||!validId(body.batchId)||!Array.isArray(body.events)||!body.events.length||body.events.length>100)throw fail('学習記録のまとめ方が不正です。',400);
  const unique=new Map();
  for(const event of body.events){
   if(!event||!CONTENT_IDS.has(event.appId)||!validId(event.eventId))throw fail('教材または記録IDが不正です。',400);
   unique.set(event.eventId,event.appId);
  }
  if(unique.size>100)throw fail('記録件数の上限を超えています。',413);
  const counts=new Map();for(const appId of unique.values())counts.set(appId,(counts.get(appId)||0)+1);
  const appIds=[...counts.keys()],{day,week}=challengePeriods(),token=await accessToken(),prefix=`projects/${projectId}/databases/(default)/documents/`;
  const receipt=prefix+`learning_activity/${user.uid}/events/${body.batchId}`;
  const transforms=[{fieldPath:'lastLearningAt',setToServerValue:'REQUEST_TIME'}];
  for(const appId of appIds)transforms.push({fieldPath:'contents.`'+appId+'`.lastLearningAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'contents.`'+appId+'`.titleCount',increment:{integerValue:String(counts.get(appId))}});
  const challengeIds=appIds.filter(isChallengeContent),challengeWrites=[];
  if(challengeIds.length){
   const makeChallengeWrite=period=>({update:{name:prefix+`challenge_progress/${user.uid}/periods/${period}`,fields:{uid:{stringValue:user.uid}}},updateMask:{fieldPaths:['uid']},updateTransforms:challengeIds.map(id=>({fieldPath:'completed.`'+id+'`',setToServerValue:'REQUEST_TIME'}))});
   challengeWrites.push(makeChallengeWrite('daily-'+day),makeChallengeWrite('weekly-'+week));
  }
  const writes=[
   {update:{name:receipt,fields:{batchId:encode(body.batchId)}},currentDocument:{exists:false}},
   {update:{name:prefix+`learning_activity/${user.uid}`,fields:{uid:{stringValue:user.uid}}},updateMask:{fieldPaths:['uid']},updateTransforms:transforms},
   ...challengeWrites
  ];
  const response=await request(base+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({writes})});
  if(!response.ok){
   if(response.status===409||response.status===412){send(res,200,{ok:true,duplicate:true,freshTitles:[]});return;}
   throw fail('学習記録を保存できませんでした。',502);
  }
  invalidate(user.uid);const committed=await response.json?.().catch(()=>({}))||{},results=committed.writeResults?.[1]?.transformResults||[],freshTitles=[];
  appIds.forEach((appId,index)=>{
   const total=Number(results[2+index*2]?.integerValue)||0,previous=Math.max(0,total-counts.get(appId));
   freshTitles.push(...activityTitles(appId,total).filter(title=>title.need>previous&&title.need<=total));
  });
  send(res,200,{ok:true,freshTitles});
 }
 return async function handle(req,res){try{
  if(req.method!=='POST')throw fail('POSTのみ対応しています。',405);
  const user=await verified(req),body=req.headers?.['content-type']?.startsWith('application/json')?await readJson(req,128000):{};
  if(Array.isArray(body.events))return await handleBatch(user,body,res);
  const appId=body.appId;if(appId!==undefined&&!CONTENT_IDS.has(appId))throw fail('教材が不正です。',400);
  const token=await accessToken(),transforms=[{fieldPath:'lastLearningAt',setToServerValue:'REQUEST_TIME'}];
  if(appId)transforms.push({fieldPath:'contents.`'+appId+'`.lastLearningAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'contents.`'+appId+'`.titleCount',increment:{integerValue:'1'}});
  const response=await request(base+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({writes:[{update:{name:`projects/${projectId}/databases/(default)/documents/learning_activity/${user.uid}`,fields:{uid:{stringValue:user.uid}}},updateMask:{fieldPaths:['uid']},updateTransforms:transforms},...challengeProgressWrites({uid:user.uid,appId,projectId})]})});
  if(!response.ok)throw fail('学習日時を保存できませんでした。',502);
  invalidate(user.uid);const committed=await response.json?.().catch(()=>({}))||{};const total=Number(committed.writeResults?.[0]?.transformResults?.[2]?.integerValue)||0;const freshTitles=appId?activityTitles(appId,total).filter(t=>t.need===total):[];send(res,200,{ok:true,freshTitles});
 }catch(error){send(res,error.status||500,{error:error.message||'学習日時を保存できませんでした。'});}};
}
