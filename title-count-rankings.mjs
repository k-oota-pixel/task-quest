import {runtimePublicRankingCache} from './public-ranking-cache.mjs';

const VERSION=1;
const CACHE_SECTION='titleCounts';
const numeric=value=>Math.max(0,Math.min(100000,Math.floor(Number(value)||0)));
const petName=value=>String(value||'').normalize('NFKC').trim().slice(0,24)||'ふしぎなたまご';
const isUid=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\/\u0000-\u001f]/.test(value);
const encode=value=>{
 if(typeof value==='string')return {stringValue:value};
 if(Number.isSafeInteger(value))return {integerValue:String(value)};
 if(Array.isArray(value))return {arrayValue:{values:value.map(encode)}};
 if(value&&typeof value==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))}};
 return {nullValue:null};
};
export function topTitleCounts(entries=[]){
 const byUid=new Map();
 for(const entry of entries){
  if(!isUid(entry?.uid))continue;
  const count=numeric(entry.unlockedTitleCount);
  if(!count)continue;
  const previous=byUid.get(entry.uid);
  if(!previous||previous.unlockedTitleCount<=count)byUid.set(entry.uid,{uid:entry.uid,petName:petName(entry.petName),unlockedTitleCount:count});
 }
 return [...byUid.values()].sort((a,b)=>b.unlockedTitleCount-a.unlockedTitleCount||a.petName.localeCompare(b.petName,'ja')||a.uid.localeCompare(b.uid)).slice(0,3);
}
const toPublic=value=>({schemaVersion:VERSION,updatedAt:value.updatedAt||'',leaders:topTitleCounts(value.leaders).map((row,index)=>({...row,rank:index+1}))});
const sameLeaders=(a,b)=>JSON.stringify(topTitleCounts(a))===JSON.stringify(topTitleCounts(b));
const uidFromName=name=>{const match=String(name||'').match(/\/documents\/users\/([^/]+)\/apps\/english-playroom$/);if(!match)return '';try{return decodeURIComponent(match[1]);}catch{return '';}};

export function createTitleCountRankings({
 base,projectId,accessToken,activeIds,excludedIds=async()=>[],decodeFields,verifyUser,send,fail,
 fetch:request=globalThis.fetch,now=Date.now,rankingStore=runtimePublicRankingCache()
}){
 const url=base+'/documents/leaderboards/titleCounts',prefix=`projects/${projectId}/databases/(default)/documents/`;
 let stored=null,loading=null,changeChain=Promise.resolve();
 async function readStored(){
  const token=await accessToken(),response=await request(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
  if(response.status===404)return null;
  if(!response.ok)throw fail('称号ランキングを取得できませんでした。',502);
  const doc=await response.json(),data=decodeFields(doc.fields||{});
  return {value:{schemaVersion:Number(data.schemaVersion)||0,updatedAt:typeof data.updatedAt==='string'?data.updatedAt:'',leaders:topTitleCounts(data.leaders)},updateTime:doc.updateTime||''};
 }
 async function save(value,updateTime=''){
  const token=await accessToken(),target=new URL(url);
  if(updateTime)target.searchParams.set('currentDocument.updateTime',updateTime);
  else target.searchParams.set('currentDocument.exists','false');
  const fields=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]));
  const response=await request(target.href,{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({fields}),signal:AbortSignal.timeout(15000)});
  if(!response.ok){const e=fail('称号ランキングを更新できませんでした。',response.status===409||response.status===412?409:502);e.retryable=response.status===409||response.status===412;throw e;}
  const doc=await response.json().catch(()=>({}));
  return {value,updateTime:doc.updateTime||''};
 }
 async function bootstrap(){
  const excluded=new Set(await excludedIds()),ids=[...new Set(await activeIds())].filter(id=>isUid(id)&&!excluded.has(id));
  const token=await accessToken(),entries=[];
  for(let start=0;start<ids.length;start+=200){
   const names=ids.slice(start,start+200).map(id=>prefix+'users/'+encodeURIComponent(id)+'/apps/english-playroom');
   const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents:names,mask:{fieldPaths:['petName','unlockedTitleCount']}}),signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw fail('称号ランキングの初期集計に失敗しました。',502);
   const rows=await response.json();
   for(const row of Array.isArray(rows)?rows:[]){
    const uid=uidFromName(row?.found?.name);
    if(!uid||excluded.has(uid))continue;
    const wallet=decodeFields(row.found.fields||{});
    entries.push({uid,petName:wallet.petName,unlockedTitleCount:wallet.unlockedTitleCount});
   }
  }
  return {schemaVersion:VERSION,updatedAt:new Date(now()).toISOString(),leaders:topTitleCounts(entries)};
 }
 async function load(){
  if(stored?.value?.schemaVersion===VERSION)return stored;
  if(loading)return loading;
  loading=(async()=>{
   let snapshot=await readStored();
   if(snapshot?.value?.schemaVersion===VERSION)return stored=snapshot;
   const value=await bootstrap();
   for(let retry=0;retry<3;retry++){
    try{return stored=await save(value,snapshot?.updateTime||'');}
    catch(e){if(!e.retryable||retry===2)throw e;snapshot=await readStored();if(snapshot?.value?.schemaVersion===VERSION)return stored=snapshot;}
   }
  })().finally(()=>{loading=null;});
  return loading;
 }
 async function snapshot(){
  return rankingStore.getSection(CACHE_SECTION,{load:async()=>toPublic((await load()).value),valid:data=>data?.schemaVersion===VERSION&&Array.isArray(data.leaders)&&data.leaders.every(row=>isUid(row.uid))});
 }
 async function publish(candidate){
  if(!isUid(candidate?.uid))return;
  if((await excludedIds()).includes(candidate.uid))return;
  const nextCandidate={uid:candidate.uid,petName:petName(candidate.petName),unlockedTitleCount:numeric(candidate.unlockedTitleCount)};
  const update=async()=>{
   let current=await load();
   for(let retry=0;retry<3;retry++){
    const nextLeaders=topTitleCounts([...current.value.leaders.filter(row=>row.uid!==candidate.uid),nextCandidate]);
    if(sameLeaders(current.value.leaders,nextLeaders))return false;
    const next={schemaVersion:VERSION,updatedAt:new Date(now()).toISOString(),leaders:nextLeaders};
    try{
     current=await save(next,current.updateTime);
     stored=current;
     await rankingStore.setSection(CACHE_SECTION,toPublic(next));
     return true;
    }catch(e){
     if(!e.retryable||retry===2)throw e;
     current=await readStored();
     if(!current)throw fail('称号ランキングの更新に失敗しました。',502);
     stored=current;
    }
   }
   return false;
  };
  const task=changeChain.then(update,update);changeChain=task.catch(()=>{});return task;
 }
 async function handle(req,res){
  try{
   if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
   await verifyUser(req);
   return send(res,200,await snapshot());
  }catch(e){return send(res,e.status||503,{error:e.message||'称号ランキングを取得できませんでした。'});}
 }
 return {handle,publish,snapshot};
}
