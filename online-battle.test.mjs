import test from 'node:test';
import assert from 'node:assert/strict';
import {
 cleanupOnlineBattleRoom,
 createOnlineBattle,
 ONLINE_BATTLE_JOIN_TTL_MS,
 ONLINE_BATTLE_RESULT_TTL_MS,
 onlineBattleMissDamage,
 validOnlineBattleQuestionId,
 projectOnlineBattleLobbyRoom
} from './online-battle.mjs';
import {createRetryQuestionStats,mergeRetryAndBattleQuestionStats} from './retry-question-stats.mjs';

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
   roomStore:{mode:'production',read:async()=>({value:null,updateTime:'empty'}),write:async()=>{}},
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
  assert.deepEqual(result.commits,[],'入室時にFirestoreへ書き込まない');
 }
});

async function simulateCoinlessBattle(operation,initialRoom,actor='test-user',questionMode=false,questionId='',getQuestionAccuracy=null,spellId='mirogoturn'){
 const reads=[],commits=[],roomWrites=[];
 let stored={value:structuredClone(initialRoom),updateTime:'room-1'};
 const fetch=async (url,options={})=>{
  const path=String(url);
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
  readJson:async()=>({matchId:initialRoom.matchId,...(questionId?{questionId}:{}),...(operation==='magic'?{spellId}:{})}),
  send:(res,status,payload)=>{res.status=status;res.body=payload;},
  decodeFields:fields=>fields.__testValue||{},
  questionMode,getQuestionAccuracy,fetch,
  roomStore:{
   mode:'production',
   read:async()=>structuredClone(stored),
   write:async(_id,value)=>{stored={value:structuredClone(value),updateTime:'next'};roomWrites.push(stored.value);},
   saveStanding:async()=>{}
  },
  now:()=>1_000_000
 });
 const response={};
 await service.handle({method:'POST'},response,'/api/online-battle/room/4-1/'+operation);
 return {response,reads,commits,roomWrites};
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
  roomId:'4-1',status:'finished',matchId:'rematch-fixture',matchEndedAt:990_000,
  players:[player('test-user',999_000),{...player('opponent',999_000),rematchReady:true}]
 });
 const result=await simulateCoinlessBattle('continue',initial);
 assert.equal(result.response.status,200);
 assert.equal(result.response.body.room.status,'playing');
 assert.equal(result.reads.filter(name=>name==='wallet').length,0);
 assert.ok(result.commits.flat().every(write=>!write.update.name.includes('/users/')));
});

test('勝利報酬はFirebase①のwalletを2件読み一度だけ精算する',async()=>{
 const initial=room({
  roomId:'4-1',status:'playing',matchId:'match-one',
  players:[player('test-user',999_000),{...player('opponent',999_000),hp:1}]
 });
 const result=await simulateCoinlessBattle('attack',initial);
 assert.equal(result.response.status,200);
 assert.equal(result.response.body.room.status,'finished');
 assert.equal(result.response.body.room.winnerUid,'test-user');
 assert.equal(result.reads.filter(name=>name==='wallet').length,2);
 const writes=result.commits.flat();
 const ledgers=writes.filter(write=>write.update?.name.includes('/onlineBattleSettlements/'));
 assert.equal(ledgers.length,1);
 assert.equal(ledgers[0].currentDocument.exists,false);
 const wallets=writes.filter(write=>write.update?.name.includes('/users/')&&write.updateTransforms?.some(field=>field.fieldPath==='coins'));
 assert.equal(wallets.length,1);
 assert.equal(wallets[0].updateTransforms.find(field=>field.fieldPath==='coins').increment.integerValue,'1');
});

test('試合終了による不戦勝でもwalletを2件読み報酬を精算する',async()=>{
 const initial=room({
  roomId:'4-1',status:'playing',matchId:'forfeit-match',
  players:[player('test-user',999_000),player('opponent',999_000)]
 });
 const result=await simulateCoinlessBattle('leave',initial,'opponent');
 assert.equal(result.response.status,200);
 assert.equal(result.response.body.room.winnerUid,'test-user');
 assert.equal(result.reads.filter(name=>name==='wallet').length,2);
 const wallets=result.commits.flat().filter(write=>write.update?.name.includes('/users/')&&write.updateTransforms?.some(field=>field.fieldPath==='coins'));
 assert.equal(wallets.length,1);
 assert.equal(wallets[0].update.name.endsWith('/users/test-user/apps/english-playroom'),true);
 assert.equal(wallets[0].updateTransforms.find(field=>field.fieldPath==='coins').increment.integerValue,'1');
});

