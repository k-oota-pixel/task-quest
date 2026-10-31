import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFeed,parseHtmlIndex,discoverNewsFromFeeds,isArticleUrl,isRecentArticle} from './today-feeds.mjs';

test('parseFeed supports RSS items and Atom links while normalizing HTTP sources to HTTPS',()=>{
  const rss=`<rss><channel><item><title>NOAA studies a new ocean event</title><link>http://example.gov/ocean</link><pubDate>Thu, 30 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[Scientists reported a measured change in the ocean.]]></description></item></channel></rss>`;
  const items=parseFeed(rss,{name:'NOAA',url:'https://example.gov/rss.xml',category:'environment'});
  assert.equal(items.length,1);assert.equal(items[0].url,'https://example.gov/ocean');assert.equal(items[0].categoryHint,'environment');assert.match(items[0].summary,/Scientists reported/);
  const atom=`<feed><entry><title>New education program opens</title><link href="/news/education"/><updated>2026-10-30T12:00:00Z</updated><summary>Students can join a new program.</summary></entry></feed>`;
  const atomItems=parseFeed(atom,{name:'Education',url:'https://example.edu/feed',category:'education'});
  assert.equal(atomItems[0].url,'https://example.edu/news/education');
});

test('parseHtmlIndex keeps useful same-site newsroom links',()=>{
  const html=`<a href="/ioc/news/story-one">A new youth sports program begins in Senegal</a><a href="/home">Home</a><a href="https://evil.example/story">An unrelated external story should not be kept</a>`;
  const items=parseHtmlIndex(html,{name:'IOC',url:'https://www.olympics.com/ioc/news',category:'sports',include:/\/ioc\//i});
  assert.equal(items.length,1);assert.equal(items[0].categoryHint,'sports');assert.match(items[0].url,/olympics\.com\/ioc\/news\/story-one/);
});

test('discoverNewsFromFeeds builds a diverse compact packet despite individual source failures',async()=>{
  const feedBody=(category,index)=>`<rss><channel>${Array.from({length:3},(_,i)=>`<item><title>${category} verified update ${index}-${i} for students</title><link>https://source${index}.example/story-${i}</link><pubDate>Thu, 30 Oct 2026 10:0${i}:00 GMT</pubDate><description>Verified facts about ${category} event ${i} from an official source.</description></item>`).join('')}</channel></rss>`;
  const indexHtml=`<a href="/ioc/news/sports-one">Olympic leaders announce a new youth sports initiative</a><a href="/ioc/news/sports-two">Athletes join a new international education program</a>`;
  const appleHtml=`<a href="/newsroom/2026/10/apple-technology-one/">Apple announces a new technology accessibility feature</a><a href="/newsroom/2026/10/apple-technology-two/">Developers receive new tools for creative applications</a>`;
  const sourceBodies=new Map([
    ['https://www.noaa.gov/rss.xml',feedBody('environment',1)],
    ['https://www.jpl.nasa.gov/feeds/news/',feedBody('science',2)],
    ['https://cneos.jpl.nasa.gov/feed/news.xml',feedBody('science',3)],
    ['https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml',feedBody('health',4)],
    ['https://connect.unevoc.unesco.org/unevoc_news.xml',feedBody('education',5)],
    ['https://www.ecb.europa.eu/rss/press.html',feedBody('business',6)],
    ['https://www.olympics.com/ioc/news',indexHtml],
    ['https://www.apple.com/newsroom/',appleHtml]
  ]);
  const fetchImpl=async url=>{
    const key=String(url);const body=sourceBodies.get(key)||`<html><main><article><time datetime="2026-10-30T10:00:00Z"></time><p>This official article explains a verified event with enough factual context for an educational news rewrite. It includes dates, participants, and the main result.</p></article></main></html>`;
    return {ok:true,status:200,headers:{get:name=>name==='content-type'?'text/html; charset=utf-8':String(body.length)},arrayBuffer:async()=>Buffer.from(body)};
  };
  const result=await discoverNewsFromFeeds({fetchImpl,now:new Date('2026-10-31T00:00:00Z')});
  assert.equal(result.mode,'curated-feeds');assert.ok(result.candidateCount>=8);assert.ok(result.sources.length>=8);assert.ok(result.sources.every(source=>source.url.startsWith('https://')));assert.match(result.research,/official sources/);assert.match(result.research,/environment/);assert.match(result.research,/business/);
});

test('source selection rejects assets, old materials, unknown dates and future dates',()=>{
 assert.equal(isArticleUrl('https://cneos.jpl.nasa.gov/news/news.js'),false);
 assert.equal(isArticleUrl('https://example.org/old-book.pdf'),false);
 assert.equal(isArticleUrl('https://example.org/story.html'),true);
 const now=new Date('2026-10-31T00:00:00Z');
 assert.equal(isRecentArticle('2026-10-30T12:00:00Z',now),true);
 assert.equal(isRecentArticle('2020-05-19T00:00:00Z',now),false);
 assert.equal(isRecentArticle('',now),false);
 assert.equal(isRecentArticle('2026-11-02T00:00:00Z',now),false);
});
