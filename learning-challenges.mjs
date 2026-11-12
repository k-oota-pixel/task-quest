import {challengePeriods,challengeState,isChallengeContent} from './challenge-model.mjs';
import {dailyStreak,previousDay} from './challenge-streak.mjs';
const summaryVersion=1;
const legacyLastDay='2026-11-12';
const legacyLastWeek=challengePeriods(Date.parse(legacyLastDay+'T00:00:00+09:00')).week;
const weekdayKey=day=>'d'+new Date(day+'T00:00:00Z').getUTCDay();
const completedInDay=(activity,day)=>Object.keys(activity.dailyCounts?.[day]||{}).filter(id=>isChallengeContent(id)&&activity.dailyCounts[day][id]>0);
const completedMap=ids=>({completed:Object.fromEntries(ids.map(id=>[id,true]))});
const dailyClaimFor=(summary,day)=>{
 const claim=summary.dailyClaims?.[weekdayKey(day)];
 return claim?.day===day?claim:null;
};
const weeklyClaimFor=(summary,week)=>summary.weeklyClaim===week?{period:week}:null;
function rememberClaim(summary,kind,period,claim){
 if(kind==='weekly')return {...summary,weeklyClaim:period};
 return {...summary,dailyClaims:{...summary.dailyClaims,[weekdayKey(period)]:{day:period,streakBonus:Number(claim.streakBonus)||0}}};
}
function challengeRecords(activity,summary,periods,historyDays){
 const dailyFor=day=>completedMap([...completedInDay(activity,day),...(summary.legacyDays?.[day]||[])]);
 const weekDays=Array.from({length:7},(_,offset)=>previousDay(periods.day,offset)).filter(day=>day>=periods.week);
 const weekly=completedMap([...weekDays.flatMap(day=>completedInDay(activity,day)),...(summary.legacyWeek===periods.week?summary.legacyWeekly:[])]);
 return {daily:dailyFor(periods.day),weekly,dailyClaim:dailyClaimFor(summary,periods.day),
  weeklyClaim:weeklyClaimFor(summary,periods.week),activity,
  history:historyDays.map(day=>({day,progress:dailyFor(day),claim:dailyClaimFor(summary,day)}))};
}
const conflict=(status,error)=>[409,412].includes(status)||['ABORTED','FAILED_PRECONDITION','ALREADY_EXISTS'].includes(error?.error?.status);

