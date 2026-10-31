import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOidcClaims,normalizeGeneratedArticles,collectLevelLengthIssues,collectLevelHardFailures,articleResearch,mergeRepairedArticle,geminiRetryDelay,callGemini,plannedStories,plannedStoryPrompt} from './today-news.mjs';

const now=2_000_000_000;
const goodClaims={
  iss:'https://token.actions.githubusercontent.com',aud:'monstudy-today-daily',
  repository:'k-oota-pixel/english-playroom',repository_id:'1416249450',ref:'refs/heads/main',
  workflow_ref:'k-oota-pixel/english-playroom/.github/workflows/today-daily.yml@refs/heads/main',
  event_name:'schedule',iat:now-30,nbf:now-30,exp:now+300
};
test('TODAY OIDC claims are narrowly scoped to the daily workflow',()=>{
  assert.equal(validateOidcClaims(goodClaims,now),true);
  assert.equal(validateOidcClaims({...goodClaims,repository:'other/repo'},now),false);
  assert.equal(validateOidcClaims({...goodClaims,repository_id:'1'},now),false);
  assert.equal(validateOidcClaims({...goodClaims,ref:'refs/heads/dev'},now),false);
  assert.equal(validateOidcClaims({...goodClaims,workflow_ref:'k-oota-pixel/english-playroom/.github/workflows/other.yml@refs/heads/main'},now),false);
  assert.equal(validateOidcClaims({...goodClaims,aud:'wrong'},now),false);
  assert.equal(validateOidcClaims({...goodClaims,exp:now-100},now),false);
});

const level=(title,text)=>({title,text});
const allowedUrls=new Set(Array.from({length:6},(_,i)=>`https://example${i}.com/news`));
const categories=['science','technology','health','sports','culture','education'];
const raw=categories.map((category,i)=>({
  slug:`story-${i+1}`,category,categories:[],careerTags:['undecided'],tags:['tag'],title:`Story ${i+1}`,summaryJa:`記事${i+1}の要約です。`,sourcePublishedAt:'2026-10-31',
  levels:{
    '5級':level('Starter',`This is news number ${i+1}. It is for new English readers. Students can read it today.`),
    '4級':level('Easy',`This is a simple news story number ${i+1}. Students can read it today.`),
    '3級':level('Junior',`This is a clear news story number ${i+1}. It explains the event with a little more detail for students.`),
    '準2級':level('Pre2',`This news story number ${i+1} gives useful background and explains why the event matters to students who are learning English.`),
    '2級':level('Grade2',`This news story number ${i+1} provides more context about the verified event and keeps the explanation factual and direct for English learners.`),
    '準1級':level('Pre1',`This news story number ${i+1} provides a more nuanced explanation of the verified event while remaining factual, clear, and appropriate for high-school English learners.`)
  },
  sources:[{name:`Source ${i+1}`,url:`https://example${i}.com/news`}]
}));
test('TODAY normalizer accepts six diverse stories and rejects unverified URLs',()=>{
  const articles=normalizeGeneratedArticles(raw,{editionDate:'2026-10-31',allowedUrls});
  assert.equal(articles.length,6);
  assert.equal(articles[0].date,'2026-10-31');
  assert.match(articles[0].id,/^2026-10-31-story-1/);
  assert.ok(articles.every(article=>article.sources.length===1));
  assert.ok(articles.every(article=>Number.isInteger(article.levels['4級'].wordCount)));
  assert.throws(()=>normalizeGeneratedArticles(raw.map((item,i)=>i===0?{...item,sources:[{name:'bad',url:'https://evil.example/news'}]}:item),{editionDate:'2026-10-31',allowedUrls}));
});

