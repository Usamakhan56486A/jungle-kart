import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RaceGame,KART_STATS} from '../game.mjs';
import {ANIMALS,VEHICLES,TRACKS,ITEMS,CUP_POINTS,createTrack,sampleTrack,projectTrack,splitRects} from '../public/world.js';
const advance=(game,seconds)=>{for(let i=0;i<Math.ceil(seconds*60);i++)game.step(1/60);};
const racing=()=>{const game=new RaceGame({random:()=>.25}),player=game.addPlayer('host',{animal:'tiger',vehicle:'kart'});game.start('single');advance(game,3.4);return{game,player};};

test('fifteen selectable animals and six different vehicle bodies are available',()=>{
  assert.equal(ANIMALS.length,15);assert.equal(new Set(ANIMALS.map(a=>a.id)).size,15);assert.equal(VEHICLES.length,6);
  for(const animal of ANIMALS){const game=new RaceGame();assert.equal(game.addPlayer('a',{animal:animal.id}).animal,animal.id);}
});
test('every vehicle has exactly the same acceleration, top speed, and handling',()=>{
  const outcomes=VEHICLES.map(vehicle=>{const {game,player}=racing();player.vehicle=vehicle.id;game.setInput('host',player.id,{throttle:1,steer:.1});for(let i=0;i<30;i++)game.step(1/60,player.lastInput+i*1000/60);return[player.x,player.z,player.angle,player.speed];});
  for(const outcome of outcomes)assert.deepEqual(outcome,outcomes[0]);assert.equal(KART_STATS.topSpeed,26);assert.ok(Object.isFrozen(KART_STATS));
});
test('eight distinct smooth circuits support consistent sampling and projection',()=>{
  assert.equal(TRACKS.length,8);
  const lengths=[];for(const spec of TRACKS){const track=createTrack(spec.id);lengths.push(track.length);assert.equal(track.samples.length,384);assert.ok(track.length>250,`track ${spec.id} too short: ${track.length}`);for(const fraction of [0,.2,.49,.8,.99]){const p=sampleTrack(track,track.length*fraction);const projection=projectTrack(track,p.x,p.z);assert.ok(Math.hypot(p.x-projection.x,p.z-projection.z)<.06);assert.ok(Math.abs(p.y-projection.y)<.06);}}
  assert.equal(new Set(lengths).size,8);
});
test('2, 4, and 6 split-screen rectangles cover the viewport without overlap',()=>{
  for(const count of [1,2,4,6]){const rects=splitRects(count,1440,900);assert.equal(rects.length,count);assert.equal(rects.reduce((sum,r)=>sum+r.w*r.h,0),1440*900);for(const r of rects){assert.ok(r.w>0&&r.h>0);assert.ok(r.x+r.w<=1440);assert.ok(r.y+r.h<=900);}}
  assert.equal(splitRects(2,1000,800)[0].w,1000);assert.equal(splitRects(6,1200,900)[0].h,300);
});
test('mixed local and router controllers share a six-player cap',()=>{
  const g=new RaceGame();for(let i=0;i<4;i++)g.addPlayer('host',{control:'pad'+i});g.addPlayer('phone',{control:'touch',displayOnHost:true});g.addPlayer('laptop',{control:'keyboard1'});assert.equal(g.players.length,6);assert.equal(g.players[4].displayOnHost,true);assert.throws(()=>g.addPlayer('extra'),/full/);
});
test('only the owner can move or customize a racer',()=>{
  const {game,player}=racing();assert.equal(game.setInput('other',player.id,{throttle:1,steer:1}),false);assert.equal(game.setInput('host',player.id,{throttle:Infinity,steer:0}),false);
  assert.throws(()=>game.configure('host',player.id,{vehicle:'jeep'}),/between/);game.toLobby();assert.throws(()=>game.configure('other',player.id,{animal:'panda'}),/own/);game.configure('host',player.id,{animal:'elephant',vehicle:'hover'});assert.equal(player.animal,'elephant');assert.equal(player.vehicle,'hover');
});
test('countdown prevents false starts and input watchdog stops acceleration',()=>{
  const game=new RaceGame(),p=game.addPlayer('a');game.start();game.setInput('a',p.id,{throttle:1,steer:0});const x=p.x;game.step(.2);assert.equal(p.x,x);assert.equal(p.speed,0);advance(game,3.3);const movingSpeed=p.speed;game.step(.1,p.lastInput+1000);assert.ok(p.speed<movingSpeed);for(let i=0;i<60;i++)game.step(1/60,p.lastInput+2000);assert.equal(p.speed,0);
});
test('ordinary item crates award one power-up and enter cooldown',()=>{
  const {game,player}=racing(),box=game.boxes[0];Object.assign(player,{x:box.x,y:box.y,z:box.z,speed:0,progress:projectTrack(game.track,box.x,box.z).distance,trackDistance:projectTrack(game.track,box.x,box.z).distance});game.step(1/60);assert.ok(player.item);assert.equal(box.available,false);assert.ok(box.cooldown>6);const first=player.item;game.step(1/60);assert.equal(player.item,first);
});
test('boost and shields activate, and shield blocks an attack once',()=>{
  const {game,player}=racing();player.item='boost';game.useItem(player);assert.ok(player.boost>2);assert.equal(player.item,null);player.item='shield';game.useItem(player);assert.equal(player.shield,7);assert.equal(game.hit(player),false);assert.equal(player.shield,0);assert.equal(player.stun,0);player.invulnerable=0;assert.equal(game.hit(player),true);assert.ok(player.stun>0);
});
test('homing coconut selects the racer ahead; mud spawns behind the kart as a hazard',()=>{
  const {game,player}=racing();game.toLobby();const rival=game.addPlayer('other');game.start();advance(game,3.4);rival.progress=100;player.item='coconut';game.useItem(player);assert.equal(game.projectiles[0].target,rival.id);assert.equal(game.projectiles[0].type,'coconut');player.item='mud';game.useItem(player);const mud=game.hazards[0];assert.equal(mud.type,'mud');assert.ok(Math.hypot(mud.x-player.x,mud.z-player.z)>2);
});
test('thunder drum affects nearby rivals, not its owner or distant racers',()=>{
  const game=new RaceGame(),a=game.addPlayer('a'),b=game.addPlayer('b'),c=game.addPlayer('c');game.start();advance(game,3.4);Object.assign(a,{x:0,z:0,item:'pulse'});Object.assign(b,{x:3,z:0});Object.assign(c,{x:80,z:0});game.useItem(a);assert.equal(a.stun,0);assert.ok(b.stun>0);assert.equal(c.stun,0);
});
test('releasing a charged drift grants a temporary boost',()=>{
  const {game,player}=racing();Object.assign(player,{speed:16,drifting:true,driftCharge:1.2});game.setInput('host',player.id,{throttle:1,steer:0,drift:false});game.step(1/60);assert.ok(player.boost>1);assert.equal(player.driftCharge,0);assert.ok(game.events.some(e=>e.type==='driftboost'));
});
test('crossing the finish line updates laps, but arbitrary teleports do not',()=>{
  const {game,player}=racing(),distance=game.track.length-.25,point=sampleTrack(game.track,distance);Object.assign(player,{x:point.x,z:point.z,y:point.y,angle:point.angle,progress:distance,trackDistance:distance,speed:20,vx:point.tx*20,vz:point.tz*20,raceStartedLine:true});game.setInput('host',player.id,{throttle:1,steer:0});game.step(1/30);assert.equal(player.lap,2);const progress=player.progress;const elsewhere=sampleTrack(game.track,game.track.length*.6);Object.assign(player,{x:elsewhere.x,z:elsewhere.z});game.step(1/60);assert.ok(player.progress-progress<2);
});
test('resetting a kart costs track progress instead of advancing it',()=>{
  const {game,player}=racing();player.progress=100;game.resetKart(player);assert.equal(player.progress,93);assert.equal(player.speed,0);assert.ok(player.stun>0);
});
test('AI racers finish every circuit within the race limit',()=>{
  for(let track=0;track<TRACKS.length;track++){const game=new RaceGame({random:()=>.35});for(let i=0;i<6;i++)game.addPlayer('bot',{bot:true,animal:ANIMALS[i].id,vehicle:VEHICLES[i].id});game.start('single',track);for(let i=0;i<60*170&&game.phase!=='cupFinished';i++)game.step(1/60);assert.equal(game.phase,'cupFinished',`track ${track} did not finish`);assert.ok(game.players.every(p=>p.finished),`track ${track} has DNFs`);assert.ok(game.elapsed<170,`track ${track} too slow: ${game.elapsed}`);}
});
test('three-race Grand Prix accumulates points and records exactly one cup',()=>{
  const completed=[];const game=new RaceGame({onCupComplete:cup=>completed.push(cup),random:()=>.2});for(let i=0;i<6;i++)game.addPlayer('bot',{bot:true});game.start('cup');
  for(let round=0;round<3;round++){advance(game,3.4);game.elapsed=179.99;game.step(.02);assert.equal(game.players.reduce((sum,p)=>sum+p.cupPoints,0),CUP_POINTS.reduce((a,b)=>a+b,0)*(round+1));if(round<2){assert.equal(game.phase,'results');game.nextRace();assert.equal(game.trackId,round+1);}}
  assert.equal(game.phase,'cupFinished');assert.equal(completed.length,1);assert.equal(completed[0].totalRounds,3);assert.equal(game.cupResults.length,6);
});
test('photo finishes rank by actual crossing time rather than join order',()=>{
  const game=new RaceGame(),first=game.addPlayer('first'),second=game.addPlayer('second');game.start('single');advance(game,3.4);
  for(const [p,gap,lane] of [[first,.22,-2],[second,.09,2]]){const point=sampleTrack(game.track,-gap,lane);Object.assign(p,{x:point.x,z:point.z,y:point.y,angle:point.angle,progress:game.track.length*3-gap,trackDistance:game.track.length-gap,speed:20,vx:point.tx*20,vz:point.tz*20,completedLaps:2,raceStartedLine:true});game.setInput(p.owner,p.id,{throttle:1,steer:0});}
  game.step(1/60);assert.equal(first.finished,true);assert.equal(second.finished,true);assert.ok(second.finishTime<first.finishTime);assert.equal(second.rank,1);
});
test('side barrier clamps karts at the roadside fence without desynchronizing progress',()=>{
  const {game,player}=racing(),wall=game.track.roadWidth/2+.8,point=sampleTrack(game.track,100,game.track.roadWidth/2+8);
  Object.assign(player,{x:point.x,z:point.z,progress:100,trackDistance:100});game.step(1/60);
  const clamped=projectTrack(game.track,player.x,player.z);
  assert.ok(Math.abs(clamped.lateral)<=wall+.001,`kart escaped the barrier: ${clamped.lateral}`);
  assert.ok(Math.abs(player.progress-100)<.2,'barrier contact must not reset or desync race progress');
  assert.ok(Math.abs(clamped.distance-player.trackDistance)<.01);
  // Ramming the fence at speed kills the outward velocity instead of passing through.
  const inside=sampleTrack(game.track,100,wall-.05);
  Object.assign(player,{x:inside.x,z:inside.z,progress:100,trackDistance:100,speed:30,vx:inside.nx*30,vz:inside.nz*30});
  game.step(1/60);
  const held=projectTrack(game.track,player.x,player.z);
  assert.ok(Math.abs(held.lateral)<=wall+.001,`kart pushed through the fence: ${held.lateral}`);
  assert.ok(player.vx*held.nx+player.vz*held.nz<.01,'outward velocity should be scrubbed at the barrier');
});
test('snapshots exclude private input state and lobby reset clears stale events',()=>{
  const {game}=racing();assert.equal('input' in game.snapshot('a').players[0],false);assert.equal('lastInput' in game.snapshot('a').players[0],false);game.event('hit');game.toLobby();assert.equal(game.events.length,0);assert.equal(game.phase,'lobby');
});
test('twelve distinct powers are defined and reachable from the item bag',()=>{
  assert.equal(Object.keys(ITEMS).length,12);
  for(const key of ['boost','coconut','shield','mud','pulse','banana','rocket','shell','star','lightning','magnet','swap'])assert.ok(ITEMS[key],`missing ${key}`);
  const seen=new Set();for(let i=0;i<600;i++){const game=new RaceGame({random:()=>((i*7919)%1000)/1000});const p=game.addPlayer('a');seen.add(game.pickItem(p));}
  assert.ok(seen.size>=10,`item bag only produced ${seen.size} types: ${[...seen].join(',')}`);
});
test('sun star grants invincibility, ramming a star user stuns the attacker',()=>{
  const game=new RaceGame(),a=game.addPlayer('a'),b=game.addPlayer('b');game.start();advance(game,3.4);a.item='star';game.useItem(a);assert.ok(a.star>0);assert.equal(game.hit(a,1.5),false);Object.assign(a,{x:0,z:0});Object.assign(b,{x:1.4,z:0});game.step(1/60);assert.ok(b.stun>0,'rammer should be stunned');
});
test('storm call slows every rival ahead but not the user or trailing racers',()=>{
  const game=new RaceGame(),me=game.addPlayer('me'),ahead=game.addPlayer('ahead'),behind=game.addPlayer('behind');game.start();advance(game,3.4);me.progress=50;ahead.progress=80;behind.progress=20;me.item='lightning';game.useItem(me);assert.ok(ahead.slow>0);assert.equal(behind.slow,0);assert.equal(me.slow,0);
});
test('vine magnet steals the held item from the nearest racer ahead',()=>{
  const game=new RaceGame(),me=game.addPlayer('me'),rival=game.addPlayer('rival');game.start();advance(game,3.4);me.progress=50;rival.progress=70;rival.item='shield';me.item='magnet';game.useItem(me);assert.equal(rival.item,null);assert.equal(me.item,'shield');
});
test('spirit swap exchanges positions with a rival',()=>{
  const game=new RaceGame({random:()=>0}),me=game.addPlayer('me'),rival=game.addPlayer('rival');game.start();advance(game,3.4);me.progress=20;rival.progress=90;const myX=me.x,rivalX=rival.x;me.item='swap';game.useItem(me);assert.notEqual(me.x,myX);assert.notEqual(rival.x,rivalX);
});
test('slip banana spins out a rival that drives over it',()=>{
  const game=new RaceGame(),a=game.addPlayer('a'),b=game.addPlayer('b');game.start();advance(game,3.4);a.item='banana';game.useItem(a);const hazard=game.hazards.find(h=>h.type==='banana');assert.ok(hazard);Object.assign(b,{x:hazard.x,y:hazard.y,z:hazard.z,speed:14});hazard.age=1.5;game.step(1/60);assert.ok(b.spin>0||b.stun>0);
});
test('sky rocket fires forward and reef shell fires backward toward a pursuer',()=>{
  const game=new RaceGame(),me=game.addPlayer('me'),ahead=game.addPlayer('ahead'),behind=game.addPlayer('behind');game.start();advance(game,3.4);me.progress=50;ahead.progress=80;behind.progress=20;me.item='rocket';game.useItem(me);const rocket=game.projectiles.find(p=>p.type==='rocket');assert.equal(rocket.target,ahead.id);me.item='shell';game.useItem(me);const shell=game.projectiles.find(p=>p.type==='shell');assert.equal(shell.target,behind.id);
});
test('eight tracks all support a full grand prix rotation',()=>{
  for(let start=0;start<TRACKS.length;start++){const game=new RaceGame({random:()=>.5});for(let i=0;i<2;i++)game.addPlayer('bot',{bot:true});game.start('cup',start);for(let round=0;round<3;round++){assert.equal(game.trackId,(start+round)%TRACKS.length);advance(game,3.4);game.elapsed=179.99;game.step(.02);if(round<2)game.nextRace();}assert.equal(game.phase,'cupFinished');}
});
