const CURATED_SOURCES=[
  {kind:'rss',name:'NOAA',url:'https://www.noaa.gov/rss.xml',category:'environment'},
  {kind:'rss',name:'NASA JPL',url:'https://www.jpl.nasa.gov/feeds/news/',category:'science'},
  {kind:'rss',name:'NASA CNEOS',url:'https://cneos.jpl.nasa.gov/feed/news.xml',category:'science'},
  {kind:'rss',name:'FDA MedWatch',url:'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml',category:'health'},
  {kind:'rss',name:'UNESCO-UNEVOC',url:'https://connect.unevoc.unesco.org/unevoc_news.xml',category:'education'},
  {kind:'rss',name:'European Central Bank',url:'https://mid.ecb.europa.eu/rss/mid.xml',category:'business'},
  {kind:'html',name:'IOC',url:'https://www.olympics.com/ioc/news',category:'sports',include:/\/ioc\//i},
  {kind:'html',name:'Apple Newsroom',url:'https://www.apple.com/newsroom/',category:'technology',include:/\/newsroom\//i}
];

const GENERIC_LINK=/^(home|news|newsroom|read more|learn more|view all|load more|next|previous|press releases?|latest news|more)$/i;
const MAX_SOURCE_BYTES=2_000_000;
const MAX_EXCERPT=3200;
const MAX_CANDIDATES=28;

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
  try{const url=new URL(decodeEntities(String(value||'')),base);if(!['http:','https:'].includes(url.protocol))return '';url.hash='';return url.toString();}catch{return '';}
}
function dateIso(value){const time=Date.parse(String(value||''));return Number.isFinite(time)?new Date(time).toISOString():'';}
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
    if(!title||!url)continue;
    const publishedAt=dateIso(tagText(block,['pubDate','published','updated','dc:date','date']));
    const summary=tagText(block,['description','summary','content:encoded','content']);
    items.push({sourceName:source.name,sourcePage:source.url,categoryHint:source.category,title,url,publishedAt,summary:clean(summary,1800)});
  }
  return items;
}

export function parseHtmlIndex(html,source){
  const out=[];const seen=new Set();
  const linkRe=/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for(const match of String(html||'').matchAll(linkRe)){
    const title=stripHtml(match[2],240);if(title.length<18||GENERIC_LINK.test(title))continue;
    const url=normalizeUrl(match[1],source.url);if(!url||seen.has(url))continue;
    try{const baseHost=new URL(source.url).hostname.replace(/^www\./,'');const host=new URL(url).hostname.replace(/^www\./,'');if(!(host===baseHost||host.endsWith(`.${baseHost}`)))continue;}catch{continue;}
    if(source.include&&!source.include.test(new URL(url).pathname))continue;
    seen.add(url);out.push({sourceName:source.name,sourcePage:source.url,categoryHint:source.category,title,url,publishedAt:'',summary:''});
    if(out.length>=18)break;
  }
  return out;
}

function publishedFromHtml(html){
  const candidates=[
    html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1],
    html.match(/["']datePublished["']\s*:\s*["']([^"']+)["']/i)?.[1],
    html.match(/<meta\b[^>]*(?:property|name)=["'](?:article:published_time|date|pubdate)["'][^>]*content=["']([^"']+)["']/i)?.[1]
  ];
  for(const value of candidates){const iso=dateIso(value);if(iso)return iso;}
  return '';
}
function articleText(html){
  const article=String(html||'').match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const main=String(html||'').match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  return stripHtml(article||main||html,MAX_EXCERPT);
}
async function fetchText(url,fetchImpl,timeout=12000){
  const response=await fetchImpl(url,{headers:{'User-Agent':'Monstudy-TODAY/1.0 (+https://k-oota-pixel.github.io/english-playroom/today/)','Accept':'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.5'},redirect:'follow',signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
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
    const html=await fetchText(candidate.url,fetchImpl,10000);
    const excerpt=articleText(html);
    return {...candidate,publishedAt:candidate.publishedAt||publishedFromHtml(html),excerpt:excerpt.length>=120?excerpt:''};
  }catch{return {...candidate,excerpt:''};}
}
function dedupe(items){
  const seen=new Set(),out=[];for(const item of items){const key=item.url.replace(/\/$/,'');if(seen.has(key))continue;seen.add(key);out.push(item);}return out;
}
function sourceList(candidates){return [...new Map(candidates.map(item=>[item.url,{name:item.sourceName,url:item.url,categoryHint:item.categoryHint}])).values()];}

export async function discoverNewsFromFeeds({fetchImpl=fetch,now=new Date()}={}){
  const groups=await Promise.all(CURATED_SOURCES.map(source=>collectSource(source,fetchImpl)));
  const all=dedupe(groups.flat()).sort((a,b)=>candidateScore(b,now)-candidateScore(a,now));
  if(all.length<8)throw new Error(`公式フィードの候補が不足しています (${all.length})`);
  const perCategory=new Map(),selected=[];
  for(const item of all){const count=perCategory.get(item.categoryHint)||0;if(count>=5)continue;perCategory.set(item.categoryHint,count+1);selected.push(item);if(selected.length>=MAX_CANDIDATES)break;}
  const enriched=[];
  for(let i=0;i<selected.length;i+=6){const batch=await Promise.all(selected.slice(i,i+6).map(item=>enrich(item,fetchImpl)));enriched.push(...batch);}
  const usable=enriched.filter(item=>item.excerpt||item.summary);
  if(usable.length<8)throw new Error(`公式フィードの本文候補が不足しています (${usable.length})`);
  const allCompact=usable.slice(0,MAX_CANDIDATES).map(item=>({
    source:item.sourceName,categoryHint:item.categoryHint,title:item.title,url:item.url,publishedAt:item.publishedAt||'',summary:clean(item.summary,1400),excerpt:clean(item.excerpt,MAX_EXCERPT)
  }));
  const firstByCategory=[];const seenCategories=new Set();
  for(const item of allCompact){if(seenCategories.has(item.categoryHint))continue;seenCategories.add(item.categoryHint);firstByCategory.push(item);}
  if(firstByCategory.length<5)throw new Error(`公式フィードの分野が不足しています (${[...seenCategories].join(', ')})`);
  const requiredStories=firstByCategory.slice(0,6);
  const requiredUrls=new Set(requiredStories.map(item=>item.url));
  if(requiredStories.length<6){
    const extra=allCompact.find(item=>!requiredUrls.has(item.url));
    if(!extra)throw new Error('公式フィードから6記事を確保できませんでした');
    requiredStories.push(extra);requiredUrls.add(extra.url);
  }
  const alternates=allCompact.filter(item=>!requiredUrls.has(item.url));
  const compact=[...requiredStories,...alternates];
  return {
    mode:'curated-feeds',
    research:JSON.stringify({mode:'curated official sources',collectedAt:now.toISOString(),instruction:'Use only facts explicitly present in each candidate summary/excerpt. IMPORTANT: create exactly one TODAY article for EACH item in requiredStories, in the same order. Do not replace, merge, or duplicate these stories. Use categoryHint as that story primary category. The URL is the canonical source.',requiredStories,alternates},null,2),
    sources:sourceList(compact),
    queries:[],
    candidateCount:compact.length
  };
}

export {CURATED_SOURCES};
