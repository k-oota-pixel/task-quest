import {awardTitleIds} from './title-collection.mjs';
import {fixtureTitleAuthority} from './title-authority.mjs';
import {activityTitles} from './title-model.mjs';
import {dailyMaterialTransforms} from './material-rankings.mjs';
import {challengePeriods,isChallengeContent,challengeProgressWrites} from './challenge-model.mjs';
import {randomUUID} from 'node:crypto';
const DEFENSE_IDS=new Set(['pet-typing-defense-easy','pet-typing-defense-normal','pet-typing-defense-hard']);
const CONTENT_IDS=new Set(['word-breaker','ateru','basic-quest','eiken-retry','task-quest','eiken-cloze','eiken-title','listening-training','pre2-interview-questions','eiken-pre2-interview-a','talk-quest','pet-catch','reading-training','pet-instructions','pet-chat','adventure-tower','adventure-dungeon','eigo-meter','word-wolf','pet-typing-defense-easy','pet-typing-defense-normal','pet-typing-defense-hard']);
const encode=value=>typeof value==='string'?{stringValue:value}:typeof value==='number'?{integerValue:String(value)}:{nullValue:null};
const validId=value=>typeof value==='string'&&/^[\w-]{8,100}$/.test(value);

export function createLearningActivity({base,projectId,accessToken,verifyUser,send,fail,readJson,invalidate,onDailyCountsChanged=()=>{},onDefenseStageSaved=async()=>{},getAuthority=fixtureTitleAuthority,fetch:request=fetch}){
 const verifiedTokens=new Map();
 async function verified(req){
  const key=String(req.headers?.authorization||''),entry=verifiedTokens.get(key);
  if(key&&entry&&entry.until>Date.now())return entry.promise;
  const promise=verifyUser(req);if(key){if(verifiedTokens.size>=2000)verifiedTokens.delete(verifiedTokens.keys().next().value);verifiedTokens.set(key,{until:Date.now()+60000,promise});promise.catch(()=>verifiedTokens.delete(key));}return promise;
 }
 async function saveRetryActivityTitles(uid,token,total,previous){
  const ids=activityTitles('eiken-retry',total).filter(title=>title.unlocked&&title.need>previous).map(title=>title.id);
  if(!ids.length)return;
  const prefix=`projects/${projectId}/databases/(default)/documents/`;
  const write=awardTitleIds(prefix,uid,ids,await getAuthority());
  write.updateTransforms.push({fieldPath:'titleCountRevision',increment:{integerValue:'1'}});
  const response=await request(base+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({writes:[write]})});
  if(!response.ok)throw fail('リトライの称号を保存できませんでした。再試行します。',502);
 }
 async function recoverRetryActivityTitles(uid,token){
  const url=base+'/documents/learning_activity/'+encodeURIComponent(uid);
  const response=await request(url,{headers:{Authorization:'Bearer '+token}});
  if(response.status===404)return;
  if(!response.ok)throw fail('リトライの称号を確認できませんでした。',502);
  const fields=(await response.json()).fields||{};
  const total=Number(fields.contents?.mapValue?.fields?.['eiken-retry']?.mapValue?.fields?.titleCount?.integerValue)||0;
  await saveRetryActivityTitles(uid,token,total,0);
 }
 async function handleBatch(user,body,res){
  if(typeof body.batchId!=='string'||!validId(body.batchId)||!Array.isArray(body.events)||!body.events.length||body.events.length>100)throw fail('学習記録のまとめ方が不正です。',400);
  const unique=new Map();
  for(const event of body.events){
   if(!event||!CONTENT_IDS.has(event.appId)||!validId(event.eventId))throw fail('教材または記録IDが不正です。',400);
   if(unique.has(event.eventId)&&unique.get(event.eventId)!==event.appId)throw fail('記録IDが重複しています。',400);
   unique.set(event.eventId,event.appId);
  }
  if(unique.size>100)throw fail('記録件数の上限を超えています。',413);
  let defenseStage=null;
  if([...unique.values()].some(appId=>DEFENSE_IDS.has(appId))){
   // Bound each player's daily count to five distinct stages, regardless of device.
   // One deterministic receipt per mode, JST day and stage prevents farming.
   const event=body.events[0],match=String(event?.eventId||'').match(/^ptd-(easy|normal|hard)-(\d{4}-\d{2}-\d{2})-stage-([1-5])-clear$/);
   if(body.events.length!==1||unique.size!==1||!match||
      event.appId!=='pet-typing-defense-'+match[1]||
      match[2]!==challengePeriods().day||
      body.batchId!==event.eventId.slice(0,-6)){
    throw fail('ディフェンスのランキング記録IDが不正です。',400);
   }
   defenseStage={mode:match[1],stage:Number(match[3])};
  }
  const counts=new Map();for(const appId of unique.values())counts.set(appId,(counts.get(appId)||0)+1);
  // Reuse the activity summary write: no extra Firebase document reads or writes.
  const lastLearningAppId=body.events.at(-1).appId;
  const appIds=[...counts.keys()],{day,week}=challengePeriods(),token=await accessToken(),prefix=`projects/${projectId}/databases/(default)/documents/`;
  const receipt=prefix+`learning_activity/${user.uid}/events/${body.batchId}`;
  const transforms=[{fieldPath:'lastLearningAt',setToServerValue:'REQUEST_TIME'}];
  for(const appId of appIds)transforms.push({fieldPath:'contents.`'+appId+'`.lastLearningAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'contents.`'+appId+'`.titleCount',increment:{integerValue:String(counts.get(appId))}});
  transforms.push(...dailyMaterialTransforms(counts,day));
  if(defenseStage)transforms.push({fieldPath:({easy:'typingDefenseBestEasy',normal:'typingDefenseBestNormal',hard:'typingDefenseBestHard'})[defenseStage.mode],maximum:{integerValue:String(defenseStage.stage)}});
  const challengeIds=appIds.filter(isChallengeContent),challengeWrites=[];
  if(challengeIds.length){
   const makeChallengeWrite=period=>({update:{name:prefix+`challenge_progress/${user.uid}/periods/${period}`,fields:{uid:{stringValue:user.uid}}},updateMask:{fieldPaths:['uid']},updateTransforms:challengeIds.map(id=>({fieldPath:'completed.`'+id+'`',setToServerValue:'REQUEST_TIME'}))});
   challengeWrites.push(makeChallengeWrite('daily-'+day),makeChallengeWrite('weekly-'+week));
  }
  const writes=[
   {update:{name:receipt,fields:{batchId:encode(body.batchId),day:encode(day),counts:{mapValue:{fields:Object.fromEntries([...counts].map(([appId,count])=>[appId,{integerValue:String(count)}]))}}}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'recordedAt',setToServerValue:'REQUEST_TIME'}]},
   {update:{name:prefix+`learning_activity/${user.uid}`,fields:{uid:{stringValue:user.uid},lastLearningAppId:encode(lastLearningAppId)}},updateMask:{fieldPaths:['uid','lastLearningAppId']},updateTransforms:transforms},
   ...challengeWrites
  ];
  const response=await request(base+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({writes})});
  if(!response.ok){
   const error=await response.json?.().catch(()=>({}))||{};
   if([409,412].includes(response.status)||['ALREADY_EXISTS','FAILED_PRECONDITION'].includes(error.error?.status)){
    if(counts.has('eiken-retry'))await recoverRetryActivityTitles(user.uid,token);
    send(res,200,{ok:true,duplicate:true,freshTitles:[]});return;
   }
   throw fail('学習記録を保存できませんでした。',502);
  }
  invalidate(user.uid);onDailyCountsChanged(appIds,day);const committed=await response.json?.().catch(()=>({}))||{},results=committed.writeResults?.[1]?.transformResults||[],freshTitles=[];
  for(const [index,appId] of appIds.entries()){
   const total=Number(results[2+index*2]?.integerValue)||0,previous=Math.max(0,total-counts.get(appId));
   freshTitles.push(...activityTitles(appId,total).filter(title=>title.need>previous&&title.need<=total));
   if(appId==='eiken-retry')await saveRetryActivityTitles(user.uid,token,total,previous);
  }
  if(defenseStage){
   const savedBest=Number(results[transforms.length-1]?.integerValue)||defenseStage.stage;
   try{await onDefenseStageSaved({uid:user.uid,mode:defenseStage.mode,stage:Math.min(5,Math.max(defenseStage.stage,savedBest))});}
   catch(error){console.warn('Defense best ranking publication deferred',error?.message||error);}
  }
  send(res,200,{ok:true,freshTitles});
 }
 return async function handle(req,res){try{
  if(req.method!=='POST')throw fail('POSTのみ対応しています。',405);
  const user=await verified(req),body=req.headers?.['content-type']?.startsWith('application/json')?await readJson(req,128000):{};
  if(Array.isArray(body.events))return await handleBatch(user,body,res);
  const appId=body.appId;if(appId!==undefined&&!CONTENT_IDS.has(appId))throw fail('教材が不正です。',400);if(DEFENSE_IDS.has(appId))throw fail('ディフェンスのランキングにはステージ別の記録IDが必要です。',400);
  const token=await accessToken(),day=challengePeriods().day,prefix=`projects/${projectId}/databases/(default)/documents/`,transforms=[{fieldPath:'lastLearningAt',setToServerValue:'REQUEST_TIME'}];
  if(appId){transforms.push({fieldPath:'contents.`'+appId+'`.lastLearningAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'contents.`'+appId+'`.titleCount',increment:{integerValue:'1'}});transforms.push(...dailyMaterialTransforms(new Map([[appId,1]]),day));}
  const response=await request(base+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({writes:[...(appId?[{update:{name:prefix+`learning_activity/${user.uid}/events/${randomUUID()}`,fields:{day:encode(day),counts:{mapValue:{fields:{[appId]:{integerValue:'1'}}}}}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'recordedAt',setToServerValue:'REQUEST_TIME'}]}]:[]),{update:{name:prefix+`learning_activity/${user.uid}`,fields:{uid:{stringValue:user.uid},...(appId?{lastLearningAppId:encode(appId)}:{})}},updateMask:{fieldPaths:appId?['uid','lastLearningAppId']:['uid']},updateTransforms:transforms},...challengeProgressWrites({uid:user.uid,appId,projectId})]})});
  if(!response.ok)throw fail('学習日時を保存できませんでした。',502);
  invalidate(user.uid);if(appId)onDailyCountsChanged([appId],day);const committed=await response.json?.().catch(()=>({}))||{},activityWriteIndex=appId?1:0;const total=Number(committed.writeResults?.[activityWriteIndex]?.transformResults?.[2]?.integerValue)||0;const freshTitles=appId?activityTitles(appId,total).filter(t=>t.need===total):[];
  if(appId==='eiken-retry'&&freshTitles.length)await saveRetryActivityTitles(user.uid,token,total,0);
  send(res,200,{ok:true,freshTitles});
 }catch(error){send(res,error.status||500,{error:error.message||'学習日時を保存できませんでした。'});}};
}
