import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import net from 'node:net';
import {WebSocket} from 'ws';
import {Leaderboard} from '../leaderboard.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function client(url){
  const ws=new WebSocket(url),messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));
  const wait=(predicate,start=0)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{clearInterval(check);reject(Error('Timed out waiting for network state'));},3500);const check=setInterval(()=>{const message=messages.slice(start).find(predicate);if(message){clearTimeout(timer);clearInterval(check);resolve(message);}},10);});
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});const welcome=await wait(m=>m.type==='welcome');
  return{ws,welcome,messages,wait,action(message,predicate){const start=messages.length;ws.send(JSON.stringify(message));return wait(predicate,start);}};
}

test('local leaderboards persist human results, exclude bots, and survive restart',async()=>{
  const directory=await mkdtemp(path.join(root,'data','test-scores-'));
  try{
    const file=path.join(directory,'scores.json'),scores=await new Leaderboard(file).load();
    await scores.record({mode:'cup',totalRounds:3,results:[{name:'Tavi',animal:'tiger',vehicle:'jeep',points:26,rank:1,totalTime:135,bestLap:14,bot:false},{name:'Bot',animal:'panda',vehicle:'kart',points:21,rank:2,totalTime:139,bestLap:15,bot:true}]});
    assert.equal(scores.snapshot().entries.length,1);const reopened=await new Leaderboard(file).load();assert.equal(reopened.snapshot().entries[0].name,'Tavi');assert.equal(reopened.snapshot().entries[0].points,26);assert.equal(reopened.lastError,null);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('six-player LAN racing supports phone-only controllers, ownership, and host migration',{timeout:20000},async()=>{
  const port=await freePort(),base=`http://127.0.0.1:${port}`,url=`ws://127.0.0.1:${port}`;
  const directory=await mkdtemp(path.join(root,'data','test-network-'));
  const child=spawn(process.execPath,[path.join(root,'server.mjs')],{env:{...process.env,PORT:String(port),LEADERBOARD_FILE:path.join(directory,'scores.json')},stdio:['ignore','pipe','pipe']});
  const clients=[];
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server not ready')),5000);child.stdout.on('data',data=>{if(data.toString().includes('Local:')){clearTimeout(timer);resolve();}});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});});
    const info=await fetch(base+'/api/info').then(r=>r.json());assert.equal(info.maxPlayers,6);assert.equal(info.animalCount,15);assert.equal(info.vehicleCount,6);
    const leaderboard=await fetch(base+'/api/leaderboard').then(r=>r.json());assert.deepEqual(leaderboard.entries,[]);
    assert.equal((await fetch(base+'/vendor/three.module.js')).status,200);assert.equal((await fetch(base+'/missing-file')).status,404);assert.equal((await fetch(base+'/api/info',{method:'POST'})).status,405);
    const host=await client(url);clients.push(host);const phone=await client(url);clients.push(phone);const laptop=await client(url);clients.push(laptop);
    for(const control of ['keyboard1','keyboard2','pad0','pad1'])await host.action({type:'join',control,animal:'fox',vehicle:'buggy'},m=>m.type==='joined');
    const remote=await phone.action({type:'join',control:'touch',animal:'elephant',vehicle:'tuktuk',displayOnHost:true,name:'Phone racer'},m=>m.type==='joined');
    const six=await laptop.action({type:'join',control:'keyboard1',animal:'panda',vehicle:'jeep'},m=>m.type==='state'&&m.state.players.length===6);
    assert.equal(six.state.players.find(p=>p.id===remote.playerId).displayOnHost,true);assert.equal(new Set(six.state.players.map(p=>p.owner)).size,3);
    assert.match((await host.action({type:'addBot'},m=>m.type==='error')).message,/full/);
    assert.match((await phone.action({type:'start'},m=>m.type==='error')).message,/host/);
    const hostPlayer=six.state.players.find(p=>p.owner===host.welcome.clientId);
    assert.match((await laptop.action({type:'configure',playerId:hostPlayer.id,animal:'bear'},m=>m.type==='error')).message,/own/);
    await host.action({type:'start',mode:'cup'},m=>m.type==='state'&&m.state.phase==='countdown');
    assert.match((await phone.action({type:'join',control:'keyboard2'},m=>m.type==='error')).message,/between/);
    await host.action({type:'lobby'},m=>m.type==='state'&&m.state.phase==='lobby');
    const index=phone.messages.length;host.ws.close();const migrated=await phone.wait(m=>m.type==='state'&&m.state.hostId===phone.welcome.clientId,index);assert.equal(migrated.state.players.length,2);
    await phone.action({type:'addBot'},m=>m.type==='state'&&m.state.players.length===3);
    const bad=new WebSocket(url,{origin:'https://untrusted.invalid'});const error=await new Promise((resolve,reject)=>{bad.once('open',()=>{bad.close();reject(Error('Foreign origin allowed'));});bad.once('error',resolve);});assert.match(error.message,/401|403/);
  }finally{for(const c of clients)c.ws.terminate();child.kill();await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',resolve);});await rm(directory,{recursive:true,force:true});}
});
