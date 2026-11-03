import test from 'node:test';
import assert from 'node:assert/strict';
import {
 cleanupOnlineBattleRoom,
 ONLINE_BATTLE_JOIN_TTL_MS,
 ONLINE_BATTLE_RESULT_TTL_MS
} from './online-battle.mjs';

function player(uid,joinedAt){
 return {
  uid,
  nickname:uid,
  petName:'PET',
  stats:{hp:10,attack:1,defense:1,mp:6},
  hp:10,
  mp:6,
  level:1,
  ready:false,
  rematchReady:false,
  lastActionAt:0,
  joinedAt
 };
}

function room(overrides={}){
 return {
  roomId:'1',
  grade:'4級',
  noItems:false,
  status:'waiting',
  players:[],
  seq:4,
  winnerUid:'',
  lastEvent:null,
  matchEndedAt:0,
  updatedAt:1_000_000,
  ...overrides
 };
}

test('試合終了から2分でルーム全体を解放する',()=>{
 const endedAt=5_000_000;
 const result=cleanupOnlineBattleRoom(room({
  status:'finished',
  players:[player('a',endedAt-10_000),player('b',endedAt-9_000)],
  winnerUid:'a',
  matchEndedAt:endedAt,
  updatedAt:endedAt
 }),'1',endedAt+ONLINE_BATTLE_RESULT_TTL_MS);
 assert.equal(result.changed,true);
 assert.equal(result.reason,'result-expired');
 assert.equal(result.room.status,'open');
 assert.deepEqual(result.room.players,[]);
 assert.equal(result.room.winnerUid,'');
 assert.equal(result.room.matchEndedAt,0);
});

test('入室から1時間で参加者を強制退出させる',()=>{
 const joinedAt=10_000_000;
 const result=cleanupOnlineBattleRoom(room({
  players:[player('a',joinedAt)],
  updatedAt:joinedAt
 }),'1',joinedAt+ONLINE_BATTLE_JOIN_TTL_MS);
 assert.equal(result.changed,true);
 assert.equal(result.reason,'join-expired');
 assert.equal(result.room.status,'open');
 assert.deepEqual(result.room.players,[]);
});

test('1時間未満の参加者は維持する',()=>{
 const joinedAt=20_000_000;
 const result=cleanupOnlineBattleRoom(room({
  players:[player('a',joinedAt)],
  updatedAt:joinedAt
 }),'1',joinedAt+ONLINE_BATTLE_JOIN_TTL_MS-1);
 assert.equal(result.changed,false);
 assert.equal(result.room.status,'waiting');
 assert.equal(result.room.players.length,1);
 assert.equal(result.room.players[0].uid,'a');
});

test('旧形式の結果発表ルームはupdatedAtを終了時刻として回収する',()=>{
 const updatedAt=30_000_000;
 const legacy=room({
  status:'finished',
  players:[player('a',0)],
  winnerUid:'a',
  updatedAt
 });
 delete legacy.matchEndedAt;
 const result=cleanupOnlineBattleRoom(legacy,'1',updatedAt+ONLINE_BATTLE_RESULT_TTL_MS);
 assert.equal(result.reason,'result-expired');
 assert.equal(result.room.status,'open');
 assert.deepEqual(result.room.players,[]);
});

test('旧形式の放置参加者はupdatedAtを入室時刻の代替として回収する',()=>{
 const updatedAt=40_000_000;
 const legacyPlayer=player('a',0);
 delete legacyPlayer.joinedAt;
 const result=cleanupOnlineBattleRoom(room({
  players:[legacyPlayer],
  updatedAt
 }),'1',updatedAt+ONLINE_BATTLE_JOIN_TTL_MS);
 assert.equal(result.reason,'join-expired');
 assert.equal(result.room.status,'open');
 assert.deepEqual(result.room.players,[]);
});