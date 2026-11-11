import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createOnlineBattle, ONLINE_BATTLE_JOIN_TTL_MS } from './online-battle.mjs';
import { createRealtimeRoomStore, realtimeEvents } from './rtdb-room-store.mjs';

const roomPath = '/api/online-battle/room/4-1';
const projectId = 'demo-monstudy-battle';
const base = 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)';
const battleProjectId = 'demo-monstudy-standings';
const battleBase = 'https://firestore.googleapis.com/v1/projects/' + battleProjectId + '/databases/(default)';

function decode(value) {
 if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
 if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
 if ('integerValue' in value) return Number(value.integerValue);
 return Object.values(value)[0];
}
function decodeFields(fields) {
 return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
}
function fakeFirestore(wallet, prefix) {
 const docs = new Map();
 const counts = { reads: 0, writes: 0 };
 const walletOperations = { reads: 0, writes: 0 };
 const primaryOperations = { reads: 0, writes: 0 };
 const isWallet = path => path === wallet('a') || path === wallet('b');
 for (const uid of ['a', 'b']) {
  docs.set(wallet(uid), {
   value: { nickname: uid, coins: 0, petStrengthLevelPoints: 15, petBaseStats: { hp: 15, mp: 11 }, petDungeonItems: { bandage: 2 }, onlineBattleTitleStats: {} },
   updateTime: 'seed'
  });
 }
 const pathOf = name => name.split('/documents/')[1];
 let revision = 0;
 const request = async (url, options) => {
  const primary=url.startsWith(base);
  assert.ok(primary||url.startsWith(battleBase));
  if (!url.endsWith(':commit')) {
   counts.reads++;
   const path = pathOf(url);
   assert.equal(primary,isWallet(path)||path.startsWith(prefix+'Settlements/'));
   if(primary)primaryOperations.reads++;
   if(isWallet(path))walletOperations.reads++;
   const doc = docs.get(path);
   return doc ? Response.json({fields: { fixture: doc.value }, updateTime: doc.updateTime}) : new Response(null, { status: 404 });
  }
  const { writes } = JSON.parse(options.body);
  for (const write of writes) {
   const current = docs.get(pathOf(write.update?.name || write.transform.document));
   const guard = write.currentDocument;
   if (guard?.updateTime && current?.updateTime !== guard.updateTime || guard?.exists !== undefined && guard.exists !== Boolean(current)) {
    return Response.json({ error: { status: 'FAILED_PRECONDITION' } }, { status: 412 });
   }
  }
  const writeResults = writes.map(write => {
   const key = pathOf(write.update?.name || write.transform.document);
   assert.equal(primary,isWallet(key)||key.startsWith(prefix+'Settlements/'));
   if(primary)primaryOperations.writes++;
   const value = { ...structuredClone(docs.get(key)?.value || {}), ...decodeFields(write.update?.fields || {}) };
   for (const field of write.updateTransforms || write.transform?.fieldTransforms || []) {
    const [parent, child] = field.fieldPath.split('.');
    if (child) {
     const item = child.slice(1, -1);
     value[parent][item] = (value[parent][item] || 0) + decode(field.increment);
    } else value[parent] = (value[parent] || 0) + decode(field.increment);
   }
   const updateTime = String(++revision);
   docs.set(key, { value, updateTime });
   counts.writes++;
   if(isWallet(key))walletOperations.writes++;
   return { updateTime };
  });
  return Response.json({ writeResults });
 };
 return { request, docs, counts, walletOperations, primaryOperations };
}

function fakeRealtime() {
 const rooms = new Map(), subscribers = new Set();
 const bytes = { snapshots: 0, streams: 0, uploads: 0 };
 let revision = 0;
 let failClear = false;
 const request = async (url, options) => {
  assert.equal(options.headers.Authorization, 'Bearer fixture');
  const key = url.pathname;
  const stored = rooms.get(key) || { payload: null, version: '"null_etag"' };
  if (options.headers.Accept === 'text/event-stream') {
   let subscription;
   const stream = new ReadableStream({
    start(controller) {
     subscription = {
      key,
      publish(payload) {
       const chunk = Buffer.from('event: put\ndata: ' + JSON.stringify({path:'/',data:payload}) + '\n\n');
       bytes.streams += chunk.length;
       controller.enqueue(chunk);
      }
     };
     subscribers.add(subscription);
     subscription.publish(stored.payload);
     options.signal.addEventListener('abort', () => {
      if (subscribers.delete(subscription)) controller.close();
     }, { once: true });
    },
    cancel() { subscribers.delete(subscription); }
   });
   return new Response(stream);
  }
  if (options.method === 'PUT') {
   if (options.headers['If-Match'] !== stored.version) return new Response(null, { status: 412 });
   bytes.uploads += Buffer.byteLength(options.body);
   const payload = JSON.parse(options.body);
   const room = JSON.parse(payload);
   if (failClear && room.lastSettledMatchId && !room.pendingSettlement) {
    failClear = false;
    return new Response(null, { status: 500 });
   }
   const version = '"' + (++revision) + '"';
   rooms.set(key, {payload, version});
   for (const subscriber of subscribers) if (subscriber.key === key) subscriber.publish(payload);
   bytes.snapshots += Buffer.byteLength(options.body);
   return Response.json(payload);
  }
  const result = JSON.stringify(stored.payload);
  bytes.snapshots += Buffer.byteLength(result);
  return new Response(result, {headers:{etag:stored.version}});
 };
 return { request, bytes, subscribers, failNextClear: () => { failClear = true; } };
}

