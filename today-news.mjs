import {createPublicKey,verify as verifySignature} from 'node:crypto';
import {discoverNewsFromFeeds} from './today-feeds.mjs';

const OIDC_ISSUER='https://token.actions.githubusercontent.com';
const OIDC_AUDIENCE='monstudy-today-daily';
const ALLOWED_REPOSITORY='k-oota-pixel/english-playroom';
const ALLOWED_REPOSITORY_ID='1416249450';
const ALLOWED_REF='refs/heads/main';
const ALLOWED_WORKFLOW_REF='k-oota-pixel/english-playroom/.github/workflows/today-daily.yml@refs/heads/main';
const ALLOWED_EVENTS=new Set(['schedule','workflow_dispatch','push']);
const LEVELS=['5級','4級','3級','準2級','2級','準1級'];
const LEVEL_TARGET_RANGES={'5級':[35,55],'4級':[55,90],'3級':[85,130],'準2級':[125,180],'2級':[180,260],'準1級':[250,360]};
const LEVEL_HARD_LIMITS={'5級':[25,80],'4級':[40,120],'3級':[60,170],'準2級':[90,230],'2級':[130,320],'準1級':[180,430]};
const CATEGORIES=['world','science','technology','health','sports','culture','business','environment','education','life'];
const CAREERS=['medicine','education','science','engineering','it','business','public','global','sports','arts','undecided'];
const RETRYABLE=new Set([429,500,502,503,504]);

let oidcConfigCache=null,oidcConfigUntil=0,jwksCache=null,jwksUntil=0;

function text(value,max=10000){return String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0,max);}
function uniq(values,max=20){return [...new Set((Array.isArray(values)?values:[]).map(value=>text(value,120)).filter(Boolean))].slice(0,max);}
function decodePart(value){return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}
function audienceMatches(value){return Array.isArray(value)?value.includes(OIDC_AUDIENCE):value===OIDC_AUDIENCE;}

export function validateOidcClaims(payload,now=Math.floor(Date.now()/1000)){
  if(!payload||payload.iss!==OIDC_ISSUER||!audienceMatches(payload.aud))return false;
  if(payload.repository!==ALLOWED_REPOSITORY||String(payload.repository_id||'')!==ALLOWED_REPOSITORY_ID)return false;
  if(payload.ref!==ALLOWED_REF||payload.workflow_ref!==ALLOWED_WORKFLOW_REF)return false;
  if(!ALLOWED_EVENTS.has(String(payload.event_name||'')))return false;
  const exp=Number(payload.exp),nbf=Number(payload.nbf||payload.iat||0),iat=Number(payload.iat||0);
  if(!Number.isFinite(exp)||exp<now-60)return false;
  if(Number.isFinite(nbf)&&nbf>now+60)return false;
  if(Number.isFinite(iat)&&iat>now+60)return false;
  return true;
}

