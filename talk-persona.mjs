export function createPersona(seed) {
  let s=seed>>>0;
  const pick=a=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return a[Math.floor(s/4294967296*a.length)];};
  const gender=pick(['女性','男性']);
  const ageGroup=pick(['若者','大人','ご老人']);
  const age=pick(ageGroup==='若者'?[18,19,20,22]:ageGroup==='大人'?[28,34,42,50]:[67,72,78,82]);
  const ethnicity=pick(['アジア人','アフリカンアメリカン','白人']);
  const name=pick(gender==='女性'?['Emma','Maya','Hana','Sophie','Alex','Naomi']:['Leo','Noah','Ken','Daniel','Sam','Kai']);
  const personality=pick(['穏やかで聞き上手','明るく好奇心旺盛','少し照れ屋で親切','ユーモアがあり温かい','落ち着いていて思慮深い']);
  const home=pick(['Seattle','Boston','Portland','Chicago','San Francisco']);
  const hobby=pick(['cooking','hiking','reading','drawing','gardening','watching movies','playing tennis']);
  const food=pick(['curry','sushi','pasta','ramen','pancakes','udon']);
  const occupation=ageGroup==='若者'?'college student':ageGroup==='ご老人'?'retired librarian':pick(['librarian','designer','baker','teacher']);
  const pet=pick(['a cat named Mochi','a dog named Sunny','no pets']);
  return {seed,name,gender,ageGroup,age,ethnicity,personality,home,hobby,food,occupation,pet,
    family:'one older sister',experience:'visited Kyoto last spring',dream:'visit Hokkaido',
    intro:`Hi! I'm ${name}. I live in ${home}. I like ${hobby}. Nice to meet you!`};
}
