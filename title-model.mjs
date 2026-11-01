import {CHALLENGE_CONTENTS} from './challenge-model.mjs';
import retryCatalog from './retry-title-catalog.json' with {type:'json'};
import baseCreativeCatalog from './creative-title-catalog.json' with {type:'json'};
import caseTalkCatalog from './case-talk-title-catalog.json' with {type:'json'};
import petFishingCatalog from './pet-fishing-title-catalog.json' with {type:'json'};
const wordTowerBaseTitles=(baseCreativeCatalog['word-tower']||[]).map(t=>t.id==='creative:word-tower:14'?{...t,name:'無傷の魔将斬り'}:t.id==='creative:word-tower:15'?{...t,name:'高みを征く者'}:t);
const wordTowerEndgameTitles=[
 {id:'creative:word-tower:16',name:'災厄を討ちし者',condition:'大ボスを初めて撃破する',metric:'bestFloor',need:51,displayNeed:1},
 {id:'creative:word-tower:17',name:'深淵の門を越えし者',condition:'100階に到達し、魔王の前に立つ',metric:'bestFloor',need:100,displayNeed:1},
 {id:'creative:word-tower:18',name:'終焉を喰らう者',condition:'100階の魔王を撃破する',metric:'bestFloor',need:101,displayNeed:1}
];
export const creativeCatalog={...baseCreativeCatalog,'word-tower':[...wordTowerBaseTitles,...wordTowerEndgameTitles],'case-talk':caseTalkCatalog,'pet-fishing':petFishingCatalog};
const HIDDEN_TITLE_PREFIXES=['creative:pet-instructions:'];
export function creativeTitles(appId,progress={}){return (creativeCatalog[appId]||[]).map(t=>{const raw=count(progress.metrics?.[t.metric]),unlocked=raw>=t.need,displayNeed=count(t.displayNeed)||t.need;return {...t,appId,label:TITLE_CONTENTS.find(x=>x.id===appId)?.label||appId,need:displayNeed,done:t.displayNeed?(unlocked?displayNeed:0):raw,unlocked};});}
export function validTitleName(id){if(HIDDEN_TITLE_PREFIXES.some(prefix=>id?.startsWith(prefix)))return '';const t=Object.values(creativeCatalog).flat().find(t=>t.id===id);if(t)return t.name;if(id?.startsWith('retry:'))return retryCatalog.titles.find(t=>'retry:'+t.id===id)?.name||'';return activityTitles('eiken-retry',0).find(t=>t.id===id)?.name||'';}
export const TITLE_CONTENTS=[{id:'basic-grammar',label:'並べ替え問題（基本文法）'},{id:'grammar',label:'並べ替え問題（文法別）'},{id:'today',label:'TODAY'},...CHALLENGE_CONTENTS.map(({id,label})=>({id,label})),{id:'case-talk',label:'サポート付きケーストーク'},{id:'pet-catch',label:'PET CATCH'},{id:'pet-chat',label:'ペットと英会話'},{id:'pet-fishing',label:'PET FISHING'},{id:'word-tower',label:'魔王の塔'},{id:'eiken-dungeon',label:'魔物の巣窟'}];
const count=value=>Math.max(0,Math.floor(Number(value)||0));
export function activityTitles(appId,total){
 if(appId!=='eiken-retry')return [];
 const content=TITLE_CONTENTS.find(x=>x.id===appId);if(!content)return [];
 const tiers=[[1,'はじめの一歩'],[10,'チャレンジャー'],[50,'エキスパート'],[100,'マスター']];
 if(appId!=='eiken-retry')tiers.push([3,'ルーキー'],[5,'探究者'],[25,'熟練者'],[200,'達人'],[300,'レジェンド'],[500,'殿堂入り']);
 return tiers.sort((a,b)=>a[0]-b[0]).map(([need,suffix])=>({id:appId+':'+need,appId,label:content.label,name:content.label+'・'+suffix,need,done:count(total),unlocked:count(total)>=need,condition:`取り組みを${need}回記録する`}));
}
export function titleState({activity={},retry={},selection={},progress={},wallet={}}={}){
 progress={...progress};
 for(const [app,field] of [['word-tower','wordTowerBest'],['eiken-dungeon','eikenDungeonBest']]){const prior=progress[app]||{};progress[app]={...prior,metrics:{...prior.metrics,bestFloor:Math.max(count(prior.metrics?.bestFloor),count(wallet[field]))}};}
 const titles=TITLE_CONTENTS.flatMap(x=>[...activityTitles(x.id,activity.contents?.[x.id]?.titleCount),...creativeTitles(x.id,progress[x.id])]);
 const done={};for(const [id,r] of Object.entries(retry.state?.records||{})){const grade=retryCatalog.questions[id];if(grade&&count(r?.attempts)>0)done[grade]=(done[grade]||0)+1;}
 for(const t of retryCatalog.titles){const need=t.all?retryCatalog.totals[t.grade]:t.at;titles.push({id:'retry:'+t.id,appId:'eiken-retry',label:'リトライノート',name:t.name,need,done:done[t.grade]||0,unlocked:need>0&&(done[t.grade]||0)>=need,condition:`${t.grade}の異なる問題に${need}問回答する`});}
 const old=retry.profile?.equippedTitle,selectedId=typeof selection.selectedId==='string'?selection.selectedId:(old?'retry:'+old:'');
 const selected=titles.find(t=>t.id===selectedId&&t.unlocked)||null;
 return {titles,selectedId:selected?.id||'',selectedTitle:selected?.name||''};
}
