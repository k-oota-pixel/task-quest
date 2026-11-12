import { randomUUID } from 'node:crypto';

const ROOM_ID = /^(?:4-(?:20|1[0-9]|[1-9])|(?:3|pre2|2)-(?:10|[1-9]))$/;
const GRADE = /^(?:4|3|pre2|2)$/;
const firebaseHost = hostname => /\.(?:firebaseio\.com|firebasedatabase\.app)$/.test(hostname);

export function createRealtimeRoomStore({ databaseUrl, accessToken, request = fetch, emulatorNamespace, mode = 'preview', namespace = 'onlineBattle' }) {
 if (mode !== 'preview' && mode !== 'production') throw new Error('Invalid realtime battle mode');
 if (!['onlineBattle', 'onlineBattleQuestions'].includes(namespace)) throw new Error('Invalid realtime battle namespace');
 const root = mode === 'production' ? namespace : namespace + 'Preview';
 const database = new URL(databaseUrl);
 if (database.pathname !== '/' || database.username || database.password || database.search || database.hash ||
     !(database.protocol === 'https:' && firebaseHost(database.hostname) ||
       database.protocol === 'http:' && database.hostname === '127.0.0.1')) {
  throw new Error('Realtime Database URL is invalid');
 }

 function url(grade, room = '') {
  if (!GRADE.test(grade) || room && !ROOM_ID.test(room)) throw new Error('Invalid battle room path');
  const target = new URL('/' + root + '/rooms/' + grade + (room ? '/' + room : '') + '.json', database);
  if (emulatorNamespace && database.hostname === '127.0.0.1') target.searchParams.set('ns', emulatorNamespace);
  return target;
 }

 async function send(target, options) {
  const config = {
   ...options,
   redirect: 'manual',
   headers: { Authorization: 'Bearer ' + await accessToken(), ...options.headers }
  };
  for (let redirects = 0; redirects < 3; redirects++) {
   const response = await request(target, config);
   if (response.status !== 307) return response;
   const location = response.headers.get('location');
   await response.body?.cancel();
   if (!location) break;
   target = new URL(location, target);
   if (target.protocol !== 'https:' || !firebaseHost(target.hostname) || target.username || target.password) break;
  }
  throw new Error('Unexpected Realtime Database redirect');
 }

 function check(response) {
  if (response.ok) return;
  throw Object.assign(new Error('対戦データを同期できませんでした。'), {
   status: response.status === 412 ? 409 : 502,
   retryable: response.status === 412
  });
 }

 async function read(id) {
  const response = await send(url(id.split('-')[0], id), {
   headers: { 'X-Firebase-ETag': 'true' },
   signal: AbortSignal.timeout(12000)
  });
  check(response);
  const updateTime = response.headers.get('etag');
  if (!updateTime) throw new Error('Realtime Database did not return an ETag');
  const payload = await response.json();
  return { value: payload === null ? null : JSON.parse(payload), updateTime };
 }

 async function write(id, room, version) {
  if (!version) throw new Error('Room writes require an ETag');
  const response = await send(url(id.split('-')[0], id), {
   method: 'PUT',
   headers: { 'Content-Type': 'application/json', 'If-Match': version },
   signal: AbortSignal.timeout(12000),
   body: JSON.stringify(JSON.stringify(room))
  });
  try { check(response); }
  finally { await response.body?.cancel(); }
 }

 async function lobby(grade, project) {
  const response = await send(url(grade), { signal: AbortSignal.timeout(12000) });
  check(response);
  const rooms = await response.json();
  return Object.fromEntries(Object.entries(rooms || {}).map(([id, payload]) => {
   const room = JSON.parse(payload);
   return ['room' + room.roomNo, project(room, id)];
  }));
 }

 function dataUrl(path) {
  const target = new URL('/' + root + '/' + path + '.json', database);
  if (emulatorNamespace && database.hostname === '127.0.0.1') target.searchParams.set('ns', emulatorNamespace);
  return target;
 }

 function gradePath(collection, grade) {
  if (!GRADE.test(grade)) throw new Error('Invalid battle grade');
  return collection + '/' + grade;
 }

 async function readData(path, conditional = true) {
  const response = await send(dataUrl(path), {
   headers: conditional ? { 'X-Firebase-ETag': 'true' } : {},
   signal: AbortSignal.timeout(12000)
  });
  check(response);
  const updateTime = response.headers.get('etag');
  if (conditional && !updateTime) throw new Error('Realtime Database did not return an ETag');
  return { value: await response.json(), updateTime };
 }

 async function writeData(path, value, version) {
  const response = await send(dataUrl(path), {
   method: 'PUT',
   headers: { 'Content-Type': 'application/json', 'If-Match': version },
   body: JSON.stringify(value),
   signal: AbortSignal.timeout(12000)
  });
  try {
   if (response.status === 412) return false;
   check(response);
   return true;
  } finally { await response.body?.cancel(); }
 }

 async function saveStanding(grade, standing, firstAnswers){
  const key = Buffer.from(standing.uid, 'utf8').toString('base64url');
  const path = gradePath('standings', grade) + '/' + key;
  for (let attempt = 0; attempt < 5; attempt++) {
   const current = await readData(path);
   // Match counts already provide the same idempotency guard as the original
   // standings code, including after a Firestore settlement retry.
   if (current.value?.games >= standing.games) return;
   const prior = current.value?.questionFirst;
   const outcomes = prior && typeof prior === 'object' ? {...prior} : {};
   if (firstAnswers && typeof firstAnswers === 'object') {
    for (const [id, value] of Object.entries(firstAnswers)) {
     if (!Object.hasOwn(outcomes, id) && (value === 0 || value === 1)) outcomes[id] = value;
    }
   }
   const next = { ...standing, ...(firstAnswers || prior ? {questionFirst:outcomes} : {}) };
   if (await writeData(path, next, current.updateTime)) return;
  }
  throw Object.assign(new Error('対戦成績を同期できませんでした。'), { status: 503 });
 }

 async function listStandings(grade) {
  const { value } = await readData(gradePath('standings', grade), false);
  return Object.values(value || {});
 }

 const readRanking = grade => readData(gradePath('rankings', grade));
 const writeRanking = (grade, ranking, version) => writeData(gradePath('rankings', grade), ranking, version);

 async function verifyConnection() {
  const nonce = randomUUID();
  const target = dataUrl('connectionChecks/' + nonce);
  const operation = (method, headers = {}, body) => send(target, {
   method, headers, body, signal: AbortSignal.timeout(12000)
  });
  try {
   const written = await operation('PUT', {
    'Content-Type': 'application/json', 'If-Match': 'null_etag'
   }, JSON.stringify(nonce));
   try { check(written); } finally { await written.body?.cancel(); }
   const read = await operation('GET');
   check(read);
   if (await read.json() !== nonce) throw new Error('Realtime Database connection check returned unexpected data');
  } finally {
   const deleted = await operation('DELETE');
   try { check(deleted); } finally { await deleted.body?.cancel(); }
  }
 }

 async function stream(id, downstream, project) {
  const controller = new AbortController();
  const close = () => controller.abort();
  downstream.once('close', close);
  const timeout = setTimeout(close, 60_000);
  try {
   const upstream = await send(url(id.split('-')[0], id), {
    headers: { Accept: 'text/event-stream' },
    signal: controller.signal
   });
   check(upstream);
   downstream.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform'
   });
   downstream.flushHeaders();
   for await (const event of realtimeEvents(upstream.body)) {
    if (event.type === 'cancel' || event.type === 'auth_revoked') break;
    if (event.type !== 'put' || event.payload.path !== '/') continue;
    const room = await project(event.payload.data === null ? null : JSON.parse(event.payload.data));
    // Close instead of buffering an unbounded queue for a slow connection.
    if (!downstream.write('event: room\ndata: ' + JSON.stringify(room) + '\n\n') || !room.players.length) break;
   }
  } catch (error) {
   if (!downstream.headersSent && !downstream.destroyed) throw error;
  } finally {
   clearTimeout(timeout);
   controller.abort();
   downstream.removeListener('close', close);
   if (!downstream.writableEnded && !downstream.destroyed && downstream.headersSent) downstream.end();
  }
 }


 // Stream one grade's room list rather than polling every five seconds. Firebase
 // sends an initial root snapshot, then child put/patch events for changed rooms.
 async function streamLobby(grade, downstream, project) {
  if (!GRADE.test(grade)) throw new Error('Invalid battle grade');
  const controller = new AbortController();
  const close = () => controller.abort();
  downstream.once('close', close);
  const timeout = setTimeout(close, 60_000);
  let rooms = Object.create(null);
  try {
   const upstream = await send(url(grade), {
    headers: { Accept: 'text/event-stream' },
    signal: controller.signal
   });
   check(upstream);
   downstream.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform'
   });
   downstream.flushHeaders();
   for await (const event of realtimeEvents(upstream.body)) {
    if (event.type === 'cancel' || event.type === 'auth_revoked') break;
    if (!['put', 'patch'].includes(event.type)) continue;
    const path = event.payload?.path;
    const value = event.payload?.data;
    if (typeof path !== 'string') continue;
    if (path === '/') {
     if (event.type === 'put') rooms = value && typeof value === 'object' ? {...value} : Object.create(null);
     else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
       if (item === null) delete rooms[key];
       else rooms[key] = item;
      }
     }
    } else {
     const key = path.slice(1);
     // Each room is stored as one serialized JSON string, not nested fields.
     if (!ROOM_ID.test(key) || !key.startsWith(grade + '-')) continue;
     if (value === null) delete rooms[key];
     else rooms[key] = value;
    }
    const data = project(rooms);
    if (!downstream.write('event: lobby\ndata: ' + JSON.stringify(data) + '\n\n')) break;
   }
  } catch (error) {
   if (!downstream.headersSent && !downstream.destroyed) throw error;
  } finally {
   clearTimeout(timeout);
   controller.abort();
   downstream.removeListener('close', close);
   if (!downstream.writableEnded && !downstream.destroyed && downstream.headersSent) downstream.end();
  }
 }

 return { mode, read, write, lobby, stream, streamLobby, verifyConnection, saveStanding, listStandings, readRanking, writeRanking };
}

export async function* realtimeEvents(body) {
 const decoder = new TextDecoder();
 let buffer = '';
 for await (const chunk of body) {
  buffer += decoder.decode(chunk, { stream: true });
  let boundary;
  while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
   const frame = buffer.slice(0, boundary.index);
   buffer = buffer.slice(boundary.index + boundary[0].length);
   const lines = frame.split(/\r?\n/);
   const type = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
   const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
   if (data && type) yield { type, payload: JSON.parse(data) };
  }
  if (buffer.length > 256_000) throw new Error('Realtime Database event exceeded the size limit');
 }
}
