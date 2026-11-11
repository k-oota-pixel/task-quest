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
export const DEFENSE_TITLE_APP='pet-typing-defense';
export const ONLINE_TITLE_APP='online-battle';
const onlineBattleTitleCatalog=[
 {id:'creative:online-battle:01',name:"はじめての決闘",condition:"オンライン対戦を初めて1戦する",metric:'games',need:1},
 {id:'creative:online-battle:02',name:"勝利の第一歩",condition:"オンライン対戦で初めて勝利する",metric:'wins',need:1},
 {id:'creative:online-battle:03',name:"戦場の常連",condition:"オンライン対戦を累計10戦する",metric:'games',need:10},
 {id:'creative:online-battle:04',name:"百戦への道",condition:"オンライン対戦を累計50戦する",metric:'games',need:50},
 {id:'creative:online-battle:05',name:"駆け出し剣士",condition:"オンライン対戦で累計5勝する",metric:'wins',need:5},
 {id:'creative:online-battle:06',name:"歴戦の勇者",condition:"オンライン対戦で累計20勝する",metric:'wins',need:20},
 {id:'creative:online-battle:07',name:"百戦錬磨",condition:"オンライン対戦で累計100勝する",metric:'wins',need:100},
 {id:'creative:online-battle:08',name:"連勝街道",condition:"級を問わずオンライン対戦で3連勝する",metric:'maxStreak',need:3},
 {id:'creative:online-battle:09',name:"無敗の進撃",condition:"級を問わずオンライン対戦で5連勝する",metric:'maxStreak',need:5},
 {id:'creative:online-battle:10',name:"4級の覇者",condition:"4級のオンライン対戦で5勝する",metric:'wins4',need:5},
 {id:'creative:online-battle:11',name:"3級の覇者",condition:"3級のオンライン対戦で5勝する",metric:'wins3',need:5},
 {id:'creative:online-battle:12',name:"準2級の覇者",condition:"準2級のオンライン対戦で5勝する",metric:'winsPre2',need:5},
 {id:'creative:online-battle:13',name:"2級の覇者",condition:"2級のオンライン対戦で5勝する",metric:'wins2',need:5},
 {id:'creative:online-battle:14',name:"四つの戦場を知る者",condition:"4級・3級・準2級・2級で各1戦以上する",metric:'gradesPlayed',need:4},
 {id:'creative:online-battle:15',name:"四冠王",condition:"4級・3級・準2級・2級でそれぞれ5勝以上する",metric:'gradesWins5',need:4}
];

