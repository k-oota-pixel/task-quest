import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFeed,parseHtmlIndex,discoverNewsFromFeeds,isArticleUrl,isRecentArticle,selectRegionalStories,CURATED_SOURCES} from './today-feeds.mjs';

test('parseFeed supports RSS items and Atom links while normalizing HTTP sources to HTTPS',()=>{
  const rss=`<rss><channel><item><title>NOAA studies a new ocean event</title><link>http://example.gov/ocean</link><pubDate>Thu, 30 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[Scientists reported a measured change in the ocean.]]></description></item></channel></rss>`;
  const items=parseFeed(rss,{name:'NOAA',publisher:'NOAA',url:'https://example.gov/rss.xml',category:'environment'});
  assert.equal(items.length,1);assert.equal(items[0].url,'https://example.gov/ocean');assert.equal(items[0].categoryHint,'environment');assert.equal(items[0].scopeHint,'world');assert.equal(items[0].publisherHint,'NOAA');assert.match(items[0].summary,/Scientists reported/);
  const atom=`<feed><entry><title>New education program opens</title><link href="/news/education"/><updated>2026-10-30T12:00:00Z</updated><summary>Students can join a new program.</summary></entry></feed>`;
  const atomItems=parseFeed(atom,{name:'Education',publisher:'Education',url:'https://example.edu/feed',category:'education',scope:'japan'});
  assert.equal(atomItems[0].url,'https://example.edu/news/education');assert.equal(atomItems[0].scopeHint,'japan');
});

