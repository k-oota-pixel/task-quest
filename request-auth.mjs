// Share the full admission check only within one HTTP request. A later request
// always checks again, including after account resets or token revocation.
export function createRequestVerifier({verifyRawUser,admission,fail}){
 const verified=new WeakMap();
 return function verifyUser(req){
  let pending=verified.get(req);
  if(!pending){
   pending=Promise.resolve().then(async()=>{
    const user=await verifyRawUser(req),session=await admission(user);
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
