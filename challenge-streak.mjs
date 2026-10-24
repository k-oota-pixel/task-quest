import {dailyChallengeTasks} from './challenge-model.mjs';
export const previousDay=(day,offset=1)=>new Date(Date.parse(day+'T00:00:00Z')-offset*86400000).toISOString().slice(0,10);
export function dailyStreak(uid,day,currentComplete,currentClaim,history=[]){
 let count=0;
 for(const entry of history){
  const done=!!entry.claim||dailyChallengeTasks(uid,entry.day).every(t=>entry.progress?.completed?.[t.id]);
  count=done?count+1:0;
  if(entry.claim?.streakBonus>0)count=0;
 }
 count=currentComplete?Math.min(3,count+1):count;
 return {count,target:3,bonus:10,eligible:currentComplete&&count>=3,received:!!currentClaim?.streakBonus};
}
