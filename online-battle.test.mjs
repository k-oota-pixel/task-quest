import test from 'node:test';
import assert from 'node:assert/strict';
import {
 cleanupOnlineBattleRoom,
 createOnlineBattle,
 ONLINE_BATTLE_JOIN_TTL_MS,
 ONLINE_BATTLE_RESULT_TTL_MS,
 projectOnlineBattleLobbyRoom
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
test('ロビーは15分の直前まで待機中、15分で空室表示になる',()=>{
 const joinedAt=100_000_000;
 const saved={status:'waiting',playerCount:1,updatedAt:joinedAt,playerExpiresAt:[joinedAt+ONLINE_BATTLE_JOIN_TTL_MS]};
 assert.equal(ONLINE_BATTLE_JOIN_TTL_MS,15*60*1000);
 assert.equal(projectOnlineBattleLobbyRoom(saved,'4-1',joinedAt+ONLINE_BATTLE_JOIN_TTL_MS-1).status,'waiting');
 const expired=projectOnlineBattleLobbyRoom(saved,'4-1',joinedAt+ONLINE_BATTLE_JOIN_TTL_MS);
 assert.equal(expired.status,'open');
 assert.equal(expired.playerCount,0);
});
test('2人のうち1人だけ期限切れなら残り1人待機中とする',()=>{
 const joinedAt=100_000_000;
 const saved={status:'playing',playerCount:2,updatedAt:joinedAt+5*60*1000,playerExpiresAt:[joinedAt+ONLINE_BATTLE_JOIN_TTL_MS,joinedAt+5*60*1000+ONLINE_BATTLE_JOIN_TTL_MS]};
 const partial=projectOnlineBattleLobbyRoom(saved,'4-2',joinedAt+ONLINE_BATTLE_JOIN_TTL_MS);
 assert.equal(partial.status,'waiting');
 assert.equal(partial.playerCount,1);
 const expired=projectOnlineBattleLobbyRoom(saved,'4-2',joinedAt+5*60*1000+ONLINE_BATTLE_JOIN_TTL_MS);
 assert.equal(expired.status,'open');
 assert.equal(expired.playerCount,0);
});
test('ロビーの結果発表は2分で空室表示になる',()=>{
 const endedAt=200_000_000;
 const saved={status:'finished',playerCount:2,updatedAt:endedAt,playerExpiresAt:[endedAt+ONLINE_BATTLE_JOIN_TTL_MS,endedAt+ONLINE_BATTLE_JOIN_TTL_MS],matchExpiresAt:endedAt+ONLINE_BATTLE_RESULT_TTL_MS};
 assert.equal(projectOnlineBattleLobbyRoom(saved,'3-1',endedAt+ONLINE_BATTLE_RESULT_TTL_MS-1).status,'finished');
 const expired=projectOnlineBattleLobbyRoom(saved,'3-1',endedAt+ONLINE_BATTLE_RESULT_TTL_MS);
 assert.equal(expired.status,'open');
 assert.equal(expired.playerCount,0);
});
test('旧形式のロビー情報も更新時刻から期限切れ判定する',()=>{
 const updatedAt=300_000_000;
 assert.equal(projectOnlineBattleLobbyRoom({status:'waiting',playerCount:1,updatedAt},'4-9',updatedAt+ONLINE_BATTLE_JOIN_TTL_MS).status,'open');
 assert.equal(projectOnlineBattleLobbyRoom({status:'finished',playerCount:2,updatedAt},'4-8',updatedAt+ONLINE_BATTLE_RESULT_TTL_MS).status,'open');
});

test('0コインでも入室でき、入室時にコインを消費しない',async()=>{
 async function attemptJoin(coins){
  const commits=[];
  const fetch=async (url,options={})=>{
   const path=String(url);
   if(path.includes('/documents/onlineBattleRooms/'))return {status:404,ok:false,json:async()=>({})};
   if(path.includes('/documents/users/test-user/apps/english-playroom')){
    return {status:200,ok:true,json:async()=>({fields:{coins:{integerValue:String(coins)}},updateTime:'wallet-1'})};
   }
   if(path.endsWith('/documents:commit')){
    commits.push(JSON.parse(options.body));
    return {status:200,ok:true,json:async()=>({})};
   }
   throw new Error('Unexpected Firestore request: '+path);
  };
  const service=createOnlineBattle({
   base:'https://firestore.googleapis.com/v1/projects/online-battle-test/databases/(default)',
   projectId:'online-battle-test',
   accessToken:async()=> 'fake-token',
   verifyUser:async()=>({uid:'test-user'}),
   readJson:async()=>({}),
   send:(res,status,payload)=>{res.status=status;res.body=payload;},
   decodeFields:fields=>({coins:Number(fields?.coins?.integerValue||0)}),
   fetch,
   now:()=>1_000_000
  });
  const response={};
  await service.handle({method:'POST'},response,'/api/online-battle/room/4-1/join');
  return {response,commits};
 }
 for(const coins of [0,1,10]){
  const result=await attemptJoin(coins);
  assert.equal(result.response.status,200);
  assert.equal(result.response.body.room.players[0].uid,'test-user');
  assert.equal(result.response.body.room.status,'waiting');
  assert.equal(result.commits.length,1);
  assert.equal(result.commits[0].writes.length,2);
  assert.ok(result.commits[0].writes.every(write=>!write.update.name.includes('/users/')),'入室時にコインを消費しない');
 }
});

async function simulateCoinlessBattle(operation,initialRoom,actor='test-user'){
 const reads=[],commits=[];
 const fetch=async (url,options={})=>{
  const path=String(url);
  if(path.endsWith('/documents/onlineBattleRooms/room4-1')){
   reads.push('room');
   return {status:200,ok:true,json:async()=>({fields:{__testValue:initialRoom},updateTime:'room-1'})};
  }
  if(path.includes('/documents/onlineBattleStats/')){
   reads.push('stats');
   return {status:404,ok:false,json:async()=>({})};
  }
  if(path.includes('/documents/users/')){
   reads.push('wallet');
   return {status:200,ok:true,json:async()=>({fields:{__testValue:{coins:0}},updateTime:'wallet-1'})};
  }
  if(path.endsWith('/documents:commit')){
   commits.push(JSON.parse(options.body).writes);
   return {status:200,ok:true,json:async()=>({})};
  }
  throw new Error('Unexpected Firestore request: '+path);
 };
 const service=createOnlineBattle({
  base:'https://firestore.googleapis.com/v1/projects/online-battle-test/databases/(default)',
  projectId:'online-battle-test',
  accessToken:async()=> 'fake-token',
  verifyUser:async()=>({uid:actor}),
  readJson:async()=>({}),
  send:(res,status,payload)=>{res.status=status;res.body=payload;},
  decodeFields:fields=>fields.__testValue||{},
  fetch,
  now:()=>1_000_000
 });
 const response={};
 await service.handle({method:'POST'},response,'/api/online-battle/room/4-1/'+operation);
 return {response,reads,commits};
}

test('対戦開始は双方0コインでも可能で財布のread/writeがない',async()=>{
 const initial=room({
  roomId:'4-1',players:[player('test-user',999_000),{...player('opponent',999_000),ready:true}]
 });
 const result=await simulateCoinlessBattle('ready',initial);
 assert.equal(result.response.status,200);
 assert.equal(result.response.body.room.status,'playing');
 assert.equal(result.reads.filter(name=>name==='wallet').length,0);
 assert.ok(result.commits.flat().every(write=>!write.update.name.includes('/users/')));
});

test('再戦は双方0コインでも可能で財布のread/writeがない',async()=>{
 const initial=room({
  roomId:'4-1',status:'finished',matchEndedAt:990_000,
  players:[player('test-user',999_000),{...player('opponent',999_000),rematchReady:true}]
 });
 const result=await simulateCoinlessBattle('continue',initial);
 assert.equal(result.response.status,200);
 assert.equal(result.response.body.room.status,'playing');
 assert.equal(result.reads.filter(name=>name==='wallet').length,0);
 assert.ok(result.commits.flat().every(write=>!write.update.name.includes('/users/')));
});

test('勝利時は0コインの勝者に正確に1コイン付与する',async()=>{
 const initial=room({
  roomId:'4-1',status:'playing',players:[player('test-user',999_000),{...player('opponent',999_000),hp:1}]
 });
 const result=await simulateCoinlessBattle('attack',initial);
 assert.equal(result.response.status,200);
 assert.equal(result.response.body.room.status,'finished');
 assert.equal(result.response.body.room.winnerUid,'test-user');
 assert.equal(result.reads.filter(name=>name==='wallet').length,1);
 const walletWrites=result.commits.flat().filter(write=>write.update.name.includes('/users/'));
 assert.equal(walletWrites.length,1);
 assert.equal(walletWrites[0].update.fields.coins.integerValue,'1');
});

test('相手が対戦中に退室した不戦勝でも1コイン付与する',async()=>{
 const initial=room({
  roomId:'4-1',status:'playing',players:[player('test-user',999_000),player('opponent',999_000)]
 });
 const result=await simulateCoinlessBattle('leave',initial,'opponent');
 assert.equal(result.response.status,200);
 assert.equal(result.response.body.room.winnerUid,'test-user');
 const walletWrites=result.commits.flat().filter(write=>write.update.name.includes('/users/'));
 assert.equal(walletWrites.length,1);
 assert.equal(walletWrites[0].update.fields.coins.integerValue,'1');
});
