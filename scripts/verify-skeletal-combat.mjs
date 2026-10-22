import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';

// Uses the same real-password session as the deployed game. Never calls voice.
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const base = option('--base-url', process.env.BASE_URL || 'http://127.0.0.1:3044');
const stagedPilots = process.argv.includes('--staged-pilots');
const pilotRelease = process.argv.includes('--pilot-release');
const out = path.resolve(option('--out', '.local/rigging/qa/' + (stagedPilots?'staged-pilots-':'') + new URL(base).hostname.replaceAll('.', '-')));
const channel = option('--browser-channel', process.env.BROWSER_CHANNEL || 'chrome');
fs.mkdirSync(out, {recursive:true});
const report = {base, stagedPilots, coverage:stagedPilots?'Three staged pilot attackers; staged Luffy substitutes Marine pawn defender. Not production or all66 proof.':'Deployed character assets and independent pawn instances', startedAt:new Date().toISOString(), stagedAssets:[], errors:[], httpErrors:[], providerRequests:[], fixtures:[], passed:false};
const persist = () => fs.writeFileSync(path.join(out, 'skeletal-combat.json'), JSON.stringify(report, null, 2));
let browser, browserServer, context;
const fixtures = [
 {id:'mugiwara/king', fen:'7k/8/8/3p4/4K3/8/8/8 w - - 0 1'},
 {id:'mugiwara/queen', fen:'7k/8/8/3p4/4Q3/8/8/K7 w - - 0 1'},
 {id:'mugiwara/bishop', fen:'7k/8/8/3p4/4B3/8/8/K7 w - - 0 1'},
];
async function ready(page) {
 await page.waitForFunction(() => Boolean(window.chessApp));
 await page.evaluate(() => window.chessApp.whenReady);
 await page.evaluate(() => window.chessApp.setAI(false));
 await page.waitForFunction(() => !window.chessApp.busy);
}
async function setup(page, fixture) {
 await page.evaluate(async fen => {
  const app = window.chessApp;
  if (app.crew !== 'mugiwara') await app.setCrew('mugiwara');
  await app.loadFEN(fen);
 }, fixture.fen);
 await page.waitForFunction(() => !window.chessApp.busy);
}
async function capture(page, fixture, {cancel=false, reduced=false}={}) {
 const result = await page.evaluate(async ({cancel,reduced}) => {
  const THREE = await import('/vendor/three/three.module.js');
  const app = window.chessApp, view = app.view, attacker = view.pieces.get('E4'), defender = view.pieces.get('D5');
  const canonical = name => name.replace(/[_.]/g, '').toLowerCase();
  function track(root) {
   const bones = [], samples = [];
   root.traverse(object => {
    if (object.isBone) bones.push({object, name:canonical(object.name), quaternion:object.quaternion.clone(), position:object.position.clone(), scale:object.scale.clone()});
    if (object.isSkinnedMesh) {
     const attributes = object.geometry.attributes;
     for (const name of ['upper_arm','forearm','upper_leg','lower_leg']) {
      const joints = new Set(object.skeleton.bones.flatMap((bone,i) => canonical(bone.name).startsWith(canonical(name)) ? [i] : []));
      let best = -1, maximum = 0;
      for (let i=0; i<attributes.position.count; i++) {
       let sum=0;
       for (let slot=0; slot<4; slot++) if (joints.has(attributes.skinIndex.array[i*4+slot])) sum+=attributes.skinWeight.array[i*4+slot];
       if (sum>maximum) {maximum=sum; best=i;}
      }
      if (best>=0) samples.push({mesh:object,index:best,limb:name,rest:object.getVertexPosition(best,new THREE.Vector3())});
     }
    }
   });
   function sample() {
    root.updateWorldMatrix(true,true);
    for (const mesh of new Set(samples.map(sample=>sample.mesh))) mesh.updateMatrixWorld(true);
    const angles = Object.fromEntries(bones.map(b => [b.name,b.object.quaternion.angleTo(b.quaternion)]));
    const displacements = samples.map(s => ({limb:s.limb,distance:s.mesh.getVertexPosition(s.index,new THREE.Vector3()).distanceTo(s.rest)}));
    return {angles,displacements,finite:[...Object.values(angles),...displacements.map(d=>d.distance)].every(Number.isFinite)};
   }
   function restored() {
    return bones.every(b => b.object.position.equals(b.position) && b.object.quaternion.equals(b.quaternion) && b.object.scale.equals(b.scale));
   }
   const restSize=new THREE.Box3().setFromObject(root,true).getSize(new THREE.Vector3());
   return {sample,restored,boneCount:bones.length,samples:samples.length,restSize:restSize.toArray()};
  }
  view.scene.updateMatrixWorld(true);
  const a=track(attacker), d=track(defender), frames=[], images={}, imageBounds={}, started=performance.now();
  function screenshot(phase) {
   const camera = view.camera, saved={position:camera.position.clone(),quaternion:camera.quaternion.clone(),zoom:camera.zoom};
   view.scene.updateMatrixWorld(true);
   const bounds=new THREE.Box3().setFromObject(attacker,true).union(new THREE.Box3().setFromObject(defender,true));
   const target=bounds.getCenter(new THREE.Vector3()), size=bounds.getSize(new THREE.Vector3());
   imageBounds[phase]={min:bounds.min.toArray(),max:bounds.max.toArray(),size:size.toArray()};
   const halfFov=THREE.MathUtils.degToRad(camera.fov/2), distance=size.length()*.58/Math.sin(Math.min(halfFov,Math.atan(Math.tan(halfFov)*camera.aspect)));
   camera.position.copy(target).addScaledVector(new THREE.Vector3(2.2,1.3,2.5).normalize(),distance);camera.lookAt(target);camera.zoom=1;camera.updateProjectionMatrix();
   const effects=['chess-combat-effects','character-attack-effects'].map(name=>view.scene.getObjectByName(name)).filter(Boolean);
   const visible=effects.map(object=>object.visible);effects.forEach(object=>{object.visible=false;});
   view.renderer.render(view.scene,camera);images[phase]=view.canvas.toDataURL('image/png');
   effects.forEach((object,i)=>{object.visible=visible[i];});camera.position.copy(saved.position);camera.quaternion.copy(saved.quaternion);camera.zoom=saved.zoom;camera.updateProjectionMatrix();
  }
  screenshot('rest');
  const move=app.commands.move({from:'E4',to:'D5'},{source:'mouse'});
  if (!move.ok) return {move};
  let didCancel=false;
  await new Promise((resolve,reject) => {
   function sample() {
    const metrics=view.getMetrics().combat||{}, progress=metrics.progress||0;
    frames.push({at:performance.now()-started,progress,phase:metrics.phase,attacker:a.sample(),defender:d.sample(),articulation:metrics.articulation ? structuredClone(metrics.articulation) : null});
    if (progress>=.30 && progress<.43 && !images.guard) screenshot('guard');
    if (progress>=.62 && progress<.71 && !images.strike) screenshot('strike');
    if (cancel && progress>=.33 && !didCancel) {didCancel=true;document.getElementById('reset-button').click();}
    if (!app.busy) {resolve();return;}
    if (performance.now()-started>18000) {reject(Error('Skeletal capture timed out'));return;}
    requestAnimationFrame(sample);
   }
   requestAnimationFrame(sample);
  });
  return {move,frames,images,imageBounds,elapsedMs:performance.now()-started,attackerRestored:a.restored(),defenderRestored:d.restored(),attackerBoneCount:a.boneCount,defenderBoneCount:d.boneCount,attackerRestSize:a.restSize,defenderRestSize:d.restSize,weightedSamples:a.samples,fen:app.game.fen(),turn:app.game.turn,pieces:[...view.pieces.keys()],pieceCount:view.pieces.size,busy:app.busy,effects:view.getMetrics().effects,reduced,canceled:didCancel};
 },{cancel,reduced});
 for (const [phase,png] of Object.entries(result.images||{})) {
  const file=path.join(out,`${fixture.id.replace('/','-')}-${cancel?'cancel-':reduced?'reduced-':''}${phase}.png`);
  fs.writeFileSync(file,Buffer.from(png.split(',')[1],'base64'));result.images[phase]=file;
 }
 return result;
}
function verify(result, id, {cancel=false,reduced=false}={}) {
 assert.equal(result.move.ok,true,id+' legal capture');
 assert(result.attackerBoneCount>=17,id+' real attacker skeleton');
 if(!pilotRelease)assert(result.defenderBoneCount>=17,id+' real defender skeleton');
 for (const [width,height,depth] of [result.attackerRestSize,result.defenderRestSize]) assert(height<=.9001 && Math.max(width,depth)<=.7201,id+' actual skinned rest vertices fit the chess square');
 assert(result.weightedSamples>=4,id+' mesh vertices weighted to arms and legs');
 assert(result.attackerRestored && result.defenderRestored,id+' exact rest pose restored on saved live instances');
 assert.equal(result.effects,0,id+' effects cleanup');
 assert.equal(result.busy,false,id+' animation completes');
 assert(result.frames.every(frame=>frame.attacker.finite&&frame.defender.finite),id+' finite joint/vertex transforms');
 if (cancel) {assert.equal(result.canceled,true);assert.equal(result.pieceCount,32);return;}
 assert(!result.pieces.includes('E4') && result.pieces.includes('D5'),id+' capture updates board');
 assert.equal(result.turn,'marine',id+' turn advances exactly once');
 if (reduced) {assert(result.elapsedMs<700,id+' reduced motion is immediate');return;}
 for (const chain of ['upperarm','forearm','upperleg','lowerleg']) {
  assert(result.frames.some(frame=>Object.entries(frame.attacker.angles).some(([name,angle])=>name.startsWith(chain)&&angle>.06)),id+' actual '+chain+' rotation');
 }
 if(!pilotRelease)assert(result.frames.some(frame=>frame.progress>=.25&&frame.progress<.5&&Object.entries(frame.defender.angles).some(([name,angle])=>name.startsWith('forearm')&&angle>.06)),id+' defender raises a guard');
 for (const limb of ['upper_arm','upper_leg']) assert(result.frames.some(frame=>frame.attacker.displacements.some(d=>d.limb===limb&&d.distance>.002)),id+' actual '+limb+' skin deformation');
 assert(result.images.guard && result.images.strike,id+' unobstructed guard and contact screenshots');
}
try {
 if(pilotRelease){assert(!stagedPilots,'Production pilot verification cannot substitute assets');report.coverage='Three published articulated attackers with original rigid Marine defender; full66 articulation remains pending';report.pilotRelease=true;}
 browserServer=await chromium.launchServer({headless:true,channel,timeout:45000});
 report.runnerPid=process.pid;report.browserPid=browserServer.process().pid;
 browser=await chromium.connect(browserServer.wsEndpoint());
 context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'no-preference'});
 await context.route('**/api/voice/**',route=>{report.providerRequests.push(route.request().url());return route.abort();});
 if (stagedPilots) {
  assert(['127.0.0.1','localhost'].includes(new URL(base).hostname),'staged fixtures only run against localhost');
  for (const [servedId,candidateId] of [['mugiwara/king','mugiwara/king'],['mugiwara/queen','mugiwara/queen'],['mugiwara/bishop','mugiwara/bishop'],['marines/pawn','mugiwara/king']]) {
   const file=path.resolve('.local/rigging/candidates',candidateId+'.glb'),bytes=fs.readFileSync(file);
   report.stagedAssets.push({servedId,candidateId,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
   await context.route('**/assets/models/'+servedId+'.glb',route=>route.fulfill({status:200,contentType:'model/gltf-binary',body:bytes}));
  }
 }
 const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:process.env.APP_PASSWORD||'12345'}),signal:AbortSignal.timeout(30000)});
 assert.equal(login.status,200,'real password login');report.loginStatus=login.status;
 const cookie=login.headers.get('set-cookie').split(';')[0],separator=cookie.indexOf('=');
 await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:base,httpOnly:true,sameSite:'Lax',secure:base.startsWith('https:')}]);
 const page=await context.newPage();page.setDefaultTimeout(60000);
 page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 page.on('response',response=>{if(response.status()>=400)report.httpErrors.push({status:response.status(),url:response.url()});});
 await page.goto(base+'/',{waitUntil:'commit'});await ready(page);
 report.isolation=await page.evaluate(()=>{
  const pieces=[...window.chessApp.view.pieces.values()].filter(piece=>piece.userData.piece.type==='pawn'&&piece.userData.piece.player==='pirate');
  const meshes=pieces.map(piece=>{let found;piece.traverse(object=>{if(!found&&object.isSkinnedMesh)found=object;});return found;});
  return {pieces:pieces.length,skinned:meshes.filter(Boolean).length,uniqueSkeletons:new Set(meshes.map(mesh=>mesh?.skeleton)).size,uniqueFirstBones:new Set(meshes.map(mesh=>mesh?.skeleton.bones[0])).size,sharedGeometry:meshes.every(mesh=>mesh?.geometry===meshes[0]?.geometry)};
 });
 if (!stagedPilots&&!pilotRelease) {assert.equal(report.isolation.pieces,8);assert.equal(report.isolation.skinned,8);assert.equal(report.isolation.uniqueSkeletons,8);assert.equal(report.isolation.uniqueFirstBones,8);assert.equal(report.isolation.sharedGeometry,true);}
 else report.isolation.skippedReason='Pirate pawns are original unrigged assets in staged pilot review';
 persist();
 await page.evaluate(()=>window.chessApp.combatAudio.setEnabled(false));
 for (const fixture of fixtures) {
  await setup(page,fixture);const result=await capture(page,fixture);report.fixtures.push({id:fixture.id,result});persist();verify(result,fixture.id);console.log('SKELETAL_OK '+fixture.id);
 }
 await setup(page,fixtures[0]);report.cancel=await capture(page,fixtures[0],{cancel:true});persist();verify(report.cancel,'reset',{cancel:true});
 await page.waitForTimeout(3800);assert.equal(await page.evaluate(()=>window.chessApp.view.pieces.size),32,'stale capture does not overwrite reset');
 await page.emulateMedia({reducedMotion:'reduce'});await page.reload({waitUntil:'commit'});await ready(page);await page.evaluate(()=>window.chessApp.combatAudio.setEnabled(false));
 await setup(page,fixtures[0]);report.reducedMotion=await capture(page,fixtures[0],{reduced:true});persist();verify(report.reducedMotion,'reduced-motion',{reduced:true});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);assert.deepEqual(report.providerRequests,[]);
 report.passed=true;report.completedAt=new Date().toISOString();persist();console.log(`SKELETAL_COMBAT_OK staged=${stagedPilots} pilotRelease=${pilotRelease} real limbs=3 guard=${pilotRelease?'rigid-defender':1} skin displacement=1 independent skeletons=${stagedPilots||pilotRelease?'unit-tested':8} reset=1 reducedMotion=1`);
} catch (error) {report.error=error.stack;persist();console.error(error.stack);process.exitCode=1;}
finally {
 const ownedProcess=browserServer?.process();
 if(process.platform==='win32'&&ownedProcess?.exitCode===null){
  try{execFileSync('taskkill',['/PID',String(ownedProcess.pid),'/T','/F'],{stdio:'ignore',timeout:5000});report.cleanup='owned browser tree terminated';}
  catch{report.cleanup='owned browser termination unconfirmed';}
 }else{let timer;try{await Promise.race([browserServer?.close(),new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);}finally{clearTimeout(timer);}}
 persist();process.exit(process.exitCode||0);
}
