import {createHash} from 'node:crypto';
export const CHALLENGE_CONTENTS=Object.freeze([
 ['word-breaker','ワードブレイカー','https://k-oota-pixel.github.io/word-breaker/','1プレイ取り組んで記録する','light'],
 ['ateru','アテル','https://k-oota-pixel.github.io/ateru/','5問の結果を確認する','light'],
 ['basic-quest','並べ替え問題（基礎）','https://k-oota-pixel.github.io/basic-quest/','1ステージの結果を確認する','light'],
 ['eiken-retry','リトライノート','https://k-oota-pixel.github.io/eiken-retry/','1問以上回答する','light'],
 ['eiken-cloze','長文空所補充','https://k-oota-pixel.github.io/eiken-cloze/','回答して判定を受ける','practice'],
 ['eiken-title','長文概要把握','https://k-oota-pixel.github.io/eiken-title/','タイトルを回答して判定を受ける','practice'],
 ['reading-training','長文演習','https://k-oota-pixel.github.io/english-playroom/reading-training/','答え合わせ、または要約の確認をする','practice'],
 ['listening-training','リスニング演習＆ディクテーション','https://k-oota-pixel.github.io/english-playroom/listening-training/','1問以上取り組んで結果を確認する','practice'],
 ['task-quest','タスク別英会話','https://k-oota-pixel.github.io/task-quest/','英文を回答して採点を受ける','practice'],
 ['pre2-interview-questions','準2級面接・質問4・5対策','https://k-oota-pixel.github.io/english-playroom/pre2-interview-questions/','回答してフィードバックを受ける','practice'],
 ['eiken-pre2-interview-a','準2級面接A練習','https://k-oota-pixel.github.io/eiken-pre2-interview-a/','説明を回答して答え合わせをする','practice'],
 ['talk-quest','テーマ別日常英会話','https://k-oota-pixel.github.io/talk-quest/','英語を送って返事を受け取る','practice']
].map(([id,label,url,hint,group])=>Object.freeze({id,label,url,hint,group})));
const ids=new Set(CHALLENGE_CONTENTS.map(x=>x.id));
export const isChallengeContent=id=>ids.has(id);
export function challengePeriods(now=Date.now()){
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 const date=new Date(day+'T00:00:00Z'),offset=(date.getUTCDay()+6)%7;
 const week=new Date(date.getTime()-offset*86400000).toISOString().slice(0,10);
 return {day,week,weekEnd:new Date(new Date(week+'T00:00:00Z').getTime()+6*86400000).toISOString().slice(0,10),nextDaily:new Date(new Date(day+'T00:00:00+09:00').getTime()+86400000).toISOString(),nextWeekly:new Date(new Date(week+'T00:00:00+09:00').getTime()+7*86400000).toISOString()};
}
export function dailyChallengeTasks(uid,day){
 const index=Math.floor(new Date(day+'T00:00:00Z').getTime()/86400000);
 const hash=id=>createHash('sha256').update('challenges-v1|'+uid+'|'+id).digest('hex');
 return ['light','practice'].map(group=>{const pool=CHALLENGE_CONTENTS.filter(x=>x.group===group).sort((a,b)=>hash(a.id).localeCompare(hash(b.id)));return pool[((index%pool.length)+pool.length)%pool.length];});
}
export function challengeProgressWrites({uid,appId,projectId,now=Date.now()}){
 if(!isChallengeContent(appId))return [];
 const {day,week}=challengePeriods(now),prefix=`projects/${projectId}/databases/(default)/documents/challenge_progress/${uid}/periods/`;
 return ['daily-'+day,'weekly-'+week].map(period=>({update:{name:prefix+period,fields:{uid:{stringValue:uid}}},updateMask:{fieldPaths:['uid']},updateTransforms:[{fieldPath:'completed.`'+appId+'`',setToServerValue:'REQUEST_TIME'}]}));
}
export function challengeState(uid,periods,records={},now=Date.now()){
 const completed=kind=>{const found=new Set(Object.keys(records[kind]?.completed||{}).filter(isChallengeContent));const start=new Date((kind==='daily'?periods.day:periods.week)+'T00:00:00+09:00').getTime();for(const [id,value] of Object.entries(records.activity?.contents||{})){const time=new Date(value?.lastLearningAt).getTime();if(isChallengeContent(id)&&time>=start&&time<=now)found.add(id);}return found;};
 const dailyDone=completed('daily'),weekDone=completed('weekly'),tasks=dailyChallengeTasks(uid,periods.day).map(x=>({...x,done:dailyDone.has(x.id)}));
 return {serverNow:now,...periods,daily:{id:periods.day,reward:10,target:2,count:tasks.filter(x=>x.done).length,complete:tasks.every(x=>x.done),claimed:!!records.dailyClaim,tasks},weekly:{id:periods.week,reward:20,target:4,count:weekDone.size,complete:weekDone.size>=4,claimed:!!records.weeklyClaim,contents:CHALLENGE_CONTENTS.map(x=>({...x,done:weekDone.has(x.id)}))}};
}