test('アイテム消費は対戦中の①read/writeなし・終了時に一回だけ精算する',async()=>{
 const initial=room({
  roomId:'4-1',status:'playing',matchId:'items-match',
  players:[{...player('test-user',999_000),hp:5,battleInventory:{bandage:1},spentItems:{bandage:1}},
   {...player('opponent',999_000),hp:1}]
 });
 const result=await simulateCoinlessBattle('attack',initial);
 assert.equal(result.response.status,200);
 assert.equal(result.reads.filter(name=>name==='wallet').length,2);
 const walletWrites=result.commits.flat().filter(write=>write.update?.name.includes('/users/')&&write.updateTransforms?.some(field=>field.fieldPath==='coins'));
 assert.equal(walletWrites.length,1);
 const transforms=walletWrites[0].updateTransforms;
 assert.equal(transforms.find(field=>field.fieldPath==='petDungeonItems.`bandage`').increment.integerValue,'-1');
 assert.equal(transforms.find(field=>field.fieldPath==='coins').increment.integerValue,'1');
 const savedPlayers=result.roomWrites[0].players;
 assert.deepEqual(savedPlayers[0].spentItems,{},'精算後に次の試合へ持ち越さない');
});

test('タイムアウトで残ったプレイヤーの使用済アイテムを次戦へ持ち越さない',()=>{
 const at=1_000_000;
 const previous=room({
  roomId:'4-1',status:'playing',matchId:'timeout-item-test',
  players:[{...player('expired',at-ONLINE_BATTLE_JOIN_TTL_MS),spentItems:{bandage:2}},
   {...player('survivor',at-1000),spentItems:{medicine:1}}]
 });
 const result=cleanupOnlineBattleRoom(previous,'4-1',at);
 assert.equal(result.changed,true);
 assert.equal(result.room.players.length,1);
 assert.deepEqual(result.room.players[0].spentItems,{});
 const entry=result.room.pendingSettlement.entries.find(e=>e.uid==='survivor');
 assert.equal(entry.items.medicine,1);
});


test('誤答は現在HPではなく最大HPの4分の1（端数切り上げ）を失う',async()=>{
 assert.equal(onlineBattleMissDamage(10),3);
 assert.equal(onlineBattleMissDamage(12),3);
 assert.equal(onlineBattleMissDamage(13),4);
 assert.equal(onlineBattleMissDamage(1),1);
 const initial=room({
  roomId:'4-1',status:'playing',matchId:'miss-quarter-test',
  players:[{...player('test-user',999_000),stats:{hp:13,attack:1,defense:1,mp:6},hp:5},
           {...player('opponent',999_000),hp:10}]
 });
 const result=await simulateCoinlessBattle('miss',initial);
 assert.equal(result.response.status,200);
 assert.equal(result.response.body.room.players[0].hp,1);
 assert.equal(result.response.body.room.lastEvent.damage,4);
 assert.equal(result.reads.length,0,'誤答ではFirestoreの読み込み不要');
 assert.equal(result.commits.length,0,'決着前の誤答でFirestore書き込み不要');
});

