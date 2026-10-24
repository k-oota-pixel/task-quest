import {challengePeriods,challengeState} from './challenge-model.mjs';
import {dailyStreak,previousDay} from './challenge-streak.mjs';
export function createLearningChallenges({base,projectId,accessToken,verifyUser,decodeFields,send,fail,readJson,onAward=()=>{},fetch:request=globalThis.fetch,now=Date.now}){
 const prefix=`projects/${projectId}/databases/(default)/documents/`;
 return async function handle(req,res){try{
  if(!['GET','POST'].includes(req.method))throw fail('GETまたはPOSTのみ対応しています。',405);
  const user=await verifyUser(req);let body={};if(req.method==='POST'){if(!req.headers?.['content-type']?.startsWith('application/json'))throw fail('JSONで送信してください。',415);body=await readJson(req,1024);if(!['daily','weekly'].includes(body.kind))throw fail('チャレンジの種類が不正です。',400);}
  const access=await accessToken(),headers={Authorization:'Bearer '+access,'Content-Type':'application/json'};
  async function read(path){const response=await request(base+'/documents/'+path,{headers,signal:AbortSignal.timeout(15000)});if(response.status===404)return null;if(!response.ok)throw fail('チャレンジ情報を取得できませんでした。更新して再試行してください。',502);const d=await response.json();return {data:decodeFields(d.fields||{}),updateTime:d.updateTime};}
  for(let attempt=0;attempt<4;attempt++){
   const time=now(),periods=challengePeriods(time),dayId='daily-'+periods.day,weekId='weekly-'+periods.week,progress=`challenge_progress/${user.uid}/periods/`,claims=`challenge_claims/${user.uid}/periods/`;
   const [daily,weekly,dailyClaim,weeklyClaim,activity,...historyDocs]=await Promise.all([read(progress+dayId),read(progress+weekId),read(claims+dayId),read(claims+weekId),read('learning_activity/'+user.uid),... [2,1].flatMap(offset=>{const id='daily-'+previousDay(periods.day,offset);return [read(progress+id),read(claims+id)];})]);
   const state=challengeState(user.uid,periods,{daily:daily?.data,weekly:weekly?.data,dailyClaim:dailyClaim?.data,weeklyClaim:weeklyClaim?.data,activity:activity?.data},time);
   state.daily.streak=dailyStreak(user.uid,periods.day,state.daily.complete,dailyClaim?.data,[2,1].map((offset,i)=>({day:previousDay(periods.day,offset),progress:historyDocs[i*2]?.data,claim:historyDocs[i*2+1]?.data})));
   if(req.method==='GET')return send(res,200,state);
   const kind=body.kind,challenge=state[kind],periodId=kind==='daily'?dayId:weekId;
   if(body.period!==challenge.id)throw fail('チャレンジの期間が変わりました。更新して確認してください。',409);
   if(challenge.claimed)return send(res,200,{...state,awarded:0,alreadyClaimed:true});
   if(!challenge.complete)throw fail('まだ達成していません。対象教材に取り組んでから更新してください。',409);
   const walletPath=`users/${user.uid}/apps/english-playroom`,wallet=await read(walletPath),data=wallet?.data||{};
   // Period boundaries use server time, including a midnight crossed during reads.
   const current=challengePeriods(now());if(current.day!==periods.day||current.week!==periods.week)continue;
   const streakBonus=kind==='daily'&&state.daily.streak.eligible?10:0,reward=challenge.reward+streakBonus;
   const count=x=>Math.max(0,Math.floor(Number(x)||0)),coins=count(data.coins)+reward,earned=(data.coinEarnedDate===periods.day?count(data.coinsEarnedToday):0)+reward;
   const fields={coins:{integerValue:String(coins)},coinEarnedDate:{stringValue:periods.day},coinsEarnedToday:{integerValue:String(earned)},coinSchemaVersion:{integerValue:'1'}};
   const writes=[{update:{name:prefix+claims+periodId,fields:{uid:{stringValue:user.uid},kind:{stringValue:kind},period:{stringValue:challenge.id},reward:{integerValue:String(reward)},streakBonus:{integerValue:String(streakBonus)}}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'claimedAt',setToServerValue:'REQUEST_TIME'}]},{update:{name:prefix+walletPath,fields},updateMask:{fieldPaths:Object.keys(fields)},currentDocument:wallet?{updateTime:wallet.updateTime}:{exists:false},updateTransforms:[{fieldPath:'coinUpdatedAt',setToServerValue:'REQUEST_TIME'}]}];
   const response=await request(base+'/documents:commit',{method:'POST',headers,body:JSON.stringify({writes}),signal:AbortSignal.timeout(15000)});
   if(response.ok){challenge.claimed=true;if(kind==='daily')state.daily.streak.received=streakBonus>0;try{await onAward({user,access,today:periods.day});}catch(error){console.warn('Challenge leaderboard refresh deferred',error.message);}return send(res,200,{...state,coins,awarded:reward,streakBonus});}
   const error=await response.json().catch(()=>({}));if(response.status===409||['ABORTED','FAILED_PRECONDITION','ALREADY_EXISTS'].includes(error.error?.status))continue;
   throw fail('報酬を受け取れませんでした。更新して再試行してください。',502);
  }
  throw fail('情報が更新されました。もう一度更新してください。',409);
 }catch(error){send(res,error.status||500,{error:error.message||'チャレンジを読み込めませんでした。'});}};
}
