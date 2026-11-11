import {DEFENSE_TITLE_APP,defenseTitleProgress,creativeTitles} from './title-model.mjs';
// Settle one typing-defense play with one atomic Firestore commit.
// The client never contacts Firestore while the enemy is moving or a phase ends.
const MAX_PHASES=25;
const MODES=Object.freeze({easy:'typingDefenseBestEasy',normal:'typingDefenseBestNormal',hard:'typingDefenseBestHard'});
const runIdValid=value=>typeof value==='string'&&/^td-[A-Za-z0-9_-]{9,60}$/.test(value);
const integer=value=>Number.isInteger(Number(value))&&Number(value)>=0?Number(value):0;
const fieldInt=value=>({integerValue:String(value)});
const fieldString=value=>({stringValue:String(value)});
const quoted=value=>String.fromCharCode(96)+value+String.fromCharCode(96);
const dailyField=(day,appId)=>'dailyCounts.'+quoted(day)+'.'+quoted(appId);
const cappedStage=value=>Math.min(5,integer(value));

export function defenseSettlementPlan(mode,clearedPhases){
 if(!Object.hasOwn(MODES,mode)||!Number.isInteger(clearedPhases)||clearedPhases<0||clearedPhases>MAX_PHASES)return null;
 const stage=Math.floor(clearedPhases/5);
 return {mode,clearedPhases,stage,coins:mode==='easy'?stage:clearedPhases*(mode==='hard'?2:1)};
}

