import {RacingScene,PodiumScene} from './scene.js';
import {ANIMALS,VEHICLES,COLORS,ITEMS,ITEM_IDS,TRACKS,createTrack,splitRects,clamp} from './world.js';

const $=id=>document.getElementById(id);
const touchDevice=matchMedia('(pointer:coarse)').matches;
let windowFocused=document.hasFocus();
let socket,clientId=null,connected=false,scene=null,retry=0,urls=[],previewTrack=0,activePlayerId=null;
let state={phase:'lobby',trackId:0,elapsed:0,countdown:0,roundIndex:0,totalRounds:3,players:[],boxes:[],projectiles:[],events:[],raceResults:[],cupResults:[],tick:0};
let prefs={animal:'tiger',vehicle:'kart',name:''};
try{const stored=JSON.parse(localStorage.getItem('jungle-garage')||'{}');if(ANIMALS.some(a=>a.id===stored.animal))prefs.animal=stored.animal;if(VEHICLES.some(v=>v.id===stored.vehicle))prefs.vehicle=stored.vehicle;if(typeof stored.name==='string')prefs.name=stored.name.slice(0,18);}catch{}
let previousPhase='lobby',rosterKey='',hudKey='',viewIds=[],hudViews=[],mapTrack=createTrack(0),mapTrackId=0,lastEvent=0,lastCountdown=4,notificationTimer,alertTimer;
let lowQuality=touchDevice,sound=false,audio,engine,engineGain,disposedForController=false;
const podiums=new Map(['results','leaderboard'].map(id=>[id,{scene:null,entries:[],failed:false}]));
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let leaderboardRequest=0;
function closePodium(id){const podium=podiums.get(id);podium.scene?.dispose();podium.scene=null;podium.failed=false;}
for(const id of podiums.keys())$(id+'-dialog').addEventListener('close',()=>{closePodium(id);if(id==='leaderboard')leaderboardRequest++;});
function updatePodiums(dt){
  for(const [id,podium] of podiums){
    const canvas=$(id+'-podium');
    if(!$(id+'-dialog').open){if(podium.scene)closePodium(id);continue;}
    if(podium.failed)continue;
    try{
      if(!podium.scene){canvas.hidden=false;podium.scene=new PodiumScene(canvas);podium.scene.setQuality(lowQuality);}
      podium.scene.update(podium.entries,reducedMotion.matches?0:dt);
    }catch(error){closePodium(id);podium.failed=true;canvas.hidden=true;console.warn('3D podium unavailable; the standings below are still available.',error);}
  }
}
const keys=new Set(),padStarts=new Map(),itemPresses=new Map(),touch={steer:0,brake:false,drift:false,useItem:false};
const ownPlayers=()=>state.players.filter(p=>p.owner===clientId);
const isHost=()=>clientId&&state.hostId===clientId;
const controllerOnly=()=>ownPlayers().length>0&&ownPlayers().every(p=>p.displayOnHost)&&!isHost();
const animalFor=id=>ANIMALS.find(a=>a.id===id)||ANIMALS[0];
const vehicleFor=id=>VEHICLES.find(v=>v.id===id)||VEHICLES[0];
// Six keyboard schemes occupy separate physical zones of one keyboard, plus a single gamepad slot.
const KEYMAP={
  keyboard1:{up:'KeyW',down:'KeyS',left:'KeyA',right:'KeyD',drift:'Space',item:'KeyE'},
  keyboard2:{up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',drift:'ShiftRight',item:'Enter'},
  keyboard3:{up:'KeyI',down:'KeyK',left:'KeyJ',right:'KeyL',drift:'KeyU',item:'KeyO'},
  keyboard4:{up:'KeyT',down:'KeyG',left:'KeyF',right:'KeyH',drift:'KeyV',item:'KeyY'},
  keyboard5:{up:'Numpad8',down:'Numpad5',left:'Numpad4',right:'Numpad6',drift:'Numpad0',item:'NumpadDecimal'},
  keyboard6:{up:'Digit8',down:'Digit5',left:'Digit4',right:'Digit6',drift:'Digit7',item:'Digit9'}
};
const KEY_LABEL={
  keyboard1:{name:'P1 · WASD',drive:'W A S D',drift:'Space',item:'E'},
  keyboard2:{name:'P2 · Arrows',drive:'↑ ← ↓ →',drift:'R Shift',item:'Enter'},
  keyboard3:{name:'P3 · IJKL',drive:'I J K L',drift:'U',item:'O'},
  keyboard4:{name:'P4 · TFGH',drive:'T F G H',drift:'V',item:'Y'},
  keyboard5:{name:'P5 · Numpad',drive:'8 4 5 6',drift:'Num 0',item:'Num .'},
  keyboard6:{name:'P6 · Numbers',drive:'8 4 5 6',drift:'7',item:'9'}
};
const labelFor=control=>KEY_LABEL[control]?`${KEY_LABEL[control].drive} · ${KEY_LABEL[control].drift} · ${KEY_LABEL[control].item}`:control==='touch'?'Touch steering':control==='bot'?'AI racer':control==='pad0'?'Gamepad 1':`Gamepad ${Number(control.slice(3))+1}`;
const raceActive=()=>['countdown','racing','results','cupFinished'].includes(state.phase);
const editable=()=>['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)||!!document.querySelector('dialog[open]');
const formatTime=value=>value===null||value===undefined?'DNF':`${Math.floor(value/60)}:${(value%60).toFixed(2).padStart(5,'0')}`;
function svgIcon(id){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 64 64');svg.setAttribute('aria-hidden','true');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#'+id);svg.append(use);return svg;}
function notify(message){$('notice').textContent=message;$('notice').classList.add('visible');clearTimeout(notificationTimer);notificationTimer=setTimeout(()=>$('notice').classList.remove('visible'),4300);}
function raceAlert(message){$('race-alert').textContent=message;$('race-alert').classList.add('visible');clearTimeout(alertTimer);alertTimer=setTimeout(()=>$('race-alert').classList.remove('visible'),2400);}
function savePrefs(){try{localStorage.setItem('jungle-garage',JSON.stringify(prefs));}catch{}}
function send(message){if(socket?.readyState!==WebSocket.OPEN){if(message.type!=='input')notify('Connecting to the host. Try again in a moment.');return false;}socket.send(JSON.stringify(message));return true;}
function connection(text,ok){$('connection').textContent=text;$('connection').classList.toggle('online',ok);$('connection').classList.toggle('offline',!ok);}
function connect(){
  socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}`);
  socket.onopen=()=>{connected=true;retry=0;connection('LOCAL CONNECTED',true);};
  socket.onmessage=event=>{
    let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message.type==='welcome'){
      clientId=message.clientId;state.hostId=message.hostId;urls=message.lanUrls;lastEvent=0;activePlayerId=null;rosterKey='';hudKey='';
      const current=urls.find(url=>new URL(url).hostname===location.hostname)||urls[0];$('network-url').textContent=current||'Connect the host to Wi-Fi';$('network-select').replaceChildren();
      for(const url of urls){const option=document.createElement('option');option.value=url;option.textContent=url;$('network-select').append(option);}$('network-select').value=current||'';$('network-select').hidden=urls.length<2;
    }else if(message.type==='state'){state=message.state;renderUI();}
    else if(message.type==='joined'){activePlayerId=message.playerId;rosterKey='';tone(540,.1);}
    else if(message.type==='error')notify(message.message);
    else if(message.type==='pong')connection(`${Date.now()-message.at} ms · LOCAL`,true);
  };
  socket.onclose=()=>{connected=false;keys.clear();resetTouch();connection('RECONNECTING',false);renderUI();notify('Host disconnected. Keep the game server running. Reconnecting…');setTimeout(connect,Math.min(1000*2**retry++,5000));};
  socket.onerror=()=>connection('HOST UNAVAILABLE',false);
}
function setGarage(){
  $('selected-animal').textContent=`${animalFor(prefs.animal).name} · ${animalFor(prefs.animal).species}`;$('selected-vehicle').textContent=vehicleFor(prefs.vehicle).name;
  for(const button of $('animal-grid').children){button.classList.toggle('active',button.dataset.animal===prefs.animal);button.setAttribute('aria-pressed',String(button.dataset.animal===prefs.animal));}
  for(const button of $('vehicle-grid').children){button.classList.toggle('active',button.dataset.vehicle===prefs.vehicle);button.setAttribute('aria-pressed',String(button.dataset.vehicle===prefs.vehicle));}
}
function configure(){savePrefs();setGarage();if(activePlayerId&&['lobby','cupFinished'].includes(state.phase)&&ownPlayers().some(p=>p.id===activePlayerId))send({type:'configure',playerId:activePlayerId,...prefs});}
for(const animal of ANIMALS){const button=document.createElement('button');button.className='animal-tile';button.dataset.animal=animal.id;button.title=`${animal.name} the ${animal.species}`;button.setAttribute('aria-label',button.title);button.append(svgIcon('avatar-'+animal.id));const name=document.createElement('span');name.textContent=animal.species;button.append(name);button.onclick=()=>{prefs.animal=animal.id;configure();};$('animal-grid').append(button);}
for(const vehicle of VEHICLES){const button=document.createElement('button');button.className='vehicle-tile';button.dataset.vehicle=vehicle.id;button.title=`${vehicle.name} — identical racing stats`;button.setAttribute('aria-label',vehicle.name);button.append(svgIcon('vehicle-'+vehicle.id));const name=document.createElement('span');name.textContent=vehicle.name;button.append(name);button.onclick=()=>{prefs.vehicle=vehicle.id;configure();};$('vehicle-grid').append(button);}
$('player-name').value=prefs.name;$('player-name').addEventListener('change',()=>{prefs.name=$('player-name').value.trim();configure();});
$('player-name').addEventListener('keydown',event=>{if(event.key==='Enter'&&!raceActive())$('join-button').click();});
function join(control){
  const displayOnHost=$('device-mode').value==='controller';
  if(displayOnHost&&isHost()){notify('Open the game on the PC first, then connect this device using its router address for controller-only mode.');return false;}
  prefs.name=$('player-name').value.trim();savePrefs();
  return send({type:'join',control,displayOnHost,...prefs});
}
$('join-button').onclick=()=>join(touchDevice?'touch':'keyboard1');
function readPads(){try{return [...(navigator.getGamepads?.()||[])];}catch{return [];}}
// Browsers do not guarantee a pad sits at index 0 (a reconnect can leave a hole in the
// array), so bind each racer to the pad's real index or its buttons read as dead.
const padControl=pad=>`pad${Math.min(pad.index,3)}`;
const freePad=()=>readPads().find(p=>p&&p.connected!==false&&!state.players.some(q=>q.control===padControl(p)));
// Each keyboard slot and the single gamepad slot has its own explicit join button.
for(const button of document.querySelectorAll('.join-key[data-control]'))button.onclick=()=>{
  const control=button.dataset.control;
  if(state.players.some(p=>p.control===control)){notify(`${KEY_LABEL[control]?.name||control} is already on the grid.`);return;}
  join(control);
};
$('add-pad').onclick=()=>{
  if(state.players.some(p=>p.control.startsWith('pad'))){notify('The gamepad slot is already taken.');return;}
  const pad=freePad();
  if(!pad){notify('No gamepad detected. Plug one in, press any button to wake it, then try again.');return;}
  join(padControl(pad));
};
$('add-local').onclick=()=>{
  const own=ownPlayers(),primary=touchDevice?'touch':'keyboard1';
  if(!own.some(p=>p.control===primary)){join(primary);return;}
  for(const control of Object.keys(KEYMAP))if(!state.players.some(p=>p.control===control)){join(control);return;}
  const pad=freePad();if(pad){join(padControl(pad));return;}
  notify('All six keyboard slots and the gamepad are taken. Have another device join using the router address.');
};
$('add-bot').onclick=()=>send({type:'addBot'});
$('start-button').onclick=()=>send({type:'start',mode:$('mode-select').value,trackId:previewTrack});
$('practice-button').onclick=()=>{
  const needJoin=!ownPlayers().length;
  if(needJoin&&!join(touchDevice?'touch':'keyboard1'))return;
  const available=6-state.players.length-(needJoin?1:0),bots=Math.min(3,available);
  for(let i=0;i<bots;i++)send({type:'addBot'});
  send({type:'start',mode:'single',trackId:previewTrack});
};
$('roster').onclick=event=>{
  const remove=event.target.closest('[data-remove]');if(remove){send({type:'remove',playerId:remove.dataset.remove});return;}
  const playerId=event.target.closest('[data-player]')?.dataset.player,p=ownPlayers().find(p=>p.id===playerId);
  if(p){activePlayerId=p.id;prefs={animal:p.animal,vehicle:p.vehicle,name:p.name};$('player-name').value=p.name;setGarage();rosterKey='';renderUI();}
};
$('track-prev').onclick=()=>{previewTrack=(previewTrack+TRACKS.length-1)%TRACKS.length;updateTrackCard();};$('track-next').onclick=()=>{previewTrack=(previewTrack+1)%TRACKS.length;updateTrackCard();};
function updateTrackCard(){$('track-name-lobby').textContent=TRACKS[previewTrack].name;$('track-tag-lobby').textContent=TRACKS[previewTrack].tag;$('track-description').textContent=TRACKS[previewTrack].description;const counter=$('track-counter');if(counter)counter.textContent=`${String(previewTrack+1).padStart(2,'0')} / ${String(TRACKS.length).padStart(2,'0')}`;}
$('network-select').onchange=()=>{$('network-url').textContent=$('network-select').value;};
$('copy-address').onclick=async()=>{
  if(!urls.length){notify('Connect the host computer to a router or Wi-Fi first.');return;}
  const text=$('network-url').textContent;
  try{await navigator.clipboard.writeText(text);notify('Router address copied. Open it on your other devices.');}
  catch{const input=document.createElement('textarea');input.value=text;input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();const copied=document.execCommand('copy');input.remove();notify(copied?'Router address copied.':`Open ${text} on your other device.`);}
};
function openHelp(){keys.clear();resetTouch();$('help-dialog').showModal();}
$('help-button').onclick=openHelp;
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>button.closest('dialog').close();
$('leave-button').onclick=()=>{if(isHost())send({type:'lobby'});else openHelp();};
$('results-back').onclick=()=>{if(isHost())send({type:'lobby'});else $('results-dialog').close();};
$('next-button').onclick=()=>send(state.phase==='results'?{type:'next'}:{type:'start',mode:state.mode,trackId:previewTrack});
$('leaderboard-button').onclick=async()=>{
  const request=++leaderboardRequest;podiums.get('leaderboard').entries=[];
  $('leaderboard-list').textContent='Loading this host’s leaderboard…';$('leaderboard-dialog').showModal();
  try{
    const response=await fetch('/api/leaderboard');if(!response.ok)throw Error('Could not load standings.');const data=await response.json();
    if(request!==leaderboardRequest||!$('leaderboard-dialog').open)return;
    podiums.get('leaderboard').entries=data.entries.slice(0,3);$('leaderboard-list').replaceChildren();
    if(!data.entries.length){const p=document.createElement('p');p.className='empty-message';p.textContent='Your first finish belongs here. Complete a race or Grand Prix to save a score.';$('leaderboard-list').append(p);}
    data.entries.slice(0,25).forEach((entry,i)=>{const row=scoreRow(entry,i+1,`${entry.points} pts`,`${entry.rounds} race${entry.rounds>1?'s':''} · best lap ${formatTime(entry.bestLap)}`);$('leaderboard-list').append(row);});
    if(data.persistenceError)notify('Standings are in memory, but this host could not save them to disk.');
  }catch(error){if(request===leaderboardRequest)$('leaderboard-list').textContent=error.message;}
};
$('fullscreen-button').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('Fullscreen is unavailable here. Open the game in Chrome or Edge.');}};
$('quality-button').onclick=()=>{lowQuality=!lowQuality;scene?.setQuality(lowQuality);for(const podium of podiums.values())podium.scene?.setQuality(lowQuality);$('quality-button').textContent=`${lowQuality?'LOW':'HIGH'} GRAPHICS`;};
$('sound-button').onclick=()=>{sound=!sound;$('sound-button').classList.toggle('active',sound);$('sound-button').setAttribute('aria-label',sound?'Mute sound':'Enable sound');if(sound){initAudio();audio?.resume().catch(()=>{});tone(440,.12);}else engineGain?.gain.setTargetAtTime(0,audio.currentTime,.08);notify(sound?'Sound on.':'Sound muted.');};
function initAudio(){
  if(audio)return;try{audio=new(window.AudioContext||window.webkitAudioContext)();engine=audio.createOscillator();engine.type='triangle';engineGain=audio.createGain();engineGain.gain.value=0;engine.connect(engineGain);engineGain.connect(audio.destination);engine.start();}catch{sound=false;}
}
function tone(freq,duration=.15,type='sine',volume=.035,slide=1){if(!sound)return;initAudio();if(!audio)return;const now=audio.currentTime,o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,now);o.frequency.exponentialRampToValueAtTime(Math.max(25,freq*slide),now+duration);g.gain.setValueAtTime(0,now);g.gain.linearRampToValueAtTime(volume,now+.012);g.gain.exponentialRampToValueAtTime(.001,now+duration);o.connect(g);g.connect(audio.destination);o.start();o.stop(now+duration+.03);}
function chord(notes,type='sine',volume=.03){if(!sound)return;notes.forEach(([freq,delay,duration],i)=>setTimeout(()=>tone(freq,duration||.16,type,volume,1),delay||i*55));}
function noiseBurst(duration=.22,volume=.045,filterFreq=1200,sweep=.4){
  if(!sound)return;initAudio();if(!audio)return;
  const now=audio.currentTime,frames=Math.floor(audio.sampleRate*duration);
  const buffer=audio.createBuffer(1,frames,audio.sampleRate),data=buffer.getChannelData(0);
  for(let i=0;i<frames;i++)data[i]=(Math.random()*2-1)*(1-i/frames);
  const src=audio.createBufferSource();src.buffer=buffer;
  const filter=audio.createBiquadFilter();filter.type='bandpass';filter.frequency.setValueAtTime(filterFreq,now);filter.frequency.exponentialRampToValueAtTime(Math.max(80,filterFreq*sweep),now+duration);filter.Q.value=2.4;
  const gain=audio.createGain();gain.gain.setValueAtTime(volume,now);gain.gain.exponentialRampToValueAtTime(.0008,now+duration);
  src.connect(filter);filter.connect(gain);gain.connect(audio.destination);src.start(now);src.stop(now+duration+.02);
}
// Funny, distinct signature for every power-up so players can identify hits by ear.
function playPower(item){
  if(!sound)return;
  switch(item){
    case 'boost':chord([[420,0,.12],[620,55,.12],[880,110,.18]],'triangle',.04);noiseBurst(.22,.025,900,2.4);break;
    case 'coconut':tone(220,.08,'square',.035,1.6);setTimeout(()=>tone(160,.12,'sawtooth',.03,.55),90);noiseBurst(.15,.018,420,.6);break;
    case 'shield':chord([[523,0,.14],[659,70,.14],[784,140,.22],[1047,210,.26]],'sine',.03);break;
    case 'mud':tone(140,.22,'sawtooth',.04,.4);noiseBurst(.3,.035,320,.3);break;
    case 'pulse':chord([[880,0,.08],[1175,55,.08],[1568,110,.18]],'square',.035);noiseBurst(.32,.04,2400,.25);break;
    case 'banana':tone(900,.06,'square',.03,2.2);setTimeout(()=>tone(1400,.05,'square',.028,2.4),70);setTimeout(()=>tone(500,.18,'triangle',.032,.4),140);break;
    case 'rocket':noiseBurst(.4,.05,300,8);chord([[180,0,.1],[260,80,.12],[420,180,.24]],'sawtooth',.035);break;
    case 'shell':tone(660,.1,'sine',.03,1.8);setTimeout(()=>tone(880,.14,'sine',.028,1.5),110);noiseBurst(.18,.022,1600,1.8);break;
    case 'star':chord([[659,0,.1],[784,60,.1],[988,120,.1],[1319,180,.16],[1568,260,.3]],'triangle',.035);noiseBurst(.5,.025,3200,1.5);break;
    case 'lightning':noiseBurst(.45,.055,4200,.18);chord([[180,0,.06],[120,80,.08],[90,160,.22]],'square',.04);break;
    case 'magnet':tone(300,.08,'sine',.03,2);setTimeout(()=>tone(450,.08,'sine',.03,2),90);setTimeout(()=>tone(700,.16,'sine',.032,1.4),180);break;
    case 'swap':chord([[1200,0,.06],[300,80,.06],[1400,160,.06],[260,240,.18]],'sine',.035);noiseBurst(.25,.03,2200,.4);break;
    default:tone(600,.12,'sine',.03,1.3);
  }
}
function playHit(kind='hit'){
  if(!sound)return;
  if(kind==='spin'){chord([[700,0,.08],[500,80,.08],[300,160,.16],[180,240,.24]],'sawtooth',.04);noiseBurst(.4,.04,800,.3);}
  else if(kind==='rocket'){noiseBurst(.55,.07,200,12);chord([[120,0,.1],[80,120,.18],[60,260,.3]],'square',.045);}
  else if(kind==='banana'){tone(1200,.05,'square',.035,2.6);setTimeout(()=>tone(800,.06,'square',.03,2.2),60);setTimeout(()=>tone(240,.28,'sawtooth',.04,.35),130);noiseBurst(.35,.04,600,.3);}
  else if(kind==='blocked'){chord([[880,0,.08],[1320,60,.12]],'sine',.035);}
  else if(kind==='storm'){noiseBurst(.4,.05,3800,.2);tone(160,.3,'square',.04,.4);}
  else if(kind==='swap'){chord([[1400,0,.05],[280,70,.05],[1600,140,.18]],'sine',.04);}
  else{chord([[280,0,.08],[200,70,.1],[140,150,.2]],'sawtooth',.045);noiseBurst(.22,.04,700,.4);}
}

function buildRoster(){
  const signature=JSON.stringify(state.players.map(p=>[p.id,p.name,p.animal,p.vehicle,p.control,p.owner,p.displayOnHost]))+clientId+isHost()+activePlayerId;
  if(signature===rosterKey)return;rosterKey=signature;$('roster').replaceChildren();
  for(let slot=0;slot<6;slot++){
    const p=state.players.find(p=>p.slot===slot),card=document.createElement('div');card.className=`crew-slot ${p?'filled':''} ${p?.id===activePlayerId?'selected':''}`;
    if(p){card.dataset.player=p.id;card.style.setProperty('--player-color',p.color);const avatar=document.createElement('span');avatar.className='slot-avatar';avatar.append(svgIcon('avatar-'+p.animal));const detail=document.createElement('div');const name=document.createElement('span');name.className='slot-name';name.textContent=p.name;const sub=document.createElement('span');sub.className='slot-sub';sub.textContent=p.bot?'AI racer':p.displayOnHost?'Router controller':p.owner===clientId?labelFor(p.control):'Router racer';detail.append(name,sub);card.append(avatar,detail);
      if(p.owner===clientId||isHost()){const remove=document.createElement('button');remove.className='remove-player';remove.dataset.remove=p.id;remove.textContent='×';remove.setAttribute('aria-label',`Remove ${p.name}`);card.append(remove);}
    }else{const number=document.createElement('span');number.className='slot-avatar';number.textContent=String(slot+1).padStart(2,'0');const label=document.createElement('span');label.className='slot-name';label.textContent='Open grid';card.append(number,label);}
    $('roster').append(card);
  }
}
function chooseViews(){
  const own=ownPlayers().filter(p=>!p.displayOnHost);
  if(isHost())own.push(...state.players.filter(p=>p.displayOnHost));
  const unique=[...new Map(own.map(p=>[p.id,p])).values()].sort((a,b)=>a.slot-b.slot);
  if(!unique.length&&!controllerOnly()&&state.players.length)return[state.players.reduce((a,b)=>a.rank<b.rank?a:b).id];
  return unique.map(p=>p.id);
}
function buildHUD(){
  viewIds=chooseViews();const rect=$('game-canvas').getBoundingClientRect();
  const signature=viewIds.join(',')+'|'+Math.round(rect.width)+'|'+Math.round(rect.height)+'|'+raceActive()+'|'+controllerOnly();
  if(signature===hudKey)return;hudKey=signature;hudViews=[];$('view-huds').replaceChildren();
  if(!raceActive()||controllerOnly())return;
  const rectangles=splitRects(viewIds.length||1,rect.width,rect.height);
  for(let i=0;i<viewIds.length;i++){
    const p=state.players.find(p=>p.id===viewIds[i]),r=rectangles[i],hud=document.createElement('div');hud.className='view-hud'+(viewIds.length>2||r.w<500?' compact':'');hud.style.cssText=`left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;--player-color:${p.color}`;
    const name=document.createElement('div');name.className='view-label';name.textContent=`${p.slot+1} / ${p.name}`;
    const position=document.createElement('div');position.className='position-display';
    const lap=document.createElement('div');lap.className='lap-display';
    const speed=document.createElement('div');speed.className='speed-display';
    const item=document.createElement('button');item.className='item-button';item.setAttribute('aria-label',`Use ${p.name}'s power-up`);item.onclick=()=>{if(p.owner===clientId)itemPresses.set(p.id,performance.now()+150);};
    const drift=document.createElement('div');drift.className='drift-meter';const fill=document.createElement('i');drift.append(fill);
    const minimap=document.createElement('canvas');minimap.className='mini-map';minimap.width=130;minimap.height=115;
    hud.append(name,position,lap,speed,item,drift,minimap);$('view-huds').append(hud);hudViews.push({id:p.id,hud,position,lap,speed,item,fill,minimap});
  }
}
function drawMinimap(canvas,selectedId){
  const ctx=canvas.getContext('2d'),scale=.89,cx=65,cy=58;ctx.clearRect(0,0,130,115);ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();mapTrack.samples.forEach((point,i)=>{const x=cx+point.x*scale,z=cy+point.z*scale;if(i===0)ctx.moveTo(x,z);else ctx.lineTo(x,z);});ctx.closePath();ctx.strokeStyle='#0e302a99';ctx.lineWidth=8;ctx.stroke();ctx.strokeStyle='#f8f3d28a';ctx.lineWidth=3;ctx.stroke();
  for(const p of state.players){ctx.beginPath();ctx.arc(cx+p.x*scale,cy+p.z*scale,p.id===selectedId?4:2.7,0,Math.PI*2);ctx.fillStyle=p.color;ctx.fill();if(p.id===selectedId){ctx.strokeStyle='#fff8dd';ctx.lineWidth=1.4;ctx.stroke();}}
}
function updateHUD(){
  if(mapTrackId!==state.trackId){mapTrackId=state.trackId;mapTrack=createTrack(state.trackId);}
  for(const view of hudViews){const p=state.players.find(p=>p.id===view.id);if(!p)continue;view.position.textContent=p.finished?'FINISH':`${p.rank}${['st','nd','rd'][p.rank-1]||'th'}`;view.lap.textContent=p.wrongWay>1.3?'WRONG WAY':p.spin>0?'SPINNING':p.slow>0?'STORM SLOWED':`LAP ${p.lap} / 3`;view.speed.textContent=`${Math.round(Math.abs(p.speed)*3.6)} km/h`;view.item.textContent=p.item?ITEMS[p.item].short:p.star>0?'STAR':p.shield>0?'SHIELDED':p.boost>0?'BOOSTING':'NO ITEM';view.item.style.setProperty('--item-color',p.item?ITEMS[p.item].color:p.star>0?'#ffe27a':'#efe6c5');view.item.classList.toggle('has-item',!!p.item||p.star>0);view.item.disabled=p.owner!==clientId||!p.item;view.fill.style.width=`${Math.min(100,p.driftCharge/1.6*100)}%`;view.fill.style.background=p.driftCharge>.65?'#fbb75b':'#9fe4e0';drawMinimap(view.minimap,p.id);}
  const local=ownPlayers()[0];
  if(local){$('controller-player').textContent=`${local.name} · ${animalFor(local.animal).species}`;$('controller-speed').textContent=Math.round(Math.abs(local.speed)*3.6);$('controller-position').textContent=`${local.rank}${['st','nd','rd'][local.rank-1]||'th'} PLACE · LAP ${local.lap}/3`;$('controller-item').textContent=local.item?ITEMS[local.item].name:'Find a glowing item crate';$('touch-item').textContent=local.item?ITEMS[local.item].short:'ITEM';$('touch-item').classList.toggle('has-item',!!local.item);}
}
function renderUI(){
  const host=isHost(),active=raceActive(),locked=!['lobby','cupFinished'].includes(state.phase),own=ownPlayers(),controller=controllerOnly();
  document.body.classList.toggle('in-race',active);document.body.classList.toggle('controller-mode',controller&&active);
  $('lobby-overlay').hidden=active;$('top-race-bar').hidden=!active;$('leave-button').hidden=!active;$('view-huds').hidden=!active||controller;$('controller-panel').hidden=!controller||!active;
  $('leave-button').textContent=host?'GARAGE':'CONTROLS';
  $('crew-count').textContent=`${state.players.length} / 6`;
  const primary=touchDevice?'touch':'keyboard1',joined=own.some(p=>p.control===primary);
  $('join-button').disabled=!connected||locked||joined||state.players.length>=6;$('join-button').textContent=joined?'ON THE GRID':'JOIN THE GRID';
  const full=!connected||locked||state.players.length>=6;
  for(const button of document.querySelectorAll('.join-key')){
    const control=button.dataset.control,taken=control?state.players.some(p=>p.control===control):state.players.some(p=>p.control.startsWith('pad'));
    button.disabled=full||taken;button.classList.toggle('taken',taken);
    button.setAttribute('aria-disabled',String(full||taken));
  }
  $('add-local').disabled=full;$('add-bot').disabled=!connected||locked||!host||state.players.length>=6;
  $('start-button').disabled=!connected||locked||!host||!state.players.length;$('practice-button').hidden=!host||locked;
  $('mode-select').disabled=!host||locked;$('device-mode').disabled=own.length>0||locked;
  $('host-note').textContent=host?'You are the host. Start when your grid is ready.':'The host starts the race. Choose your animal and join.';
  for(const button of [...$('animal-grid').children,...$('vehicle-grid').children])button.disabled=locked;
  $('player-name').disabled=locked;
  $('race-stage').textContent=`${state.mode==='cup'?'GRAND PRIX':'QUICK RACE'} ${state.roundIndex+1}/${state.totalRounds} · ${TRACKS[state.trackId].name}`;
  $('touch-controls').hidden=state.phase!=='racing'||!own.some(p=>p.control==='touch');
  $('global-countdown').hidden=state.phase!=='countdown';
  if(state.phase==='countdown'){const number=Math.ceil(state.countdown);$('global-countdown').textContent=number;if(lastCountdown!==number){lastCountdown=number;tone(320,.12);}}
  if(controller&&active&&scene){scene.dispose();scene=null;disposedForController=true;}
  if((!controller||!active)&&disposedForController){disposedForController=false;initScene();}
  buildRoster();buildHUD();updateHUD();
  for(const event of state.events){if(event.id<=lastEvent)continue;lastEvent=event.id;
    const p=state.players.find(p=>p.color===event.color),mine=own.some(player=>player.color===event.color);
    if(event.type==='go'){raceAlert('GO! Find your line.');tone(740,.25);}
    else if(event.type==='pickup'&&mine){tone(800,.12,'sine',.025,1.25);if(event.item)playPower(event.item);}
    else if(event.type==='item'&&mine&&event.item){playPower(event.item);raceAlert(`${ITEMS[event.item]?.name||'Power'} deployed!`);}
    else if(event.type==='driftboost'&&mine){tone(220,.2,'triangle',.02,2.4);raceAlert('Clean drift. Free boost.');}
    else if(event.type==='hit'&&mine){playHit('hit');raceAlert('Ouch! Direct hit.');}
    else if(event.type==='spin'&&mine){playHit('spin');raceAlert('Spun out! Hold on…');}
    else if(event.type==='blocked'&&mine){playHit('blocked');raceAlert('Shield soaked it up!');}
    else if(event.type==='rocket'&&mine){playHit('rocket');raceAlert('ROCKET HIT!');}
    else if(event.type==='lightning'&&mine){playHit('storm');raceAlert('Storm slowed you!');}
    else if(event.type==='magnet'&&mine){tone(680,.16,'triangle',.022,1.6);raceAlert(event.from?'Item snatched!':'No item to steal — small boost.');}
    else if(event.type==='swap'&&mine){playHit('swap');raceAlert('Spirit swap!');}
    else if(event.type==='banana'){playHit('banana');if(mine)raceAlert('Slipped on a banana!');}
    else if(event.type==='mudtrap'){playHit('hit');if(mine)raceAlert('Mud trap!');}
    else if(event.type==='finish'){raceAlert(`${p?.name||'A racer'} crossed the finish!`);tone(660,.18);}
    else if(event.type==='lap'&&mine&&event.lap===3){raceAlert('FINAL LAP');tone(620,.13);}
  }
  if(state.phase!==previousPhase){
    if(['results','cupFinished'].includes(state.phase))showResults();else if($('results-dialog').open)$('results-dialog').close();
    if(state.phase==='lobby'){keys.clear();resetTouch();hudKey='';}
    previousPhase=state.phase;requestAnimationFrame(()=>{scene?.resize();hudKey='';buildHUD();});
  }
  $('next-button').disabled=!host||!connected;$('next-button').textContent=host?(state.phase==='results'?'NEXT CIRCUIT →':'RACE AGAIN →'):'WAITING FOR THE HOST';
  $('results-back').textContent=host?'Back to the garage':'View the circuit';
}
function scoreRow(p,rank,value,detail=''){
  const row=document.createElement('div');row.className='score-row';const number=document.createElement('span');number.className='score-rank';number.textContent=String(rank).padStart(2,'0');const icon=svgIcon('avatar-'+p.animal);const name=document.createElement('div');name.className='score-name';name.textContent=p.name;const sub=document.createElement('small');sub.textContent=detail;name.append(sub);const score=document.createElement('b');score.className='score-value';score.textContent=value;row.append(number,icon,name,score);return row;
}
function showResults(){
  keys.clear();resetTouch();const final=state.phase==='cupFinished',winner=final?state.cupResults[0]:state.raceResults[0];
  $('results-eyebrow').textContent=final?'THE WILD CIRCUIT / COMPLETE':`RACE ${state.roundIndex+1} / CLASSIFIED`;
  $('results-title').textContent=final?`${winner?.name||'The jungle'} takes the crown.`:`${winner?.name||'The jungle'} wins ${TRACKS[state.trackId].name}.`;
  $('results-subtitle').textContent=final?'One wild ride. A place in this host’s leaderboard.':'The cup is still wide open. Next stop: '+TRACKS[(state.trackId+1)%TRACKS.length].name+'.';
  $('race-results').replaceChildren();$('cup-results').replaceChildren();
  for(const p of state.raceResults)$('race-results').append(scoreRow(p,p.rank,`+${p.points}`,p.finished?formatTime(p.finishTime):'Time limit · classified by progress'));
  for(const p of state.cupResults)$('cup-results').append(scoreRow(p,p.rank,`${p.points} pts`,vehicleFor(p.vehicle).name));
  podiums.get('results').entries=(final?state.cupResults:state.raceResults).slice(0,3);
  $('results-dialog').showModal();tone(523,.2);setTimeout(()=>tone(659,.2),160);setTimeout(()=>tone(784,.3),320);
}

