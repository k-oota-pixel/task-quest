import {readFileSync,writeFileSync} from 'node:fs';

const newsPath='today-news.mjs';
let s=readFileSync(newsPath,'utf8');

const must=(oldValue,newValue,label)=>{if(!s.includes(oldValue))throw new Error(`missing anchor: ${label}`);s=s.replace(oldValue,newValue);};

must("const CAREERS=['medicine','education','science','engineering','it','business','public','global','sports','arts','undecided'];",
"const CAREERS=['medicine','education','science','engineering','it','business','public','global','sports','arts','undecided'];\nconst MISSION_TYPES=['decision','prediction','advice','ranking','personal','recommendation','information-hunt'];",
'mission types');

must("Each version needs its own English title and text. Count words before returning; preserve the same factual core.\nVerified source: ${JSON.stringify(story)}`;",
"Each version needs its own English title and text. Count words before returning; preserve the same factual core.\nAlso create ONE purposeful reading mission. Choose the best type from decision, prediction, advice, ranking, personal, recommendation, information-hunt. It must give the learner a reason to read the article, not merely test factual recall. The learner should need information from the story to answer well. Provide a short Japanese purpose, a short Japanese follow-up cue, and one English question for EACH of the six levels, simplified appropriately from 5級 through 準1級. Do not ask for sensitive personal information.\nVerified source: ${JSON.stringify(story)}`;",
'planned mission prompt');

const missionSchema="mission:{type:'OBJECT',properties:{type:{type:'STRING',enum:MISSION_TYPES},purposeJa:{type:'STRING'},followUpJa:{type:'STRING'},questions:{type:'OBJECT',properties:{'5級':{type:'STRING'},'4級':{type:'STRING'},'3級':{type:'STRING'},'準2級':{type:'STRING'},'2級':{type:'STRING'},'準1級':{type:'STRING'}},required:LEVELS}},required:['type','purposeJa','followUpJa','questions']},";
must("sourcePublishedAt:{type:'STRING'},levels:",`sourcePublishedAt:{type:'STRING'},${missionSchema}levels:`,'schema mission property');
must("required:['slug','scope','category','categories','careerTags','tags','titleJa','title','summaryJa','levels','sources']",
"required:['slug','scope','category','categories','careerTags','tags','titleJa','title','summaryJa','mission','levels','sources']",
'schema mission required');

must("Each level needs its own natural English title.\n\nDo not add comprehension questions, translations, vocabulary lists, commentary, or Markdown. Return only the requested JSON.",
`Each level needs its own natural English title.\n\nPURPOSEFUL READING MISSION — REQUIRED FOR EVERY STORY:\n- Create exactly one mission that gives the learner a genuine reason to read, not a quiz after reading.\n- Choose the best type from: decision, prediction, advice, ranking, personal, recommendation, information-hunt.\n- The mission must depend on information in THIS story. A learner who skips the article should not be able to answer it well from general opinion alone.\n- Avoid simple factual-recall questions such as “Where did this happen?” or “How many...?”.\n- Avoid asking for sensitive personal, family, health, financial, political, religious, or identifying information.\n- purposeJa: one short Japanese sentence explaining what the learner is reading to decide/find/consider.\n- followUpJa: one short Japanese cue such as 「記事の情報を1つ使って理由も考えよう。」\n- questions: create the SAME core mission at all six Eiken levels, but rewrite the English question to fit each level.\n  5級: extremely simple question, usually one short sentence.\n  4級: simple junior-high English.\n  3級: natural junior-high English with a simple reason/choice when appropriate.\n  準2級: accessible high-school English.\n  2級: more precise reasoning.\n  準1級: nuanced but answerable from the article.\n- Across the six-story edition, vary mission types when the stories allow it; do not make all six “Do you agree?” questions.\n\nDo not add comprehension questions, translations, vocabulary lists, commentary, or Markdown. The mission is a purposeful task, not a comprehension quiz. Return only the requested JSON.`,
'generation mission prompt');

const normalizeAnchor="    const levels={};let levelsOk=true;";
const normalizeInsert=`    const missionRaw=raw?.mission||{};\n    const missionType=MISSION_TYPES.includes(missionRaw.type)?missionRaw.type:'';\n    const purposeJa=text(missionRaw.purposeJa,220),followUpJa=text(missionRaw.followUpJa,220);\n    const missionQuestions=Object.fromEntries(LEVELS.map(level=>[level,text(missionRaw?.questions?.[level],420)]));\n    const missionOk=missionType&&purposeJa&&followUpJa&&LEVELS.every(level=>missionQuestions[level]);\n    if(!missionOk)continue;\n    const mission={type:missionType,purposeJa,followUpJa,questions:missionQuestions};\n`;
must(normalizeAnchor,normalizeInsert+normalizeAnchor,'normalize mission');
must("tags,titleJa,title,summaryJa,sourcePublishedAt:text(raw.sourcePublishedAt,40),levels,sources:cleanSources",
"tags,titleJa,title,summaryJa,sourcePublishedAt:text(raw.sourcePublishedAt,40),mission,levels,sources:cleanSources",
'push mission');

writeFileSync(newsPath,s,'utf8');

const testPath='today-news.test.mjs';
let t=readFileSync(testPath,'utf8');
const tMust=(oldValue,newValue,label)=>{if(!t.includes(oldValue))throw new Error(`missing test anchor: ${label}`);t=t.replace(oldValue,newValue);};
tMust("slug:`story-${i+1}`,scope:i<5?'japan':'world',category,categories:[],careerTags:['undecided'],tags:['tag'],title:`Story ${i+1}`,summaryJa:`記事${i+1}の要約です。`,sourcePublishedAt:'2026-10-31',",
"slug:`story-${i+1}`,scope:i<5?'japan':'world',category,categories:[],careerTags:['undecided'],tags:['tag'],title:`Story ${i+1}`,summaryJa:`記事${i+1}の要約です。`,sourcePublishedAt:'2026-10-31',mission:{type:'decision',purposeJa:'記事の情報を使って考えよう。',followUpJa:'理由も考えよう。',questions:{'5級':'Is this good?','4級':'Do you like this idea?','3級':'Do you think this is a good idea?','準2級':'Would you support this idea? Why?','2級':'Do you think the benefits are greater than the problems?','準1級':'Based on the article, would you support this approach, and why?'}},",
'raw mission fixture');
tMust("  assert.ok(articles.every(article=>Number.isInteger(article.levels['4級'].wordCount)));",
"  assert.ok(articles.every(article=>Number.isInteger(article.levels['4級'].wordCount)));\n  assert.equal(articles[0].mission.type,'decision');\n  assert.match(articles[0].mission.questions['準2級'],/support/);",
'mission assertions');
tMust(" assert.match(prompt,/ALL SIX/);assert.match(prompt,/scope/);",
" assert.match(prompt,/ALL SIX/);assert.match(prompt,/scope/);assert.match(prompt,/purposeful reading mission/i);",
'planned prompt mission assertion');
writeFileSync(testPath,t,'utf8');

// Workflow trigger marker: v2
