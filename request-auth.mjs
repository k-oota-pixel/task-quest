export const ONLINE_BATTLE_ADMISSION_TTL_MS=60*60*1000;
export const SHOP_GIFT_ADMISSION_TTL_MS=60*1000;

function admissionCacheScope(req){
 try{
  const path=new URL(String(req?.url||''),'http://localhost').pathname;
  if(path.startsWith('/api/online-battle'))return 'battle';
  if(path.startsWith('/api/shop/gifts/'))return 'gift';
  if(path==='/api/friends'||path.startsWith('/api/friends/'))return 'friend';
  return '';
 }catch{return '';}
}

// Share the admission check inside each request. For the high-frequency
// online-battle API, SHOP gift API and friends API, cache only the Firestore
// registration result (1h and 1min respectively). Firebase token validation
// is never cached; every new HTTP request is authenticated again.
export function createRequestVerifier({verifyRawUser,admission,fail,now=Date.now,battleAdmissionTtlMs=ONLINE_BATTLE_ADMISSION_TTL_MS,giftAdmissionTtlMs=SHOP_GIFT_ADMISSION_TTL_MS}){
 const verified=new WeakMap(),admissionCache=new Map();
 return function verifyUser(req){
  let pending=verified.get(req);
  if(!pending){
   pending=Promise.resolve().then(async()=>{
    const user=await verifyRawUser(req);
    let session;
    const scope=admissionCacheScope(req);
    const ttl=scope==='battle'?battleAdmissionTtlMs:(scope==='gift'||scope==='friend')?giftAdmissionTtlMs:0;
    if(ttl>0){
     const at=Number(now()),key=`${scope}|${String(user?.uid||'')}|${String(user?.provider||'')}|${Number(user?.codeVersion||0)}`;
     const cached=admissionCache.get(key);
     if(cached&&at<cached.until)session=cached.session;
     else{
      session=await admission(user);
      if(session.resetRequired)throw fail('パスワードを再設定してください。',403);
      admissionCache.set(key,{session,until:at+ttl});
      if(admissionCache.size>2000)for(const [id,value] of admissionCache)if(at>=value.until)admissionCache.delete(id);
      return user;
     }
    }else session=await admission(user);
    if(session.resetRequired)throw fail('パスワードを再設定してください。',403);
    return user;
   });
   verified.set(req,pending);
  }
  return pending;
 };
}

export function isAdministrator(user,adminEmail){
 return Boolean(adminEmail)&&String(user?.email||'').toLowerCase()===adminEmail&&user?.emailVerified===true;
}
