const http=require('node:http');
const {createSign}=require('node:crypto');

const GITHUB_ORIGIN='https://k-oota-pixel.github.io';
const FIREBASE_PROJECT_ID=process.env.FIREBASE_PROJECT_ID||'eiken-retry';
const FIREBASE_WEB_API_KEY=process.env.FIREBASE_WEB_API_KEY||'AIzaSyAllLjPcGhygMSEIORXhKZOaDjYvpSJ4EQ';
const ADMIN_EMAIL=(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
const FIRESTORE_BASE=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE_PROJECT_ID)}/databases/(default)`;
let googleAccessToken='',googleAccessTokenUntil=0;

function send(res,status,obj){
  if(res.headersSent)return res.end();
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  res.end(JSON.stringify(obj));
}
function fail(message,status=500){const error=new Error(message);error.status=status;return error;}
function getServiceAccount(){
  let raw=process.env.FIREBASE_SERVICE_ACCOUNT_JSON||'';
  if(!raw&&process.env.FIREBASE_SERVICE_ACCOUNT_B64){try{raw=Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64,'base64').toString('utf8');}catch{}}
  if(!raw)throw fail('管理画面のFirebase管理設定が未完了です。',503);
  let sa;try{sa=JSON.parse(raw);}catch{throw fail('管理画面のFirebase管理設定を確認してください。',503);}
  if(!sa?.client_email||!sa?.private_key)throw fail('管理画面のFirebase管理設定を確認してください。',503);
  return sa;
}
function b64urlJson(value){return Buffer.from(JSON.stringify(value)).toString('base64url');}
async function getGoogleAccessToken(){
  if(googleAccessToken&&Date.now()<googleAccessTokenUntil-60000)return googleAccessToken;
  const sa=getServiceAccount(),now=Math.floor(Date.now()/1000);
  const header=b64urlJson({alg:'RS256',typ:'JWT'});
  const claims=b64urlJson({iss:sa.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const unsigned=`${header}.${claims}`,signer=createSign('RSA-SHA256');signer.update(unsigned);signer.end();
  const assertion=`${unsigned}.${signer.sign(sa.private_key).toString('base64url')}`;
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok||!data.access_token)throw fail('Firebase管理用の認証に失敗しました。',503);
  googleAccessToken=data.access_token;googleAccessTokenUntil=Date.now()+Number(data.expires_in||3600)*1000;return googleAccessToken;
}
async function verifyUser(req){
  const auth=String(req.headers.authorization||''),match=auth.match(/^Bearer\s+(.+)$/i);
  if(!match)throw fail('ログインが必要です。',401);
  const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:match[1]})});
  let data={};try{data=await response.json();}catch{}
  const user=data.users?.[0];if(!response.ok||!user?.localId||!user?.email)throw fail('ログイン情報を確認できませんでした。',401);
  return {uid:user.localId,email:user.email,displayName:user.displayName||''};
}
async function verifyAdmin(req){
  if(!ADMIN_EMAIL)throw fail('管理者メールアドレスが未設定です。',503);
  const user=await verifyUser(req);if(String(user.email).toLowerCase()!==ADMIN_EMAIL)throw fail('このアカウントには管理権限がありません。',403);return user;
}
function decodeFirestoreValue(v){
  if(!v||typeof v!=='object')return null;
  if('nullValue'in v)return null;if('stringValue'in v)return v.stringValue;if('booleanValue'in v)return !!v.booleanValue;
  if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return Number(v.doubleValue);if('timestampValue'in v)return v.timestampValue;
  if('arrayValue'in v)return (v.arrayValue.values||[]).map(decodeFirestoreValue);
  if('mapValue'in v){const out={};for(const [k,val]of Object.entries(v.mapValue.fields||{}))out[k]=decodeFirestoreValue(val);return out;}
  return null;
}
function decodeFields(input={}){const out={};for(const [key,value]of Object.entries(input))out[key]=decodeFirestoreValue(value);return out;}
function setCors(req,res){
  if(req.headers.origin===GITHUB_ORIGIN){res.setHeader('Access-Control-Allow-Origin',GITHUB_ORIGIN);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');}
}

const monitorPromise=import('./security-monitor.mjs').then(({createSecurityMonitor})=>createSecurityMonitor({
  base:FIRESTORE_BASE,projectId:FIREBASE_PROJECT_ID,accessToken:getGoogleAccessToken,verifyAdmin,send,fail,decodeFields
})).catch(error=>{console.error('Security monitor failed to initialize:',error);return null;});

const originalCreateServer=http.createServer;
http.createServer=function(options,requestListener){
  if(typeof options==='function'){requestListener=options;options=undefined;}
  const wrapped=async(req,res)=>{
    let monitor=null;try{monitor=await monitorPromise;}catch{}
    const pathname=(()=>{try{return new URL(req.url||'/','http://localhost').pathname;}catch{return '/';}})();
    if(pathname==='/api/admin/security'&&req.method!=='OPTIONS'){
      setCors(req,res);
      if(!monitor)return send(res,503,{error:'セキュリティ監視を初期化できませんでした。'});
      return monitor.handleAdmin(req,res);
    }
    if(monitor){
      const decision=monitor.inspect(req);
      if(decision.blocked)return send(res,404,{error:'ページが見つかりません。'});
    }
    return requestListener(req,res);
  };
  return options===undefined?originalCreateServer.call(http,wrapped):originalCreateServer.call(http,options,wrapped);
};

console.log('Security monitor preload installed');