const defenseTitleCatalog=[
 {id:'creative:pet-typing-defense:01',name:"新米防衛兵",condition:"もんすた城の防衛を初めてプレイする",metric:'plays',need:1},
 {id:'creative:pet-typing-defense:02',name:"森の守り人",condition:"単語の森をクリアする",metric:'bestStage',need:1},
 {id:'creative:pet-typing-defense:03',name:"畑の救世主",condition:"ポテトマンの畑をクリアする",metric:'bestStage',need:2},
 {id:'creative:pet-typing-defense:04',name:"文法の守護者",condition:"文法の砦をクリアする",metric:'bestStage',need:3},
 {id:'creative:pet-typing-defense:05',name:"言葉の騎士",condition:"タスク別英会話をクリアする",metric:'bestStage',need:4},
 {id:'creative:pet-typing-defense:06',name:"文法の賢者",condition:"文法別の試練をクリアする",metric:'bestStage',need:5},
 {id:'creative:pet-typing-defense:07',name:"城の守護兵",condition:"イージーを完全クリアする",metric:'easyClears',need:1},
 {id:'creative:pet-typing-defense:08',name:"鉄壁の防衛隊長",condition:"ノーマルを完全クリアする",metric:'normalClears',need:1},
 {id:'creative:pet-typing-defense:09',name:"伝説の城主",condition:"ハードを完全クリアする",metric:'hardClears',need:1},
 {id:'creative:pet-typing-defense:10',name:"正確無比",condition:"1ステージを全問正解で突破する",metric:'perfectStages',need:1},
 {id:'creative:pet-typing-defense:11',name:"無傷の守護者",condition:"城の耐久力を失わず全5ステージクリアする",metric:'flawlessClears',need:1},
 {id:'creative:pet-typing-defense:12',name:"防衛の達人",condition:"いずれかの難易度で累計10回完全クリアする",metric:'totalClears',need:10},
 {id:'creative:pet-typing-defense:13',name:"不落の城",condition:"いずれかの難易度で累計30回完全クリアする",metric:'totalClears',need:30},
 {id:'creative:pet-typing-defense:14',name:"三界の守護神",condition:"3難易度すべて完全クリアする",metric:'modesCleared',need:3},
 {id:'creative:pet-typing-defense:15',name:"究極の防衛王",condition:"ハードを城の耐久力を失わず完全クリアする",metric:'hardFlawlessClears',need:1}
];
export const creativeCatalog={...baseCreativeCatalog,'word-tower':[...wordTowerBaseTitles,...wordTowerEndgameTitles],'case-talk':caseTalkCatalog,'pet-fishing':petFishingCatalog,[DEFENSE_TITLE_APP]:defenseTitleCatalog,[ONLINE_TITLE_APP]:onlineBattleTitleCatalog};
const HIDDEN_TITLE_PREFIXES=['creative:pet-instructions:'];
export const WEEKLY_DAYS_TARGET=4;
// These gameplay modes participate in daily rankings and weekly titles without adding
// two unnecessary per-user creative-title progress documents to every titles read.
export const RANKING_ONLY_CONTENTS=Object.freeze([
 {id:'pet-typing-defense-easy',label:'もんすたディフェンス（イージー）'},
 {id:'pet-typing-defense-normal',label:'もんすたディフェンス（ノーマル）'},
 {id:'pet-typing-defense-hard',label:'もんすたディフェンス（ハード）'}
]);
const WEEKLY_SPECIAL_NAMES=Object.freeze({coins:'黄金の四冠王',ateru:'語彙を統べし者','basic-grammar':'語順の支配者','grammar':'文法の覇者','task-quest':'言霊の覇者','eiken-retry':'不屈の修練者'});
export function weeklyTitleName(appId){
 if(appId==='coins')return WEEKLY_SPECIAL_NAMES.coins;
 const content=[...TITLE_CONTENTS,...RANKING_ONLY_CONTENTS].find(item=>item.id===appId);
 return content?(WEEKLY_SPECIAL_NAMES[appId]||content.label+'・週間覇者'):'';
}
export function weeklyTitles({earnedIds=[],progress={}}={}){
 const earned=new Set(Array.isArray(earnedIds)?earnedIds:[]);
 return [{id:'weekly:coins',appId:'coins',label:'獲得コイン',name:weeklyTitleName('coins'),condition:'1週間で4日以上、獲得コインTOP3に入る'},
  ...[...TITLE_CONTENTS.filter(app=>![DEFENSE_TITLE_APP,ONLINE_TITLE_APP].includes(app.id)),...RANKING_ONLY_CONTENTS].map(app=>({id:'weekly:'+app.id,appId:app.id,label:app.label,name:weeklyTitleName(app.id),condition:'1週間で4日以上、この教材の取り組み数1位になる'}))]
   .map(item=>{const done=Math.max(0,Math.min(7,Math.floor(Number(progress[item.appId])||0)));return {...item,need:WEEKLY_DAYS_TARGET,done:earned.has(item.id)?WEEKLY_DAYS_TARGET:done,unlocked:earned.has(item.id),category:'weekly'};});
}
const MASTER_NAMES=Object.freeze({
 'ateru':'真理を見抜く者',
 'basic-grammar':'語順を統べし者',
 'grammar':'文法を極めし者',
 'basic-quest':'基礎を極めし者',
 'task-quest':'言霊の支配者',
 'eiken-retry':'敗北を糧にする者',
 'today':'世界を読み解く者',
 'word-tower':'終焉を越えし者',
 'eiken-dungeon':'深淵を制する者',
 'pet-fishing':'深海の探究者',
 'pet-catch':'百発百中の捕獲者',
 'online-battle':'闘技場の覇王'
});
export function masterTitleName(appId){
 const content=TITLE_CONTENTS.find(item=>item.id===appId);
 return content?(MASTER_NAMES[appId]||content.label+'・マスター'):'';
}
export function masterTitles(titles=[]){
 const result=[];
 for(const app of TITLE_CONTENTS){
  const sources=titles.filter(t=>t.appId===app.id&&!String(t.id).startsWith('master:')&&!String(t.id).startsWith('weekly:'));
  if(!sources.length)continue;
  const done=sources.filter(t=>t.unlocked).length,need=sources.length;
  result.push({id:'master:'+app.id,appId:app.id,label:app.label,name:masterTitleName(app.id),need,done,unlocked:done===need,condition:app.label+'の対象称号をすべて獲得する',category:'master'});
 }
 return result;
}
export function creativeTitles(appId,progress={}){return (creativeCatalog[appId]||[]).map(t=>{const raw=count(progress.metrics?.[t.metric]),unlocked=raw>=t.need,displayNeed=count(t.displayNeed)||t.need;return {...t,appId,label:TITLE_CONTENTS.find(x=>x.id===appId)?.label||appId,need:displayNeed,done:t.displayNeed?(unlocked?displayNeed:0):raw,unlocked};});}
export function validTitleName(id){if(HIDDEN_TITLE_PREFIXES.some(prefix=>id?.startsWith(prefix)))return '';if(id?.startsWith('master:'))return masterTitleName(id.slice(7));if(id?.startsWith('weekly:'))return weeklyTitleName(id.slice(7));const t=Object.values(creativeCatalog).flat().find(t=>t.id===id);if(t)return t.name;if(id?.startsWith('retry:'))return retryCatalog.titles.find(t=>'retry:'+t.id===id)?.name||'';return activityTitles('eiken-retry',0).find(t=>t.id===id)?.name||'';}
export const TITLE_CONTENTS=[{id:'basic-grammar',label:'並べ替え問題（基本文法）'},{id:'grammar',label:'並べ替え問題（文法別）'},{id:'today',label:'TODAY'},...CHALLENGE_CONTENTS.map(({id,label})=>({id,label})),{id:'case-talk',label:'サポート付きケーストーク'},{id:'pet-catch',label:'PET CATCH'},{id:'pet-chat',label:'ペットと英会話'},{id:'pet-fishing',label:'PET FISHING'},{id:'word-tower',label:'魔王の塔'},{id:'eiken-dungeon',label:'魔物の巣窟'},{id:DEFENSE_TITLE_APP,label:'もんすた城の防衛'},{id:ONLINE_TITLE_APP,label:'オンライン対戦'}];
const count=value=>Math.max(0,Math.floor(Number(value)||0));
export function activityTitles(appId,total){
 if(appId!=='eiken-retry')return [];
 const content=TITLE_CONTENTS.find(x=>x.id===appId);if(!content)return [];
 const tiers=[[1,'はじめの一歩'],[10,'チャレンジャー'],[50,'エキスパート'],[100,'マスター']];
 if(appId!=='eiken-retry')tiers.push([3,'ルーキー'],[5,'探究者'],[25,'熟練者'],[200,'達人'],[300,'レジェンド'],[500,'殿堂入り']);
 return tiers.sort((a,b)=>a[0]-b[0]).map(([need,suffix])=>({id:appId+':'+need,appId,label:content.label,name:content.label+'・'+suffix,need,done:count(total),unlocked:count(total)>=need,condition:`取り組みを${need}回記録する`}));
}


