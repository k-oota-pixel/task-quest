const CURATED_SOURCES=[
  {kind:'rss',name:'Digital Agency Japan',url:'https://www.digital.go.jp/rss/news.xml',category:'technology',scope:'japan'},
  {kind:'rss',name:'Cabinet Office Japan',url:'https://www.cao.go.jp/rss/news.rdf',category:'world',scope:'japan'},
  {kind:'rss',name:'MHLW Japan',url:'https://www.mhlw.go.jp/stf/news.rdf',category:'health',scope:'japan'},
  {kind:'rss',name:'Consumer Affairs Agency Japan',url:'https://www.caa.go.jp/news.rss',category:'life',scope:'japan'},
  {kind:'html',name:'METI Japan',url:'https://www.meti.go.jp/press/',category:'business',scope:'japan',include:/\/press\/20\d\d\//i},
  {kind:'html',name:'JAXA Japan',url:'https://www.jaxa.jp/press/',category:'science',scope:'japan',include:/\/press\//i},
  {kind:'html',name:'Ministry of Environment Japan',url:'https://www.env.go.jp/press/',category:'environment',scope:'japan',include:/\/press\//i},
  {kind:'html',name:'MEXT Japan',url:'https://www.mext.go.jp/b_menu/houdou/',category:'education',scope:'japan',include:/\/b_menu\/houdou\//i},
  {kind:'html',name:'Japan Sports Agency',url:'https://www.mext.go.jp/sports/b_menu/houdou/',category:'sports',scope:'japan',include:/\/sports\/b_menu\/houdou\//i},
  {kind:'html',name:'Agency for Cultural Affairs Japan',url:'https://www.bunka.go.jp/koho_hodo_oshirase/hodohappyo/',category:'culture',scope:'japan',include:/\/koho_hodo_oshirase\/hodohappyo\//i},
  {kind:'rss',name:'BBC World',url:'https://feeds.bbci.co.uk/news/world/rss.xml',category:'world'},
  {kind:'rss',name:'BBC Sport',url:'https://feeds.bbci.co.uk/sport/rss.xml',category:'sports'},
  {kind:'rss',name:'The Guardian World',url:'https://www.theguardian.com/world/rss',category:'world'},
  {kind:'rss',name:'NASA News',url:'https://www.nasa.gov/news-release/feed/',category:'science'},
  {kind:'rss',name:'MIT News',url:'https://news.mit.edu/rss/feed',category:'technology'},
  {kind:'rss',name:'UN News',url:'https://news.un.org/feed/subscribe/en/news/all/rss.xml',category:'world'},
  {kind:'rss',name:'NOAA',url:'https://www.noaa.gov/rss.xml',category:'environment'},
  {kind:'rss',name:'NASA JPL',url:'https://www.jpl.nasa.gov/feeds/news/',category:'science'},
  {kind:'rss',name:'NASA CNEOS',url:'https://cneos.jpl.nasa.gov/feed/news.xml',category:'science'},
  {kind:'rss',name:'FDA MedWatch',url:'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml',category:'health'},
  {kind:'rss',name:'UNESCO-UNEVOC',url:'https://connect.unevoc.unesco.org/unevoc_news.xml',category:'education'},
  {kind:'rss',name:'European Central Bank',url:'https://www.ecb.europa.eu/rss/press.html',category:'business'},
  {kind:'html',name:'IOC',url:'https://www.olympics.com/ioc/news',category:'sports',include:/\/ioc\//i},
  {kind:'html',name:'Apple Newsroom',url:'https://www.apple.com/newsroom/',category:'technology',include:/\/newsroom\//i}
].map(source=>({...source,scope:source.scope||'world'}));

const GENERIC_LINK=/^(home|news|newsroom|read more|learn more|view all|load more|next|previous|press releases?|latest news|more)$/i;
const MAX_SOURCE_BYTES=2_000_000;
const MAX_EXCERPT=3200;
const MAX_CANDIDATES=28;
export function isArticleUrl(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!/\.(?:js|css|json|xml|pdf|png|jpe?g|gif|svg|webp|zip|mp[34])$/i.test(url.pathname);}catch{return false;}
}
export function isRecentArticle(value,now=new Date()){
  const published=Date.parse(value||'');
  return Number.isFinite(published)&&published<=now.getTime()+3_600_000&&published>=now.getTime()-72*3_600_000;
}

function clean(value,max=10000){return String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
function decodeEntities(value){
  return String(value||'')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(Number.parseInt(n,16)))
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ');
}
function stripHtml(value,max=MAX_EXCERPT){
  return clean(decodeEntities(String(value||'')
    .replace(/<script\b[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi,' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi,' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi,' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi,' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi,' ')
    .replace(/<[^>]+>/g,' ')),max);
}
function normalizeUrl(value,base){
  try{
    const url=new URL(decodeEntities(String(value||'')),base);
    if(!['http:','https:'].includes(url.protocol))return '';
    if(url.protocol==='http:')url.protocol='https:';
    url.hash='';
    return url.toString();
  }catch{return '';}
}
function dateIso(value){const time=Date.parse(String(value||''));return Number.isFinite(time)?new Date(time).toISOString():'';}
function localizedDateIso(value){
  const source=stripHtml(value,12000);const found=[];
  for(const match of source.matchAll(/(20\d{2})\s*[年\/.\-]\s*(\d{1,2})\s*[月\/.\-]\s*(\d{1,2})\s*日?/g))found.push({index:match.index||0,year:Number(match[1]),month:Number(match[2]),day:Number(match[3])});
  for(const match of source.matchAll(/令和\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)){
    const eraYear=match[1]==='元'?1:Number(match[1]);found.push({index:match.index||0,year:2018+eraYear,month:Number(match[2]),day:Number(match[3])});
  }
  found.sort((a,b)=>b.index-a.index);const item=found[0];if(!item)return '';
  const date=new Date(Date.UTC(item.year,item.month-1,item.day));
  return Number.isNaN(date.getTime())?'':date.toISOString();
}
function tagText(block,names){
  for(const name of names){const match=block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`,'i'));if(match)return stripHtml(decodeEntities(match[1]),6000);}
  return '';
}
function linkFromBlock(block,base){
  const textLink=block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1];
  const attrLink=block.match(/<link\b[^>]*(?:href|url)=["']([^"']+)["'][^>]*\/?>/i)?.[1];
  const guid=block.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i)?.[1];
  return normalizeUrl(stripHtml(textLink||attrLink||guid||'',2000),base);
}

export function parseFeed(xml,source){
  const blocks=[...String(xml||'').matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(match=>match[2]);
  const items=[];
  for(const block of blocks){
    const title=tagText(block,['title']);
    const url=linkFromBlock(block,source.url);
    if(!title||!url||!isArticleUrl(url))continue;
    const publishedAt=dateIso(tagText(block,['pubDate','published','updated','dc:date','date']))||localizedDateIso(block);
    const summary=tagText(block,['description','summary','content:encoded','content']);
    items.push({sourceName:source.name,sourcePage:source.url,categoryHint:source.category,scopeHint:source.scope||'world',title,url,publishedAt,summary:clean(summary,1800)});
  }
  return items;
}

export function parseHtmlIndex(html,source){
  const raw=String(html||''),out=[];const seen=new Set();
  const linkRe=/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for(const match of raw.matchAll(linkRe)){
    const title=stripHtml(match[2],240);if(title.length<18||GENERIC_LINK.test(title))continue;
    const url=normalizeUrl(match[1],source.url);if(!url||!isArticleUrl(url)||seen.has(url))continue;
    try{const baseHost=new URL(source.url).hostname.replace(/^www\./,'');const host=new URL(url).hostname.replace(/^www\./,'');if(!(host===baseHost||host.endsWith(`.${baseHost}`)))continue;}catch{continue;}
    if(source.include&&!source.include.test(new URL(url).pathname))continue;
    const index=Number(match.index)||0;
    const publishedAt=localizedDateIso(raw.slice(Math.max(0,index-6000),index));
    seen.add(url);out.push({sourceName:source.name,sourcePage:source.url,categoryHint:source.category,scopeHint:source.scope||'world',title,url,publishedAt,summary:''});
    if(out.length>=18)break;
  }
  return out;
}

function publishedFromHtml(html){
  const candidates=[
    html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1],
    html.match(/["']datePublished["']\s*:\s*["']([^"']+)["']/i)?.[1],
    html.match(/<meta\b[^>]*(?:property|name)=["'](?:article:published_time|date|pubdate)["'][^>]*content=["']([^"']+)["']/i)?.[1],
    html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:article:published_time|date|pubdate)["']/i)?.[1]
  ];
  for(const value of candidates){const iso=dateIso(value);if(iso)return iso;}
  return localizedDateIso(html);
}
function articleText(html){
  const article=String(html||'').match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const main=String(html||'').match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  return stripHtml(article||main||html,MAX_EXCERPT);
}
async function fetchText(url,fetchImpl,timeout=12000,htmlOnly=false){
  const response=await fetchImpl(url,{headers:{'User-Agent':'Monstudy-TODAY/1.0 (+https://k-oota-pixel.github.io/english-playroom/today/)','Accept':'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.5'},redirect:'follow',signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  if(htmlOnly&&!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(String(response.headers?.get?.('content-type')||'')))throw new Error('not an HTML article');
  const length=Number(response.headers?.get?.('content-length')||0);if(length>MAX_SOURCE_BYTES)throw new Error('response too large');
  const buffer=Buffer.from(await response.arrayBuffer());if(buffer.length>MAX_SOURCE_BYTES)throw new Error('response too large');
  let encoding='utf-8';const contentType=String(response.headers?.get?.('content-type')||'').toLowerCase();if(/charset\s*=\s*utf-16/i.test(contentType)||buffer[0]===0xff&&buffer[1]===0xfe)encoding='utf-16le';
  return new TextDecoder(encoding).decode(buffer);
}
async function collectSource(source,fetchImpl){
  try{const body=await fetchText(source.url,fetchImpl);return source.kind==='rss'?parseFeed(body,source):parseHtmlIndex(body,source);}catch(error){console.warn(`TODAY fallback source failed: ${source.name}: ${error?.message||error}`);return [];}
}
function candidateScore(candidate,now){
  const published=Date.parse(candidate.publishedAt||'');if(!Number.isFinite(published))return 10;
  const hours=Math.max(0,(now.getTime()-published)/3_600_000);return Math.max(-30,80-hours/3);
}
async function enrich(candidate,fetchImpl){
  try{
    const html=await fetchText(candidate.url,fetchImpl,10000,true);
    const excerpt=articleText(html);
    return {...candidate,publishedAt:candidate.publishedAt||publishedFromHtml(html),excerpt:excerpt.length>=120?excerpt:''};
  }catch(error){console.warn(`TODAY fallback article failed: ${candidate.sourceName}: ${candidate.url}: ${error?.message||error}`);return {...candidate,excerpt:''};}
}
function dedupe(items){
  const seen=new Set(),out=[];for(const item of items){const key=item.url.replace(/\/$/,'');if(seen.has(key))continue;seen.add(key);out.push(item);}return out;
}
function sourceList(candidates){return [...new Map(candidates.map(item=>[item.url,{name:item.sourceName,url:item.url,categoryHint:item.categoryHint,scope:item.scopeHint||item.scope||'world'}])).values()];}
function countBy(items,key){const counts=new Map();for(const item of items){const value=key(item);counts.set(value,(counts.get(value)||0)+1);}return [...counts].map(([name,count])=>`${name}=${count}`).join(', ');}
function takeDiverse(pool,wanted,selected,usedUrls){
  const categoryCounts=new Map();
  for(let round=0;round<5&&selected.length<MAX_CANDIDATES;round++){
    for(const item of pool){
      if(selected.length>=MAX_CANDIDATES||wanted<=0)break;
      if(usedUrls.has(item.url)||(categoryCounts.get(item.categoryHint)||0)!==round)continue;
      selected.push(item);usedUrls.add(item.url);categoryCounts.set(item.categoryHint,round+1);wanted--;
    }
  }
  return wanted;
}
function selectEnrichmentCandidates(items){
  const selected=[],usedUrls=new Set();
  const japan=items.filter(item=>(item.scopeHint||'world')==='japan');
  const world=items.filter(item=>(item.scopeHint||'world')==='world');
  let japanRemaining=Math.min(18,japan.length);
  japanRemaining=takeDiverse(japan,japanRemaining,selected,usedUrls);
  let worldWanted=Math.min(10,MAX_CANDIDATES-selected.length);
  worldWanted=takeDiverse(world,worldWanted,selected,usedUrls);
  for(const item of items){if(selected.length>=MAX_CANDIDATES)break;if(usedUrls.has(item.url))continue;selected.push(item);usedUrls.add(item.url);}
  return selected;
}

export function selectRegionalStories(candidates,{total=6,japanRatio=0.85}={}){
  const items=Array.isArray(candidates)?candidates:[];
  const count=Math.max(1,Math.floor(Number(total)||6));
  const ratio=Number.isFinite(Number(japanRatio))?Math.max(0,Math.min(1,Number(japanRatio))):0.85;
  let japanTarget=Math.round(count*ratio);
  if(count>1&&ratio>0&&ratio<1)japanTarget=Math.max(1,Math.min(count-1,japanTarget));
  const worldTarget=count-japanTarget;
  const selected=[],usedUrls=new Set(),usedCategories=new Set();
  const scopedCount=scope=>selected.filter(item=>(item.scope||item.scopeHint||'world')===scope).length;
  const take=(scope,wanted)=>{
    const pool=items.filter(item=>(item.scope||item.scopeHint||'world')===scope&&!usedUrls.has(item.url));
    for(const preferNew of [true,false]){
      for(const item of pool){
        if(scopedCount(scope)>=wanted)break;
        if(usedUrls.has(item.url))continue;
        if(preferNew&&usedCategories.has(item.categoryHint))continue;
        selected.push(item);usedUrls.add(item.url);usedCategories.add(item.categoryHint);
      }
    }
  };
  take('japan',japanTarget);
  take('world',worldTarget);
  if(selected.length<count){
    for(const preferNew of [true,false]){
      for(const item of items){
        if(selected.length>=count)break;
        if(usedUrls.has(item.url))continue;
        if(preferNew&&usedCategories.has(item.categoryHint))continue;
        selected.push(item);usedUrls.add(item.url);usedCategories.add(item.categoryHint);
      }
    }
  }
  return selected.slice(0,count);
}

export async function discoverNewsFromFeeds({fetchImpl=fetch,now=new Date(),japanRatio=0.85}={}){
  const groups=await Promise.all(CURATED_SOURCES.map(source=>collectSource(source,fetchImpl)));
  console.log(`TODAY fallback index candidates: ${groups.map((items,index)=>`${CURATED_SOURCES[index].name}=${items.length}`).join(', ')}`);
  const all=dedupe(groups.flat()).filter(item=>isArticleUrl(item.url)&&(!item.publishedAt||isRecentArticle(item.publishedAt,now))).sort((a,b)=>candidateScore(b,now)-candidateScore(a,now));
  console.log(`TODAY fallback recent candidates: ${countBy(all,item=>`${item.sourceName}/${item.categoryHint}/${item.scopeHint||'world'}`)}`);
  if(all.length<8)throw new Error(`公式フィードの候補が不足しています (${all.length})`);
  const selected=selectEnrichmentCandidates(all);
  console.log(`TODAY fallback enrichment set: ${countBy(selected,item=>`${item.sourceName}/${item.categoryHint}/${item.scopeHint||'world'}`)}`);
  const enriched=[];
  for(let i=0;i<selected.length;i+=6){const batch=await Promise.all(selected.slice(i,i+6).map(item=>enrich(item,fetchImpl)));enriched.push(...batch);}
  const usable=enriched.filter(item=>item.excerpt&&isRecentArticle(item.publishedAt,now));
  console.log(`TODAY fallback usable: ${countBy(usable,item=>`${item.sourceName}/${item.categoryHint}/${item.scopeHint||'world'}`)}`);
  if(usable.length<8)throw new Error(`公式フィードの本文候補が不足しています (${usable.length})`);
  const allCompact=usable.slice(0,MAX_CANDIDATES).map(item=>({
    source:item.sourceName,categoryHint:item.categoryHint,scope:item.scopeHint||'world',title:item.title,url:item.url,publishedAt:item.publishedAt||'',summary:clean(item.summary,1400),excerpt:clean(item.excerpt,MAX_EXCERPT)
  }));
  const requiredStories=selectRegionalStories(allCompact,{total:6,japanRatio});
  if(requiredStories.length<6)throw new Error('公式フィードから6記事を確保できませんでした');
  const seenCategories=new Set(requiredStories.map(item=>item.categoryHint));
  if(seenCategories.size<5)throw new Error(`公式フィードの分野が不足しています (${[...seenCategories].join(', ')})`);
  const requiredUrls=new Set(requiredStories.map(item=>item.url));
  const alternates=allCompact.filter(item=>!requiredUrls.has(item.url));
  const compact=[...requiredStories,...alternates];
  return {
    mode:'curated-feeds',
    research:JSON.stringify({mode:'curated official sources',collectedAt:now.toISOString(),instruction:'Use only facts explicitly present in each candidate summary/excerpt. IMPORTANT: create exactly one TODAY article for EACH item in requiredStories, in the same order. Do not replace, merge, or duplicate these stories. Preserve each item scope (japan or world) and use categoryHint as that story primary category. The URL is the canonical source.',requiredStories,alternates},null,2),
    sources:sourceList(compact),
    queries:[],
    candidateCount:compact.length
  };
}

export {CURATED_SOURCES};