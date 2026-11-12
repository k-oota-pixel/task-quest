export function titleIdsWithMasters(ids,masters){
 const owned=new Set(ids);
 for(const [id,required] of masters)if(required.every(source=>owned.has(source)))owned.add(id);
 return owned;
}
