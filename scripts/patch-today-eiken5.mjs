import {readFileSync,writeFileSync} from 'node:fs';

const path='today-news.mjs';
let s=readFileSync(path,'utf8');

function replaceOnce(oldText,newText,label){
  if(!s.includes(oldText))throw new Error(`anchor not found: ${label}`);
  s=s.replace(oldText,newText);
}

replaceOnce("const LEVELS=['4級','3級','準2級','2級','準1級'];\nconst LEVEL_TARGET_RANGES={'4級':[55,90],'3級':[85,130],'準2級':[125,180],'2級':[180,260],'準1級':[250,360]};",
"const LEVELS=['5級','4級','3級','準2級','2級','準1級'];\nconst LEVEL_TARGET_RANGES={'5級':[35,55],'4級':[55,90],'3級':[85,130],'準2級':[125,180],'2級':[180,260],'準1級':[250,360]};\nconst LEVEL_HARD_LIMITS={'5級':[25,80],'4級':[40,120],'3級':[60,170],'準2級':[90,230],'2級':[130,320],'準1級':[180,430]};",
'levels');

replaceOnce("levels:{type:'OBJECT',properties:{'4級':{type:'OBJECT',properties:{title:{type:'STRING'},text:{type:'STRING'}},required:['title','text']},",
"levels:{type:'OBJECT',properties:{'5級':{type:'OBJECT',properties:{title:{type:'STRING'},text:{type:'STRING'}},required:['title','text']},'4級':{type:'OBJECT',properties:{title:{type:'STRING'},text:{type:'STRING'}},required:['title','text']},",
'output schema');

replaceOnce("Create five ORIGINAL English versions of the same verified story. Preserve the same factual core while changing linguistic difficulty. The word-count ranges below are REQUIRED, not optional; do not compress the upper levels merely to save output tokens:\n- 4級: about 55-90 words.",
"Create six ORIGINAL English versions of the same verified story. Preserve the same factual core while changing linguistic difficulty. The word-count ranges below are REQUIRED generation targets; do not compress the upper levels merely to save output tokens:\n- 5級: about 35-55 words. Use very short sentences and highly frequent junior-high beginner vocabulary. Prefer simple be-verbs, have, can, basic present/past verbs, names, places, numbers, and concrete nouns. Avoid passive voice, long clauses, abstract explanation, and difficult synonyms whenever possible.\n- 4級: about 55-90 words.",
'generation prompt');

replaceOnce("- Every level must meet these REQUIRED ranges: 4級 55-90 words; 3級 85-130; 準2級 125-180; 2級 180-260; 準1級 250-360.\n- A higher level must never be shorter than the level below it.",
"- Every level should aim for these ranges: 5級 35-55 words; 4級 55-90; 3級 85-130; 準2級 125-180; 2級 180-260; 準1級 250-360.\n- For 5級, keep syntax especially simple: short independent sentences, common concrete words, and minimal subordination.\n- A higher level must never be shorter than the level below it.",
'repair prompt');

const issuesAnchor="export function collectLevelLengthIssues(articles){\n  const issues=[];\n  for(const [articleIndex,article] of (Array.isArray(articles)?articles:[]).entries()){\n    let previousWords=0;\n    for(const level of LEVELS){\n      const words=Number(article?.levels?.[level]?.wordCount)||wordCount(article?.levels?.[level]?.text||'');\n      const [min,max]=LEVEL_TARGET_RANGES[level];\n      if(words<min||words>max)issues.push({articleIndex,id:text(article?.id||article?.title||'',120),level,words,min,max,type:'range'});\n      if(previousWords&&words<previousWords)issues.push({articleIndex,id:text(article?.id||article?.title||'',120),level,words,previousWords,type:'progression'});\n      previousWords=words;\n    }\n  }\n  return issues;\n}\n";
if(!s.includes(issuesAnchor))throw new Error('anchor not found: length issues');
const hardFn=`\nexport function collectLevelHardFailures(articles){\n  const failures=[];\n  for(const [articleIndex,article] of (Array.isArray(articles)?articles:[]).entries()){\n    let previousWords=0;\n    for(const level of LEVELS){\n      const words=Number(article?.levels?.[level]?.wordCount)||wordCount(article?.levels?.[level]?.text||'');\n      const [min,max]=LEVEL_HARD_LIMITS[level];\n      if(words<min||words>max)failures.push({articleIndex,id:text(article?.id||article?.title||'',120),level,words,min,max,type:'hard-range'});\n      if(previousWords&&words<previousWords)failures.push({articleIndex,id:text(article?.id||article?.title||'',120),level,words,previousWords,type:'progression'});\n      previousWords=words;\n    }\n  }\n  return failures;\n}\n`;
s=s.replace(issuesAnchor,issuesAnchor+hardFn);

replaceOnce("        const remainingIssues=collectLevelLengthIssues(articles);\n        if(remainingIssues.length){\n          const first=remainingIssues[0];\n          throw fail(`TODAYの5段階英文を目標語数に整えられませんでした: ${first.id} ${first.level} ${first.words}語`,502);\n        }",
"        const remainingHardFailures=collectLevelHardFailures(articles);\n        if(remainingHardFailures.length){\n          const first=remainingHardFailures[0];\n          throw fail(`TODAYの6段階英文が公開基準を満たしませんでした: ${first.id} ${first.level} ${first.words}語`,502);\n        }",
'final hard validation');

writeFileSync(path,s,'utf8');

let t=readFileSync('today-news.test.mjs','utf8');
t=t.replace("import {validateOidcClaims,normalizeGeneratedArticles,collectLevelLengthIssues} from './today-news.mjs';","import {validateOidcClaims,normalizeGeneratedArticles,collectLevelLengthIssues,collectLevelHardFailures} from './today-news.mjs';");
t=t.replace("  levels:{\n    '4級':level('Easy'", "  levels:{\n    '5級':level('Starter',`This is news number ${i+1}. It is for new English readers. Students can read it today.`),\n    '4級':level('Easy'");
t=t.replace("const fakeArticleWithCounts=(counts)=>({id:'graded-story',levels:Object.fromEntries(['4級','3級','準2級','2級','準1級'].map((level,i)=>[level,{wordCount:counts[i],text:''}]))});","const fakeArticleWithCounts=(counts)=>({id:'graded-story',levels:Object.fromEntries(['5級','4級','3級','準2級','2級','準1級'].map((level,i)=>[level,{wordCount:counts[i],text:''}]))});");
t=t.replace("assert.deepEqual(collectLevelLengthIssues([fakeArticleWithCounts([60,95,140,210,290])]),[]);\n  const issues=collectLevelLengthIssues([fakeArticleWithCounts([60,95,32,210,290])]);",
"assert.deepEqual(collectLevelLengthIssues([fakeArticleWithCounts([45,70,100,145,210,290])]),[]);\n  const issues=collectLevelLengthIssues([fakeArticleWithCounts([45,70,100,32,210,290])]);");
t += `\ntest('TODAY accepts small target misses after repair when all six levels remain pedagogically ordered',()=>{\n  const articles=[fakeArticleWithCounts([32,49,72,105,160,230])];\n  assert.ok(collectLevelLengthIssues(articles).length>0);\n  assert.deepEqual(collectLevelHardFailures(articles),[]);\n});\n\ntest('TODAY hard validation rejects a collapsed Grade 5 text',()=>{\n  const failures=collectLevelHardFailures([fakeArticleWithCounts([10,49,72,105,160,230])]);\n  assert.ok(failures.some(issue=>issue.level==='5級'&&issue.type==='hard-range'));\n});\n`;
writeFileSync('today-news.test.mjs',t,'utf8');
