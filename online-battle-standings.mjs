// Online battle standings are updated once per completed match, never during polling.
// Daily published ranks subtract today's progress, so a 06:10 JST job shows yesterday's cutoff.
export const ONLINE_BATTLE_GRADES=Object.freeze(['4','3','pre2','2']);
export function japanBattleDay(timestamp=Date.now()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(timestamp));
 const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
 return values.year+'-'+values.month+'-'+values.day;
}
export function previousJapanBattleDay(timestamp=Date.now()){
 return japanBattleDay(timestamp-24*60*60*1000);
}
const nonnegative=value=>Number.isSafeInteger(Number(value))?Math.max(0,Number(value)):0;
export function nextOnlineBattleStanding(previous={},player={},won=false,at=Date.now()){
 const day=japanBattleDay(at),latestDay=previous.lastGameDay>day?previous.lastGameDay:day;
 const continuing=previous.lastGameDay===latestDay,countsToday=day===latestDay;
 const games=nonnegative(previous.games)+1,wins=nonnegative(previous.wins)+(won?1:0);
 return {
  uid:String(player.uid||previous.uid||''),
  nickname:String(player.nickname||previous.nickname||'なまえ未設定').slice(0,24),
  petName:String(player.petName||previous.petName||'ペット').slice(0,24),
  games,wins,losses:games-wins,lastGameDay:latestDay,
  todayGames:(continuing?nonnegative(previous.todayGames):0)+(countsToday?1:0),
  todayWins:(continuing?nonnegative(previous.todayWins):0)+(countsToday&&won?1:0),
  updatedAt:Math.floor(at)
 };
}
export function asOfYesterdayStanding(record,todayDay){
 const todays=record.lastGameDay===todayDay;
 const games=Math.max(0,nonnegative(record.games)-(todays?nonnegative(record.todayGames):0));
 const wins=Math.max(0,nonnegative(record.wins)-(todays?nonnegative(record.todayWins):0));
 return {uid:String(record.uid||''),nickname:String(record.nickname||'なまえ未設定').slice(0,24),petName:String(record.petName||'ペット').slice(0,24),games,wins,losses:games-wins};
}
export function projectOnlineBattleLeaderboard(records,todayDay,limit=10){
 return (Array.isArray(records)?records:[]).map(record=>asOfYesterdayStanding(record,todayDay))
  .filter(item=>item.uid&&item.wins>0)
  .sort((a,b)=>b.wins-a.wins||(b.wins*a.games-a.wins*b.games)||b.games-a.games||a.uid.localeCompare(b.uid))
  .slice(0,limit).map((entry,index)=>({...entry,rank:index+1,winRate:Math.round(1000*entry.wins/entry.games)/10}));
}
// Because Firestore's wins index includes matches from today, keep paging until
// an unread user's maximum possible wins cannot beat (or tie) rank ten.
export function onlineBattleRankingScanComplete(records,todayDay,limit=10){
 const all=Array.isArray(records)?records:[];
 if(all.length<limit||all.length===0)return true;
 const projected=projectOnlineBattleLeaderboard(all,todayDay,limit);
 const lastRawWins=nonnegative(all[all.length-1].wins);
 if(lastRawWins===0)return true;
 return projected.length===limit&&projected[limit-1].wins>lastRawWins;
}
