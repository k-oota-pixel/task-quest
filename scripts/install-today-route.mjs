import {readFileSync,writeFileSync} from 'node:fs';

const path='server.mjs';
let source=readFileSync(path,'utf8');

const importLine="import {createTodayNewsGenerator} from './today-news.mjs';";
if(!source.includes(importLine)){
  const anchor="import {publishDailyCoinBoard,readDailyCoinBoard} from './daily-coins.mjs';";
  if(!source.includes(anchor))throw new Error('TODAY import anchor not found');
  source=source.replace(anchor,`${anchor}\n${importLine}`);
}

const setupLine="const todayNews=createTodayNewsGenerator({apiKey:key,model:process.env.TODAY_GEMINI_MODEL||model,send,fail});";
if(!source.includes(setupLine)){
  const anchor='const handleTalkQuest=createTalkQuest({verifyUser,readJson,send,fail});';
  if(!source.includes(anchor))throw new Error('TODAY setup anchor not found');
  source=source.replace(anchor,`${setupLine}\n${anchor}`);
}

const routeLine="  if(path==='/api/today/generate')return todayNews.handle(req,res);";
if(!source.includes(routeLine)){
  const anchor="  if(path==='/api/adventure/rankings')return adventureRankings.handle(req,res);";
  if(!source.includes(anchor))throw new Error('TODAY route anchor not found');
  source=source.replace(anchor,`${routeLine}\n${anchor}`);
}

writeFileSync(path,source);
