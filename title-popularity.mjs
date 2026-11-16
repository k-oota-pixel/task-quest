import {titleState} from './title-model.mjs';
import {hasTitleCollection,walletTitleIds} from './title-collection.mjs';
import {fixtureTitleAuthority} from './title-authority.mjs';

// Daily, read-only export. No per-title writes and no Firestore reads on page views.
const TITLE_IDS=[...new Set(titleState().titles.map(title=>title.id))];
const validUid=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\/\u0000-\u001f]/.test(value);
const jstDate=timestamp=>new Date(timestamp).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
const uidFromPath=name=>{
 const match=String(name||'').match(/\/documents\/users\/([^/]+)\/apps\/english-playroom$/);
 if(!match)return '';
 try{return decodeURIComponent(match[1]);}catch{return '';}
};

export function createTitlePopularity({
 base,projectId,accessToken,registeredIds,decodeFields,
 getAuthority=fixtureTitleAuthority,fetch:request=globalThis.fetch,now=Date.now
}){
 const prefix=`projects/${projectId}/databases/(default)/documents/`;
 async function exportSnapshot(){
  const all=await registeredIds();
  if(!Array.isArray(all)||all.some(id=>!validUid(id)))throw Error('登録者一覧が不正です。');
  const ids=[...new Set(all)];
  if(!ids.length)throw Error('登録者が0人のため、称号集計は保留しました。');
  const [token,authority]=await Promise.all([accessToken(),getAuthority()]);
  const counts=Object.fromEntries(TITLE_IDS.map(id=>[id,0]));
  let pendingInitializations=0;
  for(let offset=0;offset<ids.length;offset+=100){
   const part=ids.slice(offset,offset+100);
   const names=part.map(uid=>prefix+'users/'+encodeURIComponent(uid)+'/apps/english-playroom');
   const response=await request(base+'/documents:batchGet',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({documents:names,mask:{fieldPaths:['earnedTitleIds','titleCollectionVersion','titleCollectionProof']}}),
    signal:AbortSignal.timeout(30000)
   });
   if(!response.ok)throw Error('称号獲得人数の集計に失敗しました。 ('+response.status+')');
   const rows=await response.json();
   if(!Array.isArray(rows))throw Error('称号集計の応答形式が不正です。');
   const results=new Map();
   for(const row of rows){
    const name=row.found?.name||row.missing;
    if(!names.includes(name)||results.has(name))throw Error('称号集計の応答に不整合があります。');
    results.set(name,row.found||null);
   }
   if(results.size!==names.length)throw Error('称号集計の一部が取得できませんでした。');
   for(let i=0;i<names.length;i++){
    const doc=results.get(names[i]);
    const wallet=doc?decodeFields(doc.fields||{}):{};
    if(!hasTitleCollection(wallet,authority,part[i]))pendingInitializations++;
    for(const titleId of walletTitleIds(wallet,authority,part[i])){
     if(Object.hasOwn(counts,titleId))counts[titleId]++;
    }
   }
  }
  return {
   schemaVersion:1,asOfDate:jstDate(now()),updatedAt:new Date(now()).toISOString(),
   totalRegistered:ids.length,pendingInitializations,titles:counts
  };
 }
 return {exportSnapshot};
}
