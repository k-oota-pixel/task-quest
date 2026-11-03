export const ONLINE_BATTLE_ADMISSION_TTL_MS=60*60*1000;

function onlineBattleRequest(req){
 try{return new URL(String(req?.url||''),'http://localhost').pathname.startsWith('/api/online-battle');}
 catch{return false;}
}

// Share the full admission check within one HTTP request. Online battle is the
// only exception across requests: raw Firebase authentication is still checked
// every time, while the Firestore-backed admission result is cached for one
// hour so high-frequency battle polling does not keep reading the main DB.
export function createRequestVerifier({verifyRawUser,admission,fail,now=Date.now,battleAdmissionTtlMs=ONLINE_BATTLE_ADMISSION_TTL_MS}){
 const verified=new WeakMap(),battleAdmissions=new Map();
 return function verifyUser(req){
  let pending=verified.get(req);
  if(!pending){
   pending=Promise.resolve().then(async()=>{
    const user=await verifyRawUser(req);
    let session;
    if(onlineBattleRequest(req)&&battleAdmissionTtlMs>0){
     const at=Number(now()),key=`${String(user?.uid||'')}|${String(user?.provider||'')}|${Number(user?.codeVersion||0)}`;
     const cached=battleAdmissions.get(key);
     if(cached&&at<cached.until)session=cached.session;
     else{
      session=await admission(user);
      if(session.resetRequired)throw fail('パスワードを再設定してください。',403);
      battleAdmissions.set(key,{session,until:at+battleAdmissionTtlMs});
      if(battleAdmissions.size>2000)for(const [id,value] of battleAdmissions)if(at>=value.until)battleAdmissions.delete(id);
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