test('問題対戦の4級は20部屋、単語対戦は従来どおり10部屋',async()=>{
 const make=questionMode=>{
  let roomReads=0;
  const service=createOnlineBattle({
   base:'https://firestore.googleapis.com/v1/projects/test/databases/(default)',
   projectId:'test',accessToken:async()=> 'token',
   verifyUser:async()=>({uid:'a'}),readJson:async()=>({}),
   send:(res,status,payload)=>{res.status=status;res.body=payload;},
   decodeFields:()=>({}),questionMode,
   roomStore:{
    mode:'production',
    lobby:async()=>({}),
    read:async()=>{roomReads++;return {value:null,updateTime:'null_etag'};},
    write:async()=>{}
   }
  });
  return {service,reads:()=>roomReads};
 };
 const question=make(true),word=make(false);
 for(const [battle,count] of [[question,20],[word,10]]){
  const lobby={};await battle.service.handle({method:'GET'},lobby,'/api/online-battle/lobby/4');
  assert.equal(lobby.status,200);
  assert.equal(lobby.body.lobby.rooms.length,count);
  assert.equal(lobby.body.lobby.rooms.at(-1).roomNo,count);
 }
 const q20={};await question.service.handle({method:'GET'},q20,'/api/online-battle/room/4-20');
 assert.equal(q20.status,200);
 const w20={};await word.service.handle({method:'GET'},w20,'/api/online-battle/room/4-20');
 assert.equal(w20.status,404);
 assert.equal(word.reads(),0,'単語対戦の存在しない部屋をDBから読まない');
});

test('問題IDは級ごとに正しいリトライノート形式だけを集計する',()=>{
 assert.equal(validOnlineBattleQuestionId('2025-2-g4-q01','4'),true);
 assert.equal(validOnlineBattleQuestionId('2020-2-pre2-q11','pre2'),true);
 assert.equal(validOnlineBattleQuestionId('2025-2-g4-q01','3'),false);
 assert.equal(validOnlineBattleQuestionId('__proto__','4'),false);
});

test('問題対戦の解答結果は既存RTDBルーム更新に同梱、Firestore read/write追加なし',async()=>{
 const questionId='2025-2-g4-q01';
 const initial=room({
  roomId:'4-1',gradeKey:'4',status:'playing',matchId:'accuracy-match',
  players:[player('test-user',999_000),{...player('opponent',999_000),hp:10}]
 });
 const first=await simulateCoinlessBattle('attack',initial,'test-user',true,questionId);
 assert.equal(first.response.status,200);
 assert.equal(first.reads.length,0);
 assert.equal(first.commits.length,0);
 assert.equal(first.roomWrites.length,1);
 assert.equal(first.roomWrites[0].players[0].battleQuestionFirst[questionId],1);
 assert.equal('battleQuestionFirst' in first.response.body.room.players[0],false,'他人に初回回答履歴を公開しない');
 // Repeated attempts for the same question in the same match must not replace
 // its originally wrong answer with a later correct answer.
 const alreadyWrong=structuredClone(initial);
 alreadyWrong.players[0].battleQuestionFirst={[questionId]:0};
 const repeat=await simulateCoinlessBattle('attack',alreadyWrong,'test-user',true,questionId);
 assert.equal(repeat.roomWrites[0].players[0].battleQuestionFirst[questionId],0);
});

test('管理者向け初回正答率は保存済みRTDB成績から1回だけ読み込み集計する',async()=>{
 let calls=0;
 const service=createOnlineBattle({
  base:'https://firestore.googleapis.com/v1/projects/test/databases/(default)',
  projectId:'test',accessToken:async()=> 'token',verifyUser:async()=>({uid:'u'}),
  readJson:async()=>({}),send:()=>{},decodeFields:()=>({}),questionMode:true,
  fetch:async()=>{throw Error('Firestore must not be accessed for accuracy stats');},
  roomStore:{mode:'production',listStandings:async grade=>{calls++;assert.equal(grade,'4');return [
   {uid:'a',questionFirst:{'2025-2-g4-q01':1,'2025-2-g4-q02':0}},
   {uid:'b',questionFirst:{'2025-2-g4-q01':0,'2025-2-g4-q02':0}},
   {uid:'c',questionFirst:{'2025-2-g4-q01':1,'2025-2-g3-q02':1}}
  ];}}
 });
 const response=await service.questionStats('4',10);
 assert.equal(calls,1);
 assert.equal(response.total,2);
 assert.deepEqual(response.rows.map(q=>({id:q.id,attempts:q.attempts,correct:q.correct,accuracy:q.accuracy})),[
  {id:'2025-2-g4-q02',attempts:2,correct:0,accuracy:0},
  {id:'2025-2-g4-q01',attempts:3,correct:2,accuracy:66.7}
 ]);
});

