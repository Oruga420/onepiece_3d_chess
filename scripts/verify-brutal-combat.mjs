import {getCharacterAttack} from '../src/attacks.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {base,out,save,settle,browserChannel} from './browser-utils.mjs';

const fixtures=[
 {id:'pawn',fen:'7k/8/8/3p4/4P3/8/8/K7 w - - 0 1',from:'E4',to:'D5',profile:'brawl'},
 {id:'knight',fen:'7k/8/8/3p4/8/4N3/8/K7 w - - 0 1',from:'E3',to:'D5',profile:'vault'},
 {id:'bishop',fen:'7k/8/8/3p4/4B3/8/8/K7 w - - 0 1',from:'E4',to:'D5',profile:'slash'},
 {id:'queen',fen:'7k/8/8/3p4/4Q3/8/8/K7 w - - 0 1',from:'E4',to:'D5',profile:'slash'},
 {id:'rook',fen:'7k/8/8/3p4/8/3R4/8/K7 w - - 0 1',from:'D3',to:'D5',profile:'charge'},
 {id:'king',fen:'7k/8/8/3p4/4K3/8/8/8 w - - 0 1',from:'E4',to:'D5',profile:'charge'},
 {id:'en-passant',fen:'7k/8/8/3pP3/8/8/8/K7 w - d6 0 1',from:'E5',to:'D6',victim:'D5',profile:'brawl'},
 {id:'castle',fen:'7k/8/8/8/8/8/8/4K2R w K - 0 1',from:'E1',to:'G1',capture:false,profile:'charge'},
];
const report={base,startedAt:new Date().toISOString(),animation:'Procedural rigid textured figures; no skeletal rig',fixtures:[],stress:[],interruptions:[],passed:false};
const persist=()=>save('brutal-combat.json',report);
const camera=page=>page.evaluate(()=>{const v=window.chessApp.view;return {position:v.camera.position.toArray(),quaternion:v.camera.quaternion.toArray(),fov:v.camera.fov,zoom:v.zoomLevel,yaw:v.cameraYaw,elevation:v.cameraElevation};});
function sameCamera(actual,expected,label){
 for(const key of ['position','quaternion'])actual[key].forEach((value,index)=>assert(Math.abs(value-expected[key][index])<1e-9,label+' '+key+' '+index));
 for(const key of ['fov','zoom','yaw','elevation'])assert(Math.abs(actual[key]-expected[key])<1e-9,label+' '+key);
}
async function observe(page,fixture,{images=false}={}){
 return page.evaluate(({fixture,images})=>new Promise((resolve,reject)=>{
  const app=window.chessApp,v=app.view,frames=[],pngs={},started=performance.now();
  const attacker=v.pieces.get(fixture.from),victim=v.pieces.get(fixture.victim||fixture.to);
  const result=app.commands.move({from:fixture.from,to:fixture.to},{source:'mouse'});
  if(!result.ok){resolve({result,frames,pngs});return;}
  const sample=()=>{
   const combat={...v.getMetrics().combat},frame={...combat,effects:v.getMetrics().effects,attackerVisible:attacker?.visible,victimVisible:victim?.visible,camera:v.camera.position.toArray()};
   frames.push(frame);
   const phase=combat.phase==='recover'&&combat.progress>=.94?'aftermath':combat.phase==='defeat'&&combat.progress>=.80?'defeat':combat.phase==='defeat'&&combat.progress>=.72?'impact':null;
   if(images&&phase&&!pngs[phase]){
    const group=v.scene.getObjectByName('chess-combat-effects');
    const renderedPools=group?.children.filter(object=>object.isInstancedMesh).map(object=>{
     const matrices=object.instanceMatrix.array;let visibleInstances=0;
     for(let i=0;i<object.count;i++)if(Math.hypot(matrices[i*16],matrices[i*16+1],matrices[i*16+2])>.00001)visibleInstances++;
     return {name:object.name,opacity:object.material.opacity,visibleInstances};
    });
    v.scene.updateMatrixWorld(true);
    const actors=[attacker,victim].filter(object=>object?.visible).map(object=>{
     const box=new window.__combatThree.Box3().setFromObject(object),points=[];
     for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new window.__combatThree.Vector3(x,y,z).project(v.camera));
     return {floor:box.min.y,projected:{minX:Math.min(...points.map(point=>point.x)),maxX:Math.max(...points.map(point=>point.x)),minY:Math.min(...points.map(point=>point.y)),maxY:Math.max(...points.map(point=>point.y))}};
    });
    v.renderer.render(v.scene,v.camera);pngs[phase]={png:v.canvas.toDataURL('image/png'),frame,renderedPools,actors};
   }
   if(!app.busy){resolve({result,frames,pngs,elapsedMs:performance.now()-started});return;}
   if(performance.now()-started>15000){reject(Error('Combat did not settle '+fixture.id));return;}
   requestAnimationFrame(sample);
  };requestAnimationFrame(sample);
 }),{fixture,images});
}
let browser,context;
try{
 console.log('BRUTAL_STAGE launch');
 browser=await chromium.launch({headless:true,channel:browserChannel,timeout:30000});
 context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'no-preference',...(process.argv.includes('--video')?{recordVideo:{dir:path.join(out,'video'),size:{width:1440,height:1050}}}:{})});
 const page=await context.newPage(),errors=[],httpErrors=[];
 page.setDefaultTimeout(30000);
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 page.on('response',response=>{if(response.status()>=400)httpErrors.push({status:response.status(),url:response.url()});});
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.fill('#password',process.env.APP_PASSWORD||'12345');
 await Promise.all([page.waitForURL(new URL('/',base).href,{waitUntil:'domcontentloaded'}),page.click('button')]);
 await page.waitForFunction(()=>Boolean(window.chessApp));await page.evaluate(()=>window.chessApp.whenReady);
 await page.evaluate(async()=>{window.__combatThree=await import('/vendor/three/three.module.js');});
 await page.evaluate(()=>{const app=window.chessApp;app.setAI(false);app.view.setCamera('front');app.view.zoom(-.27);app.view.orbit(.13,-.06);});await settle(page);
 for(const fixture of fixtures){
  await page.evaluate(fen=>window.chessApp.loadFEN(fen),fixture.fen);await settle(page);
  const beforeCamera=await camera(page),beforeCount=await page.evaluate(()=>window.chessApp.view.pieces.size);
  const observed=await observe(page,fixture,{images:fixture.capture!==false});await settle(page);
  for(const [phase,entry] of Object.entries(observed.pngs)){
   entry.file=path.join(out,`brutal-${fixture.id}-${phase}.png`);fs.writeFileSync(entry.file,Buffer.from(entry.png.split(',')[1],'base64'));delete entry.png;
  }
  const evidence={id:fixture.id,beforeCamera,observed};report.fixtures.push(evidence);persist();
  assert.equal(observed.result.ok,true,fixture.id+' legal command');
  const after=await page.evaluate(()=>({metrics:window.chessApp.view.getMetrics(),squares:[...window.chessApp.view.pieces.keys()],fen:window.chessApp.game.fen()}));
  evidence.after=after;persist();
  sameCamera(await camera(page),beforeCamera,fixture.id+' exact camera restoration');
  assert.equal(after.metrics.effects,0,fixture.id+' no leaked effects');
  assert.equal(after.metrics.pieceCount,beforeCount-(fixture.capture===false?0:1));
  assert(!after.squares.includes(fixture.from)&&after.squares.includes(fixture.to),fixture.id+' committed actor squares');
  if(fixture.id==='en-passant')assert(!after.squares.includes('D5'),'en passant victim removed from actual square');
  if(fixture.id==='castle')assert(after.squares.includes('F1')&&!after.squares.includes('H1'),'castle rook moves');
  if(fixture.capture!==false){
   assert.equal(Math.max(...observed.frames.map(frame=>frame.impactCount||0)),1,fixture.id+' exactly one impact');
   for(const phase of ['approach','windup','parry','strike','defeat','recover'])assert(observed.frames.some(frame=>frame.phase===phase),fixture.id+' phase '+phase);
   assert(observed.frames.some(frame=>frame.hitStop),fixture.id+' contact hold observed');
   assert(observed.frames.some(frame=>frame.bloodParticles>0&&frame.bloodSplats>0&&frame.shards>0),fixture.id+' blood and fragments configured');
   assert(observed.frames.some(frame=>frame.cameraPunch>0),fixture.id+' camera punch requested');
   assert(observed.frames.some(frame=>frame.camera.some((value,index)=>Math.abs(value-beforeCamera.position[index])>.02)),fixture.id+' actual camera reacts');
   assert(observed.frames.filter(frame=>frame.phase==='parry').every(frame=>frame.attackerVisible&&frame.victimVisible),fixture.id+' both fighters visible during counter');
   assert.equal(observed.frames.find(frame=>frame.profile)?.profile,getCharacterAttack('mugiwara',fixture.id==='en-passant'?'pawn':fixture.id==='castle'?'king':fixture.id).style);
   for(const phase of ['impact','defeat','aftermath']){
    assert(observed.pngs[phase],fixture.id+' rendered '+phase+' frame');
    for(const actor of observed.pngs[phase].actors)assert(actor.floor>=.139,fixture.id+' grounded '+phase+' '+actor.floor);
   }
   for(const name of ['blood-droplets','impact-shards'])assert(observed.pngs.impact.renderedPools.some(pool=>pool.name===name&&pool.opacity>.1&&pool.visibleInstances>10),fixture.id+' rendered '+name);
   assert(observed.pngs.aftermath.renderedPools.some(pool=>pool.name==='blood-floor-spatter'&&pool.opacity>.1&&pool.visibleInstances>5),fixture.id+' blood actually lands on floor');
  }
  persist();console.log('BRUTAL_FIXTURE '+fixture.id);
 }
 const fixture=fixtures[0];
 await page.evaluate(fen=>window.chessApp.loadFEN(fen),fixture.fen);await observe(page,fixture);await settle(page);
 const baseline=await page.evaluate(()=>window.chessApp.view.getMetrics().resources);report.resourceBaseline=baseline;
 for(let i=0;i<12;i++){
  await page.evaluate(fen=>window.chessApp.loadFEN(fen),fixture.fen);await observe(page,fixture);await settle(page);
  const metrics=await page.evaluate(()=>window.chessApp.view.getMetrics());
  assert.equal(metrics.effects,0);assert.equal(metrics.pieceCount,3);
  assert(metrics.resources.geometries<=baseline.geometries,'stable GPU geometry '+i);assert(metrics.resources.textures<=baseline.textures,'stable GPU textures '+i);
  report.stress.push({iteration:i+1,resources:metrics.resources});persist();
 }
 console.log('BRUTAL_STAGE stress complete');
 for(const [action,phase] of [['reset','windup'],['crew','parry'],['undo','defeat']]){
  await page.evaluate(fen=>window.chessApp.loadFEN(fen),fixture.fen);await settle(page);const beforeCamera=await camera(page);
  await page.evaluate(({from,to})=>window.chessApp.commands.move({from,to},{source:'mouse'}),fixture);
  await page.waitForFunction(phase=>window.chessApp.view.getMetrics().combat?.phase===phase,phase,{polling:'raf'});
  const duration=await page.evaluate(()=>window.chessApp.view.getMetrics().combat.duration);
  assert(Number.isFinite(duration)&&duration>0,'animation reports real duration');
  if(action==='crew')await page.selectOption('#crew-select','buggy');else await page.click(action==='reset'?'#reset-button':'#undo-button');
  await settle(page);sameCamera(await camera(page),beforeCamera,action+' cancelled camera');
  await page.waitForTimeout(duration+100);
  const snapshot=await page.evaluate(()=>window.chessApp.snapshot());
  assert.equal(snapshot.metrics.effects,0);assert.equal(snapshot.metrics.pieceCount,action==='undo'?4:32);
  assert.equal(await page.evaluate(()=>window.chessApp.game.history.length),0);
  if(action==='undo')assert.equal(snapshot.fen,fixture.fen);
  sameCamera(await camera(page),beforeCamera,action+' no stale camera callback');
  report.interruptions.push({action,phase,duration,snapshot});persist();
 }
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.chessApp.view.setCamera('front'));
 await page.evaluate(fen=>window.chessApp.loadFEN(fen),fixture.fen);await settle(page);
 const mobileCamera=await camera(page),mobile=await observe(page,fixture,{images:true});await settle(page);
 for(const [phase,entry] of Object.entries(mobile.pngs)){
  entry.file=path.join(out,`brutal-mobile-${phase}.png`);fs.writeFileSync(entry.file,Buffer.from(entry.png.split(',')[1],'base64'));delete entry.png;
  for(const actor of entry.actors){assert(actor.floor>=.139,'mobile grounded');for(const axis of ['X','Y'])assert(actor.projected['min'+axis]>=-1&&actor.projected['max'+axis]<=1,'mobile actor fully framed '+phase+' '+axis);}
 }
 sameCamera(await camera(page),mobileCamera,'mobile exact camera restoration');report.mobile=mobile;persist();
 await page.emulateMedia({reducedMotion:'reduce'});await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>Boolean(window.chessApp));await page.evaluate(()=>window.chessApp.whenReady);
 await page.evaluate(()=>window.chessApp.setAI(false));await settle(page);
 await page.evaluate(fen=>window.chessApp.loadFEN(fen),fixture.fen);await settle(page);
 const beforeReducedCamera=await camera(page),start=performance.now();const reduced=await observe(page,fixture);await settle(page);
 report.reducedMotion={elapsedMs:performance.now()-start,observed:reduced};assert(report.reducedMotion.elapsedMs<700,'reduced motion fast');
 assert(reduced.frames.every(frame=>frame.effects===0),'reduced motion has no gore FX');sameCamera(await camera(page),beforeReducedCamera,'reduced motion camera');
 assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(httpErrors.length,0,JSON.stringify(httpErrors));
 report.consoleErrors=errors;report.httpErrors=httpErrors;report.passed=true;report.completedAt=new Date().toISOString();persist();
 const recording=page.video();await context.close();context=null;
 if(recording){report.video=path.join(out,'brutal-combat.webm');await recording.saveAs(report.video);persist();}
 console.log('BRUTAL_COMBAT_OK roles=6 enPassant=1 castle=1 captures=12 cameraRestores=1 cancelSafe=1 reducedMotion=1');
}catch(error){report.error=error.stack;report.passed=false;persist();console.error(error.stack);process.exitCode=1;}
finally{await context?.close();await browser?.close();}
