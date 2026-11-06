import test from 'node:test';
import assert from 'node:assert/strict';
import {japanBattleDay,previousJapanBattleDay,nextOnlineBattleStanding,asOfYesterdayStanding,projectOnlineBattleLeaderboard,onlineBattleRankingScanComplete} from './online-battle-standings.mjs';
const time=iso=>new Date(iso).getTime();
const a={uid:'u-a',nickname:'A',petName:'Pet A'},b={uid:'u-b',nickname:'B',petName:'Pet B'};
test('battle rankings use Japan dates around midnight',()=>{
 assert.equal(japanBattleDay(time('2026-11-05T14:59:59Z')),'2026-11-05');
 assert.equal(japanBattleDay(time('2026-11-05T15:00:00Z')),'2026-11-06');
 assert.equal(previousJapanBattleDay(time('2026-11-06T00:10:00Z')),'2026-11-05');
});
test('one finished game records exactly one win and one loss',()=>{
 const at=time('2026-11-05T11:00:00Z'),win=nextOnlineBattleStanding({},a,true,at),loss=nextOnlineBattleStanding({},b,false,at);
 assert.deepEqual([win.games,win.wins,win.losses,win.todayGames,win.todayWins],[1,1,0,1,1]);
 assert.deepEqual([loss.games,loss.wins,loss.losses,loss.todayGames,loss.todayWins],[1,0,1,1,0]);
});
test('daily progress resets on a new JST date while lifetime results stay intact',()=>{
 const old=nextOnlineBattleStanding({},a,true,time('2026-11-05T14:59:00Z'));
 const current=nextOnlineBattleStanding(old,a,false,time('2026-11-05T15:01:00Z'));
 assert.deepEqual([current.games,current.wins,current.todayGames,current.todayWins],[2,1,1,0]);
 assert.deepEqual(asOfYesterdayStanding(current,'2026-11-06').games,1);
 assert.deepEqual(asOfYesterdayStanding(current,'2026-11-06').wins,1);
});
test('matches after midnight never enter the previous-day ranking',()=>{
 const day='2026-11-06';
 const first=nextOnlineBattleStanding({games:12,wins:10,lastGameDay:'2026-11-05'},a,true,time('2026-11-05T16:00:00Z'));
 const second=nextOnlineBattleStanding({games:12,wins:9,lastGameDay:'2026-11-05'},b,false,time('2026-11-05T16:00:00Z'));
 const leaders=projectOnlineBattleLeaderboard([first,second],day);
 assert.equal(leaders[0].uid,'u-a');
 assert.equal(leaders[0].wins,10);
 assert.equal(leaders[0].games,12);
 assert.equal(leaders[1].wins,9);
});
test('ties are broken by win rate, ranking reads stop only when top ten is certain',()=>{
 const entries=Array.from({length:12},(_,i)=>({uid:'u'+i,nickname:'n'+i,petName:'pet',wins:10-i, games:20-i,lastGameDay:'2026-11-05'}));
 assert.equal(onlineBattleRankingScanComplete(entries,'2026-11-06'),true);
 const tied=[{uid:'x',wins:5,games:5,lastGameDay:'2026-11-05'},{uid:'y',wins:5,games:10,lastGameDay:'2026-11-05'}];
 assert.deepEqual(projectOnlineBattleLeaderboard(tied,'2026-11-06').map(e=>e.uid),['x','y']);
 const unresolved=Array.from({length:12},(_,i)=>({uid:'t'+i,wins:1,games:1,lastGameDay:'2026-11-05'}));
 assert.equal(onlineBattleRankingScanComplete(unresolved,'2026-11-06'),false);
});
