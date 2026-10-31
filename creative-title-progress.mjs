import grammarUnits from './grammar-reward-units.json' with {type:'json'};
import {createHash} from 'node:crypto';
export const keyOf=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,24);
const n=value=>Math.max(0,Math.min(1000000,Math.floor(Number(value)||0)));
export function applyTitleEvent(previous={},e,day){
 const s=structuredClone(previous);for(const k of ['metrics','sets','items','courses','sessions','days','streaks','sequence'])s[k]||={};
 const m=s.metrics,app=e.appId,key=keyOf(e.itemId||e.sessionId||e.eventId),grade=String(e.grade||'');
 const inc=(k,v=1)=>m[k]=n(m[k])+v,max=(k,v)=>m[k]=Math.max(n(m[k]),n(v));
 const set=(k,id)=>{(s.sets[k]||={})[String(id)]=true;max(k,Object.keys(s.sets[k]).length);};
 const streak=(k,ok,id='')=>{if(!ok){s.streaks[k]=0;s.sequence[k]='';return;}if(id&&s.sequence[k]===id)return;s.sequence[k]=id;s.streaks[k]=n(s.streaks[k])+1;max(k,s.streaks[k]);};
 const item=(id=key)=>s.items[id]||=( {attempts:0,wrong:0,grade} );
 const question=(good,id=key,extra={})=>{const p=item(id),first=!p.attempts;set('attemptedItems',id);if(good){set('goodItems',id);set('correctItems',id);if(first)set('firstItems',id);if(p.wrong)set('recoveredItems',id);p.good=true;}else{p.wrong=n(p.wrong)+1;p.firstWrongDay||=day;p.lastWrongDay=day;}p.attempts++;p.grade||=grade;return {p,first};};
 const groupCount=(setName,threshold)=>{const groups={};for(const id of Object.keys(s.sets[setName]||{})){const g=s.items[id]?.grade;if(g)groups[g]=(groups[g]||0)+1;}return Object.values(groups).filter(v=>v>=threshold).length;};
 inc('attempts');
 if(app==='word-tower'||app==='eiken-dungeon'){
  const session=s.sessions[keyOf(e.sessionId)]||={streak:0,defeated:{}};
  if(e.kind==='run'){
   if(!session.started){session.started=true;inc('runs');}
   max('bestFloor',e.floor);
  }else if(e.kind==='answer'){
   if(e.correct){inc('correct');if(e.critical)inc('critical');session.streak++;max('answerStreak',session.streak);}
   else session.streak=0;
  }else if(e.kind==='defeat'&&!session.defeated[e.floor]){
   session.defeated[e.floor]=true;
   if(e.floor%5===0){inc('bosses');if(e.noDamage)max('noDamageBoss',1);}
   max('bestFloor',e.floor+1);
  }
  for(const old of Object.keys(s.sessions).slice(0,-64))delete s.sessions[old];
 }else if(app==='word-breaker'){
  inc('runs');max('score',e.score);max('combo',e.combo);max('oneLife',e.oneLifeCorrect);if(e.recovered)max('recovered',1);
  s.courses[e.course]=Math.max(n(s.courses[e.course]),n(e.score));max('courses30',Object.values(s.courses).filter(v=>v>=30).length);max('courses50',Object.values(s.courses).filter(v=>v>=50).length);
 }else if(app==='pet-catch'){
  inc('runs');max('score',e.score);max('combo',e.combo);max('afterMiss',e.afterMissCorrect);s.courses[e.mode]=Math.max(n(s.courses[e.mode]),n(e.score));max('modes10',Object.values(s.courses).filter(v=>v>=10).length);max('modes30',Object.values(s.courses).filter(v=>v>=30).length);if(e.score>=10)set('tenDays',day);
 }else if(app==='ateru'){
  if(e.kind==='run'){inc('runs');max('score',e.score);if(e.cleanRun)max('cleanRun',1);streak('perfectStreak',e.score===5);if(e.score===5)set('perfectDays',day);}
  else{const p=item(),oldRun=p.failedRun,wasRecovered=s.sets.recoveredItems?.[key];question(e.correct);if(!e.correct)p.failedRun=e.sessionId;if(e.correct&&oldRun===e.sessionId&&!wasRecovered){delete s.sets.recoveredItems?.[key];m.recoveredItems=Object.keys(s.sets.recoveredItems||{}).length;}if(e.correct&&e.clean)set('cleanItems',key);}
 }else if(app==='basic-grammar'||app==='grammar'){
  set('days',day);
  question(e.correct);
  const [unit]=e.itemId.split(':');
  const definition=grammarUnits[app].find(u=>u.number===Number(unit));
  if(definition&&Array.from({length:definition.total},(_,i)=>keyOf(unit+':'+i)).every(id=>s.sets.correctItems?.[id]))set('units',unit);
  if(s.rewardDay!==day){s.rewardDay=day;s.rewardAnswers={};s.rewardOrder=[];}
  if(e.course===day&&!Object.hasOwn(s.rewardAnswers,e.itemId)){s.rewardAnswers[e.itemId]=e.correct;(s.rewardOrder||=[]).push(e.itemId);}
 }else if(app==='today'){
  set('days',day);set('articles',key);set('editionDays',e.course);
  const p=item();p.levels||={};p.levels[e.grade]=true;
  if(Object.keys(p.levels).length>=2)set('comparedArticles',key);
  set('edition:'+e.course,key);
  if(Object.keys(s.sets['edition:'+e.course]).length>=6)set('editionSix',e.course);
 }else if(app==='basic-quest'){

  if(e.kind==='run'){set('stages',key);max('score',e.score);if(e.score===4)set('perfectStages',key);streak('perfectStreak',e.score===4,key);}
  else {question(e.correct);if(e.correct&&e.first)set('firstItems',key);}
 }else if(app==='eiken-cloze'){
  let all=true,first=true;for(const r of e.results){const result=question(r.correct,keyOf((e.itemId||'')+':'+r.id));first&&=result.first;all&&=r.correct;if(r.correct){set(e.mode==='free'?'freeItems':'choiceItems',keyOf(e.itemId+':'+r.id));set('modes',e.mode);}}
  item().grade=grade;set('attemptedPassages',key);if(all){set('goodPassages',key);set(e.mode==='free'?'freePassages':'choicePassages',key);if(first)set('firstPassages',key);}
  if(s.sets.freePassages?.[key]&&s.sets.choicePassages?.[key])set('bothPassages',key);
  max('modes3',['freePassages','choicePassages'].filter(k=>Object.keys(s.sets[k]||{}).length>=3).length);max('grades',groupCount('goodPassages',1));max('grades3',groupCount('goodPassages',3));streak('firstStreak',all&&first,key);
 }else if(app==='eiken-title'||app==='task-quest'){
  const good=e.correct,{first,p}=question(good);streak('firstStreak',first&&good,key);
  if(good&&e.answer){p.variants||={};p.variants[keyOf(String(e.answer).normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' '))]=true;if(Object.keys(p.variants).length>=2)set('variantsItems',key);}
  max('grades',groupCount('goodItems',1));max('attemptGrades3',groupCount('attemptedItems',3));
 }else if(app==='reading-training'){
  const p=item();if(e.kind==='exercise'){inc('exercises');set('exerciseItems',key);inc('correctQuestions',n(e.score));const {first}=question(e.score===e.total);if(first&&e.score===e.total)set('firstItems',key);p.exercise=true;}
  else{inc('summaries');p.summary=true;set('summaryItems',key);set(e.language==='en'?'enItems':'jaItems',key);if(e.correct)max(e.language==='en'?'enSummary':'jaSummary',1);}
  if(s.sets.enItems?.[key]&&s.sets.jaItems?.[key])set('bilingualItems',key);if(p.exercise&&p.summary)set('bothItems',key);
  max('exerciseGrades3',groupCount('exerciseItems',3));max('bothGrades',groupCount('exerciseItems',1)&&Object.keys(Object.fromEntries(Object.values(s.items).filter(i=>i.exercise&&Object.values(s.items).some(j=>j.summary&&j.grade===i.grade)).map(i=>[i.grade,1]))).length);
 }else if(app==='listening-training'){
  const id=keyOf(e.itemId+':'+e.mode),{first}=question(e.correct,id);delete s.sets.goodItems?.[id];m.goodItems=Object.keys(s.sets.goodItems||{}).length;item().grade=grade;
  if(e.mode==='dictation')inc('dictations');if(e.correct){set('goodItems',key);set(e.mode==='dictation'?'dictationItems':'practiceItems',key);}
  if(e.mode==='practice')streak('practiceStreak',first&&e.correct,key);
  if(s.sets.practiceItems?.[key]&&s.sets.dictationItems?.[key])set('bothItems',key);max('grades5',groupCount('goodItems',5));max('practiceGrades10',groupCount('practiceItems',10));
 }else if(app==='pre2-interview-questions'||app==='eiken-pre2-interview-a'){
  const p=item(),before=p.previousScore,good=app==='pre2-interview-questions'?e.score>=4:e.score>=2,perfect=e.score===e.total;
  question(good);max('score',e.score);if(before!==undefined&&e.score>before)set('improvedItems',key);p.previousScore=e.score;
  if(perfect)set('perfectItems',key);streak('goodStreak',good,key);streak('perfectStreak',perfect,key);
  if(app==='pre2-interview-questions'){max(e.questionType==='q4'?'q4':'q5',1);if(e.followUp)max('followUp',1);if(good){set('goodTypes',e.questionType);if(e.reason)set('reasonItems',key);}}
 }else if(app==='pet-instructions'){
  if(e.kind==='run'){inc('runs');max('score',e.score);streak('clearStreak',e.score>=4);streak('perfectStreak',e.score===5);if(e.score>=4)set('clearDays',day);if(e.score===5)set('perfectDays',day);}
  else if(e.correct){inc('correct');if(e.recovered)max('recovered',1);if(e.color)inc('color');if(e.shape)inc('shape');if(e.size)inc('size');if(e.color&&e.shape&&e.size)max('allConditions',1);max('minConditions',Math.min(n(m.color),n(m.shape),n(m.size)));}
 }else if(app==='case-talk'){
  inc('successes');
  if(e.mode==='normal')inc('normalSuccesses');
  if(n(e.score)>=1)inc('repairedSuccesses');
  if(n(e.score)>=2)max('doubleRepairSuccess',1);
  max('masterProgress',Math.min(n(m.successes),n(m.normalSuccesses)*2));
 }else if(app==='talk-quest'||app==='pet-chat'){
  const id=keyOf(e.sessionId),session=s.sessions[id]||={turns:0,manual:0,questions:{}};session.turns++;session.manual=e.manual?session.manual+1:0;inc('turns');if(e.manual)inc('manual');max('maxTurns',session.turns);max('manualStreak',session.manual);
  const d=s.days[day]||={turns:0,manual:0,questions:{}};d.turns++;d.manual=e.manual?d.manual+1:0;set('days',day);max('maxDailyTurns',d.turns);max('dailyManualStreak',d.manual);
  if(e.question){inc('questions');set('questionTopics',String(e.itemId));set('questionDays',day);session.questions[keyOf(e.answer)]=true;d.questions[keyOf(e.answer)]=true;max('maxQuestions',Object.keys(session.questions).length);max('maxDailyQuestions',Object.keys(d.questions).length);}
  if(session.turns>=3)set('topics3',String(e.itemId));if(session.turns>=5)set('fiveTurnDays',day);if(d.turns>=3)set('threeTurnDays',day);
  for(const old of Object.keys(s.sessions).slice(0,-64))delete s.sessions[old];
 }else if(app==='eiken-retry'){
  const p=item();p.wrong=Math.max(n(p.wrong),n(e.previousMistakes));if(!p.lastWrongDay&&e.previousWrongAt){p.lastWrongDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.previousWrongAt));p.firstWrongDay||=p.lastWrongDay;}const wrong=p.wrong||0,last=p.lastWrongDay,old=p.firstWrongDay;if(wrong)set('retriedItems',key);question(e.correct);
  if(e.series)inc('seriesAnswers');if(e.correct&&wrong){max('recoverMistakes',wrong);if(old&&Date.parse(day)-Date.parse(old)>=7*86400000)max('oldRecovery',1);if(last&&Date.parse(day)-Date.parse(last)===86400000)set('yesterdayRecovered:'+day,key);max('yesterdayRecovered',Object.keys(s.sets['yesterdayRecovered:'+day]||{}).length);}
  max('recoveryGrades10',groupCount('recoveredItems',10));max('recoveryGrades20',groupCount('recoveredItems',20));
 }
 s.schemaVersion=2;return s;
}

