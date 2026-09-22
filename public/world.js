export const MAX_PLAYERS=6;
export const LAPS=3;
export const RACE_LIMIT=180;
export const COLORS=['#ff7956','#60d2d5','#e6ba55','#b29be5','#8ac99a','#f08dab'];
export const CUP_POINTS=[10,8,6,4,2,1];
export const VEHICLES=[
  {id:'kart',name:'Trail Kart',label:'The classic',color:'#ed8b57'},
  {id:'jeep',name:'Safari Jeep',label:'Born to explore',color:'#89a26a'},
  {id:'buggy',name:'Dune Buggy',label:'All adventure',color:'#edbc63'},
  {id:'coupe',name:'Rally Coupe',label:'Retro spirit',color:'#de796f'},
  {id:'hover',name:'Hover Racer',label:'A little future',color:'#75bfc0'},
  {id:'tuktuk',name:'Jungle Tuk-Tuk',label:'Three wheels. Big dreams.',color:'#b6a0cb'}
];
export const ANIMALS=[
  {id:'tiger',name:'Tavi',species:'Tiger',color:'#e9a34b',secondary:'#382d26'},
  {id:'panda',name:'Bao',species:'Panda',color:'#f0eee0',secondary:'#333c36'},
  {id:'fox',name:'Flint',species:'Fox',color:'#d77942',secondary:'#fff0d1'},
  {id:'capybara',name:'Coco',species:'Capybara',color:'#a58b65',secondary:'#d3bb8f'},
  {id:'monkey',name:'Milo',species:'Monkey',color:'#8c654a',secondary:'#ddbc8c'},
  {id:'rabbit',name:'Pip',species:'Rabbit',color:'#e4ddd1',secondary:'#ddb8b0'},
  {id:'frog',name:'Fern',species:'Frog',color:'#8cad56',secondary:'#e4e4a7'},
  {id:'redpanda',name:'Rumi',species:'Red panda',color:'#bd603b',secondary:'#ede0c5'},
  {id:'bear',name:'Bruno',species:'Bear',color:'#856349',secondary:'#c4a982'},
  {id:'crocodile',name:'Chomp',species:'Crocodile',color:'#729168',secondary:'#d0ce98'},
  {id:'koala',name:'Kiki',species:'Koala',color:'#a4aba3',secondary:'#ebe5d3'},
  {id:'otter',name:'Ollie',species:'Otter',color:'#94745a',secondary:'#e4cfad'},
  {id:'leopard',name:'Zuri',species:'Leopard',color:'#d3ad60',secondary:'#46392d'},
  {id:'elephant',name:'Nori',species:'Elephant',color:'#9fa5a1',secondary:'#d4bfb4'},
  {id:'raccoon',name:'Bandit',species:'Raccoon',color:'#a4a097',secondary:'#343a36'}
];
export const ITEMS={
  boost:{name:'Mango Boost',short:'BOOST',color:'#ffb74c',description:'A burst of speed for 2.4 seconds.'},
  coconut:{name:'Homing Coconut',short:'COCONUT',color:'#bd9670',description:'Chases the nearest racer ahead of you.'},
  shield:{name:'Vine Shield',short:'SHIELD',color:'#9ad88b',description:'Absorbs attacks for seven seconds.'},
  mud:{name:'Mud Pod',short:'MUD',color:'#b89267',description:'Leaves a slippery trap behind your kart.'},
  pulse:{name:'Thunder Drum',short:'THUNDER',color:'#aface9',description:'Stuns nearby rivals. Shields block it.'},
  banana:{name:'Slip Banana',short:'BANANA',color:'#ffd966',description:'Drops a peeling hazard that spins rivals out.'},
  rocket:{name:'Sky Rocket',short:'ROCKET',color:'#ff7a59',description:'Fast forward missile that ignores steering.'},
  shell:{name:'Reef Shell',short:'SHELL',color:'#7ed5d2',description:'Fires straight back at any pursuer.'},
  star:{name:'Sun Star',short:'STAR',color:'#ffe27a',description:'Five seconds of invincible speed.'},
  lightning:{name:'Storm Call',short:'STORM',color:'#cdb4ff',description:'Slows every rival ahead of you.'},
  magnet:{name:'Vine Magnet',short:'MAGNET',color:'#9ee5a4',description:'Steals the held item from the racer ahead.'},
  swap:{name:'Spirit Swap',short:'SWAP',color:'#f6b8d6',description:'Teleport-swap positions with a random rival.'}
};
export const ITEM_IDS=Object.keys(ITEMS);
export const TRACKS=[
  {id:0,name:'Canopy Cruise',tag:'THE GREEN HEART',surface:'asphalt',roadWidth:10.5,theme:{sky:'#a6d5cb',fog:'#aacdbb',road:'#627477',grass:'#739953',water:'#55b8b0',sun:'#fff0ca'},points:[[0,52],[31,47],[49,27],[51,-7],[33,-34],[5,-48],[-26,-43],[-48,-21],[-42,8],[-24,28]],elevation:[1,2,4,6,5,2,0,1,3,2],description:'Sweeping bends, towering palms, and a waterfall shortcut view.'},
  {id:1,name:'Temple Tangle',tag:'RUINS OF THE SUN',surface:'stone',roadWidth:10,theme:{sky:'#b6c7ac',fog:'#bfcbb1',road:'#9b9278',grass:'#7b8f4e',water:'#729f84',sun:'#ffe2ad'},points:[[0,55],[27,53],[48,35],[43,9],[20,-4],[32,-29],[12,-51],[-20,-48],[-44,-27],[-44,0],[-23,18],[-27,40]],elevation:[2,2,4,7,5,3,1,2,5,7,4,2],description:'Ancient arches, winding stone roads, and misty jungle valleys.'},
  {id:2,name:'Sunset Splash',tag:'THE GOLDEN COAST',surface:'boardwalk',roadWidth:11,theme:{sky:'#f0cdaa',fog:'#e3c9ad',road:'#a6794d',grass:'#92a85b',water:'#74c9c3',sun:'#ffcf96'},points:[[0,53],[30,51],[54,28],[46,2],[53,-22],[29,-45],[-1,-52],[-30,-45],[-48,-24],[-45,6],[-31,34]],elevation:[2,3,5,6,3,2,1,2,4,5,3],description:'Elevated timber curves, golden light, and turquoise lagoons.'},
  {id:3,name:'Mangrove Sprint',tag:'TIGHT & TWISTY',surface:'boardwalk',roadWidth:9.4,theme:{sky:'#b8d9c8',fog:'#a8c8b8',road:'#8a6f4a',grass:'#5e8b52',water:'#5fa8a0',sun:'#ffeec2'},points:[[0,48],[22,52],[36,40],[28,22],[40,8],[52,-6],[40,-26],[18,-22],[8,-40],[-14,-44],[-32,-30],[-22,-12],[-42,-4],[-46,18],[-30,34],[-12,30]],elevation:[1,2,3,2,3,4,3,2,3,2,1,2,3,4,3,2],description:'A short, technical boardwalk through tangled mangrove roots.'},
  {id:4,name:'Volcano Ridge',tag:'EMBER CLIMB',surface:'stone',roadWidth:10.8,theme:{sky:'#d99a72',fog:'#b87f5e',road:'#5a4a44',grass:'#7a5c3a',water:'#e07a3a',sun:'#ffd091'},points:[[0,60],[34,55],[56,32],[58,-2],[44,-30],[16,-48],[-18,-52],[-46,-36],[-58,-6],[-46,26],[-22,46]],elevation:[2,4,7,11,14,11,7,4,3,5,4],description:'Steep volcanic switchbacks above glowing rivers of embers.'},
  {id:5,name:'Coral Canyon',tag:'WIDE & FAST',surface:'asphalt',roadWidth:13,theme:{sky:'#f5d6a8',fog:'#e9c79b',road:'#c08a5e',grass:'#c9a876',water:'#7fd6cc',sun:'#fff1c4'},points:[[0,68],[42,60],[68,32],[64,-8],[42,-44],[4,-62],[-38,-54],[-64,-22],[-58,18],[-30,52]],elevation:[1,2,3,2,1,2,3,2,1,2],description:'Long, fast sweepers through a sun-bleached sandstone canyon.'},
  {id:6,name:'Moonlit Marsh',tag:'NIGHT DRIVE',surface:'asphalt',roadWidth:10.2,theme:{sky:'#2c3a55',fog:'#3a4a66',road:'#3f4a4e',grass:'#2f4d3a',water:'#4f8a9a',sun:'#9eb8ff'},points:[[0,50],[26,54],[48,40],[52,14],[40,-12],[18,-26],[26,-48],[2,-58],[-26,-50],[-46,-30],[-50,-2],[-36,22],[-16,34]],elevation:[1,2,3,4,3,2,3,2,1,2,3,2,1],description:'Bioluminescent reeds and silver fog under a star-filled sky.'},
  {id:7,name:'Skyvine Spiral',tag:'ABOVE THE CANOPY',surface:'stone',roadWidth:10,theme:{sky:'#bcd8ea',fog:'#cfe2ec',road:'#8a8fa0',grass:'#7fae8a',water:'#9fd4e8',sun:'#fff5d8'},points:[[0,56],[20,50],[34,32],[24,14],[40,2],[54,-14],[42,-36],[16,-46],[-12,-40],[-30,-22],[-44,-2],[-38,24],[-18,42]],elevation:[6,8,11,13,15,17,15,12,10,8,9,10,7],description:'Floating stone platforms connected by ancient sky vines.'}
];
export const wrap=(value,length)=>((value%length)+length)%length;
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function catmull(a,b,c,d,t){const t2=t*t,t3=t2*t;return .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);}
export function createTrack(id=0){
  const spec=TRACKS[id]||TRACKS[0],count=spec.points.length,raw=[],subdivisions=80;
  for(let i=0;i<count;i++)for(let j=0;j<subdivisions;j++){
    const t=j/subdivisions,at=k=>spec.points[wrap(k,count)],y=k=>spec.elevation[wrap(k,count)];
    raw.push({x:catmull(at(i-1)[0],at(i)[0],at(i+1)[0],at(i+2)[0],t),z:catmull(at(i-1)[1],at(i)[1],at(i+1)[1],at(i+2)[1],t),y:catmull(y(i-1),y(i),y(i+1),y(i+2),t)});
  }
  raw.push({...raw[0]});let length=0;raw[0].s=0;
  for(let i=1;i<raw.length;i++){length+=Math.hypot(raw[i].x-raw[i-1].x,raw[i].z-raw[i-1].z);raw[i].s=length;}
  const samples=[],N=384;let cursor=0;
  for(let i=0;i<N;i++){const s=length*i/N;while(cursor<raw.length-2&&raw[cursor+1].s<s)cursor++;const a=raw[cursor],b=raw[cursor+1],t=(s-a.s)/(b.s-a.s);samples.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,s});}
  for(let i=0;i<N;i++){const prev=samples[wrap(i-1,N)],next=samples[(i+1)%N],dx=next.x-prev.x,dz=next.z-prev.z,l=Math.hypot(dx,dz);Object.assign(samples[i],{tx:dx/l,tz:dz/l,nx:dz/l,nz:-dx/l,angle:Math.atan2(dx,dz)});}
  return {...spec,samples,length};
}
export function sampleTrack(track,distance,offset=0){
  const index=wrap(distance,track.length)/track.length*track.samples.length,i=Math.floor(index),t=index-i,a=track.samples[i],b=track.samples[(i+1)%track.samples.length];
  let tx=a.tx+(b.tx-a.tx)*t,tz=a.tz+(b.tz-a.tz)*t;const l=Math.hypot(tx,tz);tx/=l;tz/=l;
  return{x:a.x+(b.x-a.x)*t+tz*offset,z:a.z+(b.z-a.z)*t-tx*offset,y:a.y+(b.y-a.y)*t,tx,tz,nx:tz,nz:-tx,angle:Math.atan2(tx,tz)};
}
export function projectTrack(track,x,z){
  let best=Infinity,result;
  for(let i=0;i<track.samples.length;i++){
    const a=track.samples[i],b=track.samples[(i+1)%track.samples.length],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/l2,0,1),px=a.x+dx*t,pz=a.z+dz*t,d2=(x-px)**2+(z-pz)**2;
    if(d2<best){best=d2;const l=Math.sqrt(l2),nx=dz/l,nz=-dx/l;result={distance:wrap((i+t)*track.length/track.samples.length,track.length),lateral:(x-px)*nx+(z-pz)*nz,x:px,z:pz,y:a.y+(b.y-a.y)*t,angle:Math.atan2(dx,dz),tx:dx/l,tz:dz/l,nx,nz,index:i};}
  }
  result.offroad=Math.sqrt(best)>track.roadWidth/2;return result;
}
export function gridPosition(track,slot){const s=-(4+Math.floor(slot/2)*3.1),offset=slot%2===0?-2:2;return{...sampleTrack(track,s,offset),distance:wrap(s,track.length),progress:s};}
export function pickupLocations(track){return [0.13,0.31,0.52,0.72,0.89].flatMap((fraction,index)=>[-2.6,2.6].map((offset,lane)=>({id:`box-${index}-${lane}`,...sampleTrack(track,track.length*fraction,offset),available:true,cooldown:0})));}
export function splitRects(count,width,height){
  const n=Math.max(1,Math.min(6,count));const columns=n===1?1:2,rows=n<=2?(n===2?2:1):n<=4?2:3;
  // Two players get full-width horizontal split; four and six use a 2-column grid.
  const cols=n===2?1:columns;
  return Array.from({length:n},(_,i)=>({x:(i%cols)*width/cols,y:Math.floor(i/cols)*height/rows,w:width/cols,h:height/rows}));
}
