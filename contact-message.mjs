import {createSign,randomUUID} from 'node:crypto';

const cleanText=value=>String(value??'').replace(/\r\n?/g,'\n').trim();
const safePage=value=>{
  const text=cleanText(value).slice(0,300);
  return /^\/[A-Za-z0-9_~!$&'()*+,;=:@%./?-]*$/.test(text)?text:'/english-playroom/';
};
const b64urlJson=value=>Buffer.from(JSON.stringify(value)).toString('base64url');

function serviceAccount(env){
  let raw=env.FIREBASE_SERVICE_ACCOUNT_JSON||'';
  if(!raw&&env.FIREBASE_SERVICE_ACCOUNT_B64){
    try{raw=Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_B64,'base64').toString('utf8');}catch{}
  }
  if(!raw)return null;
  try{
    const value=JSON.parse(raw);
    return value?.client_email&&value?.private_key?value:null;
  }catch{return null;}
}

async function googleAccessToken(env,fetchImpl){
  const sa=serviceAccount(env);
  if(!sa)throw Object.assign(new Error('お問い合わせ保存の準備ができていません。'),{status:503});
  const now=Math.floor(Date.now()/1000);
  const header=b64urlJson({alg:'RS256',typ:'JWT'});
  const claims=b64urlJson({iss:sa.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const unsigned=`${header}.${claims}`;
  const signer=createSign('RSA-SHA256');signer.update(unsigned);signer.end();
  const assertion=`${unsigned}.${signer.sign(sa.private_key).toString('base64url')}`;
  const response=await fetchImpl('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
    signal:AbortSignal.timeout(10000)
  });
  let data={};try{data=await response.json();}catch{}
  if(!response.ok||!data.access_token)throw Object.assign(new Error('お問い合わせ保存の認証に失敗しました。'),{status:503});
  return data.access_token;
}

function firestoreValue(value){
  if(value===null)return {nullValue:null};
  if(typeof value==='string')return {stringValue:value};
  if(typeof value==='boolean')return {booleanValue:value};
  if(Number.isSafeInteger(value))return {integerValue:String(value)};
  if(typeof value==='number'&&Number.isFinite(value))return {doubleValue:value};
  return {stringValue:String(value)};
}

async function persistMessage({env,fetchImpl,user,message,page,timestamp,createdAt}){
  const accessToken=await googleAccessToken(env,fetchImpl);
  const project=env.FIREBASE_PROJECT_ID||'eiken-retry';
  const id=randomUUID();
  const fields={
    uid:user.uid,
    message,
    page,
    sentAt:timestamp,
    createdAt,
    status:'new',
    emailDelivered:false
  };
  const response=await fetchImpl(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/developerMessages?documentId=${encodeURIComponent(id)}`,{
    method:'POST',
    headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({fields:Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,firestoreValue(value)]))}),
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok){
    let detail='';try{detail=await response.text();}catch{}
    console.error('Contact message persistence failed',{status:response.status,detail:detail.slice(0,300)});
    throw Object.assign(new Error('メッセージを保存できませんでした。少し待ってもう一度お試しください。'),{status:502});
  }
  return {id,accessToken};
}

async function tryEmail({env,fetchImpl,user,message,page,timestamp}){
  const apiKey=cleanText(env.RESEND_API_KEY);
  const to=cleanText(env.CONTACT_TO_EMAIL);
  const from=cleanText(env.CONTACT_FROM_EMAIL);
  if(!apiKey||!to||!from)return false;
  const text=[
    'もんすたでぃから開発者へのメッセージが届きました。','',
    `ユーザーID: ${user.uid}`,`ページ: ${page}`,`送信日時: ${timestamp}`,'',
    '--- メッセージ ---',message
  ].join('\n');
  const response=await fetchImpl('https://api.resend.com/emails',{
    method:'POST',
    headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({from,to:[to],subject:'【もんすたでぃ】開発者へのメッセージ',text}),
    signal:AbortSignal.timeout(12000)
  });
  if(response.ok)return true;
  let detail='';try{detail=await response.text();}catch{}
  console.error('Contact email send failed',{status:response.status,detail:detail.slice(0,300)});
  return false;
}

async function incrementUnread({env,fetchImpl,uid,accessToken}){
  if(!uid)return;
  const project=env.FIREBASE_PROJECT_ID||'eiken-retry';
  const name=`projects/${encodeURIComponent(project)}/databases/(default)/documents/users/${encodeURIComponent(uid)}/developerMessageNotifications/current`;
  const endpoint=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents:commit`;
  const createBody={writes:[{update:{name,fields:{unreadCount:{integerValue:'1'},updatedAt:{timestampValue:new Date().toISOString()}}},currentDocument:{exists:false}}]};
  const create=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify(createBody),signal:AbortSignal.timeout(8000)});
  if(create.ok)return;
  const update=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({writes:[{transform:{document:name,fieldTransforms:[{fieldPath:'unreadCount',increment:{integerValue:'1'}},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}}]}),signal:AbortSignal.timeout(8000)});
  if(!update.ok)throw Error('notification update failed');
}

export function createContactMessage({verifyUser,readJson,send,fail,getAdminUids=async()=>[],fetchImpl=fetch,env=process.env,now=Date.now}){
  const windows=new Map();
  const WINDOW_MS=60*60*1000;
  const LIMIT=5;
  const COOLDOWN_MS=15000;

  function admit(uid){
    const time=now();
    let entry=windows.get(uid);
    if(!entry||time-entry.start>=WINDOW_MS)entry={start:time,count:0,last:0};
    if(entry.last&&time-entry.last<COOLDOWN_MS)throw fail('続けて送信する場合は少し待ってください。',429);
    if(entry.count>=LIMIT)throw fail('メッセージの送信回数が多いため、しばらく待ってからお試しください。',429);
    entry.count++;entry.last=time;windows.set(uid,entry);
  }

  return async function handleContactMessage(req,res){
    if(req.method!=='POST')return send(res,405,{error:'POSTのみ対応しています。'});
    if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'JSONで送信してください。'});
    try{
      const user=await verifyUser(req);
      const body=await readJson(req,8192);
      const message=cleanText(body.message);
      if(!message||[...message].length>2000)throw fail('メッセージは1〜2000文字で入力してください。',400);
      const page=safePage(body.page);
      admit(user.uid);

      const createdAt=new Date(now()).toISOString();
      const timestamp=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'medium'}).format(new Date(now()));
      const saved=await persistMessage({env,fetchImpl,user,message,page,timestamp,createdAt});
      try{for(const uid of await getAdminUids())await incrementUnread({env,fetchImpl,uid,accessToken:saved.accessToken});}catch(error){console.error('Contact notification update failed',{id:saved.id});}
      let emailDelivered=false;try{emailDelivered=await tryEmail({env,fetchImpl,user,message,page,timestamp});}catch{console.info('Contact email delivery unavailable',{id:saved.id});}
      if(!emailDelivered)console.info('Contact message saved without email delivery',{id:saved.id});
      return send(res,200,{ok:true,message:'メッセージを受け付けました。ありがとうございます。'});
    }catch(error){
      return send(res,error.status||500,{error:error.message||'メッセージを送信できませんでした。'});
    }
  };
}
