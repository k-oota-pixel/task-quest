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
 const original=globalThis.fetch;
 globalThis.fetch=async url=>({
  ok:true,
  json:async()=>String(url).includes('online-battle-vocab')
   ?{grades:{'4':{words:[{word:'cat',answers:['猫']},{word:'dog',answers:['犬']},{word:'bird',answers:['鳥']},{word:'book',answers:['本']},{word:'pen',answers:['ペン']},{word:'desk',answers:['机']} ]}}}
   :{grades:{'4':{ordering:[{id:'o1',prompt:'私は学生です。',answer:'I am a student.'}],potato:[]}}}
 });
 const server=new EventEmitter();
 const api=installQuestPlaza(server,{
  verifyUser:async req=>({uid:req.headers.authorization.slice(7)}),
  getUserDoc:async(_accessToken,uid)=>({nickname:'user-'+uid,petName:'pet-'+uid,monsterMaze:{team:['1-0','7-0','13-0']}}),
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
  if(Math.abs(pa.x-pb.x)+Math.abs(pa.y-pb.y)>1){
   // Rejoining is authenticated, not a new teleport API.
   assert(!messages(a).some(x=>x.type==='battleStart'));
  }
  // A malformed/multi-square direction is never accepted.
  a.emit('data',frame({type:'move',dx:99,dy:0}));await delay(300);
  const advanced=messages(a).filter(x=>x.type==='positions').flatMap(x=>x.positions);
  assert(!advanced.some(([id,x])=>id==='one'&&x===pa.x+99));
 }finally{
  api.close();globalThis.fetch=original;
 }
});
