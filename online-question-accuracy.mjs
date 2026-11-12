// Question difficulty is published as a static daily JSON file in english-playroom.
// Gameplay never reads Firestore or RTDB for difficulty; only the daily exporter does.
export const ACCURACY_GRADES=Object.freeze({'4級':'4','3級':'3','準2級':'pre2','2級':'2'});
export const ACCURACY_INDEX_URL='https://k-oota-pixel.github.io/eiken-retry/assets/question-index.json?v=20261103-1';
export const ACCURACY_SNAPSHOT_URL='https://k-oota-pixel.github.io/english-playroom/online-question-accuracy.json';

export function accuracyBonusPercent(rate){
 if(rate===null)return 35; // Genuine question with no collected answers.
 if(typeof rate!=='number'||!Number.isFinite(rate)||rate<0||rate>100)return 0;
 if(rate>=75)return 0;
 if(rate>=50)return 10;
 if(rate>=21)return 20;
 return 30;
}
export function accuracyBonusDamage(baseDamage,rate){
 const base=Math.max(1,Math.floor(Number(baseDamage)||1));
 const bonus=accuracyBonusPercent(rate);
 return {baseDamage:base,bonusPercent:bonus,damage:Math.ceil(base*(100+bonus)/100)};
}
const validatedCount=value=>Number.isSafeInteger(value)&&value>=0?value:0;
const validRate=rate=>rate===null||(typeof rate==='number'&&Number.isFinite(rate)&&rate>=0&&rate<=100);

export function buildOnlineAccuracySnapshot(index=[],retryItems=[],battleByGrade={},at=new Date()){
 const result={schemaVersion:1,updatedAt:new Date(at).toISOString(),sampleUnit:'first-answer-per-material',grades:{'4':{},'3':{},pre2:{},'2':{}}};
 const lookup=new Map();
 for(const question of index){
  const grade=ACCURACY_GRADES[String(question?.grade||'')],id=String(question?.id||'');
  if(!grade||!/^20\d{2}-[1-3]-(?:g4|g3|pre2|g2)-q\d{2}$/.test(id))continue;
  const matchingSegment={'4':'g4','3':'g3',pre2:'pre2','2':'g2'}[grade];
  if(!id.includes('-'+matchingSegment+'-')||Object.hasOwn(result.grades[grade],id))continue;
  result.grades[grade][id]=null;
  lookup.set(id,{grade,attempts:0,correct:0});
 }
 function add(item,grade){
  const id=String(item?.id||''),entry=lookup.get(id),attempts=Number(item?.attempts),correct=Number(item?.correct);
  if(!entry||entry.grade!==grade||!Number.isSafeInteger(attempts)||attempts<=0||!Number.isSafeInteger(correct)||correct<0)return;
  entry.attempts+=validatedCount(attempts);
  entry.correct+=Math.min(attempts,correct);
 }
 for(const item of retryItems)add(item,ACCURACY_GRADES[String(item?.grade||'')]);
 for(const [grade,rows] of Object.entries(battleByGrade))for(const item of Array.isArray(rows)?rows:[])add(item,grade);
 for(const [id,entry] of lookup){
  if(entry.attempts>0)result.grades[entry.grade][id]=Math.round(entry.correct/entry.attempts*1000)/10;
 }
 return result;
}
export function validOnlineAccuracySnapshot(raw){
 if(!raw||raw.schemaVersion!==1||!Number.isFinite(Date.parse(raw.updatedAt)))return false;
 if(!raw.grades||typeof raw.grades!=='object')return false;
 for(const key of ['4','3','pre2','2']){
  const rows=raw.grades[key];
  if(!rows||typeof rows!=='object'||Array.isArray(rows)||Object.keys(rows).length<4)return false;
  for(const rate of Object.values(rows))if(!validRate(rate))return false;
 }
 return true;
}

export function createOnlineAccuracyProvider({url=ACCURACY_SNAPSHOT_URL,request=fetch,now=Date.now,ttlMs=15*60*1000}={}){
 let latest=null,expiresAt=0,pending=null;
 async function get(){
  if(latest&&now()<expiresAt)return latest;
  if(pending)return pending;
  pending=(async()=>{
   const response=await request(url,{cache:'no-store',signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw new Error('正答率データの配信がまだ完了していません。');
   const snapshot=await response.json();
   if(!validOnlineAccuracySnapshot(snapshot))throw new Error('正答率データの形式が不正です。');
   latest=snapshot;
   expiresAt=now()+ttlMs;
   return latest;
  })().catch(error=>{
   // Keep yesterday's verified snapshot if today's CDN update is delayed.
   if(latest){expiresAt=now()+60*1000;return latest;}
   throw error;
  }).finally(()=>{pending=null;});
  return pending;
 }
 return {get};
}
