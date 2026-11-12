import {titleState} from './title-model.mjs';
import {titleIdsWithMasters} from './title-ownership.mjs';

const catalog=titleState().titles;
const normal=catalog.filter(t=>t.category!=='weekly'&&t.category!=='master');

export const masterTitleRules=catalog.filter(t=>t.category==='master')
 .map(t=>[t.id,normal.filter(source=>source.appId===t.appId).map(source=>source.id)]);

export const titleCollectionVersion=1;
const knownIds=new Set(catalog.map(title=>title.id));
export const hasTitleCollection=(wallet,authority,uid)=>Boolean(wallet&&Array.isArray(wallet.earnedTitleIds)&&authority.initialized(uid,wallet));
export const walletTitleIds=(wallet,authority,uid)=>titleIdsWithMasters((Array.isArray(wallet?.earnedTitleIds)?wallet.earnedTitleIds:[])
 .map(token=>authority.verifyAward(uid,token)).filter(id=>knownIds.has(id)),masterTitleRules);
export const titleIdsTransform=(ids,authority,uid)=>({
 fieldPath:'earnedTitleIds',
 appendMissingElements:{values:[...new Set(ids)].map(id=>({stringValue:authority.award(uid,id)}))}
});
export function awardTitleIds(prefix,uid,ids,authority){
 return {update:{name:prefix+'users/'+encodeURIComponent(uid)+'/apps/english-playroom',fields:{}},updateMask:{fieldPaths:[]},updateTransforms:[titleIdsTransform(ids,authority,uid)]};
}

export function collectionTitleState(wallet,authority,uid,{weeklyProgress={},weeklyPeriod=''}={}){
 const ids=walletTitleIds(wallet,authority,uid);
 const titles=catalog.map(t=>{
  const unlocked=ids.has(t.id);
  const done=unlocked?t.need:t.category==='master'?normal.filter(source=>source.appId===t.appId&&ids.has(source.id)).length:
   t.category==='weekly'&&Number.isFinite(weeklyProgress[t.appId])?Math.min(t.need,weeklyProgress[t.appId]):null;
  return {...t,done,unlocked};
 });
 const selected=titles.find(t=>t.unlocked&&t.id===wallet.selectedTitleId&&authority.verifySelection(uid,wallet));
 return {titles,selectedId:selected?.id||'',selectedTitle:selected?.name||'',unlockedTitleCount:ids.size,weeklyPeriod,weeklyProgress};
}