test('リトライ＋問題対戦の正答率は回答数・正解数を合算して算出する',()=>{
 const data=mergeRetryAndBattleQuestionStats([
  {id:'2025-2-g4-q01',grade:'4級',attempts:10,correct:6},
  {id:'2025-2-g4-q02',grade:'4級',attempts:3,correct:0},
  {id:'2025-2-g3-q01',grade:'3級',attempts:2,correct:2}
 ],[
  {id:'2025-2-g4-q01',attempts:10,correct:8},
  {id:'2025-2-g4-q02',attempts:2,correct:2}
 ],'4級',20);
 assert.equal(data.total,2);
 assert.deepEqual(data.rows.map(q=>({id:q.id,attempts:q.attempts,correct:q.correct,accuracy:q.accuracy,retry:q.retryAttempts,battle:q.battleAttempts})),[
  {id:'2025-2-g4-q02',attempts:5,correct:2,accuracy:40,retry:3,battle:2},
  {id:'2025-2-g4-q01',attempts:20,correct:14,accuracy:70,retry:10,battle:10}
 ]);
});

test('合算ランキングの表示時だけFirestore 1 GET、RTDB 1 GET、追加write 0',async()=>{
 let firestoreReads=0,rtdbReads=0,authChecks=0;
 const handler=createRetryQuestionStats({
  base:'https://firestore.test',accessToken:async()=> 'token',
  verifyAdmin:async()=>{authChecks++;},decodeFields:fields=>fields,
  send:(res,status,data)=>{res.status=status;res.body=data;},
  fail:(message,status)=>Object.assign(new Error(message),{status}),
  fetch:async()=>{
   firestoreReads++;
   return {ok:true,status:200,json:async()=>({fields:{items:{
    one:{id:'2025-2-g4-q01',grade:'4級',attempts:10,correct:6}
   }}})};
  },
  getQuestionBattleStats:async gradeKey=>{
   rtdbReads++;assert.equal(gradeKey,'4');
   return {rows:[{id:'2025-2-g4-q01',attempts:10,correct:8}]};
  }
 });
 const res={};
 await handler({method:'GET',url:'/api/admin/retry-question-stats?grade=4%E7%B4%9A&limit=20'},res);
 assert.equal(res.status,200);
 assert.equal(authChecks,1);
 assert.equal(firestoreReads,1);
 assert.equal(rtdbReads,1);
 assert.equal(res.body.rows[0].accuracy,70);
 assert.equal(res.body.rows[0].attempts,20);
});

test('Firestoreの集計が未生成でも対戦の正答率は表示される',async()=>{
 let rtdbReads=0;
 const handler=createRetryQuestionStats({
  base:'https://firestore.test',accessToken:async()=> 'token',
  verifyAdmin:async()=>{},decodeFields:fields=>fields,
  send:(res,status,data)=>{res.status=status;res.body=data;},
  fail:(message,status)=>Object.assign(new Error(message),{status}),
  fetch:async()=>({ok:false,status:404}),
  getQuestionBattleStats:async()=>{rtdbReads++;return {rows:[{id:'2025-2-g4-q01',attempts:2,correct:1}]};}
 });
 const res={};
 await handler({method:'GET',url:'/api/admin/retry-question-stats?grade=4%E7%B4%9A'},res);
 assert.equal(res.status,200);
 assert.equal(rtdbReads,1);
 assert.equal(res.body.total,1);
 assert.equal(res.body.rows[0].accuracy,50);
});

test('準1級の合算ランキングはオンライン対戦RTDBを読まない',async()=>{
 let rtdbReads=0;
 const handler=createRetryQuestionStats({
  base:'https://firestore.test',accessToken:async()=> 'token',
  verifyAdmin:async()=>{},decodeFields:fields=>fields,
  send:(res,status,data)=>{res.status=status;res.body=data;},
  fail:(message,status)=>Object.assign(new Error(message),{status}),
  fetch:async()=>({ok:true,status:200,json:async()=>({fields:{items:{a:{id:'2025-2-pre1-q01',grade:'準1級',attempts:3,correct:2}}}})}),
  getQuestionBattleStats:async()=>{rtdbReads++;return {rows:[]};}
 });
 const res={};
 await handler({method:'GET',url:'/api/admin/retry-question-stats?grade=%E6%BA%961%E7%B4%9A'},res);
 assert.equal(res.status,200);
 assert.equal(rtdbReads,0);
 assert.equal(res.body.rows[0].accuracy,66.7);
});

