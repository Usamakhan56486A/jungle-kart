import {chromium} from 'playwright-core';
import {WebSocket} from 'ws';
import {spawn} from 'node:child_process';
import {access,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const url=`http://127.0.0.1:${port}`,directory=await mkdtemp(path.join(root,'data','browser-check-'));
let executablePath;
for(const candidate of [process.env.BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean)){try{await access(candidate);executablePath=candidate;break;}catch{}}
if(!executablePath)throw Error('Set BROWSER_PATH to Chrome, Chromium, or Edge.');
// Test-process IPC accelerates real simulation without exposing a debug API to browsers.
const harness=`const {game}=await import(${JSON.stringify(new URL('../server.mjs',import.meta.url).href)});
process.on('message',message=>{
  if(message!=='finish-race')return;
  for(let frame=0;frame<24000&&['countdown','racing'].includes(game.phase);frame++){
    const now=Date.now();
    for(const player of game.players)if(!player.bot)game.setInput(player.owner,player.id,game.botInput(player),now);
    game.step(1/60,now);
  }
});`;
const server=spawn(process.execPath,['--input-type=module','-e',harness],{cwd:root,env:{...process.env,PORT:String(port),LEADERBOARD_FILE:path.join(directory,'scores.json')},stdio:['ignore','pipe','pipe','ipc']});
let browser,browserServer;const errors=[],peers=[];
async function peer(){const ws=new WebSocket(`ws://127.0.0.1:${port}`);peers.push(ws);await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});return ws;}
async function checkPodium(page,id,expected){
  await page.waitForFunction(({id,expected})=>{const podium=window.jungleKart.podiums[id];return podium&&podium.renderer.info.render.frame>1&&JSON.stringify(podium.scene.userData.podiumEntries.map(p=>p.id))===JSON.stringify(expected);},{id,expected});
  assert.equal(await page.locator('#'+id+'-podium').isVisible(),true);
}
try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout')),5000);server.stdout.on('data',data=>{if(data.toString().includes('Local:')){clearTimeout(timer);resolve();}});server.once('error',reject);});
  browserServer=await chromium.launchServer({executablePath,headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});browser=await chromium.connect(browserServer.wsEndpoint());
  const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});context.setDefaultTimeout(15000);
  await context.addInitScript(()=>{window.testPads=[];Object.defineProperty(navigator,'getGamepads',{value:()=>window.testPads});});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.waitForFunction(()=>!!window.jungleKart?.clientId&&window.jungleKart.scene?.renderer.info.render.frame>2);
  assert.equal(await page.locator('.animal-tile').count(),15);assert.equal(await page.locator('.vehicle-tile').count(),6);
  await page.screenshot({path:path.join(root,'garage-desktop.png')});console.log('PASS: 3D garage, 15 animal selectors, six vehicle selectors.');
  await page.locator('#help-button').click();await page.locator('#help-dialog').waitFor({state:'visible'});await page.locator('#help-dialog [data-close]').first().click();
  await page.locator('[data-animal="elephant"]').click();await page.locator('[data-vehicle="jeep"]').click();
  await page.waitForFunction(()=>{const scene=window.jungleKart.scene,hero=scene._models.get(scene.cameras[0].userData.playerId);return hero.animal==='elephant'&&hero.vehicle==='jeep';});
  assert.equal(await page.evaluate(()=>window.jungleKart.state.players.length),0);
  await page.locator('#player-name').fill('Nori');await page.locator('#join-button').click();
  await page.waitForFunction(()=>window.jungleKart.state.players.length===1&&window.jungleKart.state.players[0].animal==='elephant');
  for(const animal of ['tiger','panda','fox','capybara','monkey','rabbit','frog','redpanda','bear','crocodile','koala','otter','leopard','elephant','raccoon']){await page.locator(`[data-animal="${animal}"]`).click();await page.waitForFunction(id=>window.jungleKart.state.players[0].animal===id,animal);await page.evaluate(()=>new Promise(requestAnimationFrame));}
  for(const vehicle of ['kart','jeep','buggy','coupe','hover','tuktuk']){await page.locator(`[data-vehicle="${vehicle}"]`).click();await page.waitForFunction(id=>window.jungleKart.state.players[0].vehicle===id,vehicle);await page.evaluate(()=>new Promise(requestAnimationFrame));}
  console.log('PASS: all 15 animals and all six vehicles can be applied in the live garage.');
  await page.locator('#add-local').click();await page.waitForFunction(()=>window.jungleKart.state.players.length===2);
  const firstId=await page.evaluate(()=>window.jungleKart.state.players[0].id);
  await page.waitForFunction(()=>window.jungleKart.scene.cameras[0].userData.playerId===window.jungleKart.state.players[1].id);
  await page.locator(`[data-player="${firstId}"] .slot-name`).click();
  await page.waitForFunction(id=>window.jungleKart.scene.cameras[0].userData.playerId===id,firstId);
  console.log('PASS: 3D garage previews before joining and follows the selected local racer.');
  await page.locator('#mode-select').selectOption('single');await page.locator('#start-button').click();await page.waitForFunction(()=>window.jungleKart.state.phase==='racing'&&window.jungleKart.views.length===2);
  await page.screenshot({path:path.join(root,'split-2.png')});
  const position=control=>page.evaluate(control=>{const p=window.jungleKart.state.players.find(p=>p.owner===window.jungleKart.clientId&&p.control===control);return{id:p.id,x:p.x,z:p.z};},control);
  for(const [control,key] of [['keyboard1','KeyW'],['keyboard2','ArrowUp']]){const before=await position(control);await page.keyboard.down(key);await page.waitForFunction(b=>{const p=window.jungleKart.state.players.find(p=>p.id===b.id);return Math.hypot(p.x-b.x,p.z-b.z)>.5;},before);await page.keyboard.up(key);}
  const canvas=await page.locator('#game-canvas').boundingBox();assert.ok(canvas.width>1000&&canvas.height>600);
  await page.locator('#leave-button').click();await page.waitForFunction(()=>window.jungleKart.state.phase==='lobby');
  await page.evaluate(()=>{window.testPads=[0,1].map(index=>({index,axes:[0,0],buttons:Array.from({length:17},(_,i)=>({pressed:i===9,value:i===9?1:0}))}));});await page.waitForFunction(()=>window.jungleKart.state.players.length===4);await page.evaluate(()=>window.testPads.forEach(p=>p.buttons[9].pressed=false));
  await page.locator('#track-next').click();await page.locator('#start-button').click();await page.waitForFunction(()=>window.jungleKart.state.phase==='racing'&&window.jungleKart.views.length===4);assert.equal(await page.evaluate(()=>window.jungleKart.state.trackId),1);
  await page.screenshot({path:path.join(root,'split-4.png')});
  const pad=await position('pad0');await page.evaluate(()=>window.testPads[0].buttons[7]={pressed:true,value:1});await page.waitForFunction(b=>{const p=window.jungleKart.state.players.find(p=>p.id===b.id);return Math.hypot(p.x-b.x,p.z-b.z)>.5;},pad);await page.evaluate(()=>window.testPads[0].buttons[7]={pressed:false,value:0});
  await page.locator('#leave-button').click();await page.waitForFunction(()=>window.jungleKart.state.phase==='lobby');
  for(const name of ['Router One','Router Two']){const ws=await peer();ws.send(JSON.stringify({type:'join',control:'touch',displayOnHost:true,animal:'frog',vehicle:'hover',name}));}
  await page.waitForFunction(()=>window.jungleKart.state.players.length===6);await page.locator('#track-next').click();await page.locator('#start-button').click();await page.waitForFunction(()=>window.jungleKart.state.phase==='racing'&&window.jungleKart.views.length===6);assert.equal(await page.evaluate(()=>window.jungleKart.state.trackId),2);
  await page.screenshot({path:path.join(root,'split-6.png')});
  const views=await page.evaluate(()=>window.jungleKart.scene.renderedViews);assert.equal(views.length,6);assert.ok(views.every(v=>v.w>0&&v.h>0));
  console.log('PASS: actual 2/4/6 camera splits, all three circuits, two keyboards, simulated gamepad throttle, and router-controller host views.');
  await page.locator('#leave-button').click();await page.waitForFunction(()=>window.jungleKart.state.phase==='lobby');
  await page.locator('#leaderboard-button').click();await checkPodium(page,'leaderboard',[]);
  await page.screenshot({path:path.join(root,'leaderboard-empty.png')});
  await page.locator('#leaderboard-dialog [data-close]').first().click();await page.waitForFunction(()=>window.jungleKart.podiums.leaderboard===null);
  for(const ws of peers)ws.terminate();await page.waitForFunction(()=>window.jungleKart.state.players.length===4);
  await page.locator('#mode-select').selectOption('cup');await page.locator('#start-button').click();
  for(let round=0;round<3;round++){
    await page.waitForFunction(round=>window.jungleKart.state.roundIndex===round&&['countdown','racing'].includes(window.jungleKart.state.phase),round);
    server.send('finish-race');
    await page.waitForFunction(round=>window.jungleKart.state.roundIndex===round&&window.jungleKart.state.phase===(round===2?'cupFinished':'results'),round);
    const winners=await page.evaluate(()=>{const s=window.jungleKart.state;return(s.phase==='cupFinished'?s.cupResults:s.raceResults).slice(0,3).map(p=>p.id);});
    await checkPodium(page,'results',winners);assert.equal(await page.locator('#race-results .score-row').count(),4);
    if(round<2){await page.locator('#next-button').click();await page.waitForFunction(()=>window.jungleKart.podiums.results===null);}
  }
  await page.screenshot({path:path.join(root,'tournament-podium.png')});
  const results=await page.evaluate(()=>window.jungleKart.state.cupResults);
  const saved=await fetch(url+'/api/leaderboard').then(r=>r.json());assert.equal(saved.entries.length,4);
  for(const entry of saved.entries){const result=results.find(p=>p.name===entry.name&&p.points===entry.points);assert.ok(result);assert.equal(entry.rounds,3);}
  await page.locator('#results-back').click();await page.waitForFunction(()=>window.jungleKart.state.phase==='lobby'&&window.jungleKart.podiums.results===null);
  for(let repeat=0;repeat<2;repeat++){
    await page.locator('#leaderboard-button').click();await checkPodium(page,'leaderboard',saved.entries.slice(0,3).map(p=>p.id));
    if(repeat===0)await page.screenshot({path:path.join(root,'leaderboard-3d.png')});
    await page.locator('#leaderboard-dialog [data-close]').first().click();await page.waitForFunction(()=>window.jungleKart.podiums.leaderboard===null);
  }
  console.log('PASS: complete three-race tournament, real 3D winners, persistent leaderboard order, empty state and dialog resource cleanup.');
  await context.close();
  const hostStub=await peer();
  const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});mobileContext.setDefaultTimeout(15000);
  const mobile=await mobileContext.newPage();mobile.on('pageerror',error=>errors.push(error.message));await mobile.goto(url);await mobile.waitForFunction(()=>!!window.jungleKart?.clientId);
  await mobile.locator('#device-mode').selectOption('controller');await mobile.locator('#player-name').fill('Phone controller');await mobile.locator('#join-button').click();await mobile.waitForFunction(()=>window.jungleKart.controllerOnly===true);
  hostStub.send(JSON.stringify({type:'start',mode:'single'}));await mobile.waitForFunction(()=>window.jungleKart.state.phase==='racing');assert.equal(await mobile.locator('#controller-panel').isVisible(),true);assert.equal(await mobile.evaluate(()=>window.jungleKart.scene===null),true);
  const stick=await mobile.locator('#steer-pad').boundingBox();const before=await mobile.evaluate(()=>{const p=window.jungleKart.state.players[0];return{id:p.id,angle:p.angle};});
  await mobile.mouse.move(stick.x+stick.width/2,stick.y+stick.height/2);await mobile.mouse.down();await mobile.mouse.move(stick.x+stick.width*.8,stick.y+stick.height/2);await mobile.waitForFunction(b=>{const p=window.jungleKart.state.players.find(p=>p.id===b.id);return Math.abs(p.angle-b.angle)>.1;},before);await mobile.mouse.up();
  await mobile.screenshot({path:path.join(root,'phone-controller.png')});console.log('PASS: mobile controller-only interface sends real steering to the host.');
  hostStub.send(JSON.stringify({type:'lobby'}));await mobile.waitForFunction(()=>window.jungleKart.state.phase==='lobby');await mobile.locator('#roster .remove-player').click();await mobile.waitForFunction(()=>window.jungleKart.state.players.length===0);
  await mobile.locator('#device-mode').selectOption('screen');await mobile.locator('#join-button').click();await mobile.waitForFunction(()=>window.jungleKart.state.players.length===1);hostStub.send(JSON.stringify({type:'start',mode:'single'}));await mobile.waitForFunction(()=>window.jungleKart.state.phase==='racing'&&!!window.jungleKart.scene);
  await mobile.locator('#touch-controls').waitFor({state:'visible'});await mobile.screenshot({path:path.join(root,'racing-mobile.png')});
  const bounds=await mobile.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,views:window.jungleKart.views.length}));assert.ok(bounds.scroll<=bounds.width+1);assert.equal(bounds.views,1);
  server.send('finish-race');await mobile.waitForFunction(()=>window.jungleKart.state.phase==='cupFinished');
  await checkPodium(mobile,'results',await mobile.evaluate(()=>window.jungleKart.state.cupResults.slice(0,3).map(p=>p.id)));
  await mobile.screenshot({path:path.join(root,'podium-mobile.png')});
  const podiumBounds=await mobile.locator('#results-podium').boundingBox();assert.ok(podiumBounds.width>250&&podiumBounds.x>=0&&podiumBounds.x+podiumBounds.width<=390);
  hostStub.send(JSON.stringify({type:'lobby'}));await mobile.waitForFunction(()=>window.jungleKart.state.phase==='lobby'&&window.jungleKart.podiums.results===null);
  await mobile.locator('#leaderboard-button').click();const mobileScores=await fetch(url+'/api/leaderboard').then(r=>r.json());
  await checkPodium(mobile,'leaderboard',mobileScores.entries.slice(0,3).map(p=>p.id));await mobile.screenshot({path:path.join(root,'leaderboard-mobile.png')});
  await mobile.locator('#leaderboard-dialog [data-close]').first().click();assert.deepEqual(errors,[]);
  console.log('PASS: mobile chase camera, touch controls, responsive results and 3D leaderboard, and no uncaught browser errors.');
  console.log('Physical gamepads and a separate physical router device are not covered by this automated check.');
}catch(error){console.error(error);process.exitCode=1;}
finally{for(const ws of peers)ws.terminate();server.kill();if(browserServer)browserServer.process().kill('SIGKILL');await rm(directory,{recursive:true,force:true});console.log('Owned QA processes stopped.');}
// Standalone CLI: close Playwright transport listeners while preserving failures.
process.exit(process.exitCode||0);
