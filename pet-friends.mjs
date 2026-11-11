// Social graph and public pet previews. Each account stores one compact social document.
// All cross-account friendship mutations use a single optimistic Firestore commit.
const UID=/^[A-Za-z0-9_-]{1,128}$/;
const maxFriends=150,maxPending=50;
const err=(message,status=400)=>Object.assign(new Error(message),{status});
const records=(value,max)=>Array.isArray(value)?value.filter(x=>x&&UID.test(x.uid||'')).slice(0,max).map(x=>({
  uid:String(x.uid),nickname:String(x.nickname||'').slice(0,20),petName:String(x.petName||'').slice(0,12)
})):[];
const cleanSocial=(data={})=>({
  friends:records(data.friends,maxFriends+1),
  incoming:records(data.incoming,maxPending+1),
  outgoing:records(data.outgoing,maxPending+1)
});
const names=(data,uid)=>({uid,nickname:String(data.nickname||'').slice(0,20),petName:String(data.petName||'').slice(0,12)});
const includes=(list,uid)=>list.some(x=>x.uid===uid);

export function createPetFriends({base,projectId,accessToken,verifyUser,readJson,send,encodeFields,decodeFields,searchUsers,fetchImpl=fetch}){
  const prefix='projects/'+projectId+'/databases/(default)/documents/';
  const socialPath=uid=>'social_friends/'+uid;
  const profilePath=uid=>'users/'+uid+'/apps/english-playroom';
  const headers=token=>({Authorization:'Bearer '+token,'Content-Type':'application/json'});
  async function read(token,path){
    const response=await fetchImpl(base+'/documents/'+path,{headers:headers(token)});
    if(response.status===404)return null;
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw err('データを読み込めませんでした。',502);
    return data;
  }
  async function commit(token,writes){
    const response=await fetchImpl(base+'/documents:commit',{method:'POST',headers:headers(token),body:JSON.stringify({writes})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw err('更新が競合しました。もう一度お試しください。',[409,412].includes(response.status)?409:502);
  }
  function write(path,value,raw){
    const fields=encodeFields(value);
    return {update:{name:prefix+path,fields},updateMask:{fieldPaths:Object.keys(fields)},currentDocument:raw?.updateTime?{updateTime:raw.updateTime}:{exists:false}};
  }
  // The canonical friendship graph lives alongside the already-watched pet profile.
  // Legacy social_friends documents are read only once per account during migration.
  const social=raw=>cleanSocial(raw?decodeFields(raw.fields||{}):{});
  const embedded=raw=>{
    if(!raw)return null;
    const value=decodeFields(raw.fields||{}).socialFriends;
    return value&&value.schemaVersion===1?cleanSocial(value):null;
  };
  const asField=value=>({schemaVersion:1,...cleanSocial(value)});
  async function readSocial(token,profileRaw,uid){
    const stored=embedded(profileRaw);
    if(stored)return stored;
    return social(await read(token,socialPath(uid)));
  }
  async function mutate(user,otherUid,action,accept=false){
    if(!UID.test(otherUid||'')||otherUid===user.uid)throw err('相手を正しく選択してください。');
    const token=await accessToken();
    for(let attempt=0;attempt<4;attempt++){
      // These are the same two profile documents that already store coins and gifts.
      const [leftRaw,rightRaw]=await Promise.all([
        read(token,profilePath(user.uid)),read(token,profilePath(otherUid))
      ]);
      if(!leftRaw||!rightRaw)throw err('プロフィールが見つかりません。',404);
      const [left,right]=await Promise.all([
        readSocial(token,leftRaw,user.uid),readSocial(token,rightRaw,otherUid)
      ]);
      if(action==='request'){
        if(includes(left.friends,otherUid))throw err('すでにおともだちです。',409);
        if(includes(left.incoming,otherUid))throw err('相手からの申請が届いています。承認してください。',409);
        if(includes(left.outgoing,otherUid))return {ok:true,alreadyRequested:true};
        if(left.outgoing.length>=maxPending||right.incoming.length>=maxPending)throw err('申請件数の上限に達しました。',409);
        // The names are in the two profile reads above; no additional profile reads.
        left.outgoing.push(names(decodeFields(rightRaw.fields||{}),otherUid));
        right.incoming.push(names(decodeFields(leftRaw.fields||{}),user.uid));
      }else if(action==='respond'){
        if(!includes(left.incoming,otherUid)||!includes(right.outgoing,user.uid))throw err('申請が見つかりません。最新の一覧を取得してください。',409);
        const incoming=left.incoming.find(x=>x.uid===otherUid),outgoing=right.outgoing.find(x=>x.uid===user.uid);
        left.incoming=left.incoming.filter(x=>x.uid!==otherUid);
        right.outgoing=right.outgoing.filter(x=>x.uid!==user.uid);
        if(accept){
          if(left.friends.length>=maxFriends||right.friends.length>=maxFriends)throw err('おともだちの登録上限に達しています。',409);
          if(!includes(left.friends,otherUid))left.friends.push(incoming);
          if(!includes(right.friends,user.uid))right.friends.push(outgoing);
        }
      }else if(action==='remove'){
        if(!includes(left.friends,otherUid)&&!includes(left.outgoing,otherUid)&&!includes(left.incoming,otherUid))return {ok:true,unchanged:true};
        left.friends=left.friends.filter(x=>x.uid!==otherUid);
        left.incoming=left.incoming.filter(x=>x.uid!==otherUid);
        left.outgoing=left.outgoing.filter(x=>x.uid!==otherUid);
        right.friends=right.friends.filter(x=>x.uid!==user.uid);
        right.incoming=right.incoming.filter(x=>x.uid!==user.uid);
        right.outgoing=right.outgoing.filter(x=>x.uid!==user.uid);
      }else throw err('不正な操作です。');
      try{
        // Both updates are masked to socialFriends, and remain one atomic commit.
        // Other profile fields (coins, gift inbox, equipment) are never overwritten.
        await commit(token,[
          write(profilePath(user.uid),{socialFriends:asField(left)},leftRaw),
          write(profilePath(otherUid),{socialFriends:asField(right)},rightRaw)
        ]);
        return {ok:true};
      }catch(error){if(error.status===409&&attempt<3)continue;throw error;}
    }
    throw err('保存が競合しました。',409);
  }
  async function handle(req,res,path){
    try{
      const user=await verifyUser(req);
      const url=new URL(req.url||'/', 'http://localhost');
      if(path==='/api/friends'){
        if(req.method!=='GET')throw err('GETのみ対応しています。',405);
        const token=await accessToken();
        for(let attempt=0;attempt<4;attempt++){
          const raw=await read(token,profilePath(user.uid));
          if(!raw)throw err('プロフィールが見つかりません。',404);
          const current=embedded(raw);
          if(current)return send(res,200,current);
          // Lazy one-time migration of historical friends and pending requests.
          const previous=social(await read(token,socialPath(user.uid)));
          try{
            await commit(token,[write(profilePath(user.uid),{socialFriends:asField(previous)},raw)]);
            return send(res,200,previous);
          }catch(error){if(error.status===409&&attempt<3)continue;throw error;}
        }
      }
      if(path==='/api/friends/search'){
        if(req.method!=='GET')throw err('GETのみ対応しています。',405);
        const q=String(url.searchParams.get('q')||'').normalize('NFKC').trim();
        if(!q||[...q].length>20)return send(res,200,{users:[]});
        return send(res,200,{users:await searchUsers(q,user.uid)});
      }
      if(path==='/api/friends/pet'){
        if(req.method!=='GET')throw err('GETのみ対応しています。',405);
        const uid=url.searchParams.get('uid')||'';
        if(!UID.test(uid))throw err('ペットを選択してください。');
        const raw=await read(await accessToken(),profilePath(uid));
        if(!raw)throw err('ペットが見つかりません。',404);
        const data=decodeFields(raw.fields||{});
        if(uid!==user.uid&&data.petVisibleToOthers===false)throw err('このペットは公開されていません。',403);
        const shop=data.petShop||{};
        return send(res,200,{
          uid,nickname:String(data.nickname||'').slice(0,20),petName:String(data.petName||'ふしぎなたまご').slice(0,12),
          petAdult:data.petAdult!==false,petHatched:data.petHatched===true,
          petAppearance:data.petAppearance&&typeof data.petAppearance==='object'?data.petAppearance:null,
          petShop:{ownedItems:Array.isArray(shop.ownedItems)?shop.ownedItems.filter(x=>typeof x==='string').slice(0,250):[],
            equipped:shop.equipped&&typeof shop.equipped==='object'?shop.equipped:{}}
        });
      }
      if(!req.headers['content-type']?.startsWith('application/json'))throw err('JSONで送信してください。',415);
      const body=await readJson(req,1024);
      if(path==='/api/friends/request'&&req.method==='POST')return send(res,200,await mutate(user,body.targetUid,'request'));
      if(path==='/api/friends/respond'&&req.method==='POST')return send(res,200,await mutate(user,body.senderUid,'respond',body.accept===true));
      if(path==='/api/friends/remove'&&req.method==='POST')return send(res,200,await mutate(user,body.targetUid,'remove'));
      if(path==='/api/friends/privacy'&&req.method==='POST'){
        if(typeof body.visible!=='boolean')throw err('公開設定を選択してください。');
        const token=await accessToken();
        for(let i=0;i<3;i++){
          const raw=await read(token,profilePath(user.uid));
          if(!raw)throw err('プロフィールが見つかりません。',404);
          try{
            await commit(token,[write(profilePath(user.uid),{petVisibleToOthers:body.visible},raw)]);
            return send(res,200,{ok:true,visible:body.visible});
          }catch(error){if(error.status===409&&i<2)continue;throw error;}
        }
      }
      throw err('ページが見つかりません。',404);
    }catch(error){return send(res,error.status||500,{error:error.message||'おともだち情報を処理できませんでした。'});}
  }
  return {handle};
}
