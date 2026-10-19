export function createPersona(seed) {
  let s=seed>>>0;
  const pick=a=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return a[Math.floor(s/4294967296*a.length)];};
  const gender=pick(['女性','男性']);
  const ageGroup=pick(['若者','大人','ご老人']);
  const age=pick(ageGroup==='若者'?[18,19,20,22]:ageGroup==='大人'?[28,34,42,50]:[67,72,78,82]);
  const ethnicity=pick(['白人','アジア人','アフリカンアメリカン']);
  const name=pick(gender==='女性'?['Emma','Maya','Hana','Sophie','Alex','Naomi']:['Leo','Noah','Ken','Daniel','Sam','Kai']);
  const personality=pick(['穏やかで聞き上手','明るく好奇心旺盛','少し照れ屋で親切','ユーモアがあり温かい','落ち着いていて思慮深い']);
  const home=pick(['Seattle','Boston','Portland','Chicago','San Francisco']);
  const hobby=pick(['cooking','hiking','reading','drawing','gardening','watching movies','playing tennis']);
  const food=pick(['curry','sushi','pasta','ramen','pancakes','udon']);
  const occupation=ageGroup==='若者'?'college student':ageGroup==='ご老人'?'retired librarian':pick(['librarian','designer','baker','teacher']);
  const pet=pick(['a cat named Mochi','a dog named Sunny','no pets']);
  const ageId=({'若者':'young','大人':'adult','ご老人':'senior'})[ageGroup];
  const genderId=gender==='女性'?'woman':'man';
  const ethnicityId=({'白人':'white','アジア人':'asian','アフリカンアメリカン':'african-american'})[ethnicity];
  const portraitId=`${ageId}-${genderId}-${ethnicityId}`;
  const hair=ageGroup==='ご老人'?'silver-gray hair':ethnicity==='アフリカンアメリカン'?'dark natural curls':ethnicity==='アジア人'?'dark hair':'brown hair';
  const clothing=ageGroup==='若者'?(gender==='女性'?'teal cardigan':'ochre sweater'):ageGroup==='大人'?(gender==='女性'?'terracotta blouse':'teal shirt'):(gender==='女性'?'sage cardigan':'blue sweater');
  const appearance=`friendly illustrated ${ageId} ${genderId}, ${hair}, ${clothing}`;
  return {seed,name,gender,ageGroup,age,ethnicity,portraitId,appearance,personality,home,hobby,food,occupation,pet,
    family:'one older sister',experience:'visited Kyoto last spring',dream:'visit Hokkaido',
    intro:`Hi! I'm ${name}. I live in ${home}. I like ${hobby}. Nice to meet you!`};
}
