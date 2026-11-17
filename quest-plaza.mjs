import {createHash,randomUUID} from 'node:crypto';

// WebSocket transport for the optional, unlinked Monster Quest plaza.
// No npm dependency, no URL credentials, no Firestore polling for movement.
const WIDTH=48,HEIGHT=32,MAX_PLAYERS=40,MOVE_MS=240,INVITE_MS=10000,BATTLE_MS=300000;
const allowedGrades=new Set(['4','3','pre2','2']);
const spellList=[
 {id:'mimuros',name:'ミムロス',level:5,kind:'heal',mp:4,base:10},
 {id:'mirogoro',name:'ミロゴロ',level:15,kind:'attack',mp:6,base:15},
 {id:'mimurose',name:'ミムローズ',level:25,kind:'heal',mp:10,base:30},
 {id:'mirogoron',name:'ミロゴロン',level:35,kind:'attack',mp:14,base:30},
 {id:'meinon',name:'メイノン',level:30,kind:'revive',mp:8,rate:.5,range:[25,35]},
 {id:'meinoora',name:'メイノーラ',level:45,kind:'revive',mp:20,rate:1,range:[65,80]}
];

const battleItems=Object.freeze([
 {id:'bandage',name:'ばんそうこう',kind:'hp',amount:10},
 {id:'medicine',name:'きずぐすり',kind:'hp',amount:20},
 {id:'date-hospital-prescription',name:'伊達医院の処方箋',kind:'hp',amount:100},
 {id:'inter-prescription',name:'インターの処方箋',kind:'hp',amount:100},
 {id:'date-water',name:'だてのみず',kind:'mp',amount:10},
 {id:'yoteizan-water',name:'ようていざんのみず',kind:'mp',amount:20}
]);
const inventoryFrom=data=>Object.fromEntries(battleItems.map(item=>[item.id,int(data?.petDungeonItems?.[item.id],0,100000)]));

