import {TITLE_CONTENTS,masterTitles} from './title-model.mjs';

export function creativeTitleCount(appId,titles){
 if(!TITLE_CONTENTS.some(app=>app.id===appId))return 0;
 return new Set([...titles,...masterTitles(titles)].filter(title=>title.unlocked).map(title=>title.id)).size;
}

const increment=(fieldPath,value)=>({fieldPath,increment:{integerValue:String(value)}});

export function titleCountTransforms(delta,{invalidate=false}={}){
 if(invalidate)return [increment('titleCountRevision',1)];
 if(!delta)return [];
 // Keep the revision gap intact for old or already-dirty summaries. A
 // synchronized wallet stays synchronized when the exact delta is known.
 return [
  increment('unlockedTitleCount',delta),
  increment('titleCountRevision',1),
  increment('titleCountSyncedRevision',1)
 ];
}