async function emulatorRealtime(port) {
 const namespace='demo-monstudy-battle';
 const url='http://127.0.0.1:'+port;
 const rules=await fetch(url+'/.settings/rules.json?ns='+namespace,{
  method:'PUT',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},
  body:JSON.stringify({rules:{'.read':false,'.write':false}})
 });
 assert.equal(rules.status,200,await rules.text());
 const blocked=await fetch(url+'/onlineBattlePreview.json?ns='+namespace);
 assert.equal(blocked.status,401);
 await blocked.body.cancel();
 const probe=createRealtimeRoomStore({databaseUrl:url,accessToken:async()=> 'owner',emulatorNamespace:namespace});
 await probe.verifyConnection();
 const empty=await fetch(url+'/onlineBattlePreview/connectionChecks.json?ns='+namespace,{headers:{Authorization:'Bearer owner'}});
 assert.equal(await empty.json(),null);
 const bytes={snapshots:0,streams:0,uploads:0};
 let failClear=false;
 async function request(target,options){
  if(options.method==='PUT'){
   bytes.uploads+=Buffer.byteLength(options.body);
   const room=JSON.parse(JSON.parse(options.body));
   if(failClear&&room.lastSettledMatchId&&!room.pendingSettlement){
    failClear=false;
    return new Response(null,{status:500});
   }
  }
  const response=await fetch(target,options);
  if(!response.ok&&response.status!==412){
   throw new Error('Emulator '+(options.method||'GET')+' returned '+response.status+': '+await response.text());
  }
  if(!response.body)return response;
  const key=options.headers.Accept==='text/event-stream'?'streams':'snapshots';
  const counted=response.body.pipeThrough(new TransformStream({transform(chunk,controller){
   bytes[key]+=chunk.byteLength;
   controller.enqueue(chunk);
  }}));
  return new Response(counted,{status:response.status,headers:response.headers});
 }
 return {request,bytes,port,namespace,token:'owner',failNextClear:()=>{failClear=true;}};
}

