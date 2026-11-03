const APP_IDS=['english-playroom','ateru','basic-quest','eiken-retry','eiken-cloze','eiken-title','task-quest','eiken-pre2-interview-a'];
export function createAdminData({base,projectId,accessToken,verifyAdmin,verifyUser,send,fail,decodeFields,normalizeNickname,validNickname,fetch:request=globalThis.fetch,now=Date.now}){
  const cache=new Map(),TTL=60000;
  async function cached(key,read){
    const previous=cache.get(key);if(previous&&previous.until>now())return previous.promise;
    if(cache.size>=200)cache.delete(cache.keys().next().value);
    const entry={until:now()+TTL};cache.set(key,entry);
    entry.promise=read().then(value=>{entry.value=value;return value;}).catch(error=>{entry.until=now()+5000;throw error;});
    return entry.promise;
  }
  async function json(url,options={}){
    const token=await accessToken();const response=await request(url,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
    const body=await response.json();
    if(!response.ok)throw fail(body?.error?.status==='RESOURCE_EXHAUSTED'?'Firestoreの利用上限に達しています。時間を置いてから更新してください。':'管理情報を取得できませんでした。',response.status===429?429:502);
    return body;
  }
  async function summary(uid){
    return cached('summary:'+uid,async()=>{
      const url=new URL(`${base}/documents/users/${encodeURIComponent(uid)}/apps/english-playroom`);
      for(const field of ['nickname','petName','coins'])url.searchParams.append('mask.fieldPaths',field);
      const token=await accessToken();const r=await request(url,{headers:{Authorization:`Bearer ${token}`}});
      if(r.status===404)return {};
      const d=await r.json();if(!r.ok)throw fail(d?.error?.status==='RESOURCE_EXHAUSTED'?'Firestoreの利用上限に達しています。時間を置いてから更新してください。':'一覧情報を取得できませんでした。',r.status===429?429:502);
      return decodeFields(d.fields||{});
    });
  }
  async function authDirectory(){
    return cached('auth:recent',async()=>{
      const users=[];let token='';
      do{
        const url=new URL(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:batchGet`);
        url.searchParams.set('maxResults','1000');if(token)url.searchParams.set('nextPageToken',token);
        const auth=await json(url);users.push(...(auth.users||[]));token=auth.nextPageToken||'';
      }while(token);
      users.sort((a,b)=>Number(b.lastLoginAt||0)-Number(a.lastLoginAt||0)||Number(b.createdAt||0)-Number(a.createdAt||0)||String(a.localId||'').localeCompare(String(b.localId||'')));
      return users;
    });
  }
  async function identityRequest(action,body){
    return json(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:${action}`,{method:'POST',body:JSON.stringify(body)});
  }
  async function authAccount(uid){
    const data=await identityRequest('lookup',{localId:[uid]});
    const user=Array.isArray(data.users)?data.users[0]:null;
    if(!user)throw fail('利用者アカウントが見つかりません。',404);
    return user;
  }
  function customAttributes(account){
    let value={};
    try{value=account.customAttributes?JSON.parse(account.customAttributes):{};}catch{throw fail('利用者の認証設定を読み取れません。',502);}
    return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  }
  async function readBody(req,maxBytes=2048){
    let raw='',size=0;
    for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw fail('送信内容が大きすぎます。',413);raw+=chunk;}
    try{return JSON.parse(raw||'{}');}catch{throw fail('送信内容を読み取れません。',400);}
  }
  async function nicknameDirectory(){
    return cached('nicknames',async()=>{
      const rows=[];let token='';
      do{
        const url=new URL(`${base}/documents/nickname_registry`);
        url.searchParams.set('pageSize','1000');if(token)url.searchParams.set('pageToken',token);
        const body=await json(url);rows.push(...(body.documents||[]));token=body.nextPageToken||'';
      }while(token);
      return rows.map(doc=>decodeFields(doc.fields||{})).map(data=>({uid:String(data.uid||''),nickname:normalizeNickname(data.nickname)})).filter(row=>row.uid&&validNickname(row.nickname));
    });
  }
  async function codeDirectory(){
    return cached('code-directory',async()=>{
      const rows=[];let startAt='',lastName='';
      do{
        const structuredQuery={from:[{collectionId:'code_accounts'}],select:{fields:[{fieldPath:'uid'},{fieldPath:'loginId'},{fieldPath:'codeName'}]},orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:1000};
        if(startAt)structuredQuery.startAt={values:[{referenceValue:startAt}],before:false};
        const result=await json(base+'/documents:runQuery',{method:'POST',body:JSON.stringify({structuredQuery})});
        const documents=result.filter(row=>row.document).map(row=>row.document);
        for(const doc of documents){if(doc.name>lastName){const data=decodeFields(doc.fields||{});if(data.uid&&data.loginId)rows.push({uid:String(data.uid),loginId:String(data.loginId),codeName:String(data.codeName||'')});}}
        if(documents.length<1000)break;
        lastName=documents.at(-1).name;startAt=lastName;
      }while(true);
      return new Map(rows.map(row=>[row.uid,row]));
    });
  }
  async function codeAccountsFor(uids){
    const ids=[...new Set(uids.map(value=>String(value||'')).filter(Boolean))];
    if(!ids.length)return new Map();
    if(ids.length>6)throw fail('一覧の登録情報は6人以内で取得してください。',400);
    const key='code-page:'+ids.slice().sort().join(',');
    return cached(key,async()=>{
      const structuredQuery={from:[{collectionId:'code_accounts'}],select:{fields:[{fieldPath:'uid'},{fieldPath:'loginId'},{fieldPath:'codeName'}]},where:{fieldFilter:{field:{fieldPath:'uid'},op:'IN',value:{arrayValue:{values:ids.map(uid=>({stringValue:uid}))}}}},limit:ids.length};
      const result=await json(base+'/documents:runQuery',{method:'POST',body:JSON.stringify({structuredQuery})});
      const rows=result.filter(row=>row.document).map(row=>decodeFields(row.document.fields||{})).filter(data=>data.uid&&data.loginId).map(data=>({uid:String(data.uid),loginId:String(data.loginId),codeName:String(data.codeName||'')}));
      return new Map(rows.map(row=>[row.uid,row]));
    });
  }
  function learningTime(value){const ms=typeof value==='number'?value:Date.parse(value||'');return Number.isFinite(ms)&&ms>0?ms:null;}
  function cursor(value){if(!value)return {phase:'recent'};try{const c=JSON.parse(Buffer.from(value,'base64url').toString());if(c.phase==='recent'&&typeof c.at==='string'&&typeof c.name==='string'&&c.name.startsWith('projects/'+projectId+'/databases/(default)/documents/learning_activity/'))return c;if(c.phase==='unrecorded'&&Number.isSafeInteger(c.offset)&&c.offset>=0)return c;}catch{}throw fail('ページ情報が不正です。',400);}
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  async function activity(uid){return cached('activity:'+uid,async()=>{const token=await accessToken(),r=await request(base+'/documents/learning_activity/'+encodeURIComponent(uid),{headers:{Authorization:'Bearer '+token}});if(r.status===404)return null;const body=await r.json();if(!r.ok)throw fail('学習日時を取得できませんでした。',502);return learningTime(decodeFields(body.fields||{}).lastLearningAt);});}
  async function unrecorded(){return cached('unrecorded',async()=>{
    const rows=await json(base+'/documents:runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'learning_activity'}],select:{fields:[{fieldPath:'uid'}]}}})});
    const known=new Set(rows.filter(r=>r.document).map(r=>decodeFields(r.document.fields||{}).uid));
    return (await authDirectory()).filter(u=>!known.has(u.localId)).sort((a,b)=>String(a.localId).localeCompare(String(b.localId)));
  });}
  async function page(token){return cached('page:'+token,async()=>{
    const c=cursor(token);let rows=[],nextPageToken=null;
    if(c.phase==='recent'){
      const query={from:[{collectionId:'learning_activity'}],orderBy:[{field:{fieldPath:'lastLearningAt'},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}],limit:7};
      if(c.at)query.startAt={values:[{timestampValue:c.at},{referenceValue:c.name}],before:false};
      const result=await json(base+'/documents:runQuery',{method:'POST',body:JSON.stringify({structuredQuery:query})});
      const documents=result.filter(r=>r.document).map(r=>r.document),more=documents.length>6;
      rows=documents.slice(0,6).map(doc=>{const d=decodeFields(doc.fields||{});return {uid:d.uid,lastLearningAt:learningTime(d.lastLearningAt)};});
      if(more){const last=documents[5];nextPageToken=encode({phase:'recent',at:decodeFields(last.fields).lastLearningAt,name:last.name});}
      else {const waiting=await unrecorded(),room=6-rows.length;rows.push(...waiting.slice(0,room).map(u=>({uid:u.localId,lastLearningAt:null,createdAt:u.createdAt||null})));if(waiting.length>room)nextPageToken=encode({phase:'unrecorded',offset:room});}
    }else{const waiting=await unrecorded();rows=waiting.slice(c.offset,c.offset+6).map(u=>({uid:u.localId,lastLearningAt:null,createdAt:u.createdAt||null}));if(waiting.length>c.offset+6)nextPageToken=encode({phase:'unrecorded',offset:c.offset+6});}
    const codeNames=await codeAccountsFor(rows.map(row=>row.uid));const users=await Promise.all(rows.map(async row=>{const p=await summary(row.uid),nickname=normalizeNickname(p.nickname),identity=codeNames.get(row.uid)||{};return {...row,codeName:identity.codeName||'',loginId:identity.loginId||'',nickname:nickname||'ニックネーム未登録',hasNickname:validNickname(nickname),petName:normalizeNickname(p.petName)||'ペット名未設定',coins:Math.max(0,Math.floor(Number(p.coins)||0))};}));
    return {users,nextPageToken,pageSize:6,fetchedAt:now()};
  });}
  async function search(query){
    const normalized=normalizeNickname(query),needle=normalized.toLocaleLowerCase('ja-JP');
    const length=[...normalized].length;if(!normalized||length>32)throw fail('検索語は1〜32文字で入力してください。',400);
    const [directory,nicknames,codeNames]=await Promise.all([authDirectory(),nicknameDirectory(),codeDirectory()]);
    const authByUid=new Map(directory.map(user=>[String(user.localId||''),user]));
    const nickByUid=new Map(nicknames.filter(row=>authByUid.has(row.uid)).map(row=>[row.uid,row.nickname]));
    const matchUids=new Set();
    for(const [uid,nickname] of nickByUid)if(nickname.toLocaleLowerCase('ja-JP').includes(needle))matchUids.add(uid);
    for(const [uid,account] of codeNames)if(authByUid.has(uid)&&[account.codeName,account.loginId].some(value=>value.toLocaleLowerCase('ja-JP').includes(needle)))matchUids.add(uid);
    const matches=[...matchUids].map(uid=>{const account=codeNames.get(uid)||{};return {uid,nickname:nickByUid.get(uid)||'',codeName:account.codeName||'',loginId:account.loginId||''};});
    matches.sort((a,b)=>{
      const rank=value=>{const v=value.toLocaleLowerCase('ja-JP');return v===needle?0:v.startsWith(needle)?1:v.includes(needle)?2:9;};
      const aq=Math.min(rank(a.nickname),rank(a.codeName),rank(a.loginId)),bq=Math.min(rank(b.nickname),rank(b.codeName),rank(b.loginId));
      if(aq!==bq)return aq-bq;
      const au=authByUid.get(a.uid)||{},bu=authByUid.get(b.uid)||{};
      return a.nickname.localeCompare(b.nickname,'ja-JP');
    });
    const selected=matches.slice(0,100);
    const users=await Promise.all(selected.map(async row=>{
      const u=authByUid.get(row.uid)||{},p=await summary(row.uid),nickname=normalizeNickname(p.nickname)||row.nickname;
      const identity=codeNames.get(row.uid)||{};return {uid:row.uid,codeName:identity.codeName||'',loginId:identity.loginId||'',nickname,hasNickname:validNickname(nickname),coins:Math.max(0,Math.floor(Number(p.coins)||0)),petName:normalizeNickname(p.petName)||'ペット名未設定',createdAt:u.createdAt||null,lastLearningAt:await activity(row.uid),disabled:!!u.disabled};
    }));
    users.sort((a,b)=>(b.lastLearningAt||0)-(a.lastLearningAt||0)||a.nickname.localeCompare(b.nickname,'ja'));
    return {users,query:normalized,total:matches.length,truncated:matches.length>users.length,fetchedAt:now()};
  }
  async function detail(uid){
    return cached('detail:'+uid,async()=>{
      const prefix=`projects/${projectId}/databases/(default)/documents/users/${uid}/apps/`;
      const rows=await json(`${base}/documents:batchGet`,{method:'POST',body:JSON.stringify({documents:[...APP_IDS.map(id=>prefix+id),`projects/${projectId}/databases/(default)/documents/learning_activity/${uid}`]})});
      const apps={};for(const row of rows){const doc=row.found;if(!doc?.name?.startsWith(prefix))continue;const id=doc.name.slice(prefix.length);if(APP_IDS.includes(id))apps[id]=decodeFields(doc.fields||{});}
      const activityDoc=rows.find(row=>row.found?.name===`projects/${projectId}/databases/(default)/documents/learning_activity/${uid}`);
      return {uid,apps,activity:activityDoc?decodeFields(activityDoc.found.fields||{}):{},fetchedAt:now()};
    });
  }
  async function handle(req,res){
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/api/admin/users'&&req.method==='POST'&&url.searchParams.get('completePasswordReset')==='1'){
        const user=await verifyUser(req);
        if(user.passwordResetRequired!==true)throw fail('パスワード再設定が必要なアカウントではありません。',403);
        if(!req.headers['content-type']?.startsWith('application/json'))throw fail('JSONで送信してください。',415);
        const body=await readBody(req),password=typeof body.password==='string'?body.password:'';
        if(password.length<6||password==='000000'||password.length>128)throw fail('新しいパスワードは6文字以上で、仮パスワードとは異なるものを設定してください。',400);
        const account=await authAccount(user.uid),claims=customAttributes(account);
        delete claims.passwordResetRequired;
        await identityRequest('update',{localId:user.uid,password,customAttributes:JSON.stringify(claims),returnSecureToken:false});
        cache.delete('auth:recent');
        send(res,200,{ok:true});return;
      }
      if(url.pathname==='/api/admin/users'&&req.method==='POST'&&url.searchParams.get('resetPassword')==='1'){
        const admin=await verifyAdmin(req);
        if(!req.headers['content-type']?.startsWith('application/json'))throw fail('JSONで送信してください。',415);
        const body=await readBody(req),uid=String(body.uid||'');
        if(!uid||uid.length>128||/[\/\u0000-\u001f]/.test(uid))throw fail('ユーザーIDが不正です。',400);
        const account=await authAccount(uid),claims=customAttributes(account);
        claims.passwordResetRequired=true;
        await identityRequest('update',{localId:uid,password:'000000',customAttributes:JSON.stringify(claims),returnSecureToken:false});
        cache.delete('auth:recent');
        console.log(`Admin password reset: uid=${uid} by=${admin.uid}`);
        send(res,200,{ok:true,passwordResetRequired:true});return;
      }
      if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
      const admin=await verifyAdmin(req); // Cache never bypasses authentication or authorization.
      if(url.pathname==='/api/admin/users'&&url.searchParams.has('emailUid')){
        const uid=url.searchParams.get('emailUid')||'';
        if(!uid||uid.length>128||/[\/\u0000-\u001f]/.test(uid))throw fail('ユーザーIDが不正です。',400);
        const account=await authAccount(uid);
        send(res,200,{uid,email:String(account.email||'')});return;
      }
      if(url.pathname==='/api/admin/contact-messages'){
        const token=url.searchParams.get('pageToken')||'';
        if(token.length>4096)throw fail('ページ情報が不正です。',400);
        const endpoint=new URL(base+'/documents/developerMessages');
        endpoint.searchParams.set('pageSize','50');
        endpoint.searchParams.set('orderBy','createdAt desc');
        if(token)endpoint.searchParams.set('pageToken',token);
        const result=await json(endpoint.toString());
        const messages=(result.documents||[]).map(doc=>{
          const fields=decodeFields(doc.fields||{});
          return {id:String(doc.name||'').split('/').pop(),uid:String(fields.uid||''),message:String(fields.message||''),page:String(fields.page||''),sentAt:String(fields.sentAt||''),createdAt:String(fields.createdAt||''),emailStatus:String(fields.emailStatus||'unconfigured')};
        });
        if(!token){
          try{
            const access=await accessToken(),notificationUrl=`${base}/documents/users/${encodeURIComponent(admin.uid)}/developerMessageNotifications/current?updateMask.fieldPaths=unreadCount`;
            const reset=await request(notificationUrl,{method:'PATCH',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:JSON.stringify({fields:{unreadCount:{integerValue:'0'}}})});
            if(!reset.ok&&reset.status!==404)console.warn('Contact unread count reset failed',{status:reset.status});
          }catch{console.warn('Contact unread count reset failed');}
        }
        send(res,200,{messages,nextPageToken:result.nextPageToken||null});return;
      }
      if(url.pathname==='/api/admin/session'){send(res,200,{admin:true,apiVersion:'1.5.10'});return;}
      if(url.pathname==='/api/admin/retry-screen-logs'){
        const ids=[...new Set((url.searchParams.get('uids')||'').split(',').filter(Boolean))];
        if(!ids.length||ids.length>6||ids.some(id=>id.length>128||!/^[-A-Za-z0-9_]+$/.test(id)))throw fail('対象は6人以内で指定してください。',400);
        const users=await Promise.all(ids.map(uid=>cached('retry-screen:'+uid,async()=>{
          const name=`projects/${projectId}/databases/(default)/documents/users/${uid}/apps/eiken-retry`;
          const rows=await json(base+'/documents:batchGet',{method:'POST',body:JSON.stringify({documents:[name],mask:{fieldPaths:['state.screenLogs']}})});
          const data=decodeFields(rows[0]?.found?.fields||{});
          return {uid,logs:Array.isArray(data.state?.screenLogs)?data.state.screenLogs.slice(-100):[]};
        })));
        send(res,200,{users,fetchedAt:now()});return;
      }
      if(url.pathname==='/api/admin/user'){

        const uid=url.searchParams.get('uid')||'';if(!uid||uid.length>128||/[\/\u0000-\u001f]/.test(uid))throw fail('ユーザーIDが不正です。',400);
        send(res,200,await detail(uid));return;
      }
      const query=url.searchParams.get('search')||'';
      if(query){send(res,200,await search(query));return;}
      const token=url.searchParams.get('pageToken')||'';
      if(token.length>4096||url.searchParams.has('limit')&&url.searchParams.get('limit')!=='6')throw fail('一覧は6人ずつ取得してください。',400);
      send(res,200,await page(token));
    }catch(error){send(res,error.status||500,{error:error.message||'管理情報を取得できませんでした。'});}
  }
  function updateCoins(uid,coins){
    for(const [key,e] of cache){
      if(e.value?.users)for(const user of e.value.users)if(user.uid===uid)user.coins=coins;
      if(e.value?.uid===uid&&e.value.apps?.['english-playroom'])e.value.apps['english-playroom'].coins=coins;
      if(key==='summary:'+uid&&e.value)e.value.coins=coins;
    }
  }
  function invalidate(uid){cache.delete('detail:'+uid);cache.delete('summary:'+uid);cache.delete('nicknames');cache.delete('activity:'+uid);cache.delete('unrecorded');for(const [key,e]of cache)if(key.startsWith('page:')||key.startsWith('code-page:'))cache.delete(key);}
  async function activeIds(){return (await authDirectory()).filter(u=>!u.disabled&&typeof u.localId==='string'&&u.localId.length>0&&u.localId.length<=128&&!/[\/\u0000-\u001f]/.test(u.localId)).map(u=>u.localId);}
  function invalidateLearning(uid){cache.delete('activity:'+uid);cache.delete('summary:'+uid);cache.delete('unrecorded');for(const key of cache.keys())if(key.startsWith('page:'))cache.delete(key);}
  async function adminIds(){const email=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase();if(!email)return [];return (await authDirectory()).filter(u=>String(u.email||'').trim().toLowerCase()===email).map(u=>u.localId).filter(Boolean);}
  return {handle,updateCoins,invalidate,invalidateLearning,activeIds,adminIds};
}
