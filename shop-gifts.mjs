import {SHOP_GIFT_CATALOG} from './shop-gift-catalog.mjs';

export const GIFT_MESSAGES = Object.freeze({
  thanks:'いつもありがとう！',
  birthday:'お誕生日おめでとう！',
  cheer:'がんばってね！',
  enjoy:'これ、使ってね！',
  friends:'これからもよろしく！'
});
export const GIFT_REPLIES = Object.freeze({
  thanks:'ありがとう！',
  happy:'とってもうれしい！',
  treasure:'大切に使うね！',
  hooray:'やったー！'
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UID=/^[A-Za-z0-9_-]{1,128}$/;
const cleanName=x=>String(x||'').normalize('NFKC').trim();
const list=x=>Array.isArray(x)?x.filter(a=>a&&typeof a==='object'):[];
const coin=x=>Math.max(0,Math.floor(Number(x)||0));
const unread=(entries,key)=>entries.filter(x=>!x[key]).length;
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const userPath=uid=>'users/'+uid+'/apps/english-playroom';
const eventPath=id=>'shop_gift_events/'+id;
const bounded=(items,max,protectedField)=>{
  const protectedItems=items.filter(x=>!x[protectedField]);
  if(protectedItems.length>max)throw error('相手のギフトボックスがいっぱいです。先に開封してもらってください。',409);
  const keep=new Set(protectedItems);
  for(let i=items.length-1;i>=0&&keep.size<max;i--)keep.add(items[i]);
  return items.filter(x=>keep.has(x));
};
const docData=(raw,decodeFields)=>raw?decodeFields(raw.fields||{}):{};
const conflict=(res,data)=>[409,412].includes(res.status)||['ABORTED','FAILED_PRECONDITION','ALREADY_EXISTS'].includes(data?.error?.status);

export function createShopGifts({base,projectId,accessToken,verifyUser,readJson,send,encodeFields,decodeFields,searchUsers,fetchImpl=fetch}){
  const prefix='projects/'+projectId+'/databases/(default)/documents/';
  const headers=token=>({Authorization:'Bearer '+token,'Content-Type':'application/json'});
  async function read(token,path){
    const r=await fetchImpl(base+'/documents/'+path,{headers:headers(token)});
    if(r.status===404)return null;
    const body=await r.json().catch(()=>({}));
    if(!r.ok)throw error('ギフトの情報を読み込めませんでした。',502);
    return body;
  }
  async function commit(token,writes){
    const r=await fetchImpl(base+'/documents:commit',{method:'POST',headers:headers(token),body:JSON.stringify({writes})});
    const body=await r.json().catch(()=>({}));
    if(!r.ok)throw Object.assign(error('ギフトの保存に失敗しました。',conflict(r,body)?409:502),{retryable:conflict(r,body)});
    return body;
  }
  function writeDoc(path,data,raw,transforms=[]){
    const fields=encodeFields(data);
    const write={update:{name:prefix+path,fields},updateMask:{fieldPaths:Object.keys(fields)},currentDocument:raw?.updateTime?{updateTime:raw.updateTime}:{exists:false}};
    if(transforms.length)write.updateTransforms=transforms.map(fieldPath=>({fieldPath,setToServerValue:'REQUEST_TIME'}));
    return write;
  }
  async function sentBefore(token,id,senderUid,toUid,itemId){
    const existing=await read(token,eventPath(id));
    if(!existing)return false;
    const gift=docData(existing,decodeFields);
    if(gift.senderUid===senderUid&&gift.recipientUid===toUid&&gift.itemId===itemId)return true;
    throw error('このギフト番号は使用できません。',409);
  }
  async function search(req,res,user){
    const q=cleanName(new URL(req.url,'http://localhost').searchParams.get('q')||'');
    if(!q||[...q].length>12)return send(res,200,{users:[]});
    const matches=await searchUsers(q,user.uid);
    return send(res,200,{users:matches});
  }
  async function sendGift(req,res,user){
    if(req.method!=='POST')throw error('POSTのみ対応しています。',405);
    const body=await readJson(req,2048);
    const {recipientUid,itemId,giftId,messageId}=body;
    if(!UID.test(recipientUid||'')||recipientUid===user.uid||!UUID.test(giftId||''))throw error('ギフトの送信先が正しくありません。');
    const item=SHOP_GIFT_CATALOG[itemId];
    if(!item||!Object.hasOwn(GIFT_MESSAGES,messageId))throw error('商品またはメッセージを選び直してください。');
    const token=await accessToken();
    for(let attempt=0;attempt<4;attempt++){
      const [senderRaw,targetRaw]=await Promise.all([read(token,userPath(user.uid)),read(token,userPath(recipientUid))]);
      if(!senderRaw||!targetRaw)throw error('送信先が見つかりません。',404);
      const sender=docData(senderRaw,decodeFields),target=docData(targetRaw,decodeFields);
      const duplicate=async()=>{if(await sentBefore(token,giftId,user.uid,recipientUid,itemId)){send(res,200,{ok:true,alreadySent:true,itemName:item.name,price:item.price});return true;}return false;};
      if(cleanName(target.petName)!==cleanName(body.recipientPetName)||cleanName(target.nickname)!==cleanName(body.recipientNickname)){
        if(await duplicate())return;
        throw error('相手のお名前が変更されています。もう一度検索してください。',409);
      }
      const owned=Array.isArray(target.petShop?.ownedItems)?target.petShop.ownedItems:[];
      if(owned.includes(itemId)){
        if(await duplicate())return;
        throw error('相手はこの商品をすでに持っています。',409);
      }
      if(coin(sender.coins)<item.price){
        if(await duplicate())return;
        throw error('コインが足りません。',409);
      }
      const inbox=list(target.giftInbox);
      const now=new Date().toISOString();
      const receipt={giftId,senderUid:user.uid,senderNickname:String(sender.nickname||''),senderPetName:String(sender.petName||''),itemId,itemName:item.name,messageId,sentAt:now,opened:false,replyId:''};
      const nextInbox=bounded([...inbox,receipt],60,'opened');
      const sent=[...list(sender.giftSent),{giftId,recipientUid,recipientNickname:String(target.nickname||''),recipientPetName:String(target.petName||''),itemId,itemName:item.name,messageId,sentAt:now}].slice(-40);
      const shop=target.petShop&&typeof target.petShop==='object'?target.petShop:{};
      const petShop={...shop,ownedItems:[...owned,itemId],equipped:shop.equipped&&typeof shop.equipped==='object'?shop.equipped:{}};
      const writes=[
        writeDoc(userPath(user.uid),{coins:coin(sender.coins)-item.price,giftSent:sent},senderRaw,['coinUpdatedAt']),
        writeDoc(userPath(recipientUid),{petShop,giftInbox:nextInbox,giftUnreadCount:unread(nextInbox,'opened')},targetRaw,['petUpdatedAt']),
        {update:{name:prefix+eventPath(giftId),fields:encodeFields({senderUid:user.uid,recipientUid,itemId,itemName:item.name,price:item.price,messageId,sentAt:now})},currentDocument:{exists:false}}
      ];
      try{await commit(token,writes);return send(res,200,{ok:true,itemName:item.name,price:item.price});}
      catch(e){
        if(await sentBefore(token,giftId,user.uid,recipientUid,itemId))return send(res,200,{ok:true,alreadySent:true,itemName:item.name,price:item.price});
        if(e.retryable&&attempt<3)continue;
        throw e;
      }
    }
    throw error('情報が変更されました。もう一度お試しください。',409);
  }
  async function openGift(req,res,user){
    if(req.method!=='POST')throw error('POSTのみ対応しています。',405);
    const {giftId}=await readJson(req,512);
    if(!UUID.test(giftId||''))throw error('ギフト番号が正しくありません。');
    const token=await accessToken();
    for(let attempt=0;attempt<4;attempt++){
      const raw=await read(token,userPath(user.uid));if(!raw)throw error('利用者が見つかりません。',404);
      const data=docData(raw,decodeFields),inbox=list(data.giftInbox),idx=inbox.findIndex(x=>x.giftId===giftId);
      if(idx<0)throw error('ギフトが見つかりません。',404);
      if(inbox[idx].opened)return send(res,200,{ok:true,alreadyOpened:true});
      inbox[idx]={...inbox[idx],opened:true};
      try{
        await commit(token,[writeDoc(userPath(user.uid),{giftInbox:inbox,giftUnreadCount:unread(inbox,'opened')},raw)]);
        return send(res,200,{ok:true});
      }catch(e){if(e.retryable&&attempt<3)continue;throw e;}
    }
    throw error('開封処理をやり直してください。',409);
  }
  async function replyGift(req,res,user){
    if(req.method!=='POST')throw error('POSTのみ対応しています。',405);
    const {giftId,replyId}=await readJson(req,512);
    if(!UUID.test(giftId||'')||!Object.hasOwn(GIFT_REPLIES,replyId))throw error('返信内容を選び直してください。');
    const token=await accessToken();
    for(let attempt=0;attempt<4;attempt++){
      const receiverRaw=await read(token,userPath(user.uid));
      if(!receiverRaw)throw error('ギフトが見つかりません。',404);
      const receiver=docData(receiverRaw,decodeFields),inbox=list(receiver.giftInbox),idx=inbox.findIndex(x=>x.giftId===giftId);
      if(idx<0)throw error('ギフトが見つかりません。',404);
      const gift=inbox[idx];
      if(!gift.opened)throw error('先にプレゼントを開封してください。',409);
      if(gift.replyId)return send(res,200,{ok:true,alreadyReplied:true});
      if(!UID.test(gift.senderUid||'')||gift.senderUid===user.uid)throw error('返信先が正しくありません。',409);
      const [event,senderRaw]=await Promise.all([read(token,eventPath(giftId)),read(token,userPath(gift.senderUid))]);
      const original=docData(event,decodeFields);
      if(!event||original.recipientUid!==user.uid||original.senderUid!==gift.senderUid||original.itemId!==gift.itemId)throw error('ギフトを確認できませんでした。',403);
      if(!senderRaw)throw error('送信者が見つかりません。',404);
      const sender=docData(senderRaw,decodeFields),replies=list(sender.giftReplies);
      if(replies.some(x=>x.giftId===giftId))return send(res,200,{ok:true,alreadyReplied:true});
      const nextReplies=bounded([...replies,{giftId,recipientUid:user.uid,recipientNickname:String(receiver.nickname||''),recipientPetName:String(receiver.petName||''),itemId:gift.itemId,itemName:gift.itemName,replyId,receivedAt:new Date().toISOString(),seen:false}],60,'seen');
      inbox[idx]={...gift,replyId};
      try{
        await commit(token,[
          writeDoc(userPath(user.uid),{giftInbox:inbox},receiverRaw),
          writeDoc(userPath(gift.senderUid),{giftReplies:nextReplies,giftUnreadReplyCount:unread(nextReplies,'seen')},senderRaw)
        ]);
        return send(res,200,{ok:true});
      }catch(e){if(e.retryable&&attempt<3)continue;throw e;}
    }
    throw error('返信をやり直してください。',409);
  }
  async function seenReply(req,res,user){
    if(req.method!=='POST')throw error('POSTのみ対応しています。',405);
    const {giftId}=await readJson(req,512);
    if(!UUID.test(giftId||''))throw error('ギフト番号が正しくありません。');
    const token=await accessToken();
    for(let attempt=0;attempt<4;attempt++){
      const raw=await read(token,userPath(user.uid));if(!raw)throw error('返信が見つかりません。',404);
      const data=docData(raw,decodeFields),replies=list(data.giftReplies),idx=replies.findIndex(x=>x.giftId===giftId);
      if(idx<0)throw error('返信が見つかりません。',404);
      if(replies[idx].seen)return send(res,200,{ok:true,alreadySeen:true});
      replies[idx]={...replies[idx],seen:true};
      try{
        await commit(token,[writeDoc(userPath(user.uid),{giftReplies:replies,giftUnreadReplyCount:unread(replies,'seen')},raw)]);
        return send(res,200,{ok:true});
      }catch(e){if(e.retryable&&attempt<3)continue;throw e;}
    }
    throw error('確認処理をやり直してください。',409);
  }
  async function handle(req,res,path){
    try{
      const user=await verifyUser(req);
      if(path==='/api/shop/gifts/search')return await search(req,res,user);
      if(!req.headers['content-type']?.startsWith('application/json'))throw error('JSONで送信してください。',415);
      if(path==='/api/shop/gifts/send')return await sendGift(req,res,user);
      if(path==='/api/shop/gifts/open')return await openGift(req,res,user);
      if(path==='/api/shop/gifts/reply')return await replyGift(req,res,user);
      if(path==='/api/shop/gifts/seen')return await seenReply(req,res,user);
      throw error('ページが見つかりません。',404);
    }catch(e){return send(res,e.status||500,{error:e.message||'ギフトの処理に失敗しました。'});}
  }
  return {handle};
}
