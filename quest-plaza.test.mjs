import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installQuestPlaza} from './quest-plaza.mjs';

class FakeSocket extends EventEmitter{
 constructor(){super();this.destroyed=false;this.writableLength=0;this.writes=[];}
 write(chunk){this.writes.push(Buffer.from(chunk));return true;}
 destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('close');}
}
function frame(message){
 const data=Buffer.from(JSON.stringify(message)),head=Buffer.alloc(data.length<126?6:8);
 head[0]=129;if(data.length<126)head[1]=128|data.length;
 else{head[1]=254;head.writeUInt16BE(data.length,2);}
 const at=data.length<126?2:4;
 for(let i=0;i<4;i++)head[at+i]=i+1;
 const body=Buffer.from(data);for(let i=0;i<data.length;i++)body[i]^=head[at+i%4];
 return Buffer.concat([head,body]);
}
function messages(socket){
 const result=[];
 for(const b of socket.writes){
  if(b.toString('ascii',0,4)==='HTTP')continue;
  const size=b[1]&127,at=size===126?4:2;
  if(b[0]===129)try{result.push(JSON.parse(b.subarray(at).toString('utf8')));}catch{}
 }
 return result;
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const token=uid=>({url:'/ws/quest-plaza',headers:{origin:'https://k-oota-pixel.github.io',upgrade:'websocket','sec-websocket-key':'MTIzNDU2Nzg5MDEyMzQ1Ng==' }});
test('Authenticated 4-direction plaza, request/accept, and incorrect-answer 10% damage',async()=>{
 const original=globalThis.fetch,originalRandom=Math.random;
 Math.random=()=>.1;
 globalThis.fetch=async url=>({
  ok:true,
  json:async()=>String(url).includes('online-battle-vocab')
   ?{grades:{'4':{words:[{word:'cat',answers:['猫']},{word:'dog',answers:['犬']},{word:'bird',answers:['鳥']},{word:'book',answers:['本']},{word:'pen',answers:['ペン']},{word:'desk',answers:['机']} ]}}}
   :{grades:{'4':{ordering:[{id:'o1',prompt:'私は学生です。',answer:'I am a student.'}],potato:[]}}}
 });
 const server=new EventEmitter();
 const api=installQuestPlaza(server,{
  verifyUser:async req=>({uid:req.headers.authorization.slice(7)}),
  getUserDoc:async(_accessToken,uid)=>({nickname:'user-'+uid,petName:'pet-'+uid,
   petStrengthLevelPoints:45,petStrength:{mp:30},monsterMaze:{team:['1-0','7-0','13-3'],owned:{'13-3':{level:1}}}}),
  getGoogleAccessToken:async()=>'access',
  grantCoins:async()=>0,originAllowed:()=>true
 });
 const join=async uid=>{
  const socket=new FakeSocket();server.emit('upgrade',token(uid),socket,Buffer.alloc(0));
  socket.emit('data',frame({type:'auth',token:uid}));await delay(20);
  assert(messages(socket).some(x=>x.type==='welcome'));
  return socket;
 };
 try{
  const a=await join('one'),b=await join('two');
  assert.equal(api.connectedCount(),2);
  const views=messages(b).find(x=>x.type==='welcome').players;
  assert.equal(views.length,2);
  // Move to adjacent cells using a legal one-tile update (the server owns positions).
  // The test does not trust remote arbitrary teleport coordinates.
  const pa=views.find(p=>p.id==='one'),pb=views.find(p=>p.id==='two');
  assert(Math.abs(pa.x-pb.x)+Math.abs(pa.y-pb.y)<=1);
  // A malformed/multi-square direction is never accepted.
  a.emit('data',frame({type:'move',dx:99,dy:0}));await delay(300);
  const advanced=messages(a).filter(x=>x.type==='positions').flatMap(x=>x.positions);
  assert(!advanced.some(([id,x])=>id==='one'&&x===pa.x+99));
  a.emit('data',frame({type:'invite',to:'two',grade:'4'}));
  await delay(25);
  assert(messages(b).some(x=>x.type==='invite'&&x.grade==='4'));
  b.emit('data',frame({type:'respond',from:'one',accept:true}));
  await delay(75);
  assert(messages(a).some(x=>x.type==='battleStart'));
  assert(messages(b).some(x=>x.type==='battleStart'));
  const question=messages(a).filter(x=>x.type==='question').at(-1);
  const before=messages(a).filter(x=>x.type==='battleState').at(-1).teams.find(t=>t.id==='one');
  assert(question?.seq);
  a.emit('data',frame({type:'answer',seq:question.seq,value:'absolutely-wrong',action:{kind:'attack'}}));
  await delay(25);
  const after=messages(a).filter(x=>x.type==='battleState').at(-1).teams.find(t=>t.id==='one');
  for(let i=0;i<before.units.length;i++){
   const old=before.units[i],newUnit=after.units[i];
   assert.equal(newUnit.hp,Math.max(0,old.hp-Math.max(1,Math.ceil(old.maxHp*.1))));
  }
  // The client's action visuals are server-confirmed, not client-invented.
  assert(messages(a).some(x=>x.type==='battleActions'&&x.events.some(e=>e.kind==='mistake')));
  const meanings={cat:'猫',dog:'犬',bird:'鳥',book:'本',pen:'ペン',desk:'机'};
  const correctFor=q=>{
   if(q.kind==='ordering')return 'I am a student.';
   const prompt=q.prompt||'';
   const ja=prompt.slice(prompt.lastIndexOf('：')+1).trim();
   if(prompt.includes('次の日本語'))return Object.keys(meanings).find(k=>meanings[k]===ja);
   return meanings[prompt.split(' ').at(-1)];
  };
  // Repeated correct attacks drop ONE companion; the caster remains alive.
  for(let turn=0;turn<6;turn++){
   const current=messages(a).filter(x=>x.type==='battleState').at(-1).teams.find(t=>t.id==='one');
   if(current.units[3].hp===0)break;
   const bQuestion=messages(b).filter(x=>x.type==='question').at(-1);
   assert(correctFor(bQuestion),'test question must be solvable');
   b.emit('data',frame({type:'answer',seq:bQuestion.seq,value:correctFor(bQuestion),
     action:{kind:'attack',target:3}}));
   await delay(12);
  }
  const preRevive=messages(a).filter(x=>x.type==='battleState').at(-1).teams.find(t=>t.id==='one');
  assert.equal(preRevive.units[3].hp,0);
  const aQuestion=messages(a).filter(x=>x.type==='question').at(-1);
  a.emit('data',frame({type:'answer',seq:aQuestion.seq,value:correctFor(aQuestion),
    action:{kind:'magic',owner:0,spell:'meinoora',reviveTarget:3}}));
  await delay(20);
  const revived=messages(a).filter(x=>x.type==='battleState').at(-1).teams.find(t=>t.id==='one');
  assert(revived.units[3].hp>=Math.floor(revived.units[3].maxHp*.65));
  assert(revived.units[3].hp<=Math.ceil(revived.units[3].maxHp*.80));
  assert(messages(a).some(x=>x.type==='battleActions'&&x.events.some(e=>e.kind==='revive'&&e.targetIndex===3)));
  const enemyAttacks=messages(a).filter(x=>x.type==='battleActions')
    .flatMap(x=>x.events).filter(x=>x.actor==='two'&&x.kind==='physical');
  assert(enemyAttacks.some(e=>e.sourceIndex===0),'enemy pet attack must animate from pet');
  assert(enemyAttacks.some(e=>e.sourceIndex===1),'enemy physical ally attack must animate from ally');
  // The pet can also die and be revived by an SSR healer: this is the
  // reported UI/server mismatch that previously said '蘇生対象なし'.
  for(let i=0;i<4;i++){
   const state=messages(a).filter(x=>x.type==='battleState').at(-1).teams.find(t=>t.id==='one');
   if(state.units[0].hp===0)break;
   const currentQ=messages(b).filter(x=>x.type==='question').at(-1);
   b.emit('data',frame({type:'answer',seq:currentQ.seq,value:correctFor(currentQ),
     action:{kind:'attack',target:0}}));
   await delay(15);
  }
  const deadPet=messages(a).filter(x=>x.type==='battleState').at(-1).teams.find(t=>t.id==='one');
  assert.equal(deadPet.units[0].hp,0);
  assert(deadPet.units[3].hp>0,'SSR healer must still be alive');
  const attackerQ=messages(a).filter(x=>x.type==='question').at(-1);
  a.emit('data',frame({type:'answer',seq:attackerQ.seq,value:correctFor(attackerQ),
    action:{kind:'attack'}}));
  await delay(20);
  const allyAttack=messages(a).filter(x=>x.type==='battleActions').at(-1).events;
  assert(allyAttack.some(e=>e.actor==='one'&&e.sourceIndex===1&&e.kind==='physical'),
    'living ally should fire its own physical energy');
  assert(!allyAttack.some(e=>e.actor==='one'&&e.sourceIndex===0&&e.kind==='physical'),
    'a defeated pet cannot launch an energy attack');
  const revivePetQuestion=messages(a).filter(x=>x.type==='question').at(-1);
  a.emit('data',frame({type:'answer',seq:revivePetQuestion.seq,value:correctFor(revivePetQuestion),
    action:{kind:'magic',owner:3,spell:'meinoora',reviveTarget:0}}));
  await delay(20);
  const petResurrected=messages(a).filter(x=>x.type==='battleState').at(-1).teams.find(t=>t.id==='one');
  assert(petResurrected.units[0].hp>=Math.floor(petResurrected.units[0].maxHp*.65));
  assert(petResurrected.units[0].hp<=Math.ceil(petResurrected.units[0].maxHp*.80));
  assert(messages(a).filter(x=>x.type==='battleActions').at(-1).events
    .some(e=>e.kind==='revive'&&e.sourceIndex===3&&e.targetIndex===0));
  a.emit('data',frame({type:'forfeit'}));
  await delay(20);
  assert.equal(messages(a).filter(x=>x.type==='battleEnd').at(-1).winner,'two');
  assert.equal(messages(b).filter(x=>x.type==='battleEnd').at(-1).winner,'two');

 }finally{
  api.close();globalThis.fetch=original;Math.random=originalRandom;
 }
});


test('Ally Mirogoron remains responsive without question or match timers, and stale answers resync',async()=>{
 const originalFetch=globalThis.fetch,originalRandom=Math.random,originalNow=Date.now;
 Math.random=()=>.1;
 const dictionary={cat:'猫',dog:'犬',bird:'鳥',book:'本',pen:'ペン',desk:'机'};
 globalThis.fetch=async()=>({ok:true,json:async()=>({grades:{'4':{words:Object.entries(dictionary)
  .map(([word,japanese])=>({word,answers:[japanese]}))}}})});
 const server=new EventEmitter();
 const api=installQuestPlaza(server,{
  verifyUser:async req=>({uid:req.headers.authorization.slice(7)}),
  getUserDoc:async(_token,uid)=>({
   nickname:uid,petName:uid,petStrengthLevelPoints:45,petStrength:{mp:40},
   monsterMaze:{team:['1-0','7-3','13-3'],owned:{'7-3':{level:1},'13-3':{level:1}}}
  }),getGoogleAccessToken:async()=>'test',grantCoins:async()=>0,originAllowed:()=>true
 });
 const join=async uid=>{
  const sock=new FakeSocket();
  server.emit('upgrade',token(uid),sock,Buffer.alloc(0));
  sock.emit('data',frame({type:'auth',token:uid}));
  await delay(20);
  assert(messages(sock).some(m=>m.type==='welcome'));
  return sock;
 };
 try{
  const a=await join('caster'),b=await join('opponent');
  a.emit('data',frame({type:'invite',to:'opponent',grade:'4'}));
  await delay(20);
  b.emit('data',frame({type:'respond',from:'caster',accept:true}));
  await delay(60);
  const q=messages(a).filter(m=>m.type==='question').at(-1);
  assert(q?.seq,'question was served');
  assert.equal('deadline' in q,false,'question has no timer');
  const initial=messages(a).filter(m=>m.type==='battleState').at(-1);
  assert(initial&&!('remaining' in initial),'battle has no five-minute clock');
  const ally=initial.teams.find(t=>t.id==='caster').units[2];
  assert(ally.hp>0&&ally.maxMp>=14);
  const correct=q.prompt.startsWith('次の日本語を英語に：')
   ? Object.keys(dictionary).find(w=>dictionary[w]===q.prompt.split('：')[1])
   : dictionary[q.prompt.split(' ').at(-1)];
  assert(q.options.includes(correct),'correct answer is among options');
  // The clock advances by twenty minutes, but there is no timeout or penalty.
  Date.now=()=>originalNow()+20*60*1000;
  a.emit('data',frame({type:'answer',seq:q.seq,value:correct,
   action:{kind:'magic',owner:2,spell:'mirogoron',target:0}}));
  Date.now=originalNow;
  await delay(30);
  const feedback=messages(a).filter(m=>m.type==='feedback').at(-1);
  assert.equal(feedback?.correct,true,'no forced wrong answer after elapsed time');
  const after=messages(a).filter(m=>m.type==='battleState').at(-1).teams.find(t=>t.id==='caster');
  assert.equal(after.units[2].mp,ally.mp-14,'Mirogoron spends exactly 14MP');
  assert(messages(a).some(m=>m.type==='battleActions'&&
    m.events.some(e=>e.kind==='magic'&&e.sourceIndex===2)));
  const following=messages(a).filter(m=>m.type==='question').at(-1);
  assert(following.seq>q.seq,'next question arrives after ally attack');
  // A late/duplicate answer is answered with the authoritative current question.
  const priorCount=messages(a).filter(m=>m.type==='question').length;
  a.emit('data',frame({type:'answer',seq:q.seq,value:correct,
   action:{kind:'magic',owner:2,spell:'mirogoron'}}));
  await delay(15);
  const resent=messages(a).filter(m=>m.type==='question');
  assert.equal(resent.length,priorCount+1);
  assert.equal(resent.at(-1).seq,following.seq);
  a.emit('data',frame({type:'syncQuestion'}));
  await delay(15);
  assert.equal(messages(a).filter(m=>m.type==='question').at(-1).seq,following.seq);
  const afterStale=messages(a).filter(m=>m.type==='battleState').at(-1).teams.find(t=>t.id==='caster');
  assert.equal(afterStale.units[2].mp,ally.mp-14,'duplicate answer does not double spend');
 }finally{
  api.close();globalThis.fetch=originalFetch;Math.random=originalRandom;Date.now=originalNow;
 }
});