async function getOidcConfig(){
  if(oidcConfigCache&&Date.now()<oidcConfigUntil)return oidcConfigCache;
  const response=await fetch(`${OIDC_ISSUER}/.well-known/openid-configuration`,{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Object.assign(new Error('GitHub OIDC設定を確認できません。'),{status:503});
  const data=await response.json();
  if(data.issuer!==OIDC_ISSUER||!/^https:\/\/token\.actions\.githubusercontent\.com\//.test(String(data.jwks_uri||'')))throw Object.assign(new Error('GitHub OIDC設定が不正です。'),{status:503});
  oidcConfigCache=data;oidcConfigUntil=Date.now()+60*60*1000;return data;
}
async function getJwks(){
  if(jwksCache&&Date.now()<jwksUntil)return jwksCache;
  const config=await getOidcConfig();
  const response=await fetch(config.jwks_uri,{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Object.assign(new Error('GitHub OIDC公開鍵を取得できません。'),{status:503});
  const data=await response.json();
  if(!Array.isArray(data.keys)||!data.keys.length)throw Object.assign(new Error('GitHub OIDC公開鍵を確認できません。'),{status:503});
  jwksCache=data.keys;jwksUntil=Date.now()+60*60*1000;return jwksCache;
}

export async function verifyGithubOidcToken(token){
  const parts=String(token||'').split('.');
  if(parts.length!==3)throw Object.assign(new Error('GitHub Actions認証が必要です。'),{status:401});
  let header,payload;
  try{header=decodePart(parts[0]);payload=decodePart(parts[1]);}catch{throw Object.assign(new Error('GitHub Actions認証を確認できません。'),{status:401});}
  if(header.alg!=='RS256'||!header.kid)throw Object.assign(new Error('GitHub Actions認証方式を確認できません。'),{status:401});
  const jwk=(await getJwks()).find(key=>key.kid===header.kid&&key.kty==='RSA');
  if(!jwk)throw Object.assign(new Error('GitHub Actions署名鍵を確認できません。'),{status:401});
  const ok=verifySignature('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url'));
  if(!ok||!validateOidcClaims(payload))throw Object.assign(new Error('このGitHub Actionsからは実行できません。'),{status:403});
  return payload;
}

function japanDateKey(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function slugify(value){
  return text(value,100).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,54)||'story';
}
function wordCount(value){return (String(value||'').match(/\b[A-Za-z]+(?:['’\-][A-Za-z]+)*\b/g)||[]).length;}
function normalizeUrl(value){
  try{const url=new URL(String(value||''));if(!['http:','https:'].includes(url.protocol))return '';url.hash='';return url.toString();}catch{return '';}
}
function urlKey(value){const normalized=normalizeUrl(value);if(!normalized)return '';try{const url=new URL(normalized);url.hostname=url.hostname.toLowerCase();url.searchParams.sort();return url.toString().replace(/\/$/,'');}catch{return normalized;}}
function extractUrls(value){
  const matches=String(value||'').match(/https?:\/\/[^\s<>"')\]}]+/g)||[];
  return [...new Set(matches.map(item=>item.replace(/[.,;:!?]+$/,'')).map(normalizeUrl).filter(Boolean))];
}
function groundedSources(data){
  const metadata=data?.candidates?.[0]?.groundingMetadata||{};
  const chunks=Array.isArray(metadata.groundingChunks)?metadata.groundingChunks:[];
  const sources=[];
  for(const chunk of chunks){
    const web=chunk?.web;if(!web)continue;const url=normalizeUrl(web.uri);if(!url)continue;
    sources.push({name:text(web.title||new URL(url).hostname,180),url});
  }
  return {sources:[...new Map(sources.map(source=>[urlKey(source.url),source])).values()],queries:uniq(metadata.webSearchQueries,30)};
}
function modelText(data){return text(data?.candidates?.[0]?.content?.parts?.filter(part=>!part.thought).map(part=>part.text||'').join('')||'',120000);}


export function geminiRetryDelay(status,retryAfter,detail='',attempt=0,now=Date.now()){
  let delay=status===429?65000:1000*2**attempt;
  const seconds=Number(retryAfter);
  if(retryAfter&&Number.isFinite(seconds))delay=Math.max(delay,seconds*1000);
  else if(retryAfter){const date=Date.parse(retryAfter);if(Number.isFinite(date))delay=Math.max(delay,date-now);}
  try{
    for(const item of JSON.parse(detail)?.error?.details||[]){
      const match=String(item.retryDelay||'').match(/^(\d+(?:\.\d+)?)s$/);
      if(match)delay=Math.max(delay,Math.ceil(Number(match[1])*1000)+1000);
    }
  }catch{}
  return Math.max(0,delay);
}
async function waitForRetry(ms){
  while(ms>0){const step=Math.min(ms,30000);await new Promise(resolve=>setTimeout(resolve,step));ms-=step;}
}


export function plannedStories(research){
  try{const packet=JSON.parse(research);return Array.isArray(packet.requiredStories)&&packet.requiredStories.length===6?packet.requiredStories:null;}catch{return null;}
}
export function plannedStoryPrompt(editionDate,story){
  return `Create exactly ONE original English-learning news article for Japanese students.
Edition: ${editionDate}. Use ONLY verified facts in the source below. Never invent facts, URLs or quotes.
Return {"articles":[one article]} matching the schema. Use categoryHint as primary category; sourcePublishedAt if known; a concise Japanese summaryJa; category/categories/careerTags/tags, an English title and slug, and the exact provided source URL.
Generate ALL SIX English versions with these REQUIRED body lengths:
5級 40-50 words, very short beginner sentences and basic be/have/can verbs.
4級 65-80 words, short junior-high sentences.
3級 95-115 words, junior-high grammar and simple connectors.
準2級 140-160 words, accessible high-school language and verified context.
2級 200-230 words, precise fuller context.
準1級 280-320 words, nuanced natural prose.
Each version needs its own English title and text. Count words before returning; preserve the same factual core.
Verified source: ${JSON.stringify(story)}`;
}

export function articleResearch(research,article){
  try{
    const packet=JSON.parse(research);
    const urls=new Set((article.sources||[]).map(source=>urlKey(source.url)));
    const matches=[...(packet.requiredStories||[]),...(packet.alternates||[])].filter(item=>urls.has(urlKey(item.url)));
    if(matches.length)return JSON.stringify({instruction:'Use only these verified source excerpts.',sources:matches});
  }catch{}
  // Free-form grounded research cannot safely be split at arbitrary text boundaries.
  return research;
}
export function articleRepairPrompt(editionDate,research,article,issues){
  const levels=[...new Set(issues.map(issue=>issue.level))];
  const targets=Object.fromEntries(levels.map(level=>[level,LEVEL_SAFE_REPAIR_RANGES[level]]));
  return `Repair only the requested English versions of this verified TODAY story.
Edition: ${editionDate}.
Return JSON only: {"levels":{"requested level":{"title":"...","text":"..."}}}.
Requested levels and REQUIRED body word counts: ${JSON.stringify(targets)}.
Count words before returning. Use the level styles: 5級 very short beginner sentences; 4級 basic junior-high; 3級 junior-high grammar; 準2級 accessible high-school; 2級 precise fuller context; 準1級 nuanced natural prose.
Use only the verified facts below; never invent facts to fill space or copy source sentences.
Preserve the story and source URLs. Return no other levels or metadata.
All levels in ascending difficulty must have nondecreasing body lengths.
Current story: ${JSON.stringify(article)}
Issues: ${JSON.stringify(issues)}
Verified research: ${articleResearch(research,article)}`;
}
export function mergeRepairedArticle(article,raw,issues){
  const levels={...article.levels};
  for(const level of new Set(issues.map(issue=>issue.level))){
    const repaired=normalizeSingleRepairedLevel(raw?.levels?.[level]);
    if(!repaired)throw Object.assign(new Error(`TODAYの${level}修復結果を読み取れませんでした。`),{status:502});
    levels[level]=repaired;
  }
  return {...article,levels};
}

export async function callGemini({apiKey,model,body,timeout=70000,label='Gemini',fetchImpl=fetch,sleep=waitForRetry}){
  let response=null;
  for(let attempt=0;attempt<3;attempt++){
    try{
      response=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
        method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},signal:AbortSignal.timeout(timeout),body:JSON.stringify(body)
      });
    }catch(error){
      if(attempt===2)throw Object.assign(new Error(`${label}への接続に失敗しました。`),{status:error?.name==='TimeoutError'?504:502});
      await sleep(900*(attempt+1));continue;
    }
    if(response.ok)break;
    const detail=await response.text();
    if(!RETRYABLE.has(response.status)||attempt===2){
      console.error(`${label} HTTP ${response.status}`);
      throw Object.assign(new Error(response.status===429?'Geminiの利用上限に達しました。':`${label}に接続できません。`),{status:response.status===429?429:502});
    }
    const delay=geminiRetryDelay(response.status,response.headers?.get?.('retry-after'),detail,attempt);
    console.warn(`${label} HTTP ${response.status}; retry in ${Math.ceil(delay/1000)}s`);
    await sleep(delay);
  }
  const data=await response.json();
  const candidate=data?.candidates?.[0];
  if(!candidate||!candidate.content)throw Object.assign(new Error(`${label}の回答を読み取れません。`),{status:502});
  return data;
}

function discoveryPrompt(editionDate){return `
You are the research editor for TODAY, a daily English-news reading feature for Japanese high-school students.
Edition date in Japan: ${editionDate}.

Use Google Search extensively and build a VERIFIED research packet for 10-14 news candidates from roughly the last 48 hours (up to 72 hours only if a category is unusually quiet).
The final publication will choose six stories, so deliberately cover many different fields from this set: world/social affairs, science, AI/technology, health, sports, culture/entertainment, business/economy, environment/nature, education/careers, life/travel.
Include a Japan-related story when there is a genuinely useful one, but keep the edition internationally broad.

Verification rules:
- Prefer primary sources: governments, public agencies, universities, peer-reviewed journals, international organizations, companies for their own announcements, official sports leagues/federations.
- Whenever practical, cross-check each event with a second independent reputable source.
- Do not use rumors, social-media-only claims, partisan opinion pieces, campaign persuasion, anonymous speculation, clickbait, or unsupported health claims.
- For political or geopolitical news, describe only verified events and decisions in neutral language. Avoid persuasive framing.
- Avoid graphic violence, sexual material, self-harm details, extremist propaganda, and stories whose main value is shock. A major serious event may be included only when educationally important and described non-graphically.
- Record exact names, dates, numbers, and direct canonical source URLs. Never invent a URL.
- If sources disagree, note the disagreement and do not present the disputed point as settled fact.

For each candidate provide:
1) short English working headline,
2) one primary category from: world, science, technology, health, sports, culture, business, environment, education, life,
3) what happened and why it matters to teenagers,
4) 4-8 atomic verified facts that are safe to reuse verbatim in meaning,
5) publication/event date,
6) two or more source entries when available, each with source name, article/page title, and DIRECT URL.

Return a compact research packet. JSON is preferred, but factual completeness and source accuracy are more important than formatting.`.trim();}

const outputSchema={type:'OBJECT',properties:{articles:{type:'ARRAY',minItems:6,maxItems:6,items:{type:'OBJECT',properties:{slug:{type:'STRING'},category:{type:'STRING'},categories:{type:'ARRAY',items:{type:'STRING'}},careerTags:{type:'ARRAY',items:{type:'STRING'}},tags:{type:'ARRAY',items:{type:'STRING'}},title:{type:'STRING'},summaryJa:{type:'STRING'},sourcePublishedAt:{type:'STRING'},levels:{type:'OBJECT',properties:{'5級':{type:'OBJECT',properties:{title:{type:'STRING'},text:{type:'STRING'}},required:['title','text']},'4級':{type:'OBJECT',properties:{title:{type:'STRING'},text:{type:'STRING'}},required:['title','text']},'3級':{type:'OBJECT',properties:{title:{type:'STRING'},text:{type:'STRING'}},required:['title','text']},'準2級':{type:'OBJECT',properties:{title:{type:'STRING'},text:{type:'STRING'}},required:['title','text']},'2級':{type:'OBJECT',properties:{title:{type:'STRING'},text:{type:'STRING'}},required:['title','text']},'準1級':{type:'OBJECT',properties:{title:{type:'STRING'},text:{type:'STRING'}},required:['title','text']}},required:LEVELS},sources:{type:'ARRAY',minItems:1,maxItems:4,items:{type:'OBJECT',properties:{name:{type:'STRING'},url:{type:'STRING'}},required:['name','url']}}},required:['slug','category','categories','careerTags','tags','title','summaryJa','levels','sources']}}},required:['articles']};

function generationPrompt(editionDate,researchText,sourceList){return `
You are the final editor for TODAY, an English-learning news feature for Japanese high-school students.
Edition date: ${editionDate}.

Choose EXACTLY SIX distinct stories from the VERIFIED RESEARCH PACKET below. The six stories must cover at least five different primary categories. Prefer stories that are educationally useful, current, concrete, and varied. Avoid six versions of the same technology/business theme.
If the research packet contains a requiredStories array, you MUST write exactly one article for each requiredStories item in the same order. Do not substitute an alternate. Use each required story's categoryHint as its primary category.

NON-NEGOTIABLE FACT RULES:
- Use ONLY facts that appear in the research packet or source list below.
- Do not infer missing numbers, causes, motives, quotations, or future outcomes.
- If a detail is uncertain or sources conflict, omit it.
- Sources in your output must use exact URLs from the research packet/source list. Never create or repair a URL from memory.
- The English texts are original educational rewrites, not copied passages. Do not reproduce source sentences.

Classification:
- category: exactly one of world, science, technology, health, sports, culture, business, environment, education, life.
- categories: 0-3 useful secondary categories from the same list, excluding the primary category.
- careerTags: 1-4 from medicine, education, science, engineering, it, business, public, global, sports, arts, undecided.
- tags: 4-8 concise topic tags.
- summaryJa: one clear Japanese sentence summarizing the verified event.
- sourcePublishedAt: ISO date if known; otherwise empty string.

Create six ORIGINAL English versions of the same verified story. Preserve the same factual core while changing linguistic difficulty. The word-count ranges below are REQUIRED generation targets; do not compress the upper levels merely to save output tokens:
- 5級: about 35-55 words. Use very short sentences and highly frequent junior-high beginner vocabulary. Prefer simple be-verbs, have, can, basic present/past verbs, names, places, numbers, and concrete nouns. Avoid passive voice, long clauses, abstract explanation, and difficult synonyms whenever possible.
- 4級: about 55-90 words. Short sentences, common vocabulary, basic present/past forms. Avoid unnecessary subordinate clauses.
- 3級: about 85-130 words. Common junior-high grammar, simple connectors and explanations.
- 準2級: about 125-180 words. High-school accessible vocabulary, clear cause/effect and context.
- 2級: about 180-260 words. More precise vocabulary and fuller context, but still direct newspaper-style prose.
- 準1級: about 250-360 words. Nuanced context and sophisticated but natural vocabulary; no unsupported analysis.
Each level needs its own natural English title.

Do not add comprehension questions, translations, vocabulary lists, commentary, or Markdown. Return only the requested JSON.

VERIFIED RESEARCH PACKET:
${researchText}

GROUNDING SOURCE LIST (these URLs are allowed):
${sourceList.map((source,index)=>`${index+1}. ${source.name} — ${source.url}`).join('\n')}
`.trim();}

export function collectLevelLengthIssues(articles){
  const issues=[];
  for(const [articleIndex,article] of (Array.isArray(articles)?articles:[]).entries()){
    let previousWords=0;
    for(const level of LEVELS){
      const words=Number(article?.levels?.[level]?.wordCount)||wordCount(article?.levels?.[level]?.text||'');
      const [min,max]=LEVEL_TARGET_RANGES[level];
      if(words<min||words>max)issues.push({articleIndex,id:text(article?.id||article?.title||'',120),level,words,min,max,type:'range'});
      if(previousWords&&words<previousWords)issues.push({articleIndex,id:text(article?.id||article?.title||'',120),level,words,previousWords,type:'progression'});
      previousWords=words;
    }
  }
  return issues;
}

export function collectLevelHardFailures(articles){
  const failures=[];
  for(const [articleIndex,article] of (Array.isArray(articles)?articles:[]).entries()){
    let previousWords=0;
    for(const level of LEVELS){
      const words=Number(article?.levels?.[level]?.wordCount)||wordCount(article?.levels?.[level]?.text||'');
      const [min,max]=LEVEL_HARD_LIMITS[level];
      if(words<min||words>max)failures.push({articleIndex,id:text(article?.id||article?.title||'',120),level,words,min,max,type:'hard-range'});
      if(previousWords&&words<previousWords)failures.push({articleIndex,id:text(article?.id||article?.title||'',120),level,words,previousWords,type:'progression'});
      previousWords=words;
    }
  }
  return failures;
}

const LEVEL_SAFE_REPAIR_RANGES={'5級':[42,48],'4級':[68,76],'3級':[100,110],'準2級':[145,155],'2級':[205,220],'準1級':[285,305]};

function normalizeSingleRepairedLevel(raw){
  const levelTitle=text(raw?.title,180),body=text(raw?.text,12000);
  if(!levelTitle||!body)return null;
  return {title:levelTitle,text:body,wordCount:wordCount(body)};
}

export function normalizeGeneratedArticles(rawArticles,{editionDate,allowedUrls,categoryByUrl=new Map()}){
  const allowedMap=new Map([...allowedUrls].map(url=>[urlKey(url),normalizeUrl(url)]).filter(([key])=>key));
  const articles=[];const usedIds=new Set();
  for(const raw of Array.isArray(rawArticles)?rawArticles:[]){
    if(articles.length>=6)break;
    const hintedCategory=(Array.isArray(raw?.sources)?raw.sources:[]).map(source=>categoryByUrl.get(urlKey(source?.url))).find(item=>CATEGORIES.includes(item));
    const category=hintedCategory||(CATEGORIES.includes(raw?.category)?raw.category:'');if(!category)continue;
    const categories=uniq(raw.categories,3).filter(item=>CATEGORIES.includes(item)&&item!==category);
    const careerTags=uniq(raw.careerTags,4).filter(item=>CAREERS.includes(item));
    const tags=uniq(raw.tags,8);
    const title=text(raw.title,180),summaryJa=text(raw.summaryJa,260);if(!title||!summaryJa)continue;
    const levels={};let levelsOk=true;
    for(const level of LEVELS){const item=raw?.levels?.[level];const levelTitle=text(item?.title,180),body=text(item?.text,12000);if(!levelTitle||!body){levelsOk=false;break;}levels[level]={title:levelTitle,text:body,wordCount:wordCount(body)};}
    if(!levelsOk)continue;
    const sources=[];
    for(const source of Array.isArray(raw.sources)?raw.sources:[]){const key=urlKey(source?.url);const approved=allowedMap.get(key);if(!approved)continue;sources.push({name:text(source?.name,180)||new URL(approved).hostname,url:approved});}
    const cleanSources=[...new Map(sources.map(source=>[urlKey(source.url),source])).values()].slice(0,4);if(!cleanSources.length)continue;
    let base=`${editionDate}-${slugify(raw.slug||title)}`,id=base,suffix=2;while(usedIds.has(id))id=`${base}-${suffix++}`;usedIds.add(id);
    articles.push({id,date:editionDate,category,categories,careerTags:careerTags.length?careerTags:['undecided'],tags,title,summaryJa,sourcePublishedAt:text(raw.sourcePublishedAt,20),levels,sources:cleanSources});
  }
  if(articles.length!==6)throw Object.assign(new Error('TODAYの記事を6本に整形できませんでした。'),{status:502});
  if(new Set(articles.map(article=>article.category)).size<5)throw Object.assign(new Error('TODAYの記事分野が偏りすぎています。'),{status:502});
  return articles;
}

export function createTodayNewsGenerator({apiKey,model='gemini-3.5-flash-lite',searchModel='gemini-3.8-flash',send,fail}){
  let active=false,cacheDay='',cachePayload=null;
  async function handle(req,res){
    try{
      if(req.method!=='POST')throw fail('POSTのみ対応しています。',405);
      const auth=String(req.headers.authorization||'');if(!auth.startsWith('Bearer '))throw fail('GitHub Actions認証が必要です。',401);
      await verifyGithubOidcToken(auth.slice(7));
      if(!apiKey)throw fail('TODAY用Gemini APIキーが未設定です。',503);
      const body=req.headers['content-type']?.startsWith('application/json')?await readSmallJson(req):{};
      const force=body?.force===true;
      const editionDate=japanDateKey();
      if(!force&&cacheDay===editionDate&&cachePayload)return send(res,200,{...cachePayload,cached:true});
      if(active)throw fail('TODAYニュースを生成中です。',409);
      active=true;
      try{
        let discoveryMode='google-search',research='',sourceList=[],searchQueries=[];
        try{
          const discovery=await callGemini({apiKey,model:searchModel,label:'TODAYニュース検索',timeout:80000,body:{contents:[{role:'user',parts:[{text:discoveryPrompt(editionDate)}]}],tools:[{google_search:{}}],generationConfig:{temperature:0.1,maxOutputTokens:6000}}});
          research=modelText(discovery);if(research.length<300)throw fail('TODAYのニュース調査結果が不足しています。',502);
          const grounding=groundedSources(discovery);
          searchQueries=grounding.queries;
          const discoveredUrls=new Set([...extractUrls(research),...grounding.sources.map(source=>source.url)]);
          if(discoveredUrls.size<6)throw fail('TODAYのニュース出典を十分に確認できませんでした。',502);
          sourceList=[...new Map([...grounding.sources,...[...discoveredUrls].map(url=>({name:new URL(url).hostname,url}))].map(source=>[urlKey(source.url),source])).values()].slice(0,80);
        }catch(searchError){
          console.warn(`TODAY Google Search discovery unavailable (${searchError?.status||'error'}): ${searchError?.message||searchError}. Falling back to curated official sources.`);
          const fallback=await discoverNewsFromFeeds();
          discoveryMode=fallback.mode;research=fallback.research;sourceList=fallback.sources;searchQueries=fallback.queries||[];
          console.log(`TODAY fallback collected ${fallback.candidateCount} candidates from curated official sources.`);
        }
        const allowedUrls=new Set([...extractUrls(research),...sourceList.map(source=>source.url)]);
        if(allowedUrls.size<6)throw fail('TODAYのニュース出典を十分に確認できませんでした。',502);
        let parsed;
        const plan=plannedStories(research);
        if(plan){
          const articleSchema={...outputSchema,properties:{articles:{...outputSchema.properties.articles,minItems:1,maxItems:1}}};
          const rawArticles=[];
          for(const story of plan){
            const generated=await callGemini({apiKey,model,label:'TODAY記事生成',timeout:100000,body:{
              contents:[{role:'user',parts:[{text:plannedStoryPrompt(editionDate,story)}]}],
              generationConfig:{temperature:0.15,maxOutputTokens:8000,responseMimeType:'application/json',responseSchema:articleSchema}
            }});
            let result;try{result=JSON.parse(modelText(generated));}catch{throw fail('TODAYの記事生成結果をJSONとして読み取れませんでした。',502);}
            if(result?.articles?.length!==1)throw fail('TODAYの記事生成結果が不足しています。',502);
            // Bind each generated story to the verified source selected by the feed planner.
            rawArticles.push({...result.articles[0],category:story.categoryHint,sources:[{name:story.source,url:story.url}]});
          }
          parsed={articles:rawArticles};
        }else{
          const generated=await callGemini({apiKey,model,label:'TODAY英文生成',timeout:90000,body:{contents:[{role:'user',parts:[{text:generationPrompt(editionDate,research,sourceList)}]}],generationConfig:{temperature:0.15,maxOutputTokens:24576,responseMimeType:'application/json',responseSchema:outputSchema}}});
          try{parsed=JSON.parse(modelText(generated));}catch{throw fail('TODAYの英文生成結果をJSONとして読み取れませんでした。',502);}
        }
        const categoryByUrl=new Map(sourceList.filter(source=>CATEGORIES.includes(source.categoryHint)).map(source=>[urlKey(source.url),source.categoryHint]));
        let articles=normalizeGeneratedArticles(parsed?.articles,{editionDate,allowedUrls,categoryByUrl});
        for(let repairRound=0;repairRound<3;repairRound++){
          const issues=repairRound===0?collectLevelLengthIssues(articles):collectLevelHardFailures(articles);
          if(!issues.length)break;
          const groups=new Map();
          for(const issue of issues){if(!groups.has(issue.articleIndex))groups.set(issue.articleIndex,[]);groups.get(issue.articleIndex).push(issue);}
          console.log(`TODAY article repair round ${repairRound+1}: ${groups.size} stories.`);
          for(const [index,articleIssues] of groups){
            const repaired=await callGemini({apiKey,model,label:'TODAY記事別修復',timeout:100000,body:{
              contents:[{role:'user',parts:[{text:articleRepairPrompt(editionDate,research,articles[index],articleIssues)}]}],
              generationConfig:{temperature:0,maxOutputTokens:8000,responseMimeType:'application/json'}
            }});
            let repairedJson;try{repairedJson=JSON.parse(modelText(repaired));}catch{throw fail('TODAYの記事別修復結果をJSONとして読み取れませんでした。',502);}
            articles[index]=mergeRepairedArticle(articles[index],repairedJson,articleIssues);
          }
        }
        const remainingHardFailures=collectLevelHardFailures(articles);
        if(remainingHardFailures.length){
          const first=remainingHardFailures[0];
          throw fail(`TODAYの6段階英文が公開基準を満たしませんでした: ${first.id} ${first.level} ${first.words}語`,502);
        }
        const payload={generatedAt:new Date().toISOString(),editionDate,model,discoveryMode,searchQueries,articles};
        cacheDay=editionDate;cachePayload=payload;
        console.log(`TODAY generated: ${editionDate} ${articles.length} stories, ${allowedUrls.size} verified URLs via ${discoveryMode}`);
        return send(res,200,payload);
      }finally{active=false;}
    }catch(error){console.error('TODAY generation failed:',error?.message||error);send(res,error.status||500,{error:error.message||'TODAYニュースを生成できませんでした。'});}
  }
  return {handle};
}

async function readSmallJson(req,maxBytes=2048){
  let raw='',size=0;for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw Object.assign(new Error('送信内容が大きすぎます。'),{status:413});raw+=chunk;}
  if(!raw)return {};try{return JSON.parse(raw);}catch{throw Object.assign(new Error('送信内容を読み取れません。'),{status:400});}
}
