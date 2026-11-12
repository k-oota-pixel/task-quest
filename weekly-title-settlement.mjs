import {challengePeriods} from './challenge-model.mjs';
import {weeklyTitles,WEEKLY_DAYS_TARGET} from './title-model.mjs';
import {awardTitleIds,walletTitleIds} from './title-collection.mjs';
import {titleCountTransforms} from './title-count-summary.mjs';

const FIRST_WEEK='2026-11-09';
const CHANGE_RETRY_MS=60_000;
const weekAfter=(week,offset=1)=>new Date(Date.parse(week+'T00:00:00Z')+offset*7*86400000).toISOString().slice(0,10);
const titleByApp=new Map(weeklyTitles().map(title=>[title.appId,title.id]));

export function createWeeklyTitleSettlement({base,projectId,accessToken,decodeFields,getAuthority,completedWeek,fetch:request=fetch,now=Date.now,log=console.warn}){
 const prefix=`projects/${projectId}/databases/(default)/documents/`;
 const checkpointPath='leaderboards/weekly-title-settlement';
 const checkpointUrl=base+'/documents/'+checkpointPath;
 let checkpoint=null,pending=null,retryAfter=0;

 async function readCheckpoint(headers){
  const response=await request(checkpointUrl,{headers,signal:AbortSignal.timeout(15000)});
  if(response.status===404)return {through:weekAfter(FIRST_WEEK,-1)};
  if(!response.ok)throw Error('週間称号の確定記録を取得できませんでした。');
  const doc=await response.json(),through=decodeFields(doc.fields||{}).settledThrough;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(through)||!doc.updateTime)throw Error('週間称号の確定記録が不正です。');
  return {through,updateTime:doc.updateTime};
 }

 async function awardsForWeek(week,headers){
  const totals=await completedWeek(week);
  const candidates=new Map();
  for(const [uid,days] of Object.entries(totals)){
   const ids=Object.entries(days).filter(([app,count])=>count>=WEEKLY_DAYS_TARGET&&titleByApp.has(app)).map(([app])=>titleByApp.get(app));
   if(ids.length)candidates.set(prefix+'users/'+encodeURIComponent(uid)+'/apps/english-playroom',{uid,ids});
  }
  if(!candidates.size)return [];
  const response=await request(base+'/documents:batchGet',{
   method:'POST',headers,signal:AbortSignal.timeout(15000),
   body:JSON.stringify({documents:[...candidates.keys()],mask:{fieldPaths:['earnedTitleIds']}})
  });
  if(!response.ok)throw Error('週間称号の対象者データを取得できませんでした。');
  const rows=await response.json(),authority=await getAuthority(),writes=[];
  const wallets=new Map(rows.map(row=>[row.found?.name||row.missing,row.found||null]));
  for(const [name,{uid,ids}] of candidates){
   if(!wallets.has(name))throw Error('週間称号の対象者データを確認できませんでした。');
   const doc=wallets.get(name),owned=walletTitleIds(decodeFields(doc?.fields||{}),authority,uid);
   const added=ids.filter(id=>!owned.has(id));
   if(!added.length)continue;
   const write=awardTitleIds(prefix,uid,added,authority);
   write.currentDocument=doc?{updateTime:doc.updateTime}:{exists:false};
   write.updateTransforms.push(...titleCountTransforms(0,{invalidate:true}));
   writes.push(write);
  }
  return writes;
 }

 async function settle(latest){
  const headers={Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json'};
  checkpoint??=await readCheckpoint(headers);
  for(let week=weekAfter(checkpoint.through);week<=latest;week=weekAfter(week)){
   const writes=await awardsForWeek(week,headers);
   writes.push({
    update:{name:prefix+checkpointPath,fields:{settledThrough:{stringValue:week}}},
    updateMask:{fieldPaths:['settledThrough']},
    currentDocument:checkpoint.updateTime?{updateTime:checkpoint.updateTime}:{exists:false}
   });
   // The checkpoint and the awards succeed together, including on retry.
   const response=await request(base+'/documents:commit',{
    method:'POST',headers,signal:AbortSignal.timeout(15000),body:JSON.stringify({writes})
   });
   if(!response.ok)throw Error('週間称号の確定結果を保存できませんでした。 ('+response.status+')');
   const result=await response.json();
   checkpoint={through:week,updateTime:result.writeResults?.at(-1)?.updateTime||result.commitTime};
  }
 }

 function run(){
  const latest=weekAfter(challengePeriods(now()).week,-1);
  if(latest<FIRST_WEEK||checkpoint?.through>=latest||now()<retryAfter)return Promise.resolve();
  if(pending)return pending;
  pending=settle(latest).catch(error=>{
   checkpoint=null;
   retryAfter=now()+CHANGE_RETRY_MS;
   log('Weekly title settlement deferred',error.message);
  }).finally(()=>{pending=null;});
  return pending;
 }
 return {run};
}
