export const RECORD_COURSES=['junior1','junior2','junior3','high1','high2','basic'];
const scoreOf=value=>Number.isSafeInteger(value)&&value>0?value:0;
const petNameOf=value=>{
 if(typeof value!=='string')return '名前未設定のペット';
 const name=value.normalize('NFKC').trim().replace(/\s+/g,' ');
 return name&&[...name].length<=12&&!/[\u0000-\u001f\u007f]/.test(name)?name:'名前未設定のペット';
};
export function summarizeRecords(players){
 return Object.fromEntries(RECORD_COURSES.map(course=>{
  let score=0,names=[];
  for(const player of players){
   const value=scoreOf(player.wordBreakerBests?.[course]?.score);
   if(value>score){score=value;names=[petNameOf(player.petName)];}
   else if(value&&value===score)names.push(petNameOf(player.petName));
  }
  names.sort((a,b)=>a.localeCompare(b,'ja'));
  return [course,{score,petNames:names.slice(0,3),leaderCount:names.length}];
 }));
}
export function createWordBreakerRecords({base,activeIds,accessToken,decodeFields,send,fail,fetch:request=globalThis.fetch,now=Date.now}){
 let cached=null,inflight=null,retryAfter=0;
 async function read(){
  const ids=[...new Set(await activeIds())],players=[],token=await accessToken();
  // Only the pet name and game bests leave Firestore; other profile fields are not read.
  for(let offset=0;offset<ids.length;offset+=200){
   const names=ids.slice(offset,offset+200).map(uid=>base.replace(/^https:\/\/firestore.googleapis.com\/v1\//,'')+'/documents/users/'+uid+'/apps/english-playroom');
   const response=await request(base+'/documents:batchGet',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
    body:JSON.stringify({documents:names,mask:{fieldPaths:['petName','wordBreakerBests']}})});
   const rows=await response.json();
   if(!response.ok||!Array.isArray(rows))throw fail('みんなの記録を取得できませんでした。',response.status===429?429:502);
   const expected=new Set(names);
   for(const row of rows)if(row.found&&expected.has(row.found.name))players.push(decodeFields(row.found.fields||{}));
  }
  return {courses:summarizeRecords(players),fetchedAt:now()};
 }
 async function snapshot(){
  if(cached&&now()-cached.fetchedAt<60000)return cached;
  if(inflight)return inflight;
  if(now()<retryAfter)throw fail('記録を取得できませんでした。少し待ってから再試行してください。',503);
  inflight=read().then(value=>{cached=value;return value;}).catch(error=>{retryAfter=now()+5000;throw error;}).finally(()=>{inflight=null;});
  return inflight;
 }
 async function handle(req,res){
  try{
   if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
   send(res,200,await snapshot());
  }catch(error){send(res,error.status||503,{error:'みんなの記録を取得できませんでした。時間を置いて再試行してください。'});}
 }
 return {handle,snapshot};
}
