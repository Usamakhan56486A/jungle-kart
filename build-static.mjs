// Assembles the static (Cloudflare Pages) build into dist/.
//
// The server build keeps game.mjs at the repo root importing ./public/world.js.
// The static build needs a FLAT layout so the in-page shim (local-server.js) can
// import ./game.mjs and ./world.js as siblings. This script produces that layout:
//
//   dist/index.html      (public/index.html with the shim injected before app.js)
//   dist/app.js          public/app.js          (unchanged)
//   dist/scene.js        public/scene.js        (unchanged)
//   dist/world.js        public/world.js        (unchanged)
//   dist/style.css       public/style.css       (unchanged)
//   dist/game.js         game.mjs  (renamed to .js, ./public/world.js → ./world.js)
//   dist/local-server.js static-shim/local-server.js (unchanged)
//   dist/vendor/three.module.js + three.core.js  (the importmap target "three")
//
// Run:  node build-static.mjs
import {cp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const DIST=path.join(ROOT,'dist');
const PUBLIC=path.join(ROOT,'public');
const THREE_BUILD=path.join(ROOT,'node_modules','three','build');

const log=(...args)=>console.log('[build-static]',...args);

await rm(DIST,{recursive:true,force:true});
await mkdir(path.join(DIST,'vendor'),{recursive:true});

// 1. Static assets copied verbatim.
for(const file of ['app.js','scene.js','world.js','style.css']){
  await cp(path.join(PUBLIC,file),path.join(DIST,file));
  log('copied',file);
}

// 2. Vendor three (module + core, because three.module.js imports ./three.core.js).
for(const file of ['three.module.js','three.core.js']){
  await cp(path.join(THREE_BUILD,file),path.join(DIST,'vendor',file));
  log('vendored',file);
}

// 3. game.mjs → dist/game.js with its world.js import flattened.
//    Renamed to .js so every static host serves it as text/javascript; some hosts
//    answer .mjs with application/octet-stream, which browsers reject for modules.
const gameSource=await readFile(path.join(ROOT,'game.mjs'),'utf8');
const flattened=gameSource.replace(/(['"])\.\/public\/world\.js\1/g,'$1./world.js$1');
if(flattened===gameSource)throw new Error('game.mjs no longer imports ./public/world.js — update build-static.mjs.');
if(flattened.includes('./public/world.js'))throw new Error('game.mjs still references ./public/world.js after rewrite.');
await writeFile(path.join(DIST,'game.js'),flattened,'utf8');
log('wrote game.js (from game.mjs, import flattened to ./world.js)');

// 4. The in-page host shim.
await cp(path.join(ROOT,'static-shim','local-server.js'),path.join(DIST,'local-server.js'));
log('copied local-server.js');

// 5. index.html — inject the shim as a module script BEFORE app.js so that
//    window.WebSocket is replaced before connect() runs.
let html=await readFile(path.join(PUBLIC,'index.html'),'utf8');
const APP_TAG='<script type="module" src="/app.js"></script>';
const SHIM_TAG='<script type="module" src="/local-server.js"></script>';
if(!html.includes(APP_TAG))throw new Error('Could not find the /app.js script tag in index.html.');
if(html.includes(SHIM_TAG))throw new Error('local-server.js is already injected into index.html.');
html=html.replace(APP_TAG,`${SHIM_TAG}\n  ${APP_TAG}`);
await writeFile(path.join(DIST,'index.html'),html,'utf8');
log('wrote index.html (shim injected before app.js)');

log('done → dist/ ready for Cloudflare Pages (root: dist, no build command needed).');
