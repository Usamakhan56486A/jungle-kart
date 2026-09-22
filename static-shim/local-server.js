// In-page host for the static (Cloudflare Pages) build.
// Replicates server.mjs's WebSocket + REST protocol entirely in the browser so the
// unmodified app.js runs with no backend. Solo, split-screen, six keyboard slots,
// one gamepad, touch, AI bots and the Grand Prix all work. Cross-device LAN play
// does not, because there is no server to connect devices to.
import {RaceGame} from './game.js';
import {ANIMALS,VEHICLES} from './world.js';

const LS_KEY='jungle-kart-leaderboard';
const loadEntries=()=>{try{const data=JSON.parse(localStorage.getItem(LS_KEY)||'[]');return Array.isArray(data)?data.filter(e=>e&&typeof e.name==='string'):[];}catch{return [];}};
const saveEntries=entries=>{try{localStorage.setItem(LS_KEY,JSON.stringify(entries.slice(0,100)));}catch{}};
const uid=()=>globalThis.crypto?.randomUUID?globalThis.crypto.randomUUID():`id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;

const game=new RaceGame({onCupComplete:cup=>{
  const entries=loadEntries(),date=new Date().toISOString();
  for(const p of cup.results){
    if(p.bot)continue;
    entries.push({id:uid(),name:p.name,animal:p.animal,vehicle:p.vehicle,points:p.points,rounds:cup.totalRounds,mode:cup.mode,rank:p.rank,totalTime:p.totalTime,bestLap:p.bestLap,date});
  }
  entries.sort((a,b)=>b.points/b.rounds-a.points/a.rounds||a.totalTime/a.rounds-b.totalTime/b.rounds);
  saveEntries(entries);
}});

const CLIENT_ID='local-host',hostId=CLIENT_ID;
let activeSocket=null;

class LocalSocket{
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  constructor(url){
    this.url=url;this.readyState=LocalSocket.CONNECTING;this.bufferedAmount=0;
    this.onopen=null;this.onmessage=null;this.onclose=null;this.onerror=null;
    activeSocket=this;
    setTimeout(()=>{
      this.readyState=LocalSocket.OPEN;this.onopen?.({type:'open'});
      this._emit({type:'welcome',clientId:CLIENT_ID,hostId,lanUrls:[],maxPlayers:6});
      this._emit({type:'state',state:game.snapshot(hostId)});
    },0);
  }
  _emit(obj){if(this.readyState===LocalSocket.OPEN)this.onmessage?.({data:JSON.stringify(obj)});}
  send(raw){
    if(this.readyState!==LocalSocket.OPEN)return;
    let msg;try{msg=JSON.parse(raw);}catch{return;}
    if(!msg||typeof msg!=='object')return;
    const id=CLIENT_ID;
    try{
      if(msg.type==='input'){if(Array.isArray(msg.inputs))for(const input of msg.inputs.slice(0,6))if(input&&typeof input==='object')game.setInput(id,input.id,input);}
      if(msg.type==='join'){
        const p=game.addPlayer(id,{name:msg.name,animal:msg.animal,vehicle:msg.vehicle,control:msg.control,displayOnHost:msg.displayOnHost===true});
        this._emit({type:'joined',playerId:p.id,control:p.control});
      }else if(msg.type==='configure')game.configure(id,msg.playerId,{name:msg.name,animal:msg.animal,vehicle:msg.vehicle});
      else if(msg.type==='addBot'){const index=game.players.length;game.addPlayer('bot',{bot:true,control:'bot',animal:ANIMALS[(index*3)%ANIMALS.length].id,vehicle:VEHICLES[index%VEHICLES.length].id});}
      else if(msg.type==='remove'){if(!['lobby','cupFinished'].includes(game.phase))throw Error('Change the grid between tournaments.');game.removePlayer(msg.playerId);}
      else if(msg.type==='start')game.start(msg.mode,msg.trackId);
      else if(msg.type==='next')game.nextRace();
      else if(msg.type==='lobby')game.toLobby();
      else if(msg.type==='reset'){const p=game.players.find(p=>p.id===msg.playerId&&p.owner===id&&!p.bot);if(p&&game.phase==='racing'&&!p.finished&&p.resetCooldown===0)game.resetKart(p);}
      else if(msg.type==='ping'){this._emit({type:'pong',at:msg.at});return;}
      else return;
      this._emit({type:'state',state:game.snapshot(hostId)});
    }catch(error){this._emit({type:'error',message:error instanceof SyntaxError?'Invalid message.':error.message});}
  }
  close(){this.readyState=LocalSocket.CLOSED;if(activeSocket===this)activeSocket=null;this.onclose?.({code:1000,reason:'closed'});}
  addEventListener(type,fn){this['on'+type]=fn;}
  removeEventListener(){}
}

// Authoritative 60 Hz simulation with a 30 Hz state broadcast, mirroring server.mjs.
let previous=performance.now(),accumulator=0,frame=0;
setInterval(()=>{
  const now=performance.now();accumulator+=Math.min((now-previous)/1000,.15);previous=now;
  while(accumulator>=1/60){game.step(1/60);accumulator-=1/60;}
  if(++frame%2===0)activeSocket?._emit({type:'state',state:game.snapshot(hostId)});
},1000/60);

const jsonResponse=obj=>new Response(JSON.stringify(obj),{status:200,headers:{'Content-Type':'application/json'}});
const nativeFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const path=typeof input==='string'?input:input?.url||'';
  if(path.endsWith('/api/leaderboard'))return jsonResponse({entries:loadEntries(),localOnly:true,persistenceError:null});
  if(path.endsWith('/api/info'))return jsonResponse({name:'Jungle Kart: Wild Circuit',port:0,lanUrls:[],maxPlayers:6,animalCount:ANIMALS.length,vehicleCount:VEHICLES.length});
  return nativeFetch(input,init);
};

// app.js constructs `new WebSocket(...)`; hand it the in-page host instead.
window.WebSocket=LocalSocket;
window.jungleKartLocalGame=game;
