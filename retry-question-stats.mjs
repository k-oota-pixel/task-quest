// Combine first-answer samples by question, not the percentages themselves.
// A learner who used both materials contributes one sample from each material.
export function mergeRetryAndBattleQuestionStats(retryRows=[],battleRows=[],grade,limit=20){
 const rows=new Map();
 for(const [source,records] of [['retry',retryRows],['battle',battleRows]]){
  for(const entry of records){
   if(!entry||typeof entry.id!=='string'||!entry.id||entry.grade&&entry.grade!==grade)continue;
   const rawAttempts=Number(entry.attempts),rawCorrect=Number(entry.correct);
   if(!Number.isSafeInteger(rawAttempts)||rawAttempts<=0||!Number.isSafeInteger(rawCorrect)||rawCorrect<0)continue;
   const attempts=rawAttempts,correct=Math.min(rawCorrect,attempts),prior=rows.get(entry.id)||{id:entry.id,attempts:0,correct:0,retryAttempts:0,battleAttempts:0};
   prior.attempts+=attempts;
   prior.correct+=correct;
   prior[source==='retry'?'retryAttempts':'battleAttempts']+=attempts;
   rows.set(entry.id,prior);
  }
 }
 const all=[...rows.values()].map(item=>({...item,accuracy:Math.round(item.correct/item.attempts*1000)/10}))
   .sort((a,b)=>a.accuracy-b.accuracy||b.attempts-a.attempts||a.id.localeCompare(b.id,'ja'));
 return {grade,limit,total:all.length,rows:all.slice(0,limit),combined:true,sampleUnit:'first-answer-per-material'};
}

export function createRetryQuestionStats({base,accessToken,verifyAdmin,decodeFields,send,fail,fetch:request=fetch,getQuestionBattleStats}){
 const allowedGrades=new Set(['4級','3級','準2級','2級','準1級']);
 const allowedLimits=new Set([10,20,30,50,100]);
 const gradeKeys={'4級':'4','3級':'3','準2級':'pre2','2級':'2'};
 return async(req,res)=>{try{
  if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
  await verifyAdmin(req);
  const url=new URL(req.url,'http://localhost'),grade=String(url.searchParams.get('grade')||'準2級');
  if(!allowedGrades.has(grade))throw fail('級を確認してください。',400);
  const requested=Number(url.searchParams.get('limit')||20),limit=allowedLimits.has(requested)?requested:20;
  // Exactly one Firestore GET and, for four supported grades, one RTDB GET.
  // Neither operation occurs during ordinary gameplay.
  const token=await accessToken();
  const [response,battle]=await Promise.all([
   request(base+'/documents/analytics/retry-question-first-v1',{headers:{Authorization:'Bearer '+token}}),
   gradeKeys[grade]&&getQuestionBattleStats?getQuestionBattleStats(gradeKeys[grade]):Promise.resolve({rows:[]})
  ]);
  if(response.status!==404&&!response.ok)throw fail('リトライ難問ランキングを取得できませんでした。',502);
  const raw=response.status===404?{}:await response.json().catch(()=>({}));
  const data=decodeFields(raw.fields||{}),items=data.items&&typeof data.items==='object'?data.items:{};
  const retry=Object.values(items).filter(item=>item&&item.grade===grade&&Number(item.attempts)>0);
  const combined=mergeRetryAndBattleQuestionStats(retry,battle?.rows||[],grade,limit);
  return send(res,200,{...combined,updatedAt:data.updatedAt||raw.updateTime||''});
 }catch(error){send(res,error.status||500,{error:error.message||'難問ランキングを取得できませんでした。'});}};
}
