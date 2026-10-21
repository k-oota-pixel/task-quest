const RETENTION_DAYS=30;
const FLUSH_MS=5000;
const MAX_PENDING=100;

const RULES=[
  {id:'env',severity:'high',label:'環境変数・設定ファイル探索',re:/(?:^|\/)(?:\.env(?:[./]|$)|config\.(?:php|json|ya?ml)(?:$|[/?]))/i},
  {id:'git',severity:'high',label:'Git情報探索',re:/(?:^|\/)\.git(?:\/|$)/i},
  {id:'wordpress',severity:'medium',label:'WordPress探索',re:/(?:^|\/)(?:wp-admin|wp-login\.php|wp-content|wp-includes|xmlrpc\.php)(?:\/|$|\?)/i},
  {id:'db-admin',severity:'high',label:'DB管理画面探索',re:/(?:^|\/)(?:phpmyadmin|pma|adminer(?:\.php)?)(?:\/|$|\?)/i},
  {id:'traversal',severity:'high',label:'パストラバーサル探索',re:/(?:\.\.\/|\.\.\\|%2e%2e|etc\/passwd|proc\/self|windows\/win\.ini)/i},
  {id:'exploit-path',severity:'high',label:'既知の脆弱パス探索',re:/(?:vendor\/phpunit|cgi-bin|eval-stdin\.php|webshell|shell\.php|server-status|actuator\/env)/i},
  {id:'sqli',severity:'high',label:'SQLインジェクション探索',re:/(?:union(?:\s|%20|\+)+select|(?:or|and)(?:\s|%20|\+)+['"]?1['"]?(?:\s|%20|\+)*=(?:\s|%20|\+)*['"]?1|sleep(?:\s|%20)*\(|benchmark(?:\s|%20)*\()/i},
  {id:'xss',severity:'medium',label:'XSS探索',re:/(?:<|%3c)script\b|javascript:/i}
];
const SCANNER_UA=/(?:sqlmap|nikto|nuclei|masscan|zgrab|gobuster|dirbuster|acunetix|nessus|wpscan)/i;
const ODD_METHODS=new Set(['TRACE','TRACK','CONNECT','PROPFIND']);

function encodeValue(value){
  if(value===null)return {nullValue:null};
  if(typeof value==='string')return {stringValue:value};
  if(typeof value==='boolean')return {booleanValue:value};
  if(Number.isSafeInteger(value))return {integerValue:String(value)};
  if(typeof value==='number'&&Number.isFinite(value))return {doubleValue:value};
  if(Array.isArray(value))return {arrayValue:{values:value.map(encodeValue)}};
  if(value&&typeof value==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encodeValue(v)]))}};
  return {nullValue:null};
}
function fields(value){return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encodeValue(v)]));}
function safeDecode(value){try{return decodeURIComponent(value);}catch{return value;}}
function cleanPath(value){
  const raw=String(value||'/').split('#')[0];
  const path=raw.split('?')[0]||'/';
  return safeDecode(path).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,180);
}
function maskedSource(req){
  const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();
  const raw=forwarded||String(req.socket?.remoteAddress||'');
  const v=raw.replace(/^::ffff:/,'');
  if(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(v)){const p=v.split('.');return `${p[0]}.${p[1]}.${p[2]}.xxx`;}
  if(v.includes(':')){const p=v.split(':').filter(Boolean).slice(0,4);return (p.join(':')||'ipv6')+'::/64';}
  return 'unknown';
}
function dayKey(ms){return new Date(ms).toISOString().slice(0,10);}
function severityRank(value){return value==='high'?3:value==='medium'?2:1;}

