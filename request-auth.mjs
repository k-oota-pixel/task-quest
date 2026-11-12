export const ONLINE_BATTLE_ADMISSION_TTL_MS=60*60*1000;
export const SHOP_GIFT_ADMISSION_TTL_MS=60*1000;
export const LEARNER_ADMISSION_TTL_MS=60*1000;

function admissionCacheScope(req){
 try{
  const path=new URL(String(req?.url||''),'http://localhost').pathname;
  if(path.startsWith('/api/online-battle'))return 'battle';
  if(path.startsWith('/api/shop/gifts/'))return 'gift';
  if(path==='/api/friends'||path.startsWith('/api/friends/'))return 'friend';
  if(path.startsWith('/api/')&&!path.startsWith('/api/admin/')&&!path.startsWith('/api/account/'))return 'learner';
  return '';
 }catch{return '';}
}

// Authenticate every HTTP request. Share only successful Firestore admission
// lookups for the same account version, including parallel learner requests.
export function createRequestVerifier({verifyRawUser,admission,fail,now=Date.now,battleAdmissionTtlMs=ONLINE_BATTLE_ADMISSION_TTL_MS,giftAdmissionTtlMs=SHOP_GIFT_ADMISSION_TTL_MS,learnerAdmissionTtlMs=LEARNER_ADMISSION_TTL_MS}){
 const verified=new WeakMap(),admissionCache=new Map();
 async function checkAdmission(user,scope){
  const ttl=scope==='battle'?battleAdmissionTtlMs:scope==='gift'||scope==='friend'?giftAdmissionTtlMs:scope==='learner'?learnerAdmissionTtlMs:0;
  if(ttl<=0){
   const session=await admission(user);
   if(session.resetRequired)throw fail('パスワードを再設定してください。',403);
   return;
  }
  const at=Number(now()),group=scope==='battle'?'battle':ttl;
  const key=JSON.stringify([user.uid,user.provider||'',Number(user.codeVersion||0),group]);
  const cached=admissionCache.get(key);
  if(cached&&at<cached.until)return cached.pending;
  if(admissionCache.size>=2000){
   for(const [id,value] of admissionCache)if(at>=value.until)admissionCache.delete(id);
   if(admissionCache.size>=2000)admissionCache.delete(admissionCache.keys().next().value);
  }
  const entry={uid:user.uid,until:at+ttl,pending:Promise.resolve().then(async()=>{
   const session=await admission(user);
   if(session.resetRequired)throw fail('パスワードを再設定してください。',403);
  }).catch(error=>{
   if(admissionCache.get(key)===entry)admissionCache.delete(key);
   throw error;
  })};
  admissionCache.set(key,entry);
  return entry.pending;
 }
 function verifyUser(req){
  let pending=verified.get(req);
  if(!pending){
   pending=Promise.resolve().then(async()=>{
    const user=await verifyRawUser(req);
    await checkAdmission(user,admissionCacheScope(req));
    return user;
   });
   verified.set(req,pending);
  }
  return pending;
 }
 verifyUser.invalidateAdmission=uid=>{
  for(const [key,entry] of admissionCache)if(entry.uid===uid)admissionCache.delete(key);
 };
 return verifyUser;
}

export function isAdministrator(user,adminEmail){
 return Boolean(adminEmail)&&String(user?.email||'').toLowerCase()===adminEmail&&user?.emailVerified===true;
}
