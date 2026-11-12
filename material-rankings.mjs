import {challengePeriods} from './challenge-model.mjs';
import {TITLE_CONTENTS,RANKING_ONLY_CONTENTS} from './title-model.mjs';
import {runtimePublicRankingCache} from './public-ranking-cache.mjs';
const APPS=new Set([...TITLE_CONTENTS,...RANKING_ONLY_CONTENTS].map(x=>x.id));
const integer=v=>Math.max(0,Math.min(1000000,Math.floor(Number(v)||0)));
const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s);
const safeName=s=>String(s||'').normalize('NFKC').trim().slice(0,24)||'ふしぎなたまご';
const uidFromDoc=name=>{const m=String(name||'').match(/\/documents\/learning_activity\/([^/]+)$/);return m?decodeURIComponent(m[1]):''};
const rowsToPublic=list=>list.map(row=>({...row}));
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
 const versions=new Map(),runtimeId=String(now())+'-'+Math.random().toString(36).slice(2);let weekdaySnapshot=null,weekdayPending=null,archiveRevision=0;
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
 function coinArchiveChanged(){
  archiveRevision++;
  weekdaySnapshot=null;
 }
 async function readRankDocument(path,token){
  const response=await request(base+'/documents/'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
  if(response.status===404)return {};
  if(!response.ok)throw fail('確定した順位を取得できませんでした。',502);
  return decodeFields((await response.json()).fields||{});
 }
 async function fillMaterialWinners(day,path,document,token){
  const stored=document.materialWinners||{};
  const missing=[...APPS].filter(app=>typeof stored[app]!=='string');
  if(!missing.length)return stored;
  const winners={...stored};
  for(let offset=0;offset<missing.length;offset+=8){
   const apps=missing.slice(offset,offset+8);
   const results=await Promise.all(apps.map(app=>getWinner(app,day)));
   apps.forEach((app,index)=>{winners[app]=results[index];});
  }
  // The coin archive and material winners share one date document. Each
  // writer masks its own fields, so either one can arrive first at midnight.
  const response=await request(base+'/documents/'+path+'?updateMask.fieldPaths=materialWinners',{
   method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   signal:AbortSignal.timeout(15000),body:JSON.stringify({fields:{materialWinners:{mapValue:{fields:
    Object.fromEntries(Object.entries(winners).map(([app,uid])=>[app,{stringValue:uid}]))
   }}}})
  });
  if(!response.ok)throw fail('確定した教材順位を保存できませんでした。',502);
  return winners;
 }
 async function readClosedDays(days){
  const totals=Object.create(null),token=days.length?await accessToken():null;
  const add=(uid,app)=>{if(uid)(totals[uid]||=Object.create(null))[app]=(totals[uid][app]||0)+1;};
  let latest;
  for(const day of days){
   const path='leaderboards/coin-day-'+day,archived=await readRankDocument(path,token);
   const winners=await fillMaterialWinners(day,path,archived,token);
   for(const app of APPS)add(winners[app],app);
   let coin=archived;
   if(coin.today!==day){
    latest??=await readRankDocument('leaderboards/daily-coins',token);
    coin=latest;
    // The coin board might have rolled over between the archive and live reads.
    if(latest.today>day&&day===days.at(-1)&&day===jstDayBefore(challengePeriods(now()).day,1)){
     coin=await readRankDocument(path,token);
    }
   }
   if(coin.today===day&&Array.isArray(coin.leaders)){
    for(const uid of new Set(coin.leaders.map(row=>row.uid)))add(uid,'coins');
   }
  }
  return totals;
 }
 async function completedWeek(week){
  if(!validDay(week)||week>=challengePeriods(now()).week)throw fail('週が確定していません。',400);
  return readClosedDays(Array.from({length:7},(_,i)=>jstDayBefore(week,-i)));
 }
 async function weeklySnapshot(){
  const period=challengePeriods(now()),revision=archiveRevision,cached=weekdaySnapshot;
  if(cached?.day===period.day&&cached.revision===revision)return cached;
  if(weekdayPending?.day===period.day&&weekdayPending.revision===revision)return weekdayPending.promise;
  const promise=(async()=>{
   const days=Array.from({length:7},(_,i)=>jstDayBefore(period.week,-i)).filter(day=>day<period.day);
   const totals=await readClosedDays(days);
   const summary={week:period.week,day:period.day,revision,totals};
   if(archiveRevision===revision)weekdaySnapshot=summary;
   return summary;
  })().finally(()=>{if(weekdayPending?.promise===promise)weekdayPending=null;});
  weekdayPending={day:period.day,revision,promise};
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
 return {handle,getBoard,userWeekly,completedWeek,changed,coinArchiveChanged};
}