export function createLearningChallenges({base,projectId,accessToken,verifyUser,decodeFields,encodeFields,send,fail,readJson,onAward=()=>{},fetch:request=globalThis.fetch,now=Date.now}){
 const prefix=`projects/${projectId}/databases/(default)/documents/`;
 const migrations=new Map();
 return async function handle(req,res){try{
  if(!['GET','POST'].includes(req.method))throw fail('GETまたはPOSTのみ対応しています。',405);
  const user=await verifyUser(req);let body={};if(req.method==='POST'){if(!req.headers?.['content-type']?.startsWith('application/json'))throw fail('JSONで送信してください。',415);body=await readJson(req,1024);if(!['daily','weekly'].includes(body.kind))throw fail('チャレンジの種類が不正です。',400);}
  const access=await accessToken(),headers={Authorization:'Bearer '+access,'Content-Type':'application/json'};
  async function read(path){const response=await request(base+'/documents/'+path,{headers,signal:AbortSignal.timeout(15000)});if(response.status===404)return null;if(!response.ok)throw fail('チャレンジ情報を取得できませんでした。更新して再試行してください。',502);const d=await response.json();return {data:decodeFields(d.fields||{}),updateTime:d.updateTime};}
  const activityPath='learning_activity/'+encodeURIComponent(user.uid);
  const progress=`challenge_progress/${user.uid}/periods/`,claims=`challenge_claims/${user.uid}/periods/`;
  function summaryWrite(summary,activity){
   return {update:{name:prefix+activityPath,fields:encodeFields({uid:user.uid,challengeSummary:summary})},
    updateMask:{fieldPaths:['uid','challengeSummary']},currentDocument:activity?{updateTime:activity.updateTime}:{exists:false}};
  }
  async function commit(writes){
   const response=await request(base+'/documents:commit',{method:'POST',headers,body:JSON.stringify({writes}),signal:AbortSignal.timeout(15000)});
   if(response.ok)return true;
   if(conflict(response.status,await response.json().catch(()=>({}))))return false;
   throw fail('チャレンジを保存できませんでした。更新して再試行してください。',502);
  }
  let legacyRead=null,recoveredClaim=null;
  async function readLegacy(periods,historyDays){
   const days=[periods.day,...historyDays];
   const [weekly,weeklyClaim,...entries]=await Promise.all([read(progress+'weekly-'+periods.week),read(claims+'weekly-'+periods.week),
    ...days.flatMap(day=>[read(progress+'daily-'+day),read(claims+'daily-'+day)])]);
   const completed=doc=>Object.keys(doc?.data?.completed||{}).filter(isChallengeContent);
   let summary={version:summaryVersion,legacyWeek:periods.week,legacyWeekly:completed(weekly),
    legacyDays:Object.fromEntries(days.map((day,i)=>[day,completed(entries[i*2])])),dailyClaims:{}};
   if(weeklyClaim)summary=rememberClaim(summary,'weekly',periods.week,weeklyClaim.data);
   days.forEach((day,i)=>{const claim=entries[i*2+1];if(claim)summary=rememberClaim(summary,'daily',day,claim.data);});
   return summary;
  }
  for(let attempt=0;attempt<4;attempt++){
   const time=now(),periods=challengePeriods(time),historyDays=[2,1].map(offset=>previousDay(periods.day,offset));
   const kind=body.kind,period=kind==='daily'?periods.day:periods.week;
   if(req.method==='POST'&&body.period!==period)throw fail('チャレンジの期間が変わりました。更新して確認してください。',409);
   const activity=await read(activityPath),dataActivity=activity?.data||{};
   const initialized=dataActivity.challengeSummary?.version===summaryVersion;
   const migrateLegacy=!initialized&&(periods.week<=legacyLastWeek||historyDays[0]<=legacyLastDay);
   if(migrateLegacy&&legacyRead?.day!==periods.day){
    const key=user.uid+'|'+periods.day;
    let pending=migrations.get(key);
    if(!pending){
     pending=readLegacy(periods,historyDays).finally(()=>migrations.delete(key));
     migrations.set(key,pending);
    }
    legacyRead={day:periods.day,summary:await pending};
   }
   let summary=initialized?dataActivity.challengeSummary:migrateLegacy?legacyRead.summary:{version:summaryVersion,dailyClaims:{}};
   const recovered=recoveredClaim?.period===period;
   if(recovered)summary=rememberClaim(summary,kind,period,recoveredClaim.data);
   const records=challengeRecords(dataActivity,summary,periods,historyDays);
   const state=challengeState(user.uid,periods,records,time);
   state.daily.streak=dailyStreak(user.uid,periods.day,state.daily.complete,records.dailyClaim,records.history);
   if(req.method==='GET'||state[kind].claimed){
    if((migrateLegacy||recovered)&&!(await commit([summaryWrite(summary,activity)])))continue;
    return send(res,200,req.method==='GET'?state:{...state,awarded:0,alreadyClaimed:true});
   }
   const challenge=state[kind];
   if(!challenge.complete)throw fail('まだ達成していません。対象教材に取り組んでから更新してください。',409);
   const walletPath=`users/${user.uid}/apps/english-playroom`,wallet=await read(walletPath),data=wallet?.data||{};
   // Period boundaries use server time, including a midnight crossed during reads.
   const current=challengePeriods(now());if(current.day!==periods.day||current.week!==periods.week)continue;
   const streakBonus=kind==='daily'&&state.daily.streak.eligible?10:0,reward=challenge.reward+streakBonus;
   const count=x=>Math.max(0,Math.floor(Number(x)||0)),coins=count(data.coins)+reward,earned=(data.coinEarnedDate===periods.day?count(data.coinsEarnedToday):0)+reward;
   const fields={coins:{integerValue:String(coins)},coinEarnedDate:{stringValue:periods.day},coinsEarnedToday:{integerValue:String(earned)},coinSchemaVersion:{integerValue:'1'}};
   const writes=[summaryWrite(rememberClaim(summary,kind,period,{streakBonus}),activity),
    {update:{name:prefix+walletPath,fields},updateMask:{fieldPaths:Object.keys(fields)},currentDocument:wallet?{updateTime:wallet.updateTime}:{exists:false},updateTransforms:[{fieldPath:'coinUpdatedAt',setToServerValue:'REQUEST_TIME'}]}];
   // The old server can still have a claim in flight during this rollout.
   const legacyPeriod=kind==='daily'?period===legacyLastDay:period===legacyLastWeek;
   const receipt=claims+kind+'-'+period;
   if(legacyPeriod)writes.push({update:{name:prefix+receipt,fields:encodeFields({uid:user.uid,kind,period,reward,streakBonus})},
    currentDocument:{exists:false},updateTransforms:[{fieldPath:'claimedAt',setToServerValue:'REQUEST_TIME'}]});
   if(await commit(writes)){challenge.claimed=true;if(kind==='daily')state.daily.streak.received=streakBonus>0;try{await onAward({user,access,today:periods.day,walletData:{...data,coinEarnedDate:periods.day,coinsEarnedToday:earned}});}catch(error){console.warn('Challenge leaderboard refresh deferred',error.message);}return send(res,200,{...state,coins,awarded:reward,streakBonus});}
   if(legacyPeriod){
    const oldClaim=await read(receipt);
    if(oldClaim)recoveredClaim={period,data:oldClaim.data};
   }
  }
  throw fail('情報が更新されました。もう一度更新してください。',409);
 }catch(error){send(res,error.status||500,{error:error.message||'チャレンジを読み込めませんでした。'});}};
}
