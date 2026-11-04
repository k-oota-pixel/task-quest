import {challengePeriods} from './challenge-model.mjs';
import {TITLE_CONTENTS} from './title-model.mjs';
import {runtimePublicRankingCache} from './public-ranking-cache.mjs';
const APPS=new Set(TITLE_CONTENTS.map(x=>x.id));
const integer=v=>Math.max(0,Math.min(1000000,Math.floor(Number(v)||0)));
const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s);
const safeName=s=>String(s||'').normalize('NFKC').trim().slice(0,24)||'ふしぎなたまご';
const uidFromDoc=name=>{const m=String(name||'').match(/\/documents\/learning_activity\/([^/]+)$/);return m?decodeURIComponent(m[1]):''};
const rowsToPublic=list=>list.map(({uid,...rest})=>rest);
export function dailyMaterialTransforms(appCounts,day){
 if(!validDay(day))return [];
 return [...appCounts].filter(([app,count])=>APPS.has(app)&&integer(count)>0)
  .map(([app,count])=>({fieldPath:'dailyCounts.`'+day+'`.`'+app+'`',increment:{integerValue:String(integer(count))}}));
}
export function rankMaterialRows(rows=[]){
 const unique=new Map();
 for(const row of rows){
  const uid=typeof row?.uid==='string'?row.uid:'',count=integer(row?.count);
  if(!uid||!count)continue;
  const existing=unique.get(uid);
  if(!existing||count>existing.count)unique.set(uid,{uid,petName:safeName(row.petName),count});
 }
 return [...unique.values()].sort((a,b)=>b.count-a.count||a.uid.localeCompare(b.uid)).slice(0,3)
  .map((row,index)=>({...row,rank:index+1}));
}
function jstDayBefore(day,days){return new Date(Date.parse(day+'T00:00:00Z')-days*86400000).toISOString().slice(0,10);}
export function createMaterialRankings({base,projectId,accessToken,decodeFields,verifyUser,send,fail,excludedIds=async()=>[],fetch:request=globalThis.fetch,now=Date.now,rankingStore=runtimePublicRankingCache()}){
 const prefix=`projects/${projectId}/databases/(default)/documents/`;
 const versions=new Map(),runtimeId=String(now())+'-'+Math.random().toString(36).slice(2);let weekdaySnapshot=null,weekdayPending=null;
 const keyOf=(app,day)=>'material_'+day+'_'+app;
 async function readBoard(app,day){
  const token=await accessToken(),fieldPath='dailyCounts.`'+day+'`.`'+app+'`';
  const structuredQuery={from:[{collectionId:'learning_activity'}],orderBy:[{field:{fieldPath},direction:'DESCENDING'}],limit:5};
  const response=await request(base+'/documents:runQuery',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw fail('教材ランキングを取得できませんでした。',502);
  const body=await response.json(),entries=[],excluded=new Set(await excludedIds());
  for(const item of Array.isArray(body)?body:[]){
   const doc=item?.document,uid=uidFromDoc(doc?.name);
   if(!uid||excluded.has(uid))continue;
   const fields=decodeFields(doc.fields||{}),count=integer(fields?.dailyCounts?.[day]?.[app]);
   if(count)entries.push({uid,count,petName:''});
  }
  if(entries.length){
   const names=entries.map(x=>prefix+'users/'+encodeURIComponent(x.uid)+'/apps/english-playroom');
   const resp=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:names,mask:{fieldPaths:['petName']}}),signal:AbortSignal.timeout(20000)});
   if(resp.ok){
    const wallets=await resp.json();
    for(const row of entries){
     const wallet=Array.isArray(wallets)?wallets.find(x=>x.found?.name===prefix+'users/'+encodeURIComponent(row.uid)+'/apps/english-playroom'):null;
     if(wallet)row.petName=decodeFields(wallet.found.fields||{}).petName||'';
    }
   }
  }
  return {day,appId:app,leaders:rankMaterialRows(entries),updatedAt:now()};
 }
 async function getBoard(app,day=challengePeriods(now()).day){
  if(!APPS.has(app)||!validDay(day))throw fail('教材が不正です。',400);
  const k=keyOf(app,day),revision=versions.get(k)||0,current=challengePeriods(now()).day;
  return rankingStore.getSection(k,{load:async()=>({...await readBoard(app,day),revision,runtimeId}),valid:value=>value?.day===day&&value?.appId===app&&(day<current||value.runtimeId===runtimeId&&value.revision===revision)});
 }
 async function getWinner(app,day){
  const cached=await rankingStore.getSection(keyOf(app,day));
  if(cached?.day===day&&Array.isArray(cached.leaders))return cached.leaders[0]?.uid||'';
  const key='materialWinner_'+day+'_'+app;
  const value=await rankingStore.getSection(key,{load:async()=>{
   const token=await accessToken(),fieldPath='dailyCounts.`'+day+'`.`'+app+'`';
   const structuredQuery={from:[{collectionId:'learning_activity'}],orderBy:[{field:{fieldPath},direction:'DESCENDING'}],limit:5};
   const response=await request(base+'/documents:runQuery',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery}),signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw fail('週間順位を取得できませんでした。',502);
   const body=await response.json(),excluded=new Set(await excludedIds()),entries=[];
   for(const item of Array.isArray(body)?body:[]){
    const doc=item?.document,uid=uidFromDoc(doc?.name);
    if(!uid||excluded.has(uid))continue;
    const fields=decodeFields(doc.fields||{}),count=integer(fields?.dailyCounts?.[day]?.[app]);
    if(count)entries.push({uid,count});
   }
   return {day,appId:app,uid:rankMaterialRows(entries)[0]?.uid||''};
  },valid:value=>value?.day===day&&value?.appId===app});
  return value?.uid||'';
 }
 function changed(appIds,day){
  if(!validDay(day))return;
  for(const app of appIds)if(APPS.has(app)){const key=keyOf(app,day);versions.set(key,(versions.get(key)||0)+1);}
 }
 async function readCoinDay(day){
  const key='coinWinners_'+day,active=challengePeriods(now()).day;
  return rankingStore.getSection(key,{load:async()=>{
   const token=await accessToken(),read=async(path)=>{
    const response=await request(base+'/documents/'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
    if(response.status===404)return null;
    if(!response.ok)throw fail('コイン順位を取得できませんでした。',502);
    return decodeFields((await response.json()).fields||{});
   };
   let board=await read('leaderboards/coin-day-'+day);
   if(!board)board=await read('leaderboards/daily-coins');
   return {day,verified:board?.today===day,leaders:board?.today===day&&Array.isArray(board.leaders)?board.leaders.map(x=>({uid:x.uid})).filter(x=>x.uid):[],loadedAt:now()};
  },valid:v=>v?.day===day&&(v.verified===true||now()-v.loadedAt<60000)&&day<active});
 }
 async function weeklySnapshot(){
  const period=challengePeriods(now()),cached=weekdaySnapshot;
  if(cached?.day===period.day&&cached?.week===period.week)return cached;
  if(weekdayPending?.day===period.day&&weekdayPending.week===period.week)return weekdayPending.promise;
  const promise=(async()=>{
  const days=Array.from({length:7},(_,i)=>jstDayBefore(period.week,-i)).filter(day=>day<period.day);
  const jobs=days.flatMap(day=>[...APPS].map(app=>({app,day})));
  const totals={};
  const add=(uid,app)=>{if(!uid)return;(totals[uid]||={})[app]=(totals[uid][app]||0)+1;};
  // Keep reads bounded. Historical leaderboards are immutable once a day closes.
  for(let offset=0;offset<jobs.length;offset+=8){
   const batch=jobs.slice(offset,offset+8);
   const results=await Promise.all(batch.map(async job=>({job,winner:await getWinner(job.app,job.day)})));
   for(const {job,winner} of results){
    if(winner)add(winner,job.app);
   }
  }
  for(const day of days){
   const coin=await readCoinDay(day);
   if(coin.verified)for(const row of coin.leaders)add(row.uid,'coins');
  }
  weekdaySnapshot={week:period.week,day:period.day,totals,completeDays:days};
  return weekdaySnapshot;
  })().finally(()=>{if(weekdayPending?.promise===promise)weekdayPending=null;});
  weekdayPending={day:period.day,week:period.week,promise};
  return promise;
 }
 async function userWeekly(uid){
  const summary=await weeklySnapshot();
  return {week:summary.week,progress:summary.totals[uid]||{}};
 }
 async function handle(req,res){
  try{
   if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
   await verifyUser(req);
   const app=new URL(req.url,'http://localhost').searchParams.get('appId'),day=challengePeriods(now()).day;
   if(!APPS.has(app))throw fail('教材が不正です。',400);
   const board=await getBoard(app,day);
   return send(res,200,{day,appId:app,updatedAt:board.updatedAt,leaders:rowsToPublic(board.leaders)});
  }catch(error){return send(res,error.status||503,{error:error.message||'教材ランキングを取得できませんでした。'});}
 }
 return {handle,getBoard,userWeekly,changed};
}