const racingKeys=new Set([...Object.values(KEYMAP).flatMap(m=>[m.up,m.down,m.left,m.right,m.drift,m.item]),'KeyR']);
window.addEventListener('keydown',event=>{if(event.ctrlKey||event.metaKey||event.altKey||editable())return;if(racingKeys.has(event.code)){if(raceActive())event.preventDefault();keys.add(event.code);}if(event.code==='KeyR'&&!event.repeat)for(const p of ownPlayers())send({type:'reset',playerId:p.id});if(event.code==='Escape'&&state.phase==='racing')openHelp();});
window.addEventListener('keyup',event=>{keys.delete(event.code);if(racingKeys.has(event.code)&&raceActive()&&!editable())event.preventDefault();});
window.addEventListener('focus',()=>{windowFocused=true;});
window.addEventListener('blur',()=>{windowFocused=false;keys.clear();resetTouch();send({type:'input',inputs:ownPlayers().map(p=>({id:p.id,throttle:0,steer:0,brake:false,drift:false,useItem:false}))});});
document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();resetTouch();send({type:'input',inputs:ownPlayers().map(p=>({id:p.id,throttle:0,steer:0,brake:true,drift:false,useItem:false}))});}});
function getInput(p,pads){
  const neutral={throttle:0,steer:0,brake:false,drift:false,useItem:false};if(document.hidden||!windowFocused||editable()||state.phase!=='racing')return neutral;
  let input;const map=KEYMAP[p.control];
  // The simulation's positive steer increases the heading angle, which on screen is a
  // LEFT turn (the chase camera looks along +heading, so screen-right is world -X).
  // Human inputs are therefore negated here so right key / stick-right / drag-right
  // all turn the kart to the right of the screen.
  if(map)input={throttle:Number(keys.has(map.up))-Number(keys.has(map.down)),steer:Number(keys.has(map.left))-Number(keys.has(map.right)),brake:false,drift:keys.has(map.drift),useItem:keys.has(map.item)};
  else if(p.control==='touch')input={throttle:touch.brake?0:1,steer:-touch.steer,brake:touch.brake,drift:touch.drift,useItem:touch.useItem};
  else{
    const pad=pads[Number(p.control.slice(3))];if(!pad)return neutral;const steer=Math.abs(pad.axes[0]||0)<.14?0:pad.axes[0];input={throttle:pad.buttons[7]?.value||Number(pad.buttons[12]?.pressed)||0,steer:clamp(-(steer+Number(pad.buttons[15]?.pressed)-Number(pad.buttons[14]?.pressed)),-1,1),brake:(pad.buttons[6]?.value||0)>.1||!!pad.buttons[13]?.pressed,drift:!!pad.buttons[0]?.pressed,useItem:!!pad.buttons[2]?.pressed};
  }
  if((itemPresses.get(p.id)||0)>performance.now())input.useItem=true;return input;
}
setInterval(()=>{
  if(!connected)return;const pads=readPads();
  for(const pad of pads){if(!pad)continue;const pressed=!!pad.buttons[9]?.pressed;if(pressed&&!padStarts.get(pad.index)&&['lobby','cupFinished'].includes(state.phase)&&!state.players.some(p=>p.control===padControl(pad)))join(padControl(pad));padStarts.set(pad.index,pressed);}
  const own=ownPlayers();if(own.length)send({type:'input',inputs:own.map(p=>({id:p.id,...getInput(p,pads)}))});
},1000/30);
setInterval(()=>{if(connected)send({type:'ping',at:Date.now()});},2500);
window.addEventListener('gamepadconnected',event=>{notify('Gamepad connected. Press Start or click the PAD button to join.');$('controller-note').textContent='GAMEPAD CONNECTED · PRESS START TO JOIN';});
window.addEventListener('gamepaddisconnected',()=>notify('A gamepad disconnected. Its racer will coast to a stop until it reconnects.'));
const stick=$('steer-pad'),knob=$('steer-knob');let pointerId=null;
function moveStick(event){const r=stick.getBoundingClientRect(),max=r.width*.32,x=clamp(event.clientX-r.left-r.width/2,-max,max);touch.steer=x/max;knob.style.transform=`translateX(${x}px)`;}
stick.addEventListener('pointerdown',event=>{if(pointerId!==null)return;pointerId=event.pointerId;stick.setPointerCapture(pointerId);moveStick(event);event.preventDefault();});
stick.addEventListener('pointermove',event=>{if(event.pointerId===pointerId)moveStick(event);});
for(const type of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(type,event=>{if(event.pointerId===pointerId){pointerId=null;touch.steer=0;knob.style.transform='';}});
for(const [id,key] of [['touch-brake','brake'],['touch-drift','drift'],['touch-item','useItem']]){const button=$(id);button.addEventListener('pointerdown',event=>{button.setPointerCapture(event.pointerId);touch[key]=true;button.classList.add('pressed');event.preventDefault();});for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>{touch[key]=false;button.classList.remove('pressed');});}
function resetTouch(){touch.steer=0;touch.brake=touch.drift=touch.useItem=false;pointerId=null;knob.style.transform='';for(const id of ['touch-brake','touch-drift','touch-item'])$(id).classList.remove('pressed');}
function initScene(){
  try{scene=new RacingScene($('game-canvas'));scene.setQuality(lowQuality);$('loading').hidden=true;}
  catch(error){console.error(error);$('loading').textContent='3D graphics could not start. Try Chrome or Edge with graphics acceleration enabled. '+error.message;$('loading').hidden=false;}
}
new ResizeObserver(()=>{scene?.resize();hudKey='';buildHUD();}).observe($('game-canvas'));
let lastFrame=performance.now();
function frame(now){const dt=Math.min((now-lastFrame)/1000,.1);lastFrame=now;
  const showingPodium=$('results-dialog').open||$('leaderboard-dialog').open;
  if(!document.hidden&&scene&&!showingPodium){const viewState=state.phase==='lobby'?{...state,previewTrack,previewAnimal:prefs.animal,previewVehicle:prefs.vehicle,previewPlayerId:activePlayerId}:state;scene.update(viewState,dt,viewIds);}
  if(!document.hidden)updatePodiums(dt);
  if(sound&&audio&&engineGain){const p=ownPlayers()[0],volume=state.phase==='racing'&&p&&!document.hidden ? .007 : 0;engineGain.gain.setTargetAtTime(volume,audio.currentTime,.1);engine.frequency.setTargetAtTime(45+Math.abs(p?.speed||0)*4.7,audio.currentTime,.1);}
  requestAnimationFrame(frame);
}
setGarage();updateTrackCard();$('quality-button').textContent=`${lowQuality?'LOW':'HIGH'} GRAPHICS`;initScene();connect();renderUI();requestAnimationFrame(frame);
Object.defineProperty(window,'jungleKart',{value:{get state(){return state;},get scene(){return scene;},get podiums(){return Object.fromEntries([...podiums].map(([id,podium])=>[id,podium.scene]));},get clientId(){return clientId;},get views(){return [...viewIds];},get controllerOnly(){return controllerOnly();},get touchDevice(){return touchDevice;}},writable:false});
