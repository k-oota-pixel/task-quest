import {readFileSync,writeFileSync} from 'node:fs';

let feeds=readFileSync('today-feeds.mjs','utf8');
const sourceListOld="function sourceList(candidates){return [...new Map(candidates.map(item=>[item.url,{name:item.sourceName,url:item.url}])).values()];}";
const sourceListNew="function sourceList(candidates){return [...new Map(candidates.map(item=>[item.url,{name:item.sourceName,url:item.url,categoryHint:item.categoryHint}])).values()];}";
if(feeds.includes(sourceListOld))feeds=feeds.replace(sourceListOld,sourceListNew);
else if(!feeds.includes(sourceListNew))throw new Error('sourceList anchor not found');
const compactOld=`  const compact=usable.slice(0,MAX_CANDIDATES).map(item=>({
    source:item.sourceName,categoryHint:item.categoryHint,title:item.title,url:item.url,publishedAt:item.publishedAt||'',summary:clean(item.summary,1400),excerpt:clean(item.excerpt,MAX_EXCERPT)
  }));
  const categories=[...new Set(compact.map(item=>item.categoryHint))];
  if(categories.length<5)throw new Error(\`公式フィードの分野が不足しています (\${categories.join(', ')})\`);
  return {
    mode:'curated-feeds',
    research:JSON.stringify({mode:'curated official sources',collectedAt:now.toISOString(),instruction:'Use only facts explicitly present in each candidate summary/excerpt. The URL is the canonical source for that candidate.',candidates:compact},null,2),
    sources:sourceList(compact),`;
const compactNew=`  const allCompact=usable.slice(0,MAX_CANDIDATES).map(item=>({
    source:item.sourceName,categoryHint:item.categoryHint,title:item.title,url:item.url,publishedAt:item.publishedAt||'',summary:clean(item.summary,1400),excerpt:clean(item.excerpt,MAX_EXCERPT)
  }));
  const firstByCategory=[];const seenCategories=new Set();
  for(const item of allCompact){if(seenCategories.has(item.categoryHint))continue;seenCategories.add(item.categoryHint);firstByCategory.push(item);}
  if(firstByCategory.length<5)throw new Error(\`公式フィードの分野が不足しています (\${[...seenCategories].join(', ')})\`);
  const requiredStories=firstByCategory.slice(0,6);
  const requiredUrls=new Set(requiredStories.map(item=>item.url));
  const alternates=allCompact.filter(item=>!requiredUrls.has(item.url));
  const compact=[...requiredStories,...alternates];
  return {
    mode:'curated-feeds',
    research:JSON.stringify({mode:'curated official sources',collectedAt:now.toISOString(),instruction:'Use only facts explicitly present in each candidate summary/excerpt. IMPORTANT: create exactly one TODAY article for EACH item in requiredStories, in the same order. Do not replace, merge, or duplicate these stories. Use categoryHint as that story primary category. The URL is the canonical source.',requiredStories,alternates},null,2),
    sources:sourceList(compact),`;
if(feeds.includes(compactOld))feeds=feeds.replace(compactOld,compactNew);
else if(!feeds.includes('requiredStories=firstByCategory.slice(0,6)'))throw new Error('compact anchor not found');
writeFileSync('today-feeds.mjs',feeds);

let news=readFileSync('today-news.mjs','utf8');
const ruleAnchor="Choose EXACTLY SIX distinct stories from the VERIFIED RESEARCH PACKET below. The six stories must cover at least five different primary categories. Prefer stories that are educationally useful, current, concrete, and varied. Avoid six versions of the same technology/business theme.";
const ruleNew=`${ruleAnchor}\nIf the research packet contains a requiredStories array, you MUST write exactly one article for each requiredStories item in the same order. Do not substitute an alternate. Use each required story's categoryHint as its primary category.`;
if(news.includes(ruleAnchor)&&!news.includes("If the research packet contains a requiredStories array"))news=news.replace(ruleAnchor,ruleNew);
const normOld="export function normalizeGeneratedArticles(rawArticles,{editionDate,allowedUrls}){";
const normNew="export function normalizeGeneratedArticles(rawArticles,{editionDate,allowedUrls,categoryByUrl=new Map()}){";
if(news.includes(normOld))news=news.replace(normOld,normNew);
else if(!news.includes(normNew))throw new Error('normalizer signature anchor not found');
const categoryOld="    const category=CATEGORIES.includes(raw?.category)?raw.category:'';if(!category)continue;";
const categoryNew="    const hintedCategory=(Array.isArray(raw?.sources)?raw.sources:[]).map(source=>categoryByUrl.get(urlKey(source?.url))).find(item=>CATEGORIES.includes(item));\n    const category=hintedCategory||(CATEGORIES.includes(raw?.category)?raw.category:'');if(!category)continue;";
if(news.includes(categoryOld))news=news.replace(categoryOld,categoryNew);
else if(!news.includes('const hintedCategory='))throw new Error('category anchor not found');
const normalizeCallOld="        const articles=normalizeGeneratedArticles(parsed?.articles,{editionDate,allowedUrls});";
const normalizeCallNew="        const categoryByUrl=new Map(sourceList.filter(source=>CATEGORIES.includes(source.categoryHint)).map(source=>[urlKey(source.url),source.categoryHint]));\n        const articles=normalizeGeneratedArticles(parsed?.articles,{editionDate,allowedUrls,categoryByUrl});";
if(news.includes(normalizeCallOld))news=news.replace(normalizeCallOld,normalizeCallNew);
else if(!news.includes('const categoryByUrl=new Map'))throw new Error('normalize call anchor not found');
writeFileSync('today-news.mjs',news);