const cards=[
 ['鉄甲ガメル',0,6,'guard'],['紅蓮フォクス',0,5,'physical'],['岩王ゴロン',0,7,'physicalAll'],
 ['トゲマル',0,4,'physical'],['シザーク',0,5,'physical'],['獅子王レオン',0,7,'physicalAll'],
 ['フレアンド',1,6,'magicAll'],['クリオペン',1,5,'magic'],['ライコ',1,6,'magicAll'],
 ['ヨルフクロウ',1,5,'magic'],['スタークラゲ',1,7,'magicAll'],['ミラーモン',1,4,'magic'],
 ['森のフィリア',2,7,'heal'],['ミツビー',2,4,'heal'],['シロツル',2,8,'heal'],
 ['ポポタン',2,5,'heal'],['ネムヒツジ',2,6,'heal'],['ユキウサ',2,5,'heal']
];
const sourceBase='https://raw.githubusercontent.com/k-oota-pixel/english-playroom/main/';
const cleanName=(value,fallback)=>String(value||fallback).normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,20)||fallback;
const int=(n,min,max)=>Number.isSafeInteger(Number(n))?Math.max(min,Math.min(max,Number(n))):min;
const randomItem=values=>values[Math.floor(Math.random()*values.length)];
const shuffled=values=>[...values].sort(()=>Math.random()-.5);
const normalizeAnswer=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[.!?,！？。、\s’]/g,'').replace(/'/g,'');
const blocked=(x,y)=>x<0||y<0||x>=WIDTH||y>=HEIGHT||(x>=22&&x<=25&&y>=14&&y<=17)
  ||((x<4||x>43)&&(y<3||y>28));
function starterRoster(data){
 const base=data.petBaseStats||{},allocated=data.petStrength||{},growth=data.petHatched&&data.petAdult!==false;
 const ages=int(data.petLifeDays,0,3650),age=[5,10,15,20,25,30,35],g={hp:growth?2:0,mp:growth?2:0,attack:growth?1:0};
 if(growth)for(const day of age)if(ages>=day){g.hp+=day%10===0?3:2;g.mp+=day%10===0?3:2;g.attack+=day%10===0?2:1;}
 const stat=(key,min)=>int(base[key],min,min+5)+Math.max(0,int(allocated[key],0,10000))*(key==='hp'?2:1)+(g[key]||0);
 const pet={name:cleanName(data.petName,'ぺっと'),role:-1,level:1+Math.max(int(data.petStrengthLevelPoints,0,10000),Object.values(allocated).reduce((n,v)=>n+int(v,0,10000),0)),
  maxHp:stat('hp',10),maxMp:stat('mp',6),physical:stat('attack',1),rarity:0};
 pet.hp=pet.maxHp;pet.mp=pet.maxMp;
 const profile=data.monsterMaze||{},owned=profile.owned||{},starter=['1-0','7-0','13-0'];
 const selected=(Array.isArray(profile.team)&&profile.team.length===3?profile.team:starter)
   .filter((key,i,values)=>typeof key==='string'&&values.indexOf(key)===i&&((owned[key]&&typeof owned[key]==='object')||starter.includes(key))).slice(0,3);
 for(const key of starter)if(selected.length<3&&!selected.includes(key))selected.push(key);
 const team=selected.map(key=>{
  const match=String(key).match(/^(\d{1,2})-([0-3])$/);
  if(!match)return null;
  const id=Number(match[1]),rarity=Number(match[2]),card=cards[id-1];
  if(!card)return null;
  const role=card[1],level=int(owned[key]?.level,1,[20,30,50,70][rarity]);
  const scale=1+(level-1)*.045+rarity*.17;
  const [hp,physical,magic,heal]=[[104,22,11,9],[79,10,24,10],[86,8,12,20]][role];
  const unit={name:card[0],key,id,role,rarity,level,skill:card[0],effect:card[3],
   maxHp:Math.round((hp+(id%6)*3)*scale*[.60,.57,.55,.52][rarity]),
   maxMp:role===0?0:[18,36,64,94][rarity]+Math.floor((level-1)/3),
   physical:Math.round((physical+id%3)*scale),magic:Math.round((magic+(id+1)%3)*scale),
   heal:Math.round((heal+id%2)*scale),maxCt:Math.max(1,card[2]-(rarity===3?1:0))};
  unit.hp=unit.maxHp;unit.mp=unit.maxMp;unit.ct=unit.maxCt;return unit;
 }).filter(Boolean);
 return [pet,...team];
}
function spellLearned(unit,spell){
 if(!unit||!spell)return false;
 if(unit.role===-1)return unit.level>=spell.level;
 if(unit.role===0)return false;
 if(unit.role===1)return ['mirogoro',...(unit.rarity>=2?['mirogoron']:[])].includes(spell.id);
 return ['mimuros',...(unit.rarity>=2?['mimurose','meinon']:[]),...(unit.rarity>=3?['meinoora']:[])].includes(spell.id);
}
function spellAllowed(unit,spell){
 return !!unit&&unit.hp>0&&unit.mp>=spell.mp&&spellLearned(unit,spell);
}
function wsFrame(op,payload=''){
 const data=Buffer.isBuffer(payload)?payload:Buffer.from(payload);
 const length=data.length,extra=length<126?0:length<=65535?2:8;
 const head=Buffer.alloc(2+extra);head[0]=128|op;head[1]=length<126?length:length<=65535?126:127;
 if(extra===2)head.writeUInt16BE(length,2);if(extra===8)head.writeBigUInt64BE(BigInt(length),2);
 return Buffer.concat([head,data]);
}
function sendSocket(client,message){
 if(!client?.socket||client.socket.destroyed||client.socket.writableLength>256000)return false;
 try{client.socket.write(wsFrame(1,JSON.stringify(message)));return true;}catch{return false;}
}
export function installQuestPlaza(server,{verifyUser,getUserDoc,getGoogleAccessToken,grantCoins,consumeItem=async()=>{throw Error('アイテム連携が未設定です。');},originAllowed}){
 const clients=new Map(),battles=new Map(),moves=new Map(),recentRewards=new Map(),sockets=new Set();
 let bankCache=null,bankPending=null,bankCachedAt=0;
 const send=(p,obj)=>sendSocket(p?.connection,obj);
 const publish=obj=>{for(const p of clients.values())if(p.connection)send(p,obj);};
 const view=p=>({id:p.uid,nickname:p.nickname,petName:p.petName,appearance:p.appearance,hatched:p.hatched,adult:p.adult,shop:p.shop,x:p.x,y:p.y,status:p.battle?'battle':'plaza'});
 const recordMove=p=>moves.set(p.uid,[p.uid,p.x,p.y]);
 const closeConnection=(connection,code=1000)=>{
  if(!connection||connection.socket.destroyed)return;
  try{connection.socket.write(wsFrame(8,Buffer.from([code>>8,code&255])));}catch{}
  connection.socket.destroy();
 };
 function cleanupPlayer(p){
  if(!p||p.connection||p.battle)return;
  if(p.invite)cancelInvite(p.invite,'相手が広場から退出しました。');
  if(p.incoming)cancelInvite(p.incoming,'相手が広場から退出しました。');
  if(clients.get(p.uid)===p){clients.delete(p.uid);publish({type:'left',id:p.uid});}
 }
 function cancelInvite(invite,message){
  if(!invite||invite.closed)return;
  invite.closed=true;
  if(invite.from.invite===invite)invite.from.invite=null;
  if(invite.to.incoming===invite)invite.to.incoming=null;
  if(message){send(invite.from,{type:'notice',message});send(invite.to,{type:'notice',message});}
 }
 async function loadBanks(){
  if(bankCache&&Date.now()-bankCachedAt<3600000)return bankCache;
  if(bankPending)return bankPending;
  bankPending=(async()=>{
   const urls=['pet-adventure/online-battle-vocab.json','monster-maze/supplemental-question-bank.json'];
   const rows=await Promise.all(urls.map(async path=>{
    const r=await fetch(sourceBase+path,{signal:AbortSignal.timeout(18000)});
    if(!r.ok)throw Error('英語問題データを取得できませんでした。');
    return r.json();
   }));
   bankCache={vocab:rows[0].grades||{},supp:rows[1].grades||{}};
   bankCachedAt=Date.now();return bankCache;
  })().finally(()=>{bankPending=null;});
  return bankPending;
 }
 function nextQuestion(p){
  if(!p.battle)return;
  const bank=bankCache;
  if(!bank)throw Error('問題データの読み込みが必要です。');
  const grade=p.battle.grade,vocab=bank.vocab[grade]?.words||[],extra=bank.supp[grade]||{};
  const kinds=['vocab'];
  if((extra.ordering||[]).length)kinds.push('ordering');
  if((extra.potato||[]).length)kinds.push('potato');
  let q=null;
  for(let attempts=0;attempts<10&&!q;attempts++){
   const type=randomItem(kinds);
   if(type==='vocab'&&vocab.length>=5){
    const rows=vocab.filter(r=>r.word&&r.answers?.[0]);
    const row=randomItem(rows.filter(r=>r.word!==p.lastWord).length?rows.filter(r=>r.word!==p.lastWord):rows);
    if(!row)continue;
    const reverse=Math.random()<.5,answer=reverse?row.word:row.answers[0];
    const others=shuffled([...new Set(rows.filter(r=>r.word!==row.word&&r.answers[0]!==row.answers[0])
      .map(r=>reverse?r.word:r.answers[0]))].filter(v=>normalizeAnswer(v)!==normalizeAnswer(answer))).slice(0,3);
    if(others.length!==3)continue;
    p.lastWord=row.word;
    q={type:'choice',label:'単語',prompt:reverse?'次の日本語を英語に：'+row.answers[0]:'次の単語の意味は？ '+row.word,answer,options:shuffled([answer,...others]),seconds:15};
   }else if(type==='ordering'){
    const item=randomItem(extra.ordering);if(!item?.answer)continue;
    const tokens=item.answer.match(/[A-Za-z]+(?:[-'’][A-Za-z]+)*|\d+(?:st|nd|rd|th)?/g)||[];
    if(tokens.length<2||tokens.length>25)continue;
    const choices=shuffled(tokens.map((v,i)=>({id:i,text:v.toLowerCase()})));
    q={type:'ordering',label:'並べ替え',prompt:item.prompt,answer:item.answer,accepted:item.acceptedAnswers||[],tokens:choices,seconds:Math.min(75,Math.max(40,tokens.length*4))};
   }else if(type==='potato'){
    const item=randomItem(extra.potato);
    if(!item?.answer||!Array.isArray(item.options)||item.options.length<2)continue;
    q={type:'choice',label:'ポテトマン',prompt:item.prompt,answer:item.answer,options:shuffled(item.options),seconds:25};
   }
  }
  if(!q)throw Error('選択された級の問題を生成できませんでした。');
  q.seq=(p.questionSeq||0)+1;p.questionSeq=q.seq;p.question=q;
  q.deadline=Date.now()+q.seconds*1000;
  send(p,{type:'question',seq:q.seq,kind:q.type,label:q.label,prompt:q.prompt,options:q.options,tokens:q.tokens,deadline:q.deadline});
 }
 const alive=team=>team.some(unit=>unit.hp>0);
 const target=team=>team.findIndex(unit=>unit.hp>0);
 const fightState=b=>({
  type:'battleState',id:b.id,grade:b.grade,remaining:Math.max(0,b.deadline-Date.now()),
  teams:[b.a,b.b].map(p=>({id:p.uid,nickname:p.nickname,units:p.units.map(({name,hp,maxHp,mp,maxMp,role,id,rarity,key,ct,level})=>({name,hp,maxHp,mp,maxMp,role,id,rarity,key,ct,level}))})),
  log:b.log.slice(-6)
 });
 const notifyFight=b=>{const state=fightState(b);send(b.a,{...state,inventory:b.a.inventory||{}});send(b.b,{...state,inventory:b.b.inventory||{}});};
 async function endBattle(b,winner=null,reason='対戦終了'){
  if(!b||b.ended)return;
  b.ended=true;battles.delete(b.id);
  b.a.battle=null;b.b.battle=null;
  b.log.push(reason);
  notifyFight(b);
  for(const p of [b.a,b.b]){send(p,{type:'battleEnd',winner:winner?.uid||null,reason});}
  publish({type:'statuses',players:[view(b.a),view(b.b)]});
  if(winner){
   const loser=winner===b.a?b.b:b.a;
   const key=[winner.uid,loser.uid].sort().join('|');
   if(Date.now()-(recentRewards.get(key)||0)<600000){
    send(winner,{type:'notice',message:'同じ相手との短時間の再戦はコイン報酬なしです。'});
    return;
   }
   recentRewards.set(key,Date.now());
   try{
    await grantCoins(await getGoogleAccessToken(),winner.uid,1);
    send(winner,{type:'notice',message:'勝利報酬：1コイン獲得！'});
   }catch(error){console.error('quest_plaza_coin_grant_failed',error?.message);send(winner,{type:'notice',message:'勝利報酬の保存に失敗しました。管理者にお知らせください。'});}
  }
 }
 function applyAnswer(p,answer){
  const b=p.battle,q=p.question;
  if(!b||!q||b.ended||answer.seq!==q.seq)return;
  p.question=null;
  const correct=Date.now()<=q.deadline&&
   (q.type==='ordering'?[q.answer,...q.accepted].some(v=>normalizeAnswer(v)===normalizeAnswer(answer.value))
    :normalizeAnswer(answer.value)===normalizeAnswer(q.answer));
  const enemy=p===b.a?b.b:b.a;
  for(const unit of p.units.slice(1))unit.ct=Math.max(0,unit.ct-(correct?1:.5));
  if(!correct){
   for(const unit of p.units)if(unit.hp>0)unit.hp=Math.max(0,unit.hp-Math.max(1,Math.ceil(unit.maxHp*.1)));
   b.log.push(p.nickname+'：誤答・味方全員に10％ダメージ');
  }else{
   const action=answer.action||{},enemyUnits=enemy.units;
   let battleFx=null;
   const selectedIndex=Number.isInteger(action.target)&&enemyUnits[action.target]?.hp>0?action.target:target(enemyUnits);
   const receive=(index,amount)=>{
    const victim=enemyUnits[index];if(!victim||victim.hp<=0)return;
    const guard=enemy.guard?.turns>0?enemy.guard.ratio:0;
    victim.hp=Math.max(0,victim.hp-Math.max(1,Math.round(amount*(1-guard))));
   };
   const hit=(power,idx=selectedIndex)=>receive(idx,power);
   if(action.kind==='magic'){
    const ownerIndex=int(action.owner,0,3);
    const owner=p.units[ownerIndex],spell=spellList.find(s=>s.id===action.spell);
    const reviveIndex=Number.isInteger(action.reviveTarget)&&action.reviveTarget>0&&p.units[action.reviveTarget]?.hp===0
      ?action.reviveTarget:p.units.findIndex((u,i)=>i>0&&u.hp===0);
    // Never consume MP when a revive spell has no valid fallen companion.
    if(spell&&spellAllowed(owner,spell)){
     if(spell.kind==='revive'&&reviveIndex<1){
      b.log.push(p.nickname+'：蘇生対象がいません（MP消費なし）');
     }else{
      owner.mp-=spell.mp;
      if(spell.kind==='attack'){
       hit(Math.max(1,Math.round(spell.base*(owner.role===-1?1:1.2))));
       b.log.push(p.nickname+'：'+spell.name);
       battleFx={actor:p.uid,receiver:enemy.uid,kind:'magic',sourceIndex:ownerIndex,targetIndex:selectedIndex};
      }else if(spell.kind==='heal'){
       const index=p.units.map((u,i)=>({i,u})).filter(({u})=>u.hp>0)
        .sort((a,c)=>a.u.hp/a.u.maxHp-c.u.hp/c.u.maxHp)[0]?.i;
       if(index!==undefined){
        p.units[index].hp=Math.min(p.units[index].maxHp,p.units[index].hp+Math.round(spell.base*(owner.role===-1?1:1.2)));
        battleFx={actor:p.uid,receiver:p.uid,kind:'heal',sourceIndex:ownerIndex,targetIndex:index};
       }
       b.log.push(p.nickname+'：'+spell.name);
      }else{
       const fallen=p.units[reviveIndex];
       // メイノーラ 100% / メイノン 50%; percentage applies to max HP.
       const success=spell.rate===1||Math.random()<spell.rate;
       if(success){
        const percentage=spell.range[0]+Math.floor(Math.random()*(spell.range[1]-spell.range[0]+1));
        fallen.hp=Math.max(1,Math.round(fallen.maxHp*percentage/100));
        b.log.push(p.nickname+'：'+spell.name+'で'+fallen.name+'を蘇生！');
        battleFx={actor:p.uid,receiver:p.uid,kind:'revive',sourceIndex:ownerIndex,targetIndex:reviveIndex};
       }else b.log.push(p.nickname+'：'+spell.name+' 蘇生失敗（成功率50％）');
      }
     }
    }else b.log.push(p.nickname+'：魔法を使用できませんでした');
   }else{
    if(p.units[0].hp>0)hit(p.units[0].physical);
    for(const unit of p.units.slice(1))if(unit.hp>0&&unit.role===0){
      const isSpecial=action.special===unit.key&&unit.ct<=0&&unit.rarity>0;
      const power=Math.round(unit.physical*(isSpecial?1.25+unit.rarity*.33:1));
      if(isSpecial&&unit.effect==='guard'){p.guard={ratio:unit.rarity/10,turns:unit.rarity===1?1:2};}
      else if(isSpecial&&unit.effect.endsWith('All'))enemyUnits.forEach((enemyUnit,i)=>{if(enemyUnit.hp>0)hit(power,i);});
      else hit(power,selectedIndex);
      if(isSpecial)unit.ct=unit.maxCt;
    }
    b.log.push(p.nickname+'：攻撃成功！');
    battleFx={actor:p.uid,receiver:enemy.uid,kind:'physical',sourceIndex:0,targetIndex:selectedIndex};
   }
   if(battleFx)b.lastAction=battleFx;
  }
  if(p.guard?.turns>0)p.guard.turns--;
  if(enemy.guard?.turns>0)enemy.guard.turns--;
  send(p,{type:'feedback',correct,answer:q.answer});
  notifyFight(b);
  const fx=correct?b.lastAction:null;
  if(correct&&fx){
   for(const participant of [b.a,b.b])send(participant,{type:'battleAction',...fx});
   b.lastAction=null;
  }else if(!correct){
   for(const participant of [b.a,b.b])send(participant,{type:'battleAction',actor:p.uid,receiver:p.uid,kind:'mistake'});
  }
  if(!alive(p.units)&&!alive(enemy.units)){void endBattle(b,null,'両者全滅・引き分け');return;}
  if(!alive(enemy.units)){void endBattle(b,p,p.nickname+'の勝利！');return;}
  if(!alive(p.units)){void endBattle(b,enemy,enemy.nickname+'の勝利！');return;}
  if(Date.now()>=b.deadline){void endBattle(b,null,'制限時間により引き分け');return;}
  try{nextQuestion(p);}catch{void endBattle(b,null,'問題データのエラーにより引き分け');}
 }
 async function beginBattle(invite){
  const a=invite.from,b=invite.to;
  if(!a.connection||!b.connection||a.battle||b.battle)return;
  a.preparing=b.preparing=true;
  try{
   await loadBanks();
   const token=await getGoogleAccessToken();
   const [dataA,dataB]=await Promise.all([getUserDoc(token,a.uid),getUserDoc(token,b.uid)]);
   if(!a.connection||!b.connection)return;
   a.units=starterRoster(dataA);b.units=starterRoster(dataB);
   a.inventory=inventoryFrom(dataA);b.inventory=inventoryFrom(dataB);
   const battle={id:randomUUID(),a,b,grade:invite.grade,deadline:Date.now()+BATTLE_MS,log:[],ended:false};
   a.battle=b.battle=battle;
   battles.set(battle.id,battle);
   publish({type:'statuses',players:[view(a),view(b)]});
   send(a,{type:'battleStart',grade:battle.grade,opponent:b.nickname});
   send(b,{type:'battleStart',grade:battle.grade,opponent:a.nickname});
   notifyFight(battle);
   nextQuestion(a);nextQuestion(b);
  }catch(error){
   send(a,{type:'notice',message:'対戦を開始できませんでした。'+String(error.message||'')});
   send(b,{type:'notice',message:'対戦を開始できませんでした。'+String(error.message||'')});
  }finally{a.preparing=b.preparing=false;}
 }

 async function useBattleItem(p,itemId){
  const b=p.battle,item=battleItems.find(row=>row.id===itemId);
  if(!b||b.ended||!item||p.itemBusy||!p.connection)return;
  const key=item.kind==='hp'?'hp':'mp',maxKey=item.kind==='hp'?'maxHp':'maxMp';
  const targetUnit=p.units.filter(unit=>unit.hp>0&&unit[maxKey]>0&&unit[key]<unit[maxKey])
    .sort((a,c)=>a[key]/a[maxKey]-c[key]/c[maxKey])[0];
  if(!targetUnit){send(p,{type:'notice',message:'回復が必要な仲間はいません。'});return;}
  if(int(p.inventory?.[itemId],0,100000)<=0){send(p,{type:'notice',message:'アイテムを持っていません。'});return;}
  p.itemBusy=true;
  try{
   // The inventory write is committed before its effects are applied.
   // Concurrent tabs cannot consume the same last item twice.
   const nextCount=await consumeItem(p.uid,itemId);
   p.inventory[itemId]=nextCount;
   if(b.ended||p.battle!==b){send(p,{type:'notice',message:'対戦終了とアイテム使用が重なりました。'});return;}
   targetUnit[key]=Math.min(targetUnit[maxKey],targetUnit[key]+item.amount);
   b.log.push(p.nickname+'：'+item.name+'を使用（'+targetUnit.name+'を回復）');
   notifyFight(b);
  }catch(error){send(p,{type:'notice',message:String(error?.message||'アイテムの使用に失敗しました。')});}
  finally{p.itemBusy=false;}
 }

 async function handle(p,msg){
  if(!msg||typeof msg.type!=='string')return;
  if(msg.type==='move'){
   if(p.battle||p.preparing||!p.connection)return;
   const now=Date.now();if(now-p.lastMove<MOVE_MS)return;
   const dx=Number(msg.dx),dy=Number(msg.dy);
   if(!Number.isInteger(dx)||!Number.isInteger(dy)||Math.abs(dx)+Math.abs(dy)!==1)return;
   const nx=p.x+dx,ny=p.y+dy;
   if(blocked(nx,ny))return;
   p.lastMove=now;p.x=nx;p.y=ny;recordMove(p);return;
  }
  if(msg.type==='refresh'){
   if(p.battle||p.preparing)return;
   try{
    p.data=await getUserDoc(await getGoogleAccessToken(),p.uid);
    p.nickname=cleanName(p.data.nickname,'冒険者');p.petName=cleanName(p.data.petName,'ぺっと');
    p.appearance=p.data.petAppearance||null;p.hatched=!!p.data.petHatched;p.adult=p.data.petAdult!==false;p.shop={equipped:p.data.petShop?.equipped||{},ownedItems:p.data.petShop?.ownedItems||[]};
    publish({type:'statuses',players:[view(p)]});
    send(p,{type:'notice',message:'編成を更新しました。'});
   }catch{send(p,{type:'notice',message:'編成の読み込みに失敗しました。'});}
   return;
  }
  if(msg.type==='invite'){
   const to=clients.get(String(msg.to||'')),grade=String(msg.grade||'');
   if(!to||to===p||!allowedGrades.has(grade)||p.battle||p.preparing||to.battle||to.preparing||p.invite||p.incoming||to.incoming||to.invite||!to.connection){send(p,{type:'notice',message:'現在、この相手には申し込めません。'});return;}
   if(Math.abs(p.x-to.x)+Math.abs(p.y-to.y)>1){send(p,{type:'notice',message:'相手の隣のマスまで近づいてください。'});return;}
   if(Date.now()-(p.lastInvite||0)<2000)return;
   p.lastInvite=Date.now();
   const invite={from:p,to,grade,expires:Date.now()+INVITE_MS,closed:false};
   p.invite=invite;to.incoming=invite;
   send(p,{type:'notice',message:'対戦を申し込みました。返答を待っています。'});
   send(to,{type:'invite',from:p.uid,nickname:p.nickname,grade,expires:invite.expires});
   return;
  }
  if(msg.type==='respond'){
   const invite=p.incoming;
   if(!invite||invite.from.uid!==msg.from||invite.closed||invite.expires<Date.now())return;
   cancelInvite(invite);
   if(msg.accept===true)void beginBattle(invite);
   else send(invite.from,{type:'notice',message:p.nickname+'が対戦を辞退しました。'});
   return;
  }
  if(msg.type==='forfeit'){
   const b=p.battle;
   if(b&&!b.ended)void endBattle(b,b.a===p?b.b:b.a,p.nickname+'が対戦を終了しました（降参）');
   return;
  }
  if(msg.type==='item'){void useBattleItem(p,String(msg.id||''));return;}
  if(msg.type==='answer'){applyAnswer(p,msg);return;}
 }
 async function authenticate(connection,msg){
  if(connection.authenticating||connection.player||msg?.type!=='auth'||typeof msg.token!=='string'||msg.token.length>16384){closeConnection(connection,1008);return;}
  connection.authenticating=true;
  try{
   const req={url:'/api/quest-plaza/join',headers:{authorization:'Bearer '+msg.token}};
   const user=await verifyUser(req);
   if(!connection.socket||connection.socket.destroyed)return;
   let p=clients.get(user.uid);
   if(!p){
    if(clients.size>=MAX_PLAYERS){sendSocket(connection,{type:'error',message:'広場は満員です（40人）。'});closeConnection(connection,1008);return;}
    const data=await getUserDoc(await getGoogleAccessToken(),user.uid);
    p={uid:user.uid,nickname:cleanName(data.nickname,'冒険者'),petName:cleanName(data.petName,'ぺっと'),
     appearance:data.petAppearance||null,hatched:!!data.petHatched,adult:data.petAdult!==false,shop:{equipped:data.petShop?.equipped||{},ownedItems:data.petShop?.ownedItems||[]},
     x:6+Math.floor(Math.random()*36),y:4+Math.floor(Math.random()*24),lastMove:0,lastInvite:0,
     data,connection:null,battle:null,invite:null,incoming:null,preparing:false};
    if(blocked(p.x,p.y)){p.x=9;p.y=9;}
    clients.set(p.uid,p);
   }
   if(p.connection&&p.connection!==connection)closeConnection(p.connection,1000);
   p.connection=connection;p.disconnectedAt=null;connection.player=p;
   connection.authenticatedAt=Date.now();
   send(p,{type:'welcome',self:p.uid,width:WIDTH,height:HEIGHT,maxPlayers:MAX_PLAYERS,players:[...clients.values()].map(view)});
   publish({type:'statuses',players:[view(p)]});
   if(p.battle&&!p.battle.ended){
    send(p,{type:'battleStart',grade:p.battle.grade,opponent:(p.battle.a===p?p.battle.b:p.battle.a).nickname});
    notifyFight(p.battle);
    if(p.question)send(p,{type:'question',seq:p.question.seq,kind:p.question.type,label:p.question.label,prompt:p.question.prompt,
      options:p.question.options,tokens:p.question.tokens,deadline:p.question.deadline});
   }
  }catch(error){sendSocket(connection,{type:'error',message:'ログインを確認できませんでした。'});closeConnection(connection,1008);}
  finally{connection.authenticating=false;}
 }
 function connectionClosed(connection){
  const p=connection.player;
  if(!p||p.connection!==connection)return;
  p.connection=null;
  if(p.battle)p.disconnectedAt=Date.now();
  else cleanupPlayer(p);
 }
 const monitor=setInterval(()=>{
  const now=Date.now();
  if(moves.size){const positions=[...moves.values()];moves.clear();publish({type:'positions',positions});}
  for(const p of clients.values()){
   if(p.invite&&p.invite.expires<now)cancelInvite(p.invite,'対戦申請は時間切れになりました。');
   if(p.battle&&p.disconnectedAt&&now-p.disconnectedAt>20000){
    const b=p.battle,other=b.a===p?b.b:b.a;
    void endBattle(b,other.connection?other:null,p.nickname+'が切断しました。');
    p.disconnectedAt=null;
   }
  }
  for(const b of battles.values()){
   if(now>=b.deadline){void endBattle(b,null,'制限時間により引き分け');continue;}
   for(const p of [b.a,b.b])if(p.connection&&p.question&&now>p.question.deadline){
    applyAnswer(p,{seq:p.question.seq,value:null,action:{}});
   }
  }
  for(const p of clients.values())if(!p.connection&&!p.battle)cleanupPlayer(p);
  for(const [key,at] of recentRewards)if(now-at>3600000)recentRewards.delete(key);
 },250);
 monitor.unref?.();
 server.on('upgrade',(req,socket,head)=>{
  let path;try{path=new URL(req.url,'http://localhost').pathname;}catch{socket.destroy();return;}
  if(path!=='/ws/quest-plaza'){socket.destroy();return;} // No other upgrade consumers.
  if(sockets.size>=MAX_PLAYERS*3){
   socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');socket.destroy();return;
  }
  const key=String(req.headers['sec-websocket-key']||''),origin=req.headers.origin;
  if(!origin||!originAllowed(req)||!/^[-A-Za-z0-9+/]{22}==$/.test(key)||req.headers.upgrade?.toLowerCase()!=='websocket'){
   socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;
  }
  const accept=createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const connection={socket,player:null,authenticating:false,buffer:Buffer.alloc(0),lastPong:Date.now()};
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
  const onData=data=>{
   connection.buffer=Buffer.concat([connection.buffer,data]);
   if(connection.buffer.length>65536){closeConnection(connection,1009);return;}
   while(connection.buffer.length>=2){
    const buf=connection.buffer,opcode=buf[0]&15,fin=!!(buf[0]&128),masked=!!(buf[1]&128);
    let length=buf[1]&127,offset=2;
    if(length===126){if(buf.length<4)return;length=buf.readUInt16BE(2);offset=4;}
    if(length===127){closeConnection(connection,1009);return;}
    if(!masked||!fin||length>16000){closeConnection(connection,1002);return;}
    if(buf.length<offset+4+length)return;
    const mask=buf.subarray(offset,offset+4),payload=Buffer.from(buf.subarray(offset+4,offset+4+length));
    connection.buffer=buf.subarray(offset+4+length);
    for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];
    if(opcode===8){closeConnection(connection);return;}
    if(opcode===9){socket.write(wsFrame(10,payload));continue;}
    if(opcode===10){connection.lastPong=Date.now();continue;}
    if(opcode!==1){closeConnection(connection,1003);return;}
    let msg;try{msg=JSON.parse(payload.toString('utf8'));}catch{closeConnection(connection,1007);return;}
    if(!connection.player){void authenticate(connection,msg);continue;}
    const p=connection.player;if(p.connection===connection)void handle(p,msg);
   }
  };
  socket.on('data',onData);
  socket.on('close',()=>connectionClosed(connection));
  socket.on('error',()=>connectionClosed(connection));
  if(head?.length)onData(head);
  const ping=setInterval(()=>{
   if(socket.destroyed){clearInterval(ping);return;}
   if(Date.now()-connection.lastPong>65000||connection.authenticatedAt&&Date.now()-connection.authenticatedAt>55*60000){closeConnection(connection,1001);clearInterval(ping);return;}
   socket.write(wsFrame(9,'q'));
  },20000);
  ping.unref?.();socket.on('close',()=>clearInterval(ping));
  const authWait=setTimeout(()=>{if(!connection.player)closeConnection(connection,1008);},15000);
  authWait.unref?.();socket.on('close',()=>clearTimeout(authWait));
 });
 return {connectedCount:()=>clients.size,close:()=>clearInterval(monitor)};
}
