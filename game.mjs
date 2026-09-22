import {ANIMALS,VEHICLES,COLORS,MAX_PLAYERS,LAPS,RACE_LIMIT,CUP_POINTS,ITEMS,TRACKS,createTrack,sampleTrack,projectTrack,gridPosition,pickupLocations,clamp,wrap} from './public/world.js';

// Uses the Web Crypto API so this module runs identically in Node 20+ and in the browser
// (the static Cloudflare Pages build imports it directly, with no server).
const randomUUID=()=>globalThis.crypto?.randomUUID?globalThis.crypto.randomUUID():`id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;

export const KART_STATS=Object.freeze({topSpeed:26,boostSpeed:37,reverseSpeed:8,acceleration:18,braking:32,steering:1.48,radius:1.05});
const TRACK_COUNT=TRACKS.length;
const angular=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const moveToward=(a,b,amount)=>a<b?Math.min(a+amount,b):Math.max(a-amount,b);
const cleanName=(name,fallback)=>String(name||fallback).replace(/[\x00-\x1f<>]/g,'').trim().slice(0,18)||fallback;
export class RaceGame{
  constructor({onCupComplete=()=>{},random=Math.random}={}){
    this.onCupComplete=onCupComplete;this.random=random;this.players=[];this.phase='lobby';this.trackId=0;this.track=createTrack(0);this.mode='cup';this.totalRounds=3;this.roundIndex=0;this.startingTrack=0;
    this.elapsed=0;this.countdown=0;this.raceRemaining=RACE_LIMIT;this.boxes=pickupLocations(this.track);this.projectiles=[];this.hazards=[];this.events=[];this.eventId=0;this.tick=0;this.raceResults=[];this.cupResults=[];this.firstFinishAt=null;
  }
  event(type,p={},extra={}){this.events.push({id:++this.eventId,type,x:p.x||0,y:p.y||0,z:p.z||0,color:p.color||'#f6bf69',...extra});this.events=this.events.slice(-48);}
  addPlayer(owner,options={}){
    if(!['lobby','cupFinished'].includes(this.phase))throw Error('Join between tournaments. This race is already underway.');
    if(this.players.length>=MAX_PLAYERS)throw Error('The grid is full. This game supports six racers.');
    const {bot=false,control='keyboard1'}=options;
    if(!bot&&!/^(keyboard[1-6]|touch|pad[0-3])$/.test(control))throw Error('Choose an available keyboard, touch screen, or controller.');
    if(!bot&&this.players.some(p=>p.owner===owner&&p.control===control))throw Error('That input is already assigned.');
    const slot=Array.from({length:MAX_PLAYERS},(_,i)=>i).find(s=>!this.players.some(p=>p.slot===s));
    const animal=ANIMALS.find(a=>a.id===options.animal)||ANIMALS[slot];
    const vehicle=VEHICLES.find(v=>v.id===options.vehicle)?.id||'kart';
    const p={id:randomUUID(),slot,owner,control,bot,displayOnHost:!bot&&options.displayOnHost===true,name:cleanName(options.name,bot?animal.name+' AI':animal.name),animal:animal.id,vehicle,color:COLORS[slot],cupPoints:0,totalTime:0,bestLap:null,input:{throttle:0,steer:0,brake:false,drift:false,useItem:false},lastInput:0};
    this.placeOnGrid(p);this.players.push(p);this.updateRanks();return p;
  }
  configure(owner,id,options){
    if(!['lobby','cupFinished'].includes(this.phase))throw Error('Change your garage between tournaments.');
    const p=this.players.find(p=>p.id===id&&p.owner===owner&&!p.bot);if(!p)throw Error('Choose one of your own racers.');
    if(options.animal!==undefined&&!ANIMALS.some(a=>a.id===options.animal))throw Error('Unknown animal.');
    if(options.vehicle!==undefined&&!VEHICLES.some(v=>v.id===options.vehicle))throw Error('Unknown vehicle.');
    if(options.name!==undefined)p.name=cleanName(options.name,p.name);
    if(options.animal)p.animal=options.animal;if(options.vehicle)p.vehicle=options.vehicle;
  }
  placeOnGrid(p){
    const grid=gridPosition(this.track,p.slot);
    Object.assign(p,{x:grid.x,y:grid.y,z:grid.z,angle:grid.angle,speed:0,vx:0,vz:0,steer:0,progress:grid.progress,trackDistance:grid.distance,lap:1,completedLaps:0,lastLapAt:0,raceStartedLine:false,lapTime:0,finished:false,finishTime:null,rank:p.slot+1,item:null,itemHeld:false,drifting:false,driftCharge:0,boost:0,shield:0,star:0,stun:0,spin:0,slow:0,invulnerable:0,offroad:false,wrongWay:0,resetCooldown:0});
  }
  removePlayer(id){this.players=this.players.filter(p=>p.id!==id);if(!this.players.length)this.toLobby();else this.updateRanks();}
  setInput(owner,id,value,now=Date.now()){
    const p=this.players.find(p=>p.id===id&&p.owner===owner&&!p.bot);
    if(!p||!value||!Number.isFinite(value.throttle)||!Number.isFinite(value.steer))return false;
    p.input={throttle:clamp(value.throttle,-1,1),steer:clamp(value.steer,-1,1),brake:value.brake===true,drift:value.drift===true,useItem:value.useItem===true};p.lastInput=now;return true;
  }
  start(mode='cup',trackId=0){
    if(!['lobby','cupFinished'].includes(this.phase))throw Error('Finish the current tournament or return to the garage.');
    if(!this.players.length)throw Error('Join the starting grid first.');
    this.mode=mode==='single'?'single':'cup';this.totalRounds=this.mode==='cup'?3:1;this.roundIndex=0;
    this.startingTrack=Number.isInteger(trackId)&&trackId>=0&&trackId<TRACK_COUNT?trackId:0;
    this.cupResults=[];for(const p of this.players){p.cupPoints=0;p.totalTime=0;p.bestLap=null;}
    this.prepareRace(this.startingTrack);
  }
  prepareRace(trackId){
    this.trackId=trackId;this.track=createTrack(trackId);this.phase='countdown';this.countdown=3.3;this.elapsed=0;this.raceRemaining=RACE_LIMIT;this.firstFinishAt=null;this.projectiles=[];this.hazards=[];this.events=[];this.raceResults=[];this.boxes=pickupLocations(this.track);
    for(const p of this.players)this.placeOnGrid(p);this.updateRanks();this.event('countdown');
  }
  nextRace(){if(this.phase!=='results')throw Error('The next race is not ready yet.');this.roundIndex++;this.prepareRace((this.startingTrack+this.roundIndex)%TRACK_COUNT);}
  toLobby(){this.phase='lobby';this.elapsed=0;this.events=[];this.projectiles=[];this.hazards=[];this.raceResults=[];this.cupResults=[];this.roundIndex=0;this.countdown=0;this.raceRemaining=RACE_LIMIT;this.boxes=pickupLocations(this.track);for(const p of this.players){p.cupPoints=0;this.placeOnGrid(p);}}
  botInput(p){
    const target=sampleTrack(this.track,p.trackDistance+7+Math.abs(p.speed)*.42,Math.sin(this.elapsed*.24+p.slot*2)*1.7);
    const angle=Math.atan2(target.x-p.x,target.z-p.z),error=angular(angle,p.angle);
    return{throttle:Math.abs(error)>1.0?.45:1,steer:clamp(error*1.5,-1,1),brake:Math.abs(error)>1.4&&p.speed>13,drift:Math.abs(error)>.33&&Math.abs(error)<1.1&&p.speed>12,useItem:!!p.item&&Math.floor(this.elapsed*3+p.slot)%7===0};
  }
  resetKart(p){
    p.progress=Math.max(-12,p.progress-7);const point=sampleTrack(this.track,p.progress,0);
    Object.assign(p,{x:point.x,y:point.y,z:point.z,angle:point.angle,trackDistance:wrap(p.progress,this.track.length),speed:0,vx:0,vz:0,stun:.7,spin:0,resetCooldown:2,drifting:false,driftCharge:0});
    this.event('reset',p);
  }
  updateRanks(){
    const sorted=[...this.players].sort((a,b)=>a.finished&&b.finished?a.finishTime-b.finishTime:a.finished?-1:b.finished?1:b.progress-a.progress);
    sorted.forEach((p,i)=>p.rank=i+1);
  }
  pickItem(p){
    const trailing=p.rank>=Math.ceil(this.players.length*.65);
    const bag=trailing
      ?['boost','boost','boost','coconut','shield','pulse','star','star','magnet','swap','rocket','lightning','banana','shell']
      :['boost','coconut','coconut','shield','mud','banana','shell','rocket','lightning','pulse','magnet','swap'];
    return bag[Math.floor(this.random()*bag.length)%bag.length];
  }
  hit(p,duration=1.1){
    if(p.finished||p.invulnerable>0||p.star>0)return false;
    if(p.shield>0){p.shield=0;p.invulnerable=.4;this.event('blocked',p);return false;}
    p.stun=duration;p.speed*=.3;p.vx*=.3;p.vz*=.3;p.invulnerable=1.5;p.driftCharge=0;this.event('hit',p);return true;
  }
  spinOut(p,duration=1.3){
    if(p.finished||p.invulnerable>0||p.star>0)return false;
    if(p.shield>0){p.shield=0;p.invulnerable=.4;this.event('blocked',p);return false;}
    p.spin=duration;p.stun=Math.max(p.stun,duration*.85);p.speed*=.35;p.vx*=.35;p.vz*=.35;p.invulnerable=1.4;p.driftCharge=0;this.event('spin',p);return true;
  }
  rivalsAhead(p){return this.players.filter(o=>o.id!==p.id&&!o.finished&&o.progress>p.progress).sort((a,b)=>a.progress-b.progress);}
  useItem(p){
    if(!p.item||p.stun>0||p.finished)return;
    const type=p.item;p.item=null;this.event('item',p,{item:type});
    if(type==='boost')p.boost=Math.max(p.boost,2.4);
    else if(type==='shield')p.shield=7;
    else if(type==='star'){p.star=5;p.boost=Math.max(p.boost,3.2);p.invulnerable=Math.max(p.invulnerable,5);}
    else if(type==='pulse'){
      for(const other of this.players)if(other.id!==p.id&&Math.hypot(other.x-p.x,other.z-p.z)<14)this.hit(other,1.2);
      this.event('pulse',p);
    }else if(type==='coconut'){
      const target=this.rivalsAhead(p)[0];
      this.projectiles.push({id:randomUUID(),type,owner:p.id,target:target?.id||null,x:p.x+Math.sin(p.angle)*2.5,y:p.y+.65,z:p.z+Math.cos(p.angle)*2.5,angle:p.angle,life:7,age:0});
    }else if(type==='rocket'){
      const target=this.rivalsAhead(p)[0];
      this.projectiles.push({id:randomUUID(),type,owner:p.id,target:target?.id||null,x:p.x+Math.sin(p.angle)*2.4,y:p.y+.95,z:p.z+Math.cos(p.angle)*2.4,angle:p.angle,life:5,age:0});
    }else if(type==='shell'){
      const behind=[...this.players].filter(o=>o.id!==p.id&&!o.finished&&o.progress<p.progress).sort((a,b)=>b.progress-a.progress)[0];
      const angle=behind?Math.atan2(behind.x-p.x,behind.z-p.z):p.angle+Math.PI;
      this.projectiles.push({id:randomUUID(),type,owner:p.id,target:behind?.id||null,x:p.x+Math.sin(angle)*2.2,y:p.y+.6,z:p.z+Math.cos(angle)*2.2,angle,life:6,age:0});
    }else if(type==='mud')this.hazards.push({id:randomUUID(),type,owner:p.id,x:p.x-Math.sin(p.angle)*2.3,y:p.y+.06,z:p.z-Math.cos(p.angle)*2.3,angle:p.angle,life:24,age:0});
    else if(type==='banana')this.hazards.push({id:randomUUID(),type,owner:p.id,x:p.x-Math.sin(p.angle)*2.4,y:p.y+.08,z:p.z-Math.cos(p.angle)*2.4,angle:p.angle,life:22,age:0});
    else if(type==='lightning'){
      let struck=0;
      for(const other of this.rivalsAhead(p)){other.slow=Math.max(other.slow,2.2);if(other.shield>0){other.shield=0;this.event('blocked',other);}else if(other.star<=0){other.speed*=.55;other.vx*=.55;other.vz*=.55;}struck++;}
      this.event('lightning',p,{struck});
    }else if(type==='magnet'){
      const target=this.rivalsAhead(p).find(o=>o.item);
      if(target){p.item=target.item;target.item=null;this.event('magnet',p,{from:target.color});}
      else{p.boost=Math.max(p.boost,1.2);this.event('magnet',p,{from:null});}
    }else if(type==='swap'){
      const candidates=this.players.filter(o=>o.id!==p.id&&!o.finished);
      if(candidates.length){
        const target=candidates[Math.floor(this.random()*candidates.length)%candidates.length];
        const px=p.x,py=p.y,pz=p.z,pangle=p.angle,pprogress=p.progress,pdistance=p.trackDistance;
        p.x=target.x;p.y=target.y;p.z=target.z;p.angle=target.angle;p.progress=target.progress;p.trackDistance=target.trackDistance;
        target.x=px;target.y=py;target.z=pz;target.angle=pangle;target.progress=pprogress;target.trackDistance=pdistance;
        p.vx=target.speed*Math.sin(p.angle);p.vz=target.speed*Math.cos(p.angle);
        target.vx=p.speed*Math.sin(target.angle);target.vz=p.speed*Math.cos(target.angle);
        p.stun=Math.max(p.stun,.35);target.stun=Math.max(target.stun,.35);
        this.event('swap',p,{with:target.color});
      }
    }
  }
  step(dt,now=Date.now()){
    this.tick++;
    if(this.phase==='countdown'){this.countdown=Math.max(0,this.countdown-dt);if(this.countdown===0){this.phase='racing';this.event('go');}return;}
    if(this.phase!=='racing')return;
    this.elapsed+=dt;this.raceRemaining=Math.max(0,RACE_LIMIT-this.elapsed);
    for(const box of this.boxes){box.cooldown=Math.max(0,box.cooldown-dt);box.available=box.cooldown<=0;}
    for(const p of this.players){
      for(const key of ['boost','shield','star','stun','spin','slow','invulnerable','resetCooldown'])p[key]=Math.max(0,p[key]-dt);
      if(p.finished){p.speed=moveToward(p.speed,0,15*dt);continue;}
      const input=p.bot?this.botInput(p):now-p.lastInput<650?p.input:{throttle:0,steer:0,brake:false,drift:false,useItem:false};
      if(input.useItem&&!p.itemHeld)this.useItem(p);p.itemHeld=input.useItem;
      p.steer=moveToward(p.steer,input.steer,7*dt);
      const wasDrifting=p.drifting;p.drifting=input.drift&&Math.abs(p.steer)>.12&&p.speed>9&&p.stun===0&&!p.offroad;
      if(p.drifting)p.driftCharge=Math.min(1.6,p.driftCharge+dt);
      else if(wasDrifting){if(p.driftCharge>.65){p.boost=Math.max(p.boost,.65+p.driftCharge*.55);this.event('driftboost',p);}p.driftCharge=0;}
      const slowFactor=p.slow>0?.62:1;
      const top=(p.offroad?12:p.boost>0?KART_STATS.boostSpeed:KART_STATS.topSpeed)*slowFactor;
      let desired=input.throttle>=0?top*input.throttle:KART_STATS.reverseSpeed*input.throttle;
      if(p.boost>0&&!input.brake)desired=top;if(input.brake||p.stun>0)desired=0;
      const acceleration=(p.stun>0||input.brake)?KART_STATS.braking:Math.abs(desired)>Math.abs(p.speed)?KART_STATS.acceleration:12;
      p.speed=moveToward(p.speed,desired,acceleration*dt);
      const steerLock=p.spin>0?0:1;
      if(p.stun===0&&Math.abs(p.speed)>.3)p.angle+=(p.steer*steerLock)*KART_STATS.steering*(.35+.65*Math.min(Math.abs(p.speed)/13,1))*(p.drifting?1.35:1)*Math.sign(p.speed)*dt;
      if(p.spin>0)p.angle+=p.spin*7*dt;
      const grip=1-Math.exp(-(p.drifting?3.4:9)*dt);
      p.vx+=(Math.sin(p.angle)*p.speed-p.vx)*grip;p.vz+=(Math.cos(p.angle)*p.speed-p.vz)*grip;
      p.x+=p.vx*dt;p.z+=p.vz*dt;
      // Solid side barrier: the roadside post-and-rail fence is scenery at half+.95,
      // so clamp the kart centre just inside it. Karts scrape the fence instead of
      // driving through the sticks into the jungle (or off elevated boardwalks).
      let projection=projectTrack(this.track,p.x,p.z);
      const wall=this.track.roadWidth/2+.8;
      if(Math.abs(projection.lateral)>wall){
        const side=Math.sign(projection.lateral),over=Math.abs(projection.lateral)-wall;
        p.x-=projection.nx*side*over;p.z-=projection.nz*side*over;
        const outward=(p.vx*projection.nx+p.vz*projection.nz)*side;
        if(outward>0){p.vx-=projection.nx*side*outward;p.vz-=projection.nz*side*outward;p.speed*=.97;}
        projection=projectTrack(this.track,p.x,p.z);
      }
      const lateral=Math.abs(projection.lateral);
      p.offroad=lateral>this.track.roadWidth/2+.25;
      p.y=projection.y*Math.max(0,1-Math.max(0,lateral-this.track.roadWidth/2)/12);
      if(lateral>this.track.roadWidth/2+10&&p.resetCooldown===0){this.resetKart(p);continue;}
      let delta=projection.distance-p.trackDistance;if(delta>this.track.length/2)delta-=this.track.length;if(delta<-this.track.length/2)delta+=this.track.length;
      const previousProgress=p.progress;
      if(Math.abs(delta)<Math.max(3,Math.abs(p.speed)*dt*5)&&lateral<this.track.roadWidth/2+7){p.progress+=delta;p.trackDistance=projection.distance;}
      else{this.resetKart(p);continue;}
      const crossingTime=boundary=>this.elapsed-dt+dt*clamp((boundary-previousProgress)/Math.max(p.progress-previousProgress,.000001),0,1);
      p.wrongWay=delta<-.02?Math.min(4,p.wrongWay+dt):Math.max(0,p.wrongWay-dt*.7);
      if(!p.raceStartedLine&&p.progress>=0){p.raceStartedLine=true;p.lastLapAt=crossingTime(0);}
      const completed=Math.floor(Math.max(0,p.progress)/this.track.length);
      if(completed>p.completedLaps){const crossedAt=crossingTime(completed*this.track.length),time=crossedAt-p.lastLapAt;p.bestLap=p.bestLap===null?time:Math.min(p.bestLap,time);p.lastLapAt=crossedAt;p.completedLaps=completed;this.event('lap',p,{lap:completed+1});}
      p.lap=Math.min(LAPS,completed+1);p.lapTime=this.elapsed-p.lastLapAt;
      if(p.progress>=this.track.length*LAPS){p.finished=true;p.finishTime=crossingTime(this.track.length*LAPS);if(this.firstFinishAt===null)this.firstFinishAt=this.elapsed;this.event('finish',p);continue;}
      if(!p.item)for(const box of this.boxes){if(box.available&&Math.hypot(box.x-p.x,box.z-p.z)<2){p.item=this.pickItem(p);box.available=false;box.cooldown=7;this.event('pickup',p,{item:p.item});break;}}
    }
    // Hazards sit on the track and trigger once per racer.
    for(const hazard of this.hazards){
      hazard.life-=dt;hazard.age+=dt;
      if(hazard.age<.6)continue;
      for(const p of this.players){
        if(p.finished||p.id===hazard.owner&&hazard.age<3)continue;
        if(p.invulnerable>0||p.star>0)continue;
        if(Math.hypot(p.x-hazard.x,p.z-hazard.z)<1.6&&Math.abs(p.y-hazard.y)<2){
          if(hazard.type==='banana')this.spinOut(p,1.1);else this.hit(p,1.05);
          hazard.life=0;this.event(hazard.type==='banana'?'banana':'mudtrap',p);break;
        }
      }
    }
    this.hazards=this.hazards.filter(h=>h.life>0);
    // All vehicle bodies share this collision radius and the same physics constants.
    for(let i=0;i<this.players.length;i++)for(let j=i+1;j<this.players.length;j++){
      const a=this.players[i],b=this.players[j];if(a.finished||b.finished||Math.abs(a.y-b.y)>2)continue;
      if(a.star>0&&b.star<=0){this.hit(b,.9);continue;}
      if(b.star>0&&a.star<=0){this.hit(a,.9);continue;}
      const dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz),minimum=KART_STATS.radius*2;
      if(d<minimum&&d>.01){const nx=dx/d,nz=dz/d,push=(minimum-d)*.5;a.x-=nx*push;a.z-=nz*push;b.x+=nx*push;b.z+=nz*push;a.speed*=.993;b.speed*=.993;}
    }
    for(const projectile of this.projectiles){
      projectile.life-=dt;projectile.age+=dt;
      const speed=projectile.type==='rocket'?48:projectile.type==='shell'?30:34;
      if(projectile.type==='coconut'||projectile.type==='rocket'){
        const target=this.players.find(p=>p.id===projectile.target&&!p.finished);
        const turn=projectile.type==='rocket'?2.2:5;
        if(target)projectile.angle+=clamp(angular(Math.atan2(target.x-projectile.x,target.z-projectile.z),projectile.angle),-turn*dt,turn*dt);
      }
      projectile.x+=Math.sin(projectile.angle)*speed*dt;projectile.z+=Math.cos(projectile.angle)*speed*dt;projectile.y=projectTrack(this.track,projectile.x,projectile.z).y+.65;
      for(const p of this.players){
        if(p.finished||(p.id===projectile.owner&&projectile.age<2))continue;
        if(p.star>0)continue;
        if(Math.hypot(p.x-projectile.x,p.z-projectile.z)<1.55&&Math.abs(p.y-projectile.y)<2){
          if(projectile.type==='rocket'){this.hit(p,1.5);p.speed*=.2;p.vx*=.2;p.vz*=.2;this.event('rocket',p);}
          else this.hit(p,1.25);
          projectile.life=0;break;
        }
      }
    }
    this.projectiles=this.projectiles.filter(p=>p.life>0);this.updateRanks();
    if(this.raceRemaining<=0||this.players.every(p=>p.finished)||(this.firstFinishAt!==null&&this.elapsed-this.firstFinishAt>=30))this.finishRace();
  }
  finishRace(){
    if(this.phase!=='racing')return;this.updateRanks();
    const sorted=[...this.players].sort((a,b)=>a.rank-b.rank);
    this.raceResults=sorted.map(p=>{const points=CUP_POINTS[p.rank-1]||0;p.cupPoints+=points;p.totalTime+=p.finishTime??this.elapsed+30;return{id:p.id,name:p.name,animal:p.animal,vehicle:p.vehicle,color:p.color,rank:p.rank,points,cupPoints:p.cupPoints,finishTime:p.finishTime,bestLap:p.bestLap,bot:p.bot,finished:p.finished};});
    this.cupResults=[...this.players].sort((a,b)=>b.cupPoints-a.cupPoints||a.totalTime-b.totalTime).map((p,i)=>({id:p.id,name:p.name,animal:p.animal,vehicle:p.vehicle,color:p.color,rank:i+1,points:p.cupPoints,totalTime:p.totalTime,bestLap:p.bestLap,bot:p.bot}));
    this.phase=this.roundIndex+1>=this.totalRounds?'cupFinished':'results';this.event('raceover');
    if(this.phase==='cupFinished')this.onCupComplete({mode:this.mode,results:this.cupResults.map(p=>({...p})),trackId:this.trackId,totalRounds:this.totalRounds});
  }
  snapshot(hostId){
    return{phase:this.phase,trackId:this.trackId,trackCount:TRACK_COUNT,elapsed:this.elapsed,raceRemaining:this.raceRemaining,countdown:this.countdown,roundIndex:this.roundIndex,totalRounds:this.totalRounds,mode:this.mode,laps:LAPS,tick:this.tick,hostId,players:this.players.map(({input,lastInput,itemHeld,vx,vz,resetCooldown,invulnerable,raceStartedLine,lastLapAt,completedLaps,...p})=>p),boxes:this.boxes,projectiles:this.projectiles,hazards:this.hazards,events:this.events,raceResults:this.raceResults,cupResults:this.cupResults};
  }
}