export function createDefenseSettlement({
 base,projectId,accessToken,verifyUser,send,fail,readJson,decodeFields,
 todayKey,earnedCoinsToday,invalidate=()=>{},onDailyCountsChanged=()=>{},
 onDefenseStageSaved=async()=>{},publishCoinBoard=async()=>{},fetch:request=globalThis.fetch
}){
 const prefix='projects/'+projectId+'/databases/(default)/documents/';
 const root=base+'/documents/';
 const read=async(path,token)=>{
  const response=await request(root+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
  if(response.status===404)return {exists:false,fields:{},updateTime:''};
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw fail('防衛記録を取得できませんでした。',502);
  return {exists:true,fields:decodeFields(data.fields||{}),updateTime:data.updateTime||''};
 };
 const currentDocument=doc=>doc.exists?{updateTime:doc.updateTime}:{exists:false};
 const result=(plan,day,duplicate=false,freshTitles=[])=>({
  ok:true,duplicate,mode:plan.mode,clearedPhases:plan.clearedPhases,
  completedStage:plan.stage,coinsAdded:duplicate?0:plan.coins,earnedCoins:plan.coins,day,freshTitles
 });
 async function settle(user,body){
  const plan=defenseSettlementPlan(body.mode,body.clearedPhases);
  if(!plan||!runIdValid(body.runId))throw fail('防衛ゲームのプレイ記録が不正です。',400);
  // Older saved offline sessions have no miss/perfect data: never grant flawless awards for them.
  const misses=body.misses===undefined?null:body.misses;
  const perfectStages=body.perfectStages===undefined?0:body.perfectStages;
  if((misses!==null&&(!Number.isInteger(misses)||misses<0||misses>6))||
     !Number.isInteger(perfectStages)||perfectStages<0||perfectStages>plan.stage)
   throw fail('防衛ゲームの称号記録が不正です。',400);
  const uid=user.uid,day=todayKey(),appId='pet-typing-defense-'+plan.mode;
  const walletPath='users/'+encodeURIComponent(uid)+'/apps/english-playroom';
  const activityPath='learning_activity/'+encodeURIComponent(uid);
  const receiptPath=walletPath+'/typingDefenseRewards/'+encodeURIComponent(body.runId);
  const token=await accessToken();
  const afterCommit=async({milestoneDelta=0,improvedBest=false,duplicate=false}={})=>{
   invalidate(uid);
   if(plan.stage){
    if(milestoneDelta)onDailyCountsChanged([appId],day);
    if(improvedBest||duplicate){
     try{await onDefenseStageSaved({uid,mode:plan.mode,stage:plan.stage});}
     catch(error){console.warn('Defense rank update deferred',error?.message||error);}
    }
   }
   if(plan.coins){
    try{await publishCoinBoard({uid,day,token});}
    catch(error){console.warn('Defense coin board update deferred',error?.message||error);}
   }
  };
  for(let attempt=0;attempt<4;attempt++){
   const [wallet,activity]=await Promise.all([
    read(walletPath,token),
    plan.stage?read(activityPath,token):Promise.resolve({exists:false,fields:{},updateTime:''})
   ]);
   const oldDay=Math.min(5,integer(activity.fields?.dailyCounts?.[day]?.[appId]));
   const milestoneDelta=Math.max(0,plan.stage-oldDay);
   const oldStats=wallet.fields.typingDefenseTitleStats||{};
   const cleared=Number(plan.stage===5),flawless=Number(cleared&&misses===0);
   const stats={
    plays:integer(oldStats.plays)+1,
    bestStage:Math.max(integer(oldStats.bestStage),plan.stage),
    easyClears:integer(oldStats.easyClears)+Number(cleared&&plan.mode==='easy'),
    normalClears:integer(oldStats.normalClears)+Number(cleared&&plan.mode==='normal'),
    hardClears:integer(oldStats.hardClears)+Number(cleared&&plan.mode==='hard'),
    totalClears:integer(oldStats.totalClears)+cleared,
    perfectStages:Math.max(integer(oldStats.perfectStages),perfectStages),
    flawlessClears:integer(oldStats.flawlessClears)+flawless,
    hardFlawlessClears:integer(oldStats.hardFlawlessClears)+Number(flawless&&plan.mode==='hard')
   };
   const beforeTitles=new Set(creativeTitles(DEFENSE_TITLE_APP,defenseTitleProgress(activity.fields,wallet.fields)).filter(t=>t.unlocked).map(t=>t.id));
   const newActivity={...activity.fields,[MODES[plan.mode]]:Math.max(integer(activity.fields[MODES[plan.mode]]),plan.stage)};
   const freshTitles=creativeTitles(DEFENSE_TITLE_APP,defenseTitleProgress(newActivity,{...wallet.fields,typingDefenseTitleStats:stats})).filter(t=>t.unlocked&&!beforeTitles.has(t.id));
   const newCoins=integer(wallet.fields.coins)+plan.coins;
   const earned=wallet.fields.coinEarnedDate===day?
    integer(wallet.fields.coinsEarnedToday):
    integer(earnedCoinsToday(wallet.fields,day));
   const walletWrite={
    update:{name:prefix+walletPath,fields:{
     coins:fieldInt(newCoins),coinsEarnedToday:fieldInt(earned+plan.coins),
     coinEarnedDate:fieldString(day),coinSchemaVersion:fieldInt(1),
     typingDefenseTitleStats:{mapValue:{fields:Object.fromEntries(Object.entries(stats).map(([key,value])=>[key,fieldInt(value)]))}}
    }},
    updateMask:{fieldPaths:['coins','coinsEarnedToday','coinEarnedDate','coinSchemaVersion','typingDefenseTitleStats']},
    updateTransforms:[
     {fieldPath:'coinUpdatedAt',setToServerValue:'REQUEST_TIME'},
     {fieldPath:'titleCountRevision',increment:fieldInt(1)}
    ],
    currentDocument:currentDocument(wallet)
   };
   const writes=[{
    update:{name:prefix+receiptPath,fields:{
     mode:fieldString(plan.mode),runId:fieldString(body.runId),day:fieldString(day),
     clearedPhases:fieldInt(plan.clearedPhases),stage:fieldInt(plan.stage),amount:fieldInt(plan.coins)
    }},
    updateTransforms:[{fieldPath:'awardedAt',setToServerValue:'REQUEST_TIME'}],
    currentDocument:{exists:false}
   },walletWrite];
   if(plan.stage){
    const transforms=[
     {fieldPath:'lastLearningAt',setToServerValue:'REQUEST_TIME'},
     {fieldPath:'contents.'+quoted(appId)+'.lastLearningAt',setToServerValue:'REQUEST_TIME'},
     {fieldPath:dailyField(day,appId),maximum:fieldInt(plan.stage)},
     {fieldPath:MODES[plan.mode],maximum:fieldInt(plan.stage)}
    ];
    if(milestoneDelta)transforms.push({fieldPath:'contents.'+quoted(appId)+'.titleCount',increment:fieldInt(milestoneDelta)});
    writes.push({
     update:{name:prefix+activityPath,fields:{uid:fieldString(uid)}},
     updateMask:{fieldPaths:['uid']},
     updateTransforms:transforms,
     currentDocument:currentDocument(activity)
    });
   }
   const response=await request(base+'/documents:commit',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({writes}),signal:AbortSignal.timeout(20000)
   });
   if(response.ok){
    await afterCommit({milestoneDelta,improvedBest:plan.stage>cappedStage(activity.fields?.[MODES[plan.mode]])});
    return result(plan,day,false,freshTitles);
   }
   const error=await response.json().catch(()=>({}));
   const code=String(error.error?.status||'');
   const conflict=[409,412].includes(response.status)||
    ['ALREADY_EXISTS','FAILED_PRECONDITION','ABORTED'].includes(code);
   if(!conflict)throw fail('防衛ゲームの一括保存に失敗しました。',response.status===429?429:502);
   const receipt=await read(receiptPath,token);
   if(receipt.exists){
    if(receipt.fields.mode!==plan.mode||receipt.fields.clearedPhases!==plan.clearedPhases)
     throw fail('同じプレイIDで別の結果を保存することはできません。',409);
    await afterCommit({duplicate:true});
    return result(plan,day,true);
   }
  }
  throw fail('他の更新と競合しました。再試行してください。',503);
 }
 return async function handle(req,res){
  try{
   if(req.method!=='POST')throw fail('POSTのみ対応しています。',405);
   const user=await verifyUser(req),body=await readJson(req,4096);
   send(res,200,await settle(user,body));
  }catch(error){send(res,error.status||500,{ok:false,error:error.message||'防衛記録を保存できませんでした。'});}
 };
}