test('問題対戦は実際のサーバー認定正答率だけで攻撃加算し、Firestoreアクセスを追加しない',async()=>{
 const questionId='2025-2-g4-q01',wrongId='2025-2-g4-q99';
 const initial=room({
  roomId:'4-1',gradeKey:'4',status:'playing',matchId:'accuracy-damage-match',
  players:[{...player('test-user',999_000),stats:{hp:100,attack:9,defense:1,mp:6}},
           {...player('opponent',999_000),stats:{hp:100,attack:9,defense:1,mp:6},hp:50}]
 });
 let snapshotGets=0;
 const getQuestionAccuracy=async()=>{snapshotGets++;return {grades:{'4':{[questionId]:50,[wrongId]:null}}};};
 const result=await simulateCoinlessBattle('attack',initial,'test-user',true,questionId,getQuestionAccuracy);
 assert.equal(result.response.status,200);
 assert.equal(result.response.body.room.lastEvent.baseDamage,10);
 assert.equal(result.response.body.room.lastEvent.bonusPercent,10);
 assert.equal(result.response.body.room.lastEvent.questionRate,50);
 assert.equal(result.response.body.room.lastEvent.damage,11);
 assert.equal(result.response.body.room.players[1].hp,39);
 assert.equal(snapshotGets,1);
 assert.equal(result.reads.length,0,'回答時のFirestore読取なし');
 assert.equal(result.commits.length,0,'決着前のFirestore更新なし');
 const missing=await simulateCoinlessBattle('attack',initial,'test-user',true,'2025-2-g4-q02',getQuestionAccuracy);
 assert.equal(missing.response.body.room.lastEvent.bonusPercent,0,'捏造IDにデータなしボーナスを出さない');
 const noData=await simulateCoinlessBattle('attack',initial,'test-user',true,wrongId,getQuestionAccuracy);
 assert.equal(noData.response.body.room.lastEvent.bonusPercent,35);
 assert.equal(noData.response.body.room.lastEvent.damage,14);
});

test('単語対戦のダメージに問題正答率ボーナスが混ざらない',async()=>{
 const initial=room({
  roomId:'4-1',gradeKey:'4',status:'playing',matchId:'word-damage-match',
  players:[{...player('test-user',999_000),stats:{hp:100,attack:9,defense:1,mp:6}},
   {...player('opponent',999_000),stats:{hp:100,attack:9,defense:1,mp:6},hp:50}]
 });
 const word=await simulateCoinlessBattle('attack',initial,'test-user',false,'2025-2-g4-q01',async()=>{throw Error('単語対戦では参照しない');});
 assert.equal(word.response.status,200);
 assert.equal(word.response.body.room.lastEvent.damage,10);
 assert.equal(word.response.body.room.lastEvent.bonusPercent,undefined);
});

