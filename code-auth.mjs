import {readFileSync} from 'node:fs';

import {randomBytes,randomInt,createHash,createHmac,createSign,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
export const LEGACY_BEFORE='2026-10-31T05:25:01.087Z';
const alphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const normalizeCode=value=>String(value||'').toUpperCase().replace(/[\s-]/g,'');
export const normalizeId=value=>String(value||'').normalize('NFKC').trim().toLowerCase();
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function newCode(){let value;do{value=Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join('');}while(!/[2-9]/.test(value)||!/[A-Z]/.test(value));return value;}
export function initialCodes(seed){
 if(!seed)return [];
 const values=new Set();let counter=0;
 while(values.size<10000){const bytes=createHmac('sha256',seed).update('registration-v2:'+counter++).digest();const value=Array.from(bytes.subarray(0,6),byte=>alphabet[byte&31]).join('');if(/[2-9]/.test(value)&&/[A-Z]/.test(value))values.add(value);}
 return [...values];
}
export function specialCodes(raw=''){return [...new Set(String(raw).split(',').map(normalizeCode).filter(code=>/^[A-Z0-9]{6}$/.test(code)&&/[A-Z]/.test(code)&&/[0-9]/.test(code)))];}
const preissued=new Set([...initialCodes(process.env.REGISTRATION_CODE_SEED),...specialCodes(process.env.SPECIAL_REGISTRATION_CODES)].map(digest));
export async function passwordRecord(password){
 if(typeof password!=='string'||password.length<6||password.length>12)throw Object.assign(Error('パスワードは6〜12文字で設定してください。'),{status:400});
 const salt=randomBytes(16).toString('hex'),hash=Buffer.from(await derive(password,salt,64,{N:16384,r:8,p:5})).toString('hex');
 return {salt,hash};
}
export async function passwordMatches(password,record){
 if(typeof password!=='string'||password.length>128)return false;
 const hash=Buffer.from(await derive(password,record.salt,64,{N:16384,r:8,p:5}));
 const expected=Buffer.from(record.hash,'hex');return expected.length===hash.length&&timingSafeEqual(expected,hash);
}
export function customToken(sa,uid,reset=false,version=0){
 const now=Math.floor(Date.now()/1000),enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const unsigned=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:sa.client_email,sub:sa.client_email,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:now,exp:now+3600,uid,claims:{codeAccount:true,codeVersion:version,passwordResetRequired:reset}});
 return unsigned+'.'+createSign('RSA-SHA256').update(unsigned).end().sign(sa.private_key,'base64url');
}
export function createCodeAuth({base,projectId,accessToken,serviceAccount,verifyUser,verifyAdmin,isAdmin=()=>false,readJson,send,fail,encodeFields,decodeFields,fetchImpl=fetch,issuedHashes=preissued}){
 const prefix='projects/'+projectId+'/databases/(default)/documents/';
 async function request(url,options={}){
  const access=await accessToken(),response=await fetchImpl(url,{...options,headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  if(!response.ok)throw fail('登録情報を更新できませんでした。入力済みのコード・IDか、通信状態を確認してください。',response.status===409||response.status===412?409:502);
  return data;
 }
 async function read(collection,id){
  const access=await accessToken(),r=await fetchImpl(base+'/documents/'+collection+'/'+id,{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(10000)});
  if(r.status===404)return null;const data=await r.json();if(!r.ok)throw fail('登録情報を確認できませんでした。',503);
  return {value:decodeFields(data.fields),updateTime:data.updateTime};
 }
 const write=(collection,id,value,previous)=>({update:{name:prefix+collection+'/'+id,fields:encodeFields(value)},currentDocument:previous?{updateTime:previous.updateTime}:{exists:false}});
 const commit=writes=>request(base+'/documents:commit',{method:'POST',body:JSON.stringify({writes})});
 const limits=new Map(),codeFailures=new Map();let active=0;
 function codeAttempt(req,failed=false){const key=digest(String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',').at(-1).trim()),now=Date.now();for(const [id,value]of codeFailures)if(now-value.start>900000)codeFailures.delete(id);const value=codeFailures.get(key)||{start:now,count:0};if(value.count>=20)throw fail('登録コードの入力間違いが続いたため、15分ほど待ってからお試しください。',429);if(failed){value.count++;codeFailures.set(key,value);}}
 function throttle(req){
  // Render's trusted proxy appends the client address. Never use the first, client-supplied entry.
  const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',').at(-1).trim();
  const now=Date.now(),key=digest(ip),old=limits.get(key);
  if(limits.size>10000)for(const [k,v] of limits)if(now-v.start>900000)limits.delete(k);
  const item=old&&now-old.start<900000?old:{start:now,count:0};item.count++;limits.set(key,item);
  if(item.count>1000||active>=8)throw fail('試行回数が多いため、時間をおいて再度お試しください。',429);
 }
 async function state(uid){const index=await read('account_uids',uid);return index?read('code_accounts',index.value.idKey):null;}
 async function admission(user){
  const account=await state(user.uid);
  if(account&&user.provider==='custom'&&Number(user.codeVersion||0)!==Number(account.value.version||0))throw fail('ログインし直してください。',401);
  if(account)return {registered:true,loginId:account.value.loginId,resetRequired:!!account.value.resetRequired};
  if(Number(user.createdAt)>0&&Number(user.createdAt)<Date.parse(LEGACY_BEFORE)&&user.provider!=='anonymous')return {registered:false,resetRequired:false};
  throw fail('新規登録には先生から配付された登録コードが必要です。',403);
 }
 async function handle(req,res){
  try{
   if(req.method!=='POST')throw fail('POSTのみ対応しています。',405);
   if(!req.headers['content-type']?.startsWith('application/json'))throw fail('JSONで送信してください。',415);
   const route=new URL(req.url,'http://localhost').pathname,body=await readJson(req,65536);
   if(route.startsWith('/api/admin/code-')){
    await verifyAdmin(req);
    if(route==='/api/admin/code-issue'){
     const count=Number(body.count);if(!Number.isInteger(count)||count<1||count>200)throw fail('1〜200件ずつ発行してください。',400);
     const unique=new Set();while(unique.size<count){const code=newCode();if(!issuedHashes.has(digest(code)))unique.add(code);}const codes=[...unique];
     await commit(codes.map(code=>write('registration_codes',digest(normalizeCode(code)),{used:false,createdAt:new Date().toISOString()})));
     return send(res,200,{codes});
    }
    if(route==='/api/admin/code-import'){
     if(!Array.isArray(body.hashes)||body.hashes.length<1||body.hashes.length>200||body.hashes.some(h=>typeof h!=='string'||!/^ [a-f0-9]{64}$/.test(' '+h)))throw fail('コードデータが不正です。',400);
     // Re-imports are safe: never overwrite a consumed code.
     const writes=[];
     for(const hash of new Set(body.hashes))if(!await read('registration_codes',hash))writes.push(write('registration_codes',hash,{used:false,createdAt:new Date().toISOString()}));
     if(writes.length)await commit(writes);
     return send(res,200,{imported:writes.length});
    }
    const key=digest(normalizeCode(body.code)),code=await read('registration_codes',key);
    if(!code?.value.uid)throw fail('紐づいた利用者が見つかりません。',404);
    const account=await state(code.value.uid);if(!account)throw fail('登録情報が見つかりません。',404);
    if(route==='/api/admin/code-lookup')return send(res,200,{uid:account.value.uid,loginId:account.value.loginId});
    if(route==='/api/admin/code-reset'){
     const temporaryPassword=randomBytes(9).toString('base64url'),record=await passwordRecord(temporaryPassword);
     await commit([write('code_accounts',digest(account.value.loginId),{...account.value,...record,resetRequired:true,version:Number(account.value.version||0)+1,temporaryUntil:Date.now()+86400000},account)]);
     return send(res,200,{loginId:account.value.loginId,temporaryPassword,expiresHours:24});
    }
    throw fail('ページが見つかりません。',404);
   }
   if(route==='/api/account/session'){const user=await verifyUser(req),session=await admission(user);return send(res,200,{...session,admin:isAdmin(user)===true&&!session.resetRequired});}
   if(route==='/api/account/password'){
    throttle(req);const user=await verifyUser(req),account=await state(user.uid);if(!account)throw fail('コードの紐づけが必要です。',400);
    if(!await passwordMatches(body.currentPassword,account.value))throw fail('現在のパスワードが違います。',403);
    if(body.currentPassword===body.password)throw fail('現在のパスワードとは異なるものにしてください。',400);
    const record=await passwordRecord(body.password);
    await commit([write('code_accounts',digest(account.value.loginId),{...account.value,...record,resetRequired:false,temporaryUntil:0},account)]);
    return send(res,200,{token:customToken(serviceAccount(),user.uid,false,Number(account.value.version||0))});
   }
   throttle(req);
   const identity=digest(normalizeId(body.loginId)),attemptKey='id:'+identity,attempt=limits.get(attemptKey),now=Date.now();
   const identityWindow=attempt&&now-attempt.start<900000?attempt:{start:now,count:0};identityWindow.count++;limits.set(attemptKey,identityWindow);if(identityWindow.count>25)throw fail('このIDでの試行回数が多すぎます。時間をおいて再度お試しください。',429);
   active++;
   try{
    const loginId=normalizeId(body.loginId),idKey=digest(loginId);
    if(!/^[a-z0-9][a-z0-9_-]{3,31}$/.test(loginId))throw fail('IDは4〜32文字の半角英数字・ハイフン・アンダーバーで入力してください。',400);
    if(route==='/api/account/login'){
     const account=await read('code_accounts',idKey);
     const dummy={salt:'0'.repeat(32),hash:'0'.repeat(128)};
     const valid=await passwordMatches(body.password,account?.value||dummy);
     if(!account||!valid||(account.value.resetRequired&&Date.now()>account.value.temporaryUntil))throw fail('IDまたはパスワードが違うか、仮パスワードの期限が切れています。',401);
     return send(res,200,{token:customToken(serviceAccount(),account.value.uid,!!account.value.resetRequired,Number(account.value.version||0))});
    }
    if(!['/api/account/register','/api/account/link'].includes(route))throw fail('ページが見つかりません。',404);
    codeAttempt(req);const code=normalizeCode(body.code);
    if(!/^[A-Z0-9]{6}$/.test(code)){codeAttempt(req,true);throw fail('登録コードを確認してください。',400);}
    const codeKey=digest(code),stored=await read('registration_codes',codeKey);
    const unused=stored|| (issuedHashes.has(codeKey)?{value:{used:false}}:null);
    if(!unused||unused.value.used){codeAttempt(req,true);throw fail('登録コードが無効、または使用済みです。',400);}
    let uid='code_'+randomBytes(20).toString('hex');
    if(route.endsWith('/link')){const user=await verifyUser(req);await admission(user);uid=user.uid;if(await state(uid))throw fail('このアカウントは紐づけ済みです。',409);}
    const record=await passwordRecord(body.password);
    const writes=[write('registration_codes',codeKey,{...unused.value,used:true,uid},stored),write('code_accounts',idKey,{uid,loginId,...record,resetRequired:false,createdAt:new Date().toISOString()}),write('account_uids',uid,{idKey})];
    await commit(writes);
    return send(res,200,{token:customToken(serviceAccount(),uid)});
   }finally{active--;}
  }catch(error){send(res,error.status||500,{error:error.status?error.message:'認証処理に失敗しました。時間をおいて再度お試しください。'});}
 }
 return {handle,admission,inventoryFingerprint:digest([...issuedHashes].sort().join('\n'))};
}