export function createSecurityMonitor({base,projectId,accessToken,verifyAdmin,send,fail,decodeFields,request=globalThis.fetch,now=Date.now}){
  const pending=new Map();
  let timer=null,flushing=false,lastCleanupDay='';

  function enqueue(event){
    const key=`${event.category}|${event.source}|${event.action}`;
    const existing=pending.get(key);
    if(existing){existing.count+=1;existing.lastSeen=event.lastSeen;existing.samplePath=event.samplePath||existing.samplePath;existing.method=event.method||existing.method;return;}
    if(pending.size>=MAX_PENDING)return;
    pending.set(key,event);
    if(!timer)timer=setTimeout(()=>{timer=null;flush().catch(()=>{});},FLUSH_MS);
  }

  function inspect(req){
    const rawUrl=String(req.url||'/').slice(0,1200);
    const decoded=safeDecode(rawUrl);
    const method=String(req.method||'GET').toUpperCase();
    let rule=RULES.find(item=>item.re.test(rawUrl)||item.re.test(decoded));
    let blocked=!!rule;
    if(!rule&&ODD_METHODS.has(method)){rule={id:'odd-method',severity:'medium',label:'通常使わないHTTPメソッド'};blocked=true;}
    if(!rule&&SCANNER_UA.test(String(req.headers['user-agent']||''))){rule={id:'scanner',severity:'low',label:'既知スキャナのUser-Agent'};blocked=false;}
    if(!rule)return {blocked:false};
    const stamp=now();
    enqueue({
      category:rule.id,label:rule.label,severity:rule.severity,method,
      samplePath:cleanPath(rawUrl),source:maskedSource(req),action:blocked?'blocked':'observed',
      count:1,firstSeen:stamp,lastSeen:stamp,day:dayKey(stamp)
    });
    return {blocked,category:rule.id};
  }

  async function flush(){
    if(flushing||pending.size===0)return;
    flushing=true;
    const batch=[...pending.values()];pending.clear();
    try{
      const token=await accessToken();
      const writes=batch.map((event,index)=>{
        const id=`${event.lastSeen}-${index}-${Math.random().toString(36).slice(2,9)}`;
        const name=`projects/${projectId}/databases/(default)/documents/security_events/${id}`;
        return {update:{name,fields:fields(event)}};
      });
      const response=await request(base+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({writes})});
      if(!response.ok)throw new Error('security log write failed '+response.status);
    }catch(error){
      console.error('Security monitor flush failed:',error?.message||error);
      for(const event of batch){
        const key=`${event.category}|${event.source}|${event.action}`;
        const old=pending.get(key);if(old){old.count+=event.count;old.firstSeen=Math.min(old.firstSeen,event.firstSeen);old.lastSeen=Math.max(old.lastSeen,event.lastSeen);}else if(pending.size<MAX_PENDING)pending.set(key,event);
      }
      if(!timer)timer=setTimeout(()=>{timer=null;flush().catch(()=>{});},60000);
    }finally{flushing=false;}
  }

  async function queryRecent(token,cutoff){
    const structuredQuery={from:[{collectionId:'security_events'}],where:{fieldFilter:{field:{fieldPath:'lastSeen'},op:'GREATER_THAN_OR_EQUAL',value:{integerValue:String(cutoff)}}},orderBy:[{field:{fieldPath:'lastSeen'},direction:'DESCENDING'}],limit:200};
    const response=await request(base+'/documents:runQuery',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery})});
    let body={};try{body=await response.json();}catch{}
    if(!response.ok)throw fail('セキュリティログを取得できませんでした。',response.status===429?429:502);
    const rows=Array.isArray(body)?body:[];
    return rows.map(row=>row.document).filter(Boolean).map(doc=>({id:doc.name.split('/').pop(),...decodeFields(doc.fields||{})}));
  }

  async function cleanup(token,cutoff){
    const today=dayKey(now());if(lastCleanupDay===today)return;lastCleanupDay=today;
    try{
      const query={from:[{collectionId:'security_events'}],where:{fieldFilter:{field:{fieldPath:'lastSeen'},op:'LESS_THAN',value:{integerValue:String(cutoff)}}},orderBy:[{field:{fieldPath:'lastSeen'},direction:'ASCENDING'}],limit:100};
      const response=await request(base+'/documents:runQuery',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:query})});
      const rows=await response.json();if(!response.ok||!Array.isArray(rows))return;
      const names=rows.map(row=>row.document?.name).filter(Boolean);if(!names.length)return;
      await request(base+'/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({writes:names.map(name=>({delete:name}))})});
    }catch(error){console.warn('Security log cleanup skipped:',error?.message||error);}
  }

  async function handleAdmin(req,res){
    try{
      if(req.method!=='GET')throw fail('GETのみ対応しています。',405);
      await verifyAdmin(req);
      await flush();
      const token=await accessToken(),stamp=now(),cutoff=stamp-RETENTION_DAYS*86400000;
      const events=await queryRecent(token,cutoff);
      cleanup(token,cutoff).catch(()=>{});
      const todayStart=new Date(new Date(stamp).toISOString().slice(0,10)+'T00:00:00.000Z').getTime();
      const seven=stamp-7*86400000;
      const total=list=>list.reduce((sum,event)=>sum+Math.max(1,Number(event.count)||1),0);
      const summary={today:total(events.filter(e=>Number(e.lastSeen)>=todayStart)),last7Days:total(events.filter(e=>Number(e.lastSeen)>=seven)),last30Days:total(events),blocked:total(events.filter(e=>e.action==='blocked')),high:total(events.filter(e=>e.severity==='high'))};
      events.sort((a,b)=>Number(b.lastSeen||0)-Number(a.lastSeen||0)||severityRank(b.severity)-severityRank(a.severity));
      send(res,200,{summary,events,retentionDays:RETENTION_DAYS,fetchedAt:stamp,pending:pending.size});
    }catch(error){send(res,error.status||500,{error:error.message||'セキュリティログを取得できませんでした。'});}
  }

  return {inspect,flush,handleAdmin};
}