for (const mode of ['preview', 'production']) {
test(mode + ' storage: two players, contention, reconnect and exactly-once settlement', async t => {
 const prefix=mode==='preview'?'onlineBattlePreview':'onlineBattle';
 const wallet=uid=>(mode==='preview'?'onlineBattlePreviewUsers/':'users/')+uid+'/apps/english-playroom';
 const firestore = fakeFirestore(wallet,prefix);
 const emulatorPort=process.env.MONSTUDY_RTDB_EMULATOR_PORT;
 const realtime=emulatorPort?await emulatorRealtime(emulatorPort):fakeRealtime();
 let now = 1_000_000;
 const service = createOnlineBattle({
  base, projectId, accessToken: async () => 'fixture',
  verifyUser: async req => ({uid:req.headers.authorization}),
  readJson: async req => { const parts=[]; for await (const part of req) parts.push(part); return JSON.parse(Buffer.concat(parts)); },
  send: (res, status, body) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(body)); },
  decodeFields: fields => fields.fixture,
  fetch: firestore.request, now: () => now,
  battleConfig: {base:battleBase,projectId:battleProjectId,separated:true,accessToken:async()=> 'fixture'},
  roomStore: createRealtimeRoomStore({
   databaseUrl:'http://127.0.0.1:'+(realtime.port||9000),
   accessToken:async () => realtime.token||'fixture', request:realtime.request, emulatorNamespace:realtime.namespace, mode
  })
 });
 const server = createServer((req,res) => void service.handle(req,res,req.url));
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 t.after(() => {server.closeAllConnections();server.close();});
 const origin = 'http://127.0.0.1:' + server.address().port;
 let matchId='';
 async function api(uid, operation = '', body = {}) {
  const response = await fetch(origin + roomPath + (operation ? '/' + operation : ''), {
   method:operation?'POST':'GET', headers:{Authorization:uid}, body:operation?JSON.stringify({matchId,...body}):undefined
  });
  return {status:response.status, ...await response.json()};
 }
 async function live(uid) {
  const controller = new AbortController();
  const response = await fetch(origin+roomPath+'/live',{headers:{Authorization:uid},signal:controller.signal});
  assert.equal(response.status,200);
  const events = realtimeEvents(response.body);
  return {stop:()=>controller.abort(), next:async()=> (await events.next()).value?.payload};
 }
 const outsider = await fetch(origin+roomPath+'/live',{headers:{Authorization:'c'}});
 assert.equal(outsider.status,403);
 await outsider.body.cancel();
 const joined=await api('a','join');
 assert.equal(joined.status,200,joined.error);
 assert.equal((await api('b','join')).status,200);
 assert.deepEqual(firestore.walletOperations,{reads:2,writes:0});
 const first = await live('a');
 t.after(first.stop);
 assert.equal((await first.next()).status,'waiting');
 const second = await live('b');
 t.after(second.stop);
 assert.equal((await second.next()).players[0].inventory,undefined);
 const beforeCombat = {...firestore.counts};
 await api('a','ready');
 assert.equal((await second.next()).players[0].ready,true);
 const started=await api('b','ready');
 assert.equal(started.room.status,'playing');
 matchId=started.room.matchId;
 assert.equal((await second.next()).status,'playing');
 const concurrent = await Promise.all([api('a','attack'),api('b','attack')]);
 assert.ok(concurrent.every(result=>result.status===200));
 assert.equal(new Set(concurrent.map(result=>result.room.seq)).size,2);
 assert.equal((await api('a','attack')).status,429);
 assert.deepEqual((await api('a')).room.players.map(p=>p.hp),[13,13]);
 now+=1200;
 const item = await api('a','item',{itemId:'bandage'});
 assert.equal(item.room.players[0].hp,15);
 assert.equal(item.room.players[0].inventory.bandage,1);
 now+=1200;
 const heal = await api('b','magic',{spellId:'mimuros'});
 assert.equal(heal.room.players[1].hp,15);
 assert.equal(heal.room.players[1].mp,6);
 assert.deepEqual(firestore.counts,beforeCombat);
 assert.equal(firestore.docs.get(wallet('a')).value.onlineBattleTitleStats.games,undefined);
 first.stop();second.stop();
 const reconnected = await live('a');
 t.after(reconnected.stop);
 assert.equal((await reconnected.next()).players[0].hp,15);
 reconnected.stop();
 now+=1200;
 realtime.failNextClear();
 let finished = await api('a','magic',{spellId:'mirogoro'});
 for (let attack=0;finished.room.status==='playing'&&attack<3;attack++){
  now+=1200;
  finished=await api('a','attack');
 }
 assert.equal(finished.room.winnerUid,'a');
 const results = await Promise.all([api('a'),api('a'),api('b')]);
 assert.ok(results.every(result=>result.room.status==='finished'));
 assert.ok(results[0].room.freshTitles.length>0);
 assert.equal(firestore.docs.get(wallet('a')).value.coins,1);
 assert.equal(firestore.docs.get(wallet('b')).value.coins,0);
 assert.equal(firestore.docs.get(wallet('a')).value.petDungeonItems.bandage,1);
 assert.equal(firestore.docs.get(wallet('a')).value.onlineBattleTitleStats.games,1);
 assert.deepEqual(firestore.walletOperations,{reads:4,writes:2});
 assert.deepEqual(firestore.primaryOperations,{reads:4,writes:3});
 assert.equal(firestore.docs.get(prefix+'Stats/4/players/a').value.wins,1);
 assert.ok([...firestore.docs.keys()].every(path=>path.startsWith(prefix)||path===wallet('a')||path===wallet('b')));
 if(mode==='production')assert.ok([...firestore.docs.keys()].every(path=>!path.startsWith('onlineBattlePreview')));
 const continued = await Promise.all([api('a','continue'),api('b','continue')]);
 assert.ok(continued.some(result=>result.room.status==='playing'));
 const rematch=await api('a');
 assert.notEqual(rematch.room.matchId,finished.room.matchId);
 assert.equal((await api('a','attack',{matchId:finished.room.matchId})).status,409);
 assert.equal((await api('b','leave')).room.winnerUid,'a');
 assert.equal(firestore.docs.get(wallet('a')).value.coins,2);
 assert.deepEqual(firestore.walletOperations,{reads:6,writes:4});
 assert.deepEqual(firestore.primaryOperations,{reads:6,writes:6});
 now+=ONLINE_BATTLE_JOIN_TTL_MS;
 assert.equal((await api('a')).room.status,'open');
 t.diagnostic(JSON.stringify({rtdbBodyBytes:realtime.bytes,firestoreOperations:firestore.counts}));
});
}
