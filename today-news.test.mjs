import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOidcClaims,normalizeGeneratedArticles,collectLevelLengthIssues,collectLevelHardFailures} from './today-news.mjs';

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
