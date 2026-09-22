import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {WebSocketServer,WebSocket} from 'ws';
import {RaceGame} from './game.mjs';
import {Leaderboard} from './leaderboard.mjs';
import {ANIMALS,VEHICLES} from './public/world.js';

const ROOT=path.dirname(fileURLToPath(import.meta.url)),PUBLIC=path.join(ROOT,'public');
const PORT=Number(process.env.PORT||3001);
const lanUrls=Object.values(os.networkInterfaces()).flat().filter(x=>x.family==='IPv4'&&!x.internal).map(x=>`http://${x.address}:${PORT}`);
const leaderboard=await new Leaderboard(process.env.LEADERBOARD_FILE||path.join(ROOT,'data','leaderboard.json')).load();
export const game=new RaceGame({onCupComplete:cup=>leaderboard.record(cup)});
const clients=new Map();let hostId=null;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
const vendor={'/vendor/three.module.js':'three.module.js','/vendor/three.core.js':'three.core.js'};
export const server=http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/api/info'||pathname==='/api/leaderboard'){
      const data=pathname==='/api/info'?{name:'Jungle Kart: Wild Circuit',port:PORT,lanUrls,maxPlayers:6,animalCount:ANIMALS.length,vehicleCount:VEHICLES.length}:leaderboard.snapshot();
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify(data));return;
    }
    const file=vendor[pathname]?path.join(ROOT,'node_modules','three','build',vendor[pathname]):path.resolve(PUBLIC,'.'+(pathname==='/'?'/index.html':pathname));
    if(!vendor[pathname]&&!file.startsWith(PUBLIC+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
    const content=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; base-uri 'self'"});res.end(req.method==='HEAD'?undefined:content);
  }catch{res.writeHead(404);res.end('Not found');}
});
const wss=new WebSocketServer({server,maxPayload:8192,verifyClient:({origin,req})=>{if(!origin)return true;try{return new URL(origin).host===req.headers.host;}catch{return false;}}});
const send=(ws,data)=>{if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<512*1024)ws.send(JSON.stringify(data));};
function broadcast(){const message={type:'state',state:game.snapshot(hostId)};for(const ws of clients.values())send(ws,message);}
wss.on('connection',ws=>{
  const id=randomUUID();clients.set(id,ws);if(!hostId)hostId=id;ws.alive=true;ws.on('pong',()=>ws.alive=true);
  send(ws,{type:'welcome',clientId:id,hostId,lanUrls,maxPlayers:6});send(ws,{type:'state',state:game.snapshot(hostId)});
  let messages=0,windowAt=Date.now();
  ws.on('message',raw=>{
    if(Date.now()-windowAt>1000){messages=0;windowAt=Date.now();}if(++messages>160){ws.close(1008,'Too many messages');return;}
    try{
      const msg=JSON.parse(raw.toString());if(!msg||typeof msg!=='object')return;
      const hostOnly=()=>{if(id!==hostId)throw Error('Only the host can manage the tournament.');};
      if(msg.type==='input'){if(Array.isArray(msg.inputs))for(const input of msg.inputs.slice(0,6))if(input&&typeof input==='object')game.setInput(id,input.id,input);return;}
      if(msg.type==='join'){
        const p=game.addPlayer(id,{name:msg.name,animal:msg.animal,vehicle:msg.vehicle,control:msg.control,displayOnHost:msg.displayOnHost===true});send(ws,{type:'joined',playerId:p.id,control:p.control});
      }else if(msg.type==='configure')game.configure(id,msg.playerId,{name:msg.name,animal:msg.animal,vehicle:msg.vehicle});
      else if(msg.type==='addBot'){hostOnly();const index=game.players.length;game.addPlayer('bot',{bot:true,control:'bot',animal:ANIMALS[(index*3)%15].id,vehicle:VEHICLES[index%6].id});}
      else if(msg.type==='remove'){
        if(!['lobby','cupFinished'].includes(game.phase))throw Error('Change the grid between tournaments.');
        const p=game.players.find(p=>p.id===msg.playerId);if(p&&p.owner!==id&&id!==hostId)throw Error('You can only remove your own racers.');game.removePlayer(msg.playerId);
      }else if(msg.type==='start'){hostOnly();game.start(msg.mode,msg.trackId);}
      else if(msg.type==='next'){hostOnly();game.nextRace();}
      else if(msg.type==='lobby'){hostOnly();game.toLobby();}
      else if(msg.type==='reset'){
        const p=game.players.find(p=>p.id===msg.playerId&&p.owner===id&&!p.bot);if(p&&game.phase==='racing'&&!p.finished&&p.resetCooldown===0)game.resetKart(p);
      }else if(msg.type==='ping'){send(ws,{type:'pong',at:msg.at});return;}else return;
      broadcast();
    }catch(error){send(ws,{type:'error',message:error instanceof SyntaxError?'Invalid message.':error.message});}
  });
  ws.on('close',()=>{clients.delete(id);for(const p of [...game.players])if(p.owner===id)game.removePlayer(p.id);if(id===hostId)hostId=clients.keys().next().value||null;if(!clients.size){game.players=[];game.toLobby();}broadcast();});
  ws.on('error',()=>{});
});
let previous=performance.now(),accumulator=0,frame=0;
const simulation=setInterval(()=>{const now=performance.now();accumulator+=Math.min((now-previous)/1000,.15);previous=now;while(accumulator>=1/60){game.step(1/60);accumulator-=1/60;}if(++frame%2===0)broadcast();},1000/60);
const heartbeat=setInterval(()=>{for(const ws of clients.values()){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}},15000);
server.listen(PORT,'0.0.0.0',()=>{
  console.log(`\nJUNGLE KART: WILD CIRCUIT\nLocal: http://localhost:${PORT}\n${lanUrls.map(url=>'Router: '+url).join('\n')}\nUp to six racers. Keep this window open. Ctrl+C stops the game.\n`);
  if(process.argv.includes('--open')&&process.platform==='win32')execFile('rundll32.exe',['url.dll,FileProtocolHandler',`http://localhost:${PORT}`],err=>{if(err)console.log('Open the Local address above in your browser.');});
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${PORT} is in use. Close the other Jungle Kart server or choose a different PORT.`:error.message);clearInterval(simulation);clearInterval(heartbeat);process.exitCode=1;});
async function shutdown(){clearInterval(simulation);clearInterval(heartbeat);await leaderboard.pending;for(const ws of clients.values())ws.close();wss.close();server.close(()=>process.exit(0));}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