test('ミロゴターンをLv20・MP8で唱えると1回だけの反射が無期限で残る',async()=>{
 const initial=room({roomId:'4-1',gradeKey:'4',status:'playing',matchId:'shield-cast',
  players:[{...player('test-user',999_000),level:20,mp:20,stats:{hp:60,attack:5,defense:3,mp:20}},
   {...player('opponent',999_000),level:35,mp:20,stats:{hp:60,attack:5,defense:3,mp:20}}]});
 const result=await simulateCoinlessBattle('magic',initial);
 assert.equal(result.response.status,200);
 const saved=result.response.body.room;
 assert.equal(saved.players[0].magicReflect,true);
 assert.equal(saved.players[0].mp,12);
 assert.equal(saved.lastEvent.kind,'reflect');
 assert.equal(saved.lastEvent.mpCost,8);
 assert.equal(saved.lastEvent.expiresAt,undefined,'時間制限なし');
 assert.equal(result.reads.length,0,'追加Firestore reads 0');
 assert.equal(result.commits.length,0,'追加Firestore writes 0');
 assert.equal(result.roomWrites.length,1,'既存のルーム保存のみ');
 const duplicate=await simulateCoinlessBattle('magic',{...initial,players:[{...initial.players[0],magicReflect:true},initial.players[1]]});
 assert.equal(duplicate.response.status,409,'反射の多重重ね掛けは禁止');
 const lowLevel=await simulateCoinlessBattle('magic',{...initial,players:[{...initial.players[0],level:19},initial.players[1]]});
 assert.equal(lowLevel.response.status,400,'Lv19は未習得');
 const lowMp=await simulateCoinlessBattle('magic',{...initial,players:[{...initial.players[0],mp:7},initial.players[1]]});
 assert.equal(lowMp.response.status,400,'MP7では唱えられない');
});

test('ミロゴロを反射し、相手に被害ゼロ・発動者の盾だけ消費・追加Firebase readなし',async()=>{
 const initial=room({roomId:'4-1',gradeKey:'4',status:'playing',matchId:'shield-reflect',
  players:[{...player('test-user',999_000),level:35,hp:60,mp:20,stats:{hp:60,attack:5,defense:3,mp:20}},
   {...player('opponent',999_000),level:35,hp:60,mp:20,stats:{hp:60,attack:5,defense:3,mp:20},magicReflect:true}]});
 const result=await simulateCoinlessBattle('magic',initial,'test-user',false,'',null,'mirogoro');
 assert.equal(result.response.status,200);
 const battle=result.response.body.room;
 assert.equal(battle.lastEvent.kind,'reflected');
 assert.equal(battle.lastEvent.by,'opponent');
 assert.equal(battle.players[0].hp,60-battle.lastEvent.damage,'攻撃した本人に反射');
 assert.equal(battle.players[1].hp,60,'防御側はノーダメージ');
 assert.equal(battle.players[1].magicReflect,false,'盾は1回で消える');
 assert.equal(battle.players[0].mp,15,'攻撃魔法のMP5も消費される');
 assert.equal(result.reads.length,0);
 assert.equal(result.commits.length,0);
 assert.equal(result.roomWrites.length,1);
});
test('通常攻撃や不正解では盾を消費しない・再戦で盾をリセットする',async()=>{
 const initial=room({roomId:'4-1',gradeKey:'4',status:'playing',matchId:'shield-persist',
  players:[{...player('test-user',999_000),level:35,hp:60,mp:20,stats:{hp:60,attack:5,defense:3,mp:20}},
   {...player('opponent',999_000),level:35,hp:60,mp:20,stats:{hp:60,attack:5,defense:3,mp:20},magicReflect:true}]});
 const basic=await simulateCoinlessBattle('attack',initial);
 assert.equal(basic.response.status,200);
 assert.equal(basic.response.body.room.players[1].magicReflect,true);
 const miss=await simulateCoinlessBattle('miss',initial);
 assert.equal(miss.response.status,200);
 assert.equal(miss.response.body.room.players[1].magicReflect,true);
 const rematch=await simulateCoinlessBattle('continue',{...initial,status:'finished',matchId:'shield-old',
  players:[{...initial.players[0],magicReflect:true},{...initial.players[1],rematchReady:true}]});
 assert.equal(rematch.response.status,200);
 assert.equal(rematch.response.body.room.status,'playing');
 assert.equal(rematch.response.body.room.players[0].magicReflect,false);
 assert.equal(rematch.response.body.room.players[1].magicReflect,false);
});
test('魔法・アイテム禁止ルームでは反射魔法も禁止',async()=>{
 const initial=room({roomId:'4-3',gradeKey:'4',noItems:true,status:'playing',matchId:'no-magic',
  players:[{...player('test-user',999_000),level:35,mp:20},player('opponent',999_000)]});
 const result=await simulateCoinlessBattle('magic',initial);
 assert.notEqual(result.response.status,200);
});