test('parseHtmlIndex keeps useful same-site newsroom links and dates inside the link text',()=>{
  const html=`<a href="/news/story-one">A new youth sports program begins in Hokkaido 2026年10月30日</a><a href="/home">Home</a><a href="https://evil.example/story">An unrelated external story should not be kept</a>`;
  const items=parseHtmlIndex(html,{name:'Local News',publisher:'Local News',url:'https://local.example/news/',category:'sports',include:/\/news\//i,scope:'japan'});
  assert.equal(items.length,1);assert.equal(items[0].categoryHint,'sports');assert.equal(items[0].scopeHint,'japan');assert.equal(items[0].publishedAt,'2026-10-30T00:00:00.000Z');assert.match(items[0].url,/local\.example\/news\/story-one/);
});

test('curated source list favors Japanese private and Hokkaido newsrooms and excludes Japanese ministries',()=>{
  const names=CURATED_SOURCES.map(source=>source.name);
  for(const required of ['UHB Hokkaido News','HTB Hokkaido News','STV Hokkaido News','HBC Hokkaido News','ITmedia NEWS','ITmedia AI+','Impress Watch','GIGAZINE','Gizmodo Japan','Toyokeizai Online','Mynavi News'])assert.ok(names.includes(required),required);
  for(const removed of ['Digital Agency Japan','Cabinet Office Japan','MHLW Japan','Consumer Affairs Agency Japan','METI Japan','Ministry of Environment Japan','MEXT Japan','Japan Sports Agency','Agency for Cultural Affairs Japan','NASA JPL','NASA CNEOS','UN News','NOAA','FDA MedWatch','UNESCO-UNEVOC','European Central Bank','IOC'])assert.equal(names.includes(removed),false,removed);
  assert.ok(CURATED_SOURCES.filter(source=>source.scope==='japan').length>=14);
});

test('Japan-first feed planner selects five Japan stories and one WORLD story when available',()=>{
  const candidates=[
    ...Array.from({length:6},(_,i)=>({url:`https://jp.example/${i}`,sourceName:`JP ${i}`,publisherHint:`JP ${i}`,scope:'japan',categoryHint:['science','technology','health','sports','culture','education'][i]})),
    ...Array.from({length:3},(_,i)=>({url:`https://world.example/${i}`,sourceName:`World ${i}`,publisherHint:`World ${i}`,scope:'world',categoryHint:['world','business','environment'][i]}))
  ];
  const selected=selectRegionalStories(candidates,{total:6,japanRatio:0.85});
  assert.equal(selected.length,6);
  assert.equal(selected.filter(item=>item.scope==='japan').length,5);
  assert.equal(selected.filter(item=>item.scope==='world').length,1);
  assert.ok(new Set(selected.map(item=>item.categoryHint)).size>=5);
});

test('feed planner never selects two stories from the same publisher',()=>{
  const candidates=[
    {url:'https://itmedia.example/1',sourceName:'ITmedia NEWS',publisherHint:'ITmedia',scope:'japan',categoryHint:'technology'},
    {url:'https://itmedia.example/2',sourceName:'ITmedia AI+',publisherHint:'ITmedia',scope:'japan',categoryHint:'science'},
    {url:'https://uhb.example/1',sourceName:'UHB',publisherHint:'UHB',scope:'japan',categoryHint:'life',regionalHint:true,sourceTypeHint:'newsroom'},
    {url:'https://nhk.example/1',sourceName:'NHK',publisherHint:'NHK',scope:'japan',categoryHint:'world'},
    {url:'https://jaxa.example/1',sourceName:'JAXA',publisherHint:'JAXA',scope:'japan',categoryHint:'science'},
    {url:'https://toyokeizai.example/1',sourceName:'Toyokeizai',publisherHint:'Toyokeizai',scope:'japan',categoryHint:'business'},
    {url:'https://mynavi.example/1',sourceName:'Mynavi',publisherHint:'Mynavi',scope:'japan',categoryHint:'culture'},
    {url:'https://bbc.example/1',sourceName:'BBC World',publisherHint:'BBC',scope:'world',categoryHint:'world'},
    {url:'https://bbc.example/2',sourceName:'BBC Sport',publisherHint:'BBC',scope:'world',categoryHint:'sports'},
    {url:'https://guardian.example/1',sourceName:'Guardian',publisherHint:'Guardian',scope:'world',categoryHint:'environment'}
  ];
  const selected=selectRegionalStories(candidates,{total:6,japanRatio:0.85});
  assert.equal(selected.length,6);
  assert.equal(new Set(selected.map(item=>item.publisherHint)).size,6);
  assert.ok(selected.filter(item=>item.publisherHint==='ITmedia').length<=1);
  assert.ok(selected.filter(item=>item.publisherHint==='BBC').length<=1);
});

test('Japan-first feed planner fills shortages instead of stopping generation',()=>{
  const candidates=[
    {url:'https://jp.example/1',sourceName:'JP1',publisherHint:'JP1',scope:'japan',categoryHint:'science'},
    {url:'https://jp.example/2',sourceName:'JP2',publisherHint:'JP2',scope:'japan',categoryHint:'technology'},
    ...Array.from({length:6},(_,i)=>({url:`https://world.example/${i}`,sourceName:`World ${i}`,publisherHint:`World ${i}`,scope:'world',categoryHint:['world','health','sports','culture','business','environment'][i]}))
  ];
  const selected=selectRegionalStories(candidates,{total:6,japanRatio:0.85});
  assert.equal(selected.length,6);
  assert.equal(selected.filter(item=>item.scope==='japan').length,2);
  assert.equal(selected.filter(item=>item.scope==='world').length,4);
});

test('discoverNewsFromFeeds builds a diverse compact packet despite individual source failures',async()=>{
  const now=new Date('2026-10-31T00:00:00Z');
  const rssFor=(source,index)=>`<rss><channel>${Array.from({length:2},(_,i)=>`<item><title>${source.name} verified ${source.category} update ${index}-${i}</title><link>https://article${index}.example/story-${i}</link><pubDate>Fri, 30 Oct 2026 10:0${i}:00 GMT</pubDate><description>Verified facts about a current ${source.category} event for students, including the people involved, the date and the main result.</description></item>`).join('')}</channel></rss>`;
  const htmlIndex=(source,index)=>{
    const paths={
      'UHB Hokkaido News':['/news/single.html?id=100','/news/single.html?id=101'],
      'HTB Hokkaido News':['/news/archives_100.html','/news/archives_101.html'],
      'STV Hokkaido News':['/news/stvnews/kiji/story100.html','/news/stvnews/kiji/story101.html'],
      'HBC Hokkaido News':['/articles/-/100','/articles/-/101'],
      'Impress Watch':['/docs/news/100.html','/docs/news/101.html'],
      'Gizmodo Japan':['/article/story-100/','/article/story-101/'],
      'Toyokeizai Online':['/articles/-/100','/articles/-/101'],
      'Mynavi News':['/article/20261030-story/','/techplus/article/story-101/'],
      'JAXA Japan':['/press/2026/10/100_j.html','/press/2026/10/101_j.html'],
      'JR Hokkaido Newsroom':['/CM/Info/press/pdf/100.pdf','/CM/Info/press/100.html'],
      'Apple Newsroom':['/newsroom/2026/10/story-100/','/newsroom/2026/10/story-101/']
    }[source.name]||[];
    return paths.map((path,i)=>`<a href="${path}">${source.name} verified ${source.category} story for students number ${i} 2026年10月30日</a>`).join('');
  };
  const indexBodies=new Map(CURATED_SOURCES.map((source,index)=>[source.url,source.kind==='rss'?rssFor(source,index):htmlIndex(source,index)]));
  const fetchImpl=async url=>{
    const key=String(url);
    if(indexBodies.has(key)){
      const body=indexBodies.get(key);
      return {ok:true,status:200,headers:{get:name=>name==='content-type'?(key.includes('rss')||key.endsWith('.xml')?'application/xml':'text/html; charset=utf-8'):String(body.length)},arrayBuffer:async()=>Buffer.from(body)};
    }
    const body=`<html><head><meta property="article:published_time" content="2026-10-30T10:00:00Z"></head><main><article><p>This article explains a verified current event with enough factual context for an educational news rewrite. It includes the date, people involved, what happened, why it matters, and the main result for readers.</p></article></main></html>`;
    return {ok:true,status:200,headers:{get:name=>name==='content-type'?'text/html; charset=utf-8':String(body.length)},arrayBuffer:async()=>Buffer.from(body)};
  };
  const result=await discoverNewsFromFeeds({fetchImpl,now});
  assert.equal(result.mode,'curated-feeds');assert.ok(result.candidateCount>=8);assert.ok(result.sources.length>=8);assert.ok(result.sources.every(source=>source.url.startsWith('https://')));assert.match(result.research,/student-news sources/);assert.match(result.research,/same publisher/);
  const packet=JSON.parse(result.research);assert.equal(packet.requiredStories.length,6);assert.equal(new Set(packet.requiredStories.map(item=>item.publisherHint)).size,6);assert.ok(new Set(packet.requiredStories.map(item=>item.categoryHint)).size>=5);
});

test('source selection rejects assets, old materials, unknown dates and future dates',()=>{
 assert.equal(isArticleUrl('https://example.org/news/news.js'),false);
 assert.equal(isArticleUrl('https://example.org/old-book.pdf'),false);
 assert.equal(isArticleUrl('https://example.org/story.html'),true);
 const now=new Date('2026-10-31T00:00:00Z');
 assert.equal(isRecentArticle('2026-10-30T12:00:00Z',now),true);
 assert.equal(isRecentArticle('2020-05-19T00:00:00Z',now),false);
 assert.equal(isRecentArticle('',now),false);
 assert.equal(isRecentArticle('2026-11-02T00:00:00Z',now),false);
});