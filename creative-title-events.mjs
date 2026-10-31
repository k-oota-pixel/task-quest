import grammarUnits from './grammar-reward-units.json' with {type:'json'};
import {applyTitleEvent,keyOf} from './creative-title-progress.mjs';
import {creativeTitles,creativeCatalog} from './title-model.mjs';
import {challengePeriods} from './challenge-model.mjs';
const encode=v=>v===null?{nullValue:null}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(Math.floor(v))}:typeof v==='string'?{stringValue:v}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};
export function validateTitleEvent(b,fail){
 if(!b||!creativeCatalog[b.appId]||!(/^[\w-]{8,100}$/).test(b.eventId||''))throw fail('称号の記録が不正です。',400);
 const e={appId:b.appId,eventId:b.eventId};
 for(const k of ['kind','itemId','sessionId','grade','course','mode','questionType','language','answer'])if(b[k]!==undefined){if(typeof b[k]!=='string'||b[k].length>(k==='answer'?3000:300))throw fail('記録が長すぎます。',400);e[k]=b[k];}
 for(const k of ['score','total','combo','oneLifeCorrect','afterMissCorrect','previousMistakes','previousWrongAt','floor'])if(b[k]!==undefined){if(!Number.isInteger(b[k])||b[k]<0||b[k]>(k==='previousWrongAt'?Date.now():100000))throw fail('記録の数値が不正です。',400);e[k]=b[k];}
 for(const k of ['correct','clean','cleanRun','recovered','color','shape','size','manual','question','reason','followUp','series','first','critical','noDamage'])if(b[k]!==undefined){if(typeof b[k]!=='boolean')throw fail('記録の条件が不正です。',400);e[k]=b[k];}
 const kinds={ 'word-tower':['run','answer','defeat'],'eiken-dungeon':['run','answer','defeat'],'word-breaker':['run'],'pet-catch':['run'],ateru:['question','run'],'basic-quest':['question','run'],'basic-grammar':['question'],grammar:['question'],today:['read'],'eiken-cloze':['passage'],'reading-training':['exercise','summary'],'pet-instructions':['round','run'],'talk-quest':['chat'],'pet-chat':['chat']};
 if(!(kinds[e.appId]||['answer']).includes(e.kind))throw fail('記録の種類が不正です。',400);
 if(e.kind==='run'&&!Number.isInteger(e.score))throw fail('結果が必要です。',400);
 if(!['run','chat'].includes(e.kind)&&!e.itemId)throw fail('問題が必要です。',400);
 if(e.kind==='chat'&&(!e.sessionId||!e.itemId))throw fail('会話が必要です。',400);
 if(e.appId==='word-breaker'&&!['junior1','junior2','junior3','high1','high2','basic'].includes(e.course))throw fail('コースが不正です。',400);
 if(e.appId==='pet-catch'&&!['en-ja','ja-en'].includes(e.mode))throw fail('モードが不正です。',400);
 if(e.appId==='eiken-cloze'){
  if(!['choice','free'].includes(e.mode)||!Array.isArray(b.results)||!b.results.length||b.results.length>20||b.results.some(r=>!r||!['string','number'].includes(typeof r.id)||String(r.id).length>100||typeof r.correct!=='boolean')||new Set(b.results.map(r=>String(r.id))).size!==b.results.length)throw fail('採点結果が不正です。',400);
  e.results=b.results.map(r=>({id:String(r.id),correct:r.correct}));
 }
 if(e.appId==='listening-training'&&!['practice','dictation'].includes(e.mode))throw fail('モードが不正です。',400);
 if(['pre2-interview-questions','eiken-pre2-interview-a','reading-training'].includes(e.appId)&&e.kind!=='summary'&&(!Number.isInteger(e.score)||!e.total||e.score>e.total))throw fail('採点結果が不正です。',400);
 if(['ateru','basic-quest','pet-instructions'].includes(e.appId)&&e.kind==='run'&&e.score>(e.appId==='basic-quest'?4:5))throw fail('結果の上限を超えています。',400);
 if(['eiken-retry','eiken-title','task-quest','listening-training'].includes(e.appId)&&typeof e.correct!=='boolean')throw fail('判定が必要です。',400);
 if(['word-tower','eiken-dungeon'].includes(e.appId)){
  if(!e.sessionId||!Number.isInteger(e.floor)||e.floor<1||e.floor>100000)throw fail('冒険の記録が不正です。',400);
  if(e.kind==='answer'&&(typeof e.correct!=='boolean'||typeof e.critical!=='boolean'))throw fail('解答の記録が不正です。',400);
  if(e.kind==='defeat'&&typeof e.noDamage!=='boolean')throw fail('撃破の記録が不正です。',400);
 }
 if(grammarUnits[e.appId]){
  const match=/^(\d+):(\d+)$/.exec(e.itemId||''),unit=match&&grammarUnits[e.appId].find(u=>u.number===Number(match[1]));
  if(!unit||e.itemId!==Number(match[1])+':'+Number(match[2])||Number(match[2])>=unit.total||typeof e.correct!=='boolean'||!/^\d{4}-\d{2}-\d{2}$/.test(e.course||''))throw fail('文法問題が不正です。',400);
 }
 if(e.appId==='today'&&(!['5級','4級','3級','準2級','2級','準1級'].includes(e.grade)||!/^\d{4}-\d{2}-\d{2}$/.test(e.course||'')))throw fail('記事の記録が不正です。',400);
 return e;
}
const titleCountInvalidation=(prefix,uid)=>({update:{name:prefix+`users/${uid}/apps/english-playroom`,fields:{}},updateMask:{fieldPaths:[]},updateTransforms:[{fieldPath:'titleCountRevision',increment:{integerValue:'1'}}]});
export function createTitleEvents({base,projectId,accessToken,verifyUser,decodeFields,send,fail,readJson,fetch:request=fetch}){
 const prefix=`projects/${projectId}/databases/(default)/documents/`;
 const recentBatches=new Map(),requestWindows=new Map(),inFlight=new Set();
 async function applyBatch(user,body,res){
  if(!creativeCatalog[body.appId]||typeof body.batchId!=='string'||!(/^[\w-]{8,100}$/).test(body.batchId)||!Array.isArray(body.events)||!body.events.length||body.events.length>25)throw fail('称号記録のまとめ方が不正です。',400);
  const events=body.events.map(event=>validateTitleEvent({...event,appId:body.appId},fail));
  if(new Set(events.map(event=>event.eventId)).size!==events.length)throw fail('同じ記録が重複しています。',400);
  const limited=Boolean(grammarUnits[body.appId]||body.appId==='today'),cacheKey=user.uid+':'+body.appId+':'+body.batchId,now=Date.now();
  if(limited){
   for(const [key,value]of recentBatches)if(value.until<=now)recentBatches.delete(key);
   const cached=recentBatches.get(cacheKey);if(cached)return send(res,200,{ok:true,duplicate:true,freshTitles:[]});
   for(const [key,value]of requestWindows)if(now-value.start>=60000)requestWindows.delete(key);
   const window=requestWindows.get(user.uid)||{start:now,count:0};
   if(window.count>=30||inFlight.has(user.uid))throw fail('記録が混み合っています。少し待って再送します。',429);
   window.count++;requestWindows.set(user.uid,window);inFlight.add(user.uid);
  }
  try{
  const token=await accessToken(),headers={Authorization:'Bearer '+token,'Content-Type':'application/json'},path=`title_progress/${user.uid}/activities/${body.appId}`,receipt=`title_events/${user.uid}/events/${keyOf(body.appId+':batch:'+body.batchId)}`,day=challengePeriods().day;
  const usageId=body.appId==='word-tower'?'adventure-tower':body.appId==='eiken-dungeon'?'adventure-dungeon':'';
  const answeredSessions=new Set(events.filter(event=>event.kind==='answer'&&event.sessionId).map(event=>event.sessionId));
  const completedRuns=new Set(events.filter(event=>event.kind==='run'&&event.sessionId&&answeredSessions.has(event.sessionId)).map(event=>event.sessionId));
  const usageCounts=usageId&&completedRuns.size?{[usageId]:completedRuns.size}:{};
  for(let attempt=0;attempt<5;attempt++){
   const response=await request(base+'/documents:batchGet',{method:'POST',headers,body:JSON.stringify({documents:[prefix+path,prefix+receipt,...(grammarUnits[body.appId]?[prefix+`users/${user.uid}/apps/english-playroom`]:[])]})});
   if(!response.ok)throw fail('称号の記録を取得できませんでした。',502);
   const rows=await response.json(),receiptDoc=rows.find(row=>row.found?.name===prefix+receipt)?.found;if(receiptDoc){const saved=decodeFields(receiptDoc.fields||{});return send(res,200,{ok:true,duplicate:true,freshTitles:Array.isArray(saved.freshTitles)?saved.freshTitles:[]});}
   const doc=rows.find(row=>row.found?.name===prefix+path)?.found,previous=decodeFields(doc?.fields||{});
   let next=previous;for(const event of events)next=applyTitleEvent(next,event,day);
   if(JSON.stringify(next).length>650000)throw fail('称号記録の上限に達しました。',413);
   const unlocked=new Set(creativeTitles(body.appId,previous).filter(title=>title.unlocked).map(title=>title.id)),freshTitles=creativeTitles(body.appId,next).filter(title=>title.unlocked&&!unlocked.has(title.id));
   const reward=grammarUnits[body.appId]?grammarRewardWrites({rows,previous:next,appId:body.appId,day,prefix,uid:user.uid,decodeFields}):{writes:[],coins:0};
   if(freshTitles.length&&reward.writes.length)reward.writes[0].updateTransforms.push({fieldPath:'titleCountRevision',increment:{integerValue:'1'}});
   const commit=await request(base+'/documents:commit',{method:'POST',headers,body:JSON.stringify({writes:[
    {update:{name:prefix+receipt,fields:{day:encode(day),batchId:encode(body.batchId),eventCount:encode(events.length),counts:encode(usageCounts),freshTitles:encode(freshTitles)}},currentDocument:{exists:false}},
    {update:{name:prefix+path,fields:encode(next).mapValue.fields},currentDocument:doc?{updateTime:doc.updateTime}:{exists:false}},
    ...reward.writes,...((freshTitles.length&&!reward.writes.length)||body.appId==='eiken-retry'?[titleCountInvalidation(prefix,user.uid)]:[])
   ]})});
   if(commit.ok){if(limited){if(recentBatches.size>=2000)recentBatches.delete(recentBatches.keys().next().value);recentBatches.set(cacheKey,{until:now+300000});}return send(res,200,{ok:true,freshTitles,awardedCoins:reward.coins});}
   const error=await commit.json?.().catch(()=>({}))||{};
   if(![409,412].includes(commit.status)&&!['ABORTED','ALREADY_EXISTS','FAILED_PRECONDITION'].includes(error.error?.status))throw fail('称号を保存できませんでした。',502);
  }
  throw fail('称号の保存が混み合っています。再試行してください。',409);
  }finally{if(limited)inFlight.delete(user.uid);}
 }
 return async(req,res)=>{try{
  if(req.method!=='POST')throw fail('POSTのみ対応しています。',405);
  const user=await verifyUser(req),body=await readJson(req,128000);
  if(Array.isArray(body?.events))return await applyBatch(user,body,res);
  if(grammarUnits[body?.appId]||body?.appId==='today')return await applyBatch(user,{appId:body.appId,batchId:body.eventId,events:[body]},res);
  const e=validateTitleEvent(body,fail),token=await accessToken(),headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const path=`title_progress/${user.uid}/activities/${e.appId}`,receipt=`title_events/${user.uid}/events/${keyOf(e.appId+':'+e.eventId)}`,day=challengePeriods().day;
  for(let attempt=0;attempt<5;attempt++){
   const response=await request(base+'/documents:batchGet',{method:'POST',headers,body:JSON.stringify({documents:[prefix+path,prefix+receipt]})});if(!response.ok)throw fail('称号の記録を取得できませんでした。',502);
   const rows=await response.json(),receiptDoc=rows.find(row=>row.found?.name===prefix+receipt)?.found;if(receiptDoc){const saved=decodeFields(receiptDoc.fields||{});return send(res,200,{ok:true,duplicate:true,freshTitles:[]});}
   const doc=rows.find(row=>row.found?.name===prefix+path)?.found,previous=decodeFields(doc?.fields||{}),next=applyTitleEvent(previous,e,day);
   if(JSON.stringify(next).length>650000)throw fail('称号記録の上限に達しました。',413);
   const unlocked=new Set(creativeTitles(e.appId,previous).filter(title=>title.unlocked).map(title=>title.id)),freshTitles=creativeTitles(e.appId,next).filter(title=>title.unlocked&&!unlocked.has(title.id));
   const commit=await request(base+'/documents:commit',{method:'POST',headers,body:JSON.stringify({writes:[{update:{name:prefix+receipt,fields:{day:encode(day),freshTitles:encode(freshTitles)}},currentDocument:{exists:false}},{update:{name:prefix+path,fields:encode(next).mapValue.fields},currentDocument:doc?{updateTime:doc.updateTime}:{exists:false}},...(freshTitles.length||e.appId==='eiken-retry'?[titleCountInvalidation(prefix,user.uid)]:[])]})});
   if(commit.ok)return send(res,200,{ok:true,freshTitles});const error=await commit.json?.().catch(()=>({}))||{};if(![409,412].includes(commit.status)&&!['ABORTED','ALREADY_EXISTS','FAILED_PRECONDITION'].includes(error.error?.status))throw fail('称号を保存できませんでした。',502);
  }
  throw fail('称号の保存が混み合っています。',409);
 }catch(error){send(res,error.status||500,{error:error.message||'称号を保存できませんでした。'});}};
}