const ONLINE_GRADES=Object.freeze(['4','3','pre2','2']);
const onlineInt=value=>Math.max(0,Number.isSafeInteger(Number(value))?Number(value):0);
/** The wallet already participates in coin settlement; avoid title_progress reads. */
export function onlineBattleTitleProgress(wallet={}){
 const stats=wallet.onlineBattleTitleStats||{},byGrade=stats.byGrade||{};
 const grades=ONLINE_GRADES.map(key=>({games:onlineInt(byGrade[key]?.games),wins:onlineInt(byGrade[key]?.wins)}));
 return {metrics:{
  games:onlineInt(stats.games),wins:onlineInt(stats.wins),maxStreak:onlineInt(stats.maxStreak),
  wins4:grades[0].wins,wins3:grades[1].wins,winsPre2:grades[2].wins,wins2:grades[3].wins,
  gradesPlayed:grades.filter(g=>g.games>=1).length,
  gradesWins5:grades.filter(g=>g.wins>=5).length
 }};
}
/** Called ONLY after a completed PVP match; result is persisted with the coin receipt. */
export function nextOnlineBattleTitleStats(previous={},gradeKey,won){
 if(!ONLINE_GRADES.includes(gradeKey))throw new Error('対戦級が不正です。');
 const old=previous&&typeof previous==='object'?previous:{},byGrade=old.byGrade||{};
 const nextStreak=won?onlineInt(old.streak)+1:0;
 const grade=byGrade[gradeKey]||{};
 return {
  games:onlineInt(old.games)+1,wins:onlineInt(old.wins)+Number(Boolean(won)),
  streak:nextStreak,maxStreak:Math.max(onlineInt(old.maxStreak),nextStreak),
  byGrade:Object.fromEntries(ONLINE_GRADES.map(key=>[key,{
   games:onlineInt(byGrade[key]?.games)+Number(key===gradeKey),
   wins:onlineInt(byGrade[key]?.wins)+Number(key===gradeKey&&won)
  }]))
 };
}

