import {readFileSync,writeFileSync} from 'node:fs';
const path='today-news.mjs';
let source=readFileSync(path,'utf8');

const importAnchor="import {createPublicKey,verify as verifySignature} from 'node:crypto';";
const importLine="import {discoverNewsFromFeeds} from './today-feeds.mjs';";
if(!source.includes(importLine)){
  if(!source.includes(importAnchor))throw new Error('import anchor not found');
  source=source.replace(importAnchor,`${importAnchor}\n${importLine}`);
}

const signatureOld="export function createTodayNewsGenerator({apiKey,model='gemini-2.5-flash',send,fail}){";
const signatureNew="export function createTodayNewsGenerator({apiKey,model='gemini-3.5-flash-lite',searchModel='gemini-2.5-flash',send,fail}){";
if(source.includes(signatureOld))source=source.replace(signatureOld,signatureNew);
else if(!source.includes(signatureNew))throw new Error('generator signature anchor not found');

const oldBlock=`        const discovery=await callGemini({apiKey,model,label:'TODAYニュース検索',timeout:80000,body:{contents:[{role:'user',parts:[{text:discoveryPrompt(editionDate)}]}],tools:[{google_search:{}}],generationConfig:{temperature:0.1,maxOutputTokens:6000}}});
        const research=modelText(discovery);if(research.length<300)throw fail('TODAYのニュース調査結果が不足しています。',502);
        const grounding=groundedSources(discovery);
        const allowedUrls=new Set([...extractUrls(research),...grounding.sources.map(source=>source.url)]);
        if(allowedUrls.size<6)throw fail('TODAYのニュース出典を十分に確認できませんでした。',502);
        const sourceList=[...new Map([...grounding.sources,...[...allowedUrls].map(url=>({name:new URL(url).hostname,url}))].map(source=>[urlKey(source.url),source])).values()].slice(0,80);`;
const newBlock=`        let discoveryMode='google-search',research='',sourceList=[],searchQueries=[];
        try{
          const discovery=await callGemini({apiKey,model:searchModel,label:'TODAYニュース検索',timeout:80000,body:{contents:[{role:'user',parts:[{text:discoveryPrompt(editionDate)}]}],tools:[{google_search:{}}],generationConfig:{temperature:0.1,maxOutputTokens:6000}}});
          research=modelText(discovery);if(research.length<300)throw fail('TODAYのニュース調査結果が不足しています。',502);
          const grounding=groundedSources(discovery);
          searchQueries=grounding.queries;
          const discoveredUrls=new Set([...extractUrls(research),...grounding.sources.map(source=>source.url)]);
          if(discoveredUrls.size<6)throw fail('TODAYのニュース出典を十分に確認できませんでした。',502);
          sourceList=[...new Map([...grounding.sources,...[...discoveredUrls].map(url=>({name:new URL(url).hostname,url}))].map(source=>[urlKey(source.url),source])).values()].slice(0,80);
        }catch(searchError){
          console.warn(\`TODAY Google Search discovery unavailable (\${searchError?.status||'error'}): \${searchError?.message||searchError}. Falling back to curated official sources.\`);
          const fallback=await discoverNewsFromFeeds();
          discoveryMode=fallback.mode;research=fallback.research;sourceList=fallback.sources;searchQueries=fallback.queries||[];
          console.log(\`TODAY fallback collected \${fallback.candidateCount} candidates from curated official sources.\`);
        }
        const allowedUrls=new Set([...extractUrls(research),...sourceList.map(source=>source.url)]);
        if(allowedUrls.size<6)throw fail('TODAYのニュース出典を十分に確認できませんでした。',502);`;
if(source.includes(oldBlock))source=source.replace(oldBlock,newBlock);
else if(!source.includes("discoveryMode='google-search'"))throw new Error('discovery block anchor not found');

const payloadOld="        const payload={generatedAt:new Date().toISOString(),editionDate,model,searchQueries:grounding.queries,articles};";
const payloadNew="        const payload={generatedAt:new Date().toISOString(),editionDate,model,discoveryMode,searchQueries,articles};";
if(source.includes(payloadOld))source=source.replace(payloadOld,payloadNew);
else if(!source.includes(payloadNew))throw new Error('payload anchor not found');

const logOld="        console.log(`TODAY generated: ${editionDate} ${articles.length} stories, ${allowedUrls.size} verified URLs`);";
const logNew="        console.log(`TODAY generated: ${editionDate} ${articles.length} stories, ${allowedUrls.size} verified URLs via ${discoveryMode}`);";
if(source.includes(logOld))source=source.replace(logOld,logNew);

writeFileSync(path,source);