export function grammarRewardWrites({rows,previous,appId,day,prefix,uid,decodeFields}){
 const name=prefix+'users/'+uid+'/apps/english-playroom',walletDoc=rows.find(r=>r.found?.name===name)?.found,wallet=decodeFields(walletDoc?.fields||{});
 const claims=wallet.coinRewardDate===day&&Array.isArray(wallet.coinRewardClaims)?[...wallet.coinRewardClaims]:[];
 let coins=0;
 const answers=previous.rewardDay===day?(previous.rewardOrder||[]).map(id=>previous.rewardAnswers?.[id]):[];
 for(let start=0;start+5<=answers.length;start+=5){
  const claim=appId+':group-'+Math.floor(start/5);
  if(!claims.includes(claim)&&answers.slice(start,start+5).filter(v=>v===true).length>=3){claims.push(claim);coins++;}
 }
 if(!coins)return {coins:0,writes:[]};
 const fields={coins:Math.max(0,Number(wallet.coins)||0)+coins,coinRewardDate:day,coinRewardClaims:claims,coinEarnedDate:day,coinsEarnedToday:(wallet.coinEarnedDate===day?Math.max(0,Number(wallet.coinsEarnedToday)||0):0)+coins,coinSchemaVersion:1};
 return {coins,writes:[{update:{name,fields:encode(fields).mapValue.fields},updateMask:{fieldPaths:Object.keys(fields)},updateTransforms:[{fieldPath:'coinUpdatedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:walletDoc?{updateTime:walletDoc.updateTime}:{exists:false}}]};
}