const fakeArticleWithCounts=(counts)=>({id:'graded-story',levels:Object.fromEntries(['5級','4級','3級','準2級','2級','準1級'].map((level,i)=>[level,{wordCount:counts[i],text:''}]))});
test('TODAY detects under-length graded text and accepts target-range progression',()=>{
  assert.deepEqual(collectLevelLengthIssues([fakeArticleWithCounts([45,70,100,145,210,290])]),[]);
  const issues=collectLevelLengthIssues([fakeArticleWithCounts([45,70,100,32,210,290])]);
  assert.ok(issues.some(issue=>issue.level==='準2級'&&issue.type==='range'&&issue.words===32));
  assert.ok(issues.some(issue=>issue.level==='準2級'&&issue.type==='progression'));
});

test('TODAY accepts small target misses after repair when all six levels remain pedagogically ordered',()=>{
  const articles=[fakeArticleWithCounts([32,49,72,105,160,230])];
  assert.ok(collectLevelLengthIssues(articles).length>0);
  assert.deepEqual(collectLevelHardFailures(articles),[]);
});

test('TODAY hard validation rejects a collapsed Grade 5 text',()=>{
  const failures=collectLevelHardFailures([fakeArticleWithCounts([10,49,72,105,160,230])]);
  assert.ok(failures.some(issue=>issue.level==='5級'&&issue.type==='hard-range'));
});

test('repair context includes only matching verified feed material',()=>{
  const packet=JSON.stringify({requiredStories:[{url:'https://one.example/a',excerpt:'KEEP'}],alternates:[{url:'https://two.example/b',excerpt:'OMIT'}]});
  const compact=articleResearch(packet,{sources:[{url:'https://one.example/a'}]});
  assert.match(compact,/KEEP/);assert.doesNotMatch(compact,/OMIT/);
  assert.equal(articleResearch('free-form verified facts',{}),'free-form verified facts');
});
test('repair merge preserves healthy levels and all story metadata',()=>{
  const article={id:'fixed-id',sources:[{url:'https://one.example/a'}],levels:{'5級':{title:'old',text:'old'},'4級':{title:'healthy',text:'Keep this.'}}};
  const merged=mergeRepairedArticle(article,{levels:{'5級':{title:'new',text:'This is new.'},'4級':{title:'bad',text:'Ignore'}}},[{level:'5級'}]);
  assert.equal(merged.levels['4級'],article.levels['4級']);
  assert.equal(merged.id,article.id);assert.equal(merged.sources,article.sources);
  assert.equal(merged.levels['5級'].wordCount,3);
  assert.throws(()=>mergeRepairedArticle(article,{levels:{}},[{level:'5級'}]));
});
test('429 respects cooldown, Retry-After and Google RetryInfo',()=>{
  assert.equal(geminiRetryDelay(429,null),65000);
  assert.equal(geminiRetryDelay(429,'90'),90000);
  assert.equal(geminiRetryDelay(429,null,JSON.stringify({error:{details:[{retryDelay:'100.5s'}]}})),101500);
  assert.equal(geminiRetryDelay(503,null,'',2),4000);
});
test('Gemini retries throttling once and returns successful response',async()=>{
  let attempts=0;const waits=[];
  const result=await callGemini({apiKey:'test',model:'test',body:{},fetchImpl:async()=>{
    attempts++;
    return attempts===1?new Response(JSON.stringify({error:{details:[{retryDelay:'70s'}]}}),{status:429}):
      new Response(JSON.stringify({candidates:[{content:{parts:[{text:'ok'}]}}]}),{status:200});
  },sleep:async ms=>waits.push(ms)});
  assert.equal(attempts,2);assert.deepEqual(waits,[71000]);assert.equal(result.candidates[0].content.parts[0].text,'ok');
});

test('feed generation uses six planned sources and limits each prompt to one story',()=>{
 const stories=Array.from({length:6},(_,i)=>({title:'Story '+i,url:'https://example.com/'+i,excerpt:'Facts '+i}));
 assert.equal(plannedStories(JSON.stringify({requiredStories:stories})).length,6);
 assert.equal(plannedStories('{}'),null);
 const prompt=plannedStoryPrompt('2026-10-31',stories[0]);
 assert.match(prompt,/Facts 0/);assert.doesNotMatch(prompt,/Facts 1/);
 assert.match(prompt,/ALL SIX/);
});
