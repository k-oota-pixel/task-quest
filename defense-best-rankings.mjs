import {runtimePublicRankingCache} from './public-ranking-cache.mjs';

// Persistent highest cleared stage for each defense mode. Both boards share one
// Render-side snapshot; returning viewers never scan Firestore individually.
const SCHEMA=1,MODES={normal:'typingDefenseBestNormal',hard:'typingDefenseBestHard'};
const stageOf=value=>Math.max(0,Math.min(5,Math.floor(Number(value)||0)));
const cleanName=value=>String(value||'').normalize('NFKC').trim().slice(0,24)||'名前未設定のペット';
const uniqueId=name=>{const match=String(name||'').match(/\/learning_activity\/([^/]+)$/);return match?decodeURIComponent(match[1]):'';};
const walletId=name=>{const match=String(name||'').match(/\/users\/([^/]+)\/apps\/english-playroom$/);return match?decodeURIComponent(match[1]):'';};
const publicRows=rows=>rows.map(({uid,...row})=>row);
export function defenseTopThree(rows=[]){
 const unique=new Map();
 for(const row of rows){
  const uid=String(row?.uid||''),floor=stageOf(row?.floor);
  if(!uid||!floor)continue;
  const prior=unique.get(uid);
  if(!prior||floor>prior.floor)unique.set(uid,{uid,petName:cleanName(row.petName),floor,...(row.title?{title:row.title}:{})});
 }
 const sorted=[...unique.values()].sort((a,b)=>b.floor-a.floor||a.uid.localeCompare(b.uid));
 let rank=0,lastFloor=0;
 return sorted.map((row,index)=>{
  if(row.floor!==lastFloor){rank=index+1;lastFloor=row.floor;}
  return {...row,rank,...(row.floor===5?{cleared:true}:{})};
 }).filter(row=>row.rank<=3);
}
function legacyStage(data,appId){
 let best=0;
 const days=data?.dailyCounts;
 if(days&&typeof days==='object')for(const perDay of Object.values(days))
  best=Math.max(best,stageOf(perDay?.[appId]));
 return best;
}
export function createDefenseBestRankings({base,projectId,accessToken,activeIds,excludedIds=async()=>[],decodeFields,decorate,send,fail,fetch:request=globalThis.fetch,now=Date.now,rankingStore=runtimePublicRankingCache()}){
 const prefix=`projects/${projectId}/databases/(default)/documents/`;
 const section='defense-best-v1';
 let publishChain=Promise.resolve();
 const call=async(documents,fieldPaths)=>{
  if(!documents.length)return [];
  const token=await accessToken();
  const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({documents,mask:{fieldPaths}}),signal:AbortSignal.timeout(20000)});
  const rows=await response.json().catch(()=>[]);
  if(!response.ok||!Array.isArray(rows))throw fail('防衛ランキングの記録を読み取れませんでした。',502);
  return rows;
 };
 async function hydrate(rows){
  const uids=[...new Set(rows.map(row=>row.uid))];
  const names=uids.map(uid=>prefix+'users/'+encodeURIComponent(uid)+'/apps/english-playroom');
  const wallets=[];
  for(let i=0;i<names.length;i+=200)wallets.push(...await call(names.slice(i,i+200),['petName']));
  const lookup=new Map(wallets.filter(row=>row.found).map(row=>[walletId(row.found.name),decodeFields(row.found.fields||{}).petName]));
  const named=rows.map(row=>({...row,petName:cleanName(lookup.get(row.uid)||row.petName)}));
  if(typeof decorate!=='function')return named;
  const decorated=await decorate(named);
  return named.map((row,i)=>({...row,title:decorated[i]?.title||'称号なし'}));
 }
 async function bootstrap(){
  const excluded=new Set(await excludedIds());
  const ids=[...new Set(await activeIds())].filter(uid=>uid&&!excluded.has(uid));
  const rows=[];
  for(let i=0;i<ids.length;i+=200){
   const names=ids.slice(i,i+200).map(uid=>prefix+'learning_activity/'+encodeURIComponent(uid));
   const docs=await call(names,['typingDefenseBestNormal','typingDefenseBestHard','dailyCounts']);
   for(const item of docs){
    if(!item.found)continue;
    const uid=uniqueId(item.found.name),d=decodeFields(item.found.fields||{});
    if(!uid||excluded.has(uid))continue;
    const normal=Math.max(stageOf(d.typingDefenseBestNormal),legacyStage(d,'pet-typing-defense-normal'));
    const hard=Math.max(stageOf(d.typingDefenseBestHard),legacyStage(d,'pet-typing-defense-hard'));
    rows.push({uid,normal,hard});
   }
  }
  const normalTop=defenseTopThree(rows.map(row=>({uid:row.uid,floor:row.normal})));
  const hardTop=defenseTopThree(rows.map(row=>({uid:row.uid,floor:row.hard})));
  const combined=await hydrate([...normalTop,...hardTop]);
  return {schemaVersion:SCHEMA,updatedAt:now(),normal:combined.slice(0,normalTop.length),hard:combined.slice(normalTop.length)};
 }
 async function shared(){return rankingStore.getSection(section,{load:bootstrap,valid:value=>value?.schemaVersion===SCHEMA&&Array.isArray(value.normal)&&Array.isArray(value.hard)});}
 async function publish({uid,mode,stage}){
  if(!uid||!Object.hasOwn(MODES,mode)||!stageOf(stage))return;
  const task=async()=>{
   if((await excludedIds()).includes(uid))return;
   const snapshot=await shared(),current=snapshot[mode],score=stageOf(stage);
   const existing=current.find(row=>row.uid===uid);
   if(existing&&existing.floor>=score)return;
   const cutoff=current.length>=3?current[current.length-1].floor:0;
   if(!existing&&score<cutoff)return;
   const ranked=defenseTopThree([...current.filter(row=>row.uid!==uid),{uid,floor:score}]);
   const candidate=ranked.find(row=>row.uid===uid);
   if(!candidate)return;
   const [enriched]=await hydrate([candidate]);
   const next=ranked.map(row=>row.uid===uid?{...row,petName:enriched.petName,title:enriched.title}:row);
   await rankingStore.setSection(section,{...snapshot,[mode]:next,updatedAt:now()});
  };
  const next=publishChain.then(task,task);
  publishChain=next.catch(()=>{});
  return next;
 }
 async function handle(req,res){
  try{
   if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
   const mode=new URL(req.url,'http://localhost').searchParams.get('mode');
   if(!Object.hasOwn(MODES,mode))throw fail('防衛モードを指定してください。',400);
   const result=await shared();
   return send(res,200,{mode,updatedAt:result.updatedAt,leaders:publicRows(result[mode])});
  }catch(error){return send(res,error.status||503,{error:error.message||'防衛ランキングを表示できませんでした。'});}
 }
 return {handle,publish,shared};
}
