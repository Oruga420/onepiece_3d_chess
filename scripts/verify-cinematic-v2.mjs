import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {ATTACK_FAMILIES,CHARACTER_ATTACKS} from '../src/attacks.mjs';
import {base,out,save,settle,browserChannel} from './browser-utils.mjs';

const ids=['mugiwara/king','mugiwara/queen','mugiwara/rook','mugiwara/bishop','mugiwara/knight','mugiwara/pawn','buggy/queen','bigmom/knight','kaido/king','doflamingo/king','doflamingo/knight','heart/king','kid/king','blackbeard/king','whitebeard/king','marines/bishop','whitebeard/rook','marines/queen','whitebeard/queen'];
const focus=process.argv.includes('--focus'),selectedIds=focus?['mugiwara/king','mugiwara/bishop','whitebeard/queen']:ids;
const prefixes={rubber:'rubber-stretched-arm',sword:'sword-cut',lightning:'lightning-fork',fire:'fire-tongue',projectile:'projectile-shot',beast:'beast-claw',blunt:'blunt-club',candy:'candy-prison-spike',dragon:'dragon-serpentine-aura',string:'string-birdcage',stone:'stone-eruption',room:'room-surgical-dome',metal:'metal-magnetic-scrap',darkness:'darkness-black-hole',quake:'quake-air-fracture',smoke:'smoke-coil'};
function fixture(id){
 const [crew,role]=id.split('/'),marine=crew==='marines',from=role==='knight'?(marine?'E6':'E3'):role==='rook'?(marine?'D6':'D3'):(marine?'E5':'E4'),to=marine?'D4':'D5';
 const board=Array.from({length:8},()=>Array(8).fill(''));const put=(square,char)=>{board[8-Number(square[1])][square.charCodeAt(0)-65]=char;};
 if(role!=='king'||marine)put('A1','K');if(role!=='king'||!marine)put('H8','k');
 const char={king:'k',queen:'q',rook:'r',bishop:'b',knight:'n',pawn:'p'}[role];put(from,marine?char:char.toUpperCase());put(to,marine?'P':'p');
 const fen=board.map(row=>{let s='',empty=0;for(const cell of row){if(!cell)empty++;else{if(empty)s+=empty;empty=0;s+=cell;}}return s+(empty||'');}).join('/')+` ${marine?'b':'w'} - - 0 1`;
 return {id,crew:marine?'mugiwara':crew,role,from,to,fen,attack:CHARACTER_ATTACKS[id]};
}
const report={base,startedAt:new Date().toISOString(),fixtures:[],stress:[],decodedAudio:[],errors:[],httpErrors:[],providerRequests:[],audioRequests:[],passed:false};
const persist=()=>save('cinematic-v2.json',report);
let browser,context;
async function setup(page,f){await page.evaluate(async({crew,fen})=>{const app=window.chessApp;if(app.crew!==crew)await app.setCrew(crew);await app.loadFEN(fen);},{crew:f.crew,fen:f.fen});await settle(page);await page.evaluate(async attack=>{await window.chessApp.combatAudio.prepare(attack);},f.attack);}
async function capture(page,f,{images=true}={}){
 const result=await page.evaluate(({f,images})=>new Promise((resolve,reject)=>{
  const app=window.chessApp,v=app.view,frames=[],pngs={},started=performance.now(),beforeAudio=app.combatAudio.getMetrics(),audioOffset=window.__audioEvents.length;
  const camera=()=>({position:v.camera.position.toArray(),quaternion:v.camera.quaternion.toArray()});const beforeCamera=camera(),beforeResources={...v.renderer.info.memory};
  const move=app.commands.move({from:f.from,to:f.to},{source:'mouse'});if(!move.ok){resolve({move});return;}
  const sample=()=>{
   const combat={...v.getMetrics().combat};frames.push({...combat,audio:app.combatAudio.getMetrics(),at:performance.now()-started});
   const phase=combat.progress>=.70&&combat.progress<.85?'finish':combat.progress>=.60&&combat.progress<.65?'signature':null;
   if(images&&phase&&!pngs[phase]){
    const group=v.scene.getObjectByName('character-attack-effects');
    const geometry=group?.children.map(o=>({name:o.name,type:o.geometry?.type,visible:group.visible&&o.visible,opacity:o.material?.uniforms?.opacity?.value??o.material?.opacity,scale:o.scale.toArray()}))||[];
    let finite=true;v.scene.traverse(o=>{if(![...o.position.toArray(),...o.quaternion.toArray(),...o.scale.toArray()].every(Number.isFinite))finite=false;const positions=o.geometry?.attributes?.position?.array;if(positions&&!positions.every(Number.isFinite))finite=false;});v.renderer.render(v.scene,v.camera);pngs[phase]={png:v.canvas.toDataURL('image/png'),combat,geometry,finite};
   }
   if(!app.busy){resolve({move,frames,pngs,audioEvents:window.__audioEvents.slice(audioOffset),beforeAudio,afterAudio:app.combatAudio.getMetrics(),beforeCamera,afterCamera:camera(),beforeResources,afterResources:{...v.renderer.info.memory},remainingSignature:Boolean(v.scene.getObjectByName('character-attack-effects')),metrics:v.getMetrics(),squares:[...v.pieces.keys()]});return;}
   if(performance.now()-started>15000){reject(Error('Unsettled '+f.id+' '+JSON.stringify({phase:combat.phase,progress:combat.progress,frames:frames.length,audio:app.combatAudio.getMetrics()})));return;}requestAnimationFrame(sample);
  };requestAnimationFrame(sample);
 }),{f,images});
 for(const [phase,entry] of Object.entries(result.pngs||{})){entry.file=path.join(out,`cinematic-v2-${f.id.replace('/','-')}-${phase}.png`);fs.writeFileSync(entry.file,Buffer.from(entry.png.split(',')[1],'base64'));delete entry.png;}
 return result;
}
function verify(f,result,{audio=true,images=true}={}){
 assert.equal(result.move.ok,true,f.id+' legal capture');assert.equal(result.remainingSignature,false,f.id+' signature disposed');assert.equal(result.metrics.effects,0);assert.equal(result.metrics.signatureEffects||0,0);
 assert(result.frames.some(frame=>frame.characterAttack===f.id&&frame.family===f.attack.family&&frame.signatureEffects>0),f.id+' identity-driven signature metrics');
 assert.equal(Math.max(...result.frames.map(frame=>frame.impactCount||0)),1);assert(!result.squares.includes(f.from)&&result.squares.includes(f.to));
 for(const key of ['position','quaternion'])result.afterCamera[key].forEach((value,index)=>assert(Math.abs(value-result.beforeCamera[key][index])<1e-9,f.id+' camera restored'));
 assert(result.afterResources.geometries<=result.beforeResources.geometries,f.id+' GPU geometry reclaimed');assert(result.afterResources.textures<=result.beforeResources.textures,f.id+' GPU texture reclaimed');
 if(audio){
  assert.equal(result.afterAudio.plays,result.beforeAudio.plays+4,f.id+' four real cue sources');
  for(const cue of ['windup','parry','impact','land'])assert.equal(result.afterAudio.cueCounts[cue],result.beforeAudio.cueCounts[cue]+1,f.id+' one '+cue);
  assert.equal(result.afterAudio.skipped,result.beforeAudio.skipped,f.id+' no missed audio cues');
  assert.equal(result.afterAudio.lastAttack,f.id);assert.equal(result.afterAudio.lastSource,'/assets/audio/combat/v2/land.mp3');assert.equal(result.afterAudio.lastError,null);
  const starts=result.audioEvents.filter(e=>e.kind==='start');assert.equal(starts.length,4,f.id+' actual WebAudio start count');
  starts.forEach((e,i)=>{assert.equal(e.contextState,'running');assert(e.duration>0);if(i)assert(e.at>starts[i-1].at,'chronological cues');});
  assert(starts[0].progress<.45&&starts[1].progress>=.4&&starts[1].progress<.62,'windup/parry timing');
  assert(starts[2].progress>=.62&&starts[2].progress<.70,'impact timing');assert(starts[3].progress>=.80&&starts[3].progress<.9,'landing timing');
 }
 if(images){const entry=result.pngs.signature;assert(entry,f.id+' signature snapshot');assert(entry.finite,f.id+' finite scene vertices/transforms');const prefix=f.id==='marines/queen'?'magma-tongue':prefixes[f.attack.family];assert(entry.geometry.some(o=>o.name.startsWith(prefix)&&o.visible&&o.opacity>.03&&o.scale.some(n=>n>.01)),f.id+' visible family geometry '+prefix);}
}
try{
 console.log('CINEMATIC_STAGE launching '+browserChannel);browser=await chromium.launch({headless:true,channel:browserChannel,timeout:45000});console.log('CINEMATIC_STAGE browser-ready');
 context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'no-preference'});
 await context.addInitScript(()=>{
  window.__audioEvents=[];
  const start=AudioBufferSourceNode.prototype.start,stop=AudioBufferSourceNode.prototype.stop;
  let sourceId=0;const ids=new WeakMap();
  AudioBufferSourceNode.prototype.start=function(...args){
   const id=++sourceId;ids.set(this,id);
   const result=start.apply(this,args);
   window.__audioEvents.push({kind:'start',id,at:performance.now(),scheduled:args[0],duration:this.buffer?.duration,contextState:this.context.state,progress:window.chessApp?.view.getMetrics().combat?.progress});
   this.addEventListener('ended',()=>window.__audioEvents.push({kind:'ended',id,at:performance.now()}),{once:true});return result;
  };
  AudioBufferSourceNode.prototype.stop=function(...args){const result=stop.apply(this,args);window.__audioEvents.push({kind:'stop',id:ids.get(this),at:performance.now()});return result;};
 });
 await context.route('**/api/voice/**',route=>{report.providerRequests.push(route.request().url());return route.abort();});
 const page=await context.newPage();page.on('request',r=>{if(r.url().includes('/assets/audio/'))report.audioRequests.push(r.url());});page.setDefaultTimeout(45000);page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({status:r.status(),url:r.url()});});
 console.log('CINEMATIC_STAGE login');const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:process.env.APP_PASSWORD||'12345'}),signal:AbortSignal.timeout(30000)});assert.equal(login.status,200,'real password login');report.loginStatus=login.status;const cookie=login.headers.get('set-cookie').split(';')[0],separator=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:base,httpOnly:true,sameSite:'Lax',secure:base.startsWith('https:')}]);console.log('CINEMATIC_STAGE authenticated');await page.goto(base+'/',{waitUntil:'commit'});
 await page.waitForFunction(()=>Boolean(window.chessApp?.combatAudio));await page.evaluate(()=>window.chessApp.whenReady);console.log('CINEMATIC_STAGE app-ready');await page.evaluate(()=>{window.chessApp.setAI(false);window.chessApp.view.setCamera('front');window.chessApp.view.zoom(-.27);});await settle(page);await page.click('#camera-reset');await page.evaluate(()=>{window.chessApp.view.zoom(-.27);return window.chessApp.combatAudio.unlock();});
 console.log('CINEMATIC_STAGE decode');report.decodedAudio=await page.evaluate(async families=>{
  const audio=new AudioContext(),result=[];
  const names=[...families.flatMap(f=>[f+'-windup',f+'-impact']),'parry','land'];
  try{for(const name of names){
   const response=await fetch('/assets/audio/combat/v2/'+name+'.mp3');if(!response.ok)throw Error('AudioHTTP '+name);
   const bytes=await response.arrayBuffer(),byteLength=bytes.byteLength,decoded=await audio.decodeAudioData(bytes),channels=[];
   for(let c=0;c<decoded.numberOfChannels;c++){const data=decoded.getChannelData(c);let sum=0,peak=0,clipped=0,finite=true;for(const value of data){finite&&=Number.isFinite(value);sum+=value*value;peak=Math.max(peak,Math.abs(value));if(Math.abs(value)>=1)clipped++;}channels.push({rms:Math.sqrt(sum/data.length),peak,clipped,finite});}
   result.push({name,bytes:byteLength,duration:decoded.duration,channels});
  }}finally{await audio.close();}return result;
 },ATTACK_FAMILIES);
 assert.equal(report.decodedAudio.length,34);
 for(const audio of report.decodedAudio){assert(audio.bytes>1000&&audio.duration>.15,'real MP3 '+audio.name);for(const c of audio.channels){assert(c.finite&&c.rms>.001&&c.peak>.01,'non-silent finite '+audio.name);assert.equal(c.clipped,0,'no decoded sample clipping '+audio.name);}}
 persist();
 for(const id of selectedIds){const f=fixture(id);await setup(page,f);const result=await capture(page,f);report.fixtures.push({id,family:f.attack.family,result});persist();verify(f,result);console.log('CHARACTER_OK '+id+' '+f.attack.family);}
 if(!focus)assert.deepEqual([...new Set(report.fixtures.map(f=>f.family))].sort(),[...ATTACK_FAMILIES].sort());
 // Consume the actual fruit, then capture with the resulting queen's character identity.
 const promoted=fixture('mugiwara/queen');await setup(page,{...promoted,fen:fixture('mugiwara/pawn').fen});
 const fruit=await page.evaluate(()=>window.chessApp.commands.runTool('propose_fruit',{square:'E4',fruit:'gomu-gomu'},{source:'mouse'}));assert.equal(fruit.ok,true);await settle(page);
 assert.equal(await page.evaluate(()=>window.chessApp.view.pieces.get('E4').userData.piece.type),'queen');report.fruitPromotion=await capture(page,promoted);verify(promoted,report.fruitPromotion);persist();
 // Twelve cross-family captures also check cleanup against each crew's warmed baseline.
 for(const id of focus?[]:ids.slice(0,12)){const f=fixture(id);await setup(page,f);const result=await capture(page,f,{images:false});verify(f,result,{images:false});report.stress.push({id,before:result.beforeResources,after:result.afterResources});persist();console.log('STRESS_OK '+id);}
 // Marine identity must not inherit the selected pirate crew.
 const marine={...fixture('marines/queen'),crew:'heart'};await setup(page,marine);report.marineCrewIndependence=await capture(page,marine);verify(marine,report.marineCrewIndependence);persist();
 // A trusted DOM mute stops real native sources and suppresses subsequent capture audio.
 const f=fixture('mugiwara/king');await setup(page,f);await page.evaluate(({from,to})=>window.chessApp.commands.move({from,to},{source:'mouse'}),f);await page.waitForFunction(()=>window.chessApp.view.getMetrics().combat?.impactCount===1);
 await page.click('#sound-toggle');report.mute=await page.evaluate(()=>({metrics:window.chessApp.combatAudio.getMetrics(),paused:window.chessApp.combatAudio.getMetrics().active===0}));assert.equal(report.mute.metrics.enabled,false);assert.equal(report.mute.paused,true);await settle(page);assert.equal(await page.evaluate(()=>window.chessApp.combatAudio.getMetrics().plays),report.mute.metrics.plays,'muted late cues stay stopped');
 await setup(page,f);const muted=await capture(page,f,{images:false});verify(f,muted,{audio:false,images:false});assert.equal(muted.afterAudio.plays,muted.beforeAudio.plays);report.mute.nextCapture=muted.afterAudio;
 if(await page.locator('#result-overlay').evaluate(dialog=>dialog.open))await page.click('.result-overlay__dismiss');
 await page.click('#sound-toggle');persist();
 // Reset while signature geometry is alive; stale callbacks must not revive audio/effects.
 await setup(page,f);await page.evaluate(({from,to})=>window.chessApp.commands.move({from,to},{source:'mouse'}),f);await page.waitForFunction(()=>window.chessApp.view.getMetrics().combat?.progress>.58);await page.click('#reset-button');await settle(page);const cancelAudio=await page.evaluate(()=>window.chessApp.combatAudio.getMetrics());await page.waitForTimeout(3700);assert.equal(await page.evaluate(()=>window.chessApp.combatAudio.getMetrics().plays),cancelAudio.plays,'reset late callbacks never restart audio');
 report.cancel=await page.evaluate(()=>({metrics:window.chessApp.view.getMetrics(),signature:Boolean(window.chessApp.view.scene.getObjectByName('character-attack-effects')),paused:window.chessApp.combatAudio.getMetrics().active===0}));assert.equal(report.cancel.metrics.pieceCount,32);assert.equal(report.cancel.metrics.effects,0);assert.equal(report.cancel.signature,false);assert.equal(report.cancel.paused,true);
 report.audioEvents=await page.evaluate(()=>window.__audioEvents);
 await page.emulateMedia({reducedMotion:'reduce'});await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Boolean(window.chessApp?.combatAudio));await page.evaluate(()=>window.chessApp.whenReady);await page.evaluate(()=>window.chessApp.setAI(false));await settle(page);await setup(page,f);await page.click('#camera-reset');await page.evaluate(()=>{window.chessApp.view.zoom(-.27);return window.chessApp.combatAudio.unlock();});
 const reducedStart=performance.now();report.reducedMotion=await capture(page,f,{images:false});report.reducedMotion.elapsedMs=performance.now()-reducedStart;
 assert(report.reducedMotion.elapsedMs<700,'reduced motion stays immediate');assert.equal(report.reducedMotion.move.ok,true);assert.equal(report.reducedMotion.metrics.effects,0);assert.equal(report.reducedMotion.remainingSignature,false);assert.equal(report.reducedMotion.metrics.combat.characterAttack,f.id);
 await page.waitForTimeout(4000);report.reducedMotion.laterAudio=await page.evaluate(()=>window.chessApp.combatAudio.getMetrics());
 assert.equal(report.reducedMotion.laterAudio.plays,report.reducedMotion.beforeAudio.plays+1,'only immediate reduced-motion impact');
 for(const cue of ['windup','parry','land'])assert.equal(report.reducedMotion.laterAudio.cueCounts[cue],report.reducedMotion.beforeAudio.cueCounts[cue],'no delayed reduced-motion '+cue);
 assert(report.audioRequests.length>=34);assert(report.audioRequests.every(url=>url.includes('/assets/audio/combat/v2/')),'no legacy combat audio requests');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);assert.deepEqual(report.providerRequests,[]);
 report.passed=true;report.completedAt=new Date().toISOString();persist();
 console.log(`CINEMATIC_V2_OK focus=${focus} captures=${selectedIds.length} fruitQueen=1 marineIdentity=1 stress=${report.stress.length} realMP3=34 realWebAudio=1 mute=1 cancel=1`);
}catch(error){report.error=error.stack;persist();console.error(error.stack);process.exitCode=1;}
finally{let closeTimer;try{await Promise.race([(async()=>{await context?.close();await browser?.close();})(),new Promise(resolve=>{closeTimer=setTimeout(resolve,5000);})]);}finally{clearTimeout(closeTimer);}}