/** Wallet-derived defense titles: zero additional title_progress reads. */
export function defenseTitleProgress(activity={},wallet={}){
 const raw=wallet.typingDefenseTitleStats||{},c=v=>Math.max(0,Math.floor(Number(v)||0));
 const bestByMode={easy:c(activity.typingDefenseBestEasy),normal:c(activity.typingDefenseBestNormal),hard:c(activity.typingDefenseBestHard)};
 const easyClears=Math.max(c(raw.easyClears),Number(bestByMode.easy>=5));
 const normalClears=Math.max(c(raw.normalClears),Number(bestByMode.normal>=5));
 const hardClears=Math.max(c(raw.hardClears),Number(bestByMode.hard>=5));
 return {metrics:{
  plays:c(raw.plays),bestStage:Math.max(c(raw.bestStage),...Object.values(bestByMode)),
  easyClears,normalClears,hardClears,perfectStages:c(raw.perfectStages),
  flawlessClears:c(raw.flawlessClears),hardFlawlessClears:c(raw.hardFlawlessClears),
  totalClears:c(raw.totalClears),modesCleared:Number(easyClears>0)+Number(normalClears>0)+Number(hardClears>0)
 }};
}

export function titleState({activity={},retry={},selection={},progress={},wallet={},weeklyEarnedIds=[],weeklyProgress={}}={}){
 progress={...progress,[DEFENSE_TITLE_APP]:defenseTitleProgress(activity,wallet),[ONLINE_TITLE_APP]:onlineBattleTitleProgress(wallet)};
 for(const [app,field] of [['word-tower','wordTowerBest'],['eiken-dungeon','eikenDungeonBest']]){const prior=progress[app]||{};progress[app]={...prior,metrics:{...prior.metrics,bestFloor:Math.max(count(prior.metrics?.bestFloor),count(wallet[field]))}};}
 const titles=TITLE_CONTENTS.flatMap(x=>[...activityTitles(x.id,activity.contents?.[x.id]?.titleCount),...creativeTitles(x.id,progress[x.id])]);
 const done={};for(const [id,r] of Object.entries(retry.state?.records||{})){const grade=retryCatalog.questions[id];if(grade&&count(r?.attempts)>0)done[grade]=(done[grade]||0)+1;}
 for(const t of retryCatalog.titles){const need=t.all?retryCatalog.totals[t.grade]:t.at;titles.push({id:'retry:'+t.id,appId:'eiken-retry',label:'リトライノート',name:t.name,need,done:done[t.grade]||0,unlocked:need>0&&(done[t.grade]||0)>=need,condition:`${t.grade}の異なる問題に${need}問回答する`});}
 titles.push(...masterTitles(titles));
 titles.push(...weeklyTitles({earnedIds:weeklyEarnedIds,progress:weeklyProgress}));
 const old=retry.profile?.equippedTitle,selectedId=typeof selection.selectedId==='string'?selection.selectedId:(old?'retry:'+old:'');
 const selected=titles.find(t=>t.id===selectedId&&t.unlocked)||null;
 return {titles,selectedId:selected?.id||'',selectedTitle:selected?.name||''};
}
