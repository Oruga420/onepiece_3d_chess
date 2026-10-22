import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {ChessGame} from '../src/rules.mjs';
import {CHARACTER_ATTACKS} from '../src/attacks.mjs';

// Uses the same real-password session as the deployed game. Never calls voice.
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const base = option('--base-url', process.env.BASE_URL || 'http://127.0.0.1:3044');
const stagedPilots = process.argv.includes('--staged-pilots');
const pilotRelease = process.argv.includes('--pilot-release');
const allCharacters = process.argv.includes('--all-characters');
const requestedIds = option('--ids','').split(',').map(id=>id.trim()).filter(Boolean);
const fixtureCheckOnly = process.argv.includes('--check-fixtures');
const out = path.resolve(option('--out', '.local/rigging/qa/' + (stagedPilots?'staged-pilots-':'') + new URL(base).hostname.replaceAll('.', '-')));
const channel = option('--browser-channel', process.env.BROWSER_CHANNEL || 'chrome');
fs.mkdirSync(out, {recursive:true});
const report = {base, stagedPilots, allCharacters, partial:requestedIds.length>0||!allCharacters, fullRosterVerified:false, coverage:stagedPilots?'Three staged pilot attackers; staged Luffy substitutes Marine pawn defender. Not production or all66 proof.':allCharacters?'All 66 character slots: 60 pirate attackers, 6 Marine attackers, real opposing defenders.':'Three deployed pilot attackers', startedAt:new Date().toISOString(), stagedAssets:[], assets:[], isolations:[], errors:[], httpErrors:[], providerRequests:[], fixtures:[], passed:false};
const persist = () => fs.writeFileSync(path.join(out, 'skeletal-combat.json'), JSON.stringify(report, null, 2));
let browser, browserServer, context;
const allIds=Object.keys(CHARACTER_ATTACKS),pilotIds=['mugiwara/king','mugiwara/queen','mugiwara/bishop'];
function makeFixture(id){
 const [team,role]=id.split('/'),marine=team==='marines',from=role==='knight'?(marine?'E6':'E3'):role==='rook'?(marine?'D6':'D3'):(marine?'E5':'E4'),to=marine?'D4':'D5';
 const board=Array.from({length:8},()=>Array(8).fill('')),put=(square,char)=>{board[8-Number(square[1])][square.charCodeAt(0)-65]=char;};
 if(role!=='king'||marine)put('A1','K');if(role!=='king'||!marine)put('H8','k');
 const char={king:'k',queen:'q',rook:'r',bishop:'b',knight:'n',pawn:'p'}[role];
 assert(char&&CHARACTER_ATTACKS[id],'Unknown character ID '+id);put(from,marine?char:char.toUpperCase());put(to,marine?'P':'p');
 const fen=board.map(row=>{let result='',empty=0;for(const cell of row){if(!cell)empty++;else{if(empty)result+=empty;empty=0;result+=cell;}}return result+(empty||'');}).join('/')+` ${marine?'b':'w'} - - 0 1`;
 const game=new ChessGame(fen),beforeVersion=game.version,move=game.move({from,to});
 assert(move.captured,'Fixture must capture a real enemy piece: '+id);assert.equal(game.version,beforeVersion+1);
 return {id,team,crew:marine?'mugiwara':team,role,from,to,side:marine?'marine':'pirate',expectedTurn:marine?'pirate':'marine',fen,expectedFen:game.fen(),expectedPieces:game.board.flat().filter(Boolean).length,defenderId:marine?'mugiwara/pawn':'marines/pawn'};
}
const selectedIds=requestedIds.length?requestedIds:allCharacters?allIds:pilotIds;
assert.equal(new Set(selectedIds).size,selectedIds.length,'Character IDs must be unique');
const fixtures=selectedIds.map(makeFixture);
report.requestedIds=selectedIds;report.partial=!(allCharacters&&!requestedIds.length);
if(requestedIds.length)report.coverage=`DEBUG PARTIAL: ${fixtures.length} selected character slots; never full-roster acceptance`;
async function ready(page) {
 await page.waitForFunction(() => Boolean(window.chessApp));
 await page.evaluate(() => window.chessApp.whenReady);
 await page.evaluate(() => window.chessApp.setAI(false));
 await page.waitForFunction(() => !window.chessApp.busy);
}
async function setup(page, fixture) {
 await page.evaluate(async ({fen,crew}) => {
  const app = window.chessApp;
  if (app.crew !== crew) await app.setCrew(crew);
  await app.loadFEN(fen);
 }, fixture);
 await page.waitForFunction(() => !window.chessApp.busy);
}
async function capture(page, fixture, {cancel=false, reduced=false}={}) {
 const result = await page.evaluate(async ({cancel,reduced,fixture}) => {
  const THREE = await import('/vendor/three/three.module.js');
  const app = window.chessApp, view = app.view, attacker = view.pieces.get(fixture.from), defender = view.pieces.get(fixture.to);
  if(!attacker||!defender)throw Error('Missing capture participants '+fixture.id);
  const before={fen:app.game.fen(),version:app.game.version,history:app.game.history.length,resources:{...view.renderer.info.memory},attackerIdentity:{...attacker.userData.piece},defenderIdentity:{...defender.userData.piece}};
  const canonical = name => name.replace(/[_.]/g, '').toLowerCase();
  function track(root) {
   const bones = [], samples = [];let rigSettings={};
   root.traverse(object => {
    if(object.userData.combatRig)rigSettings=structuredClone(object.userData.combatRig);
    if (object.isBone) bones.push({object, name:canonical(object.name), quaternion:object.quaternion.clone(), position:object.position.clone(), scale:object.scale.clone()});
    if (object.isSkinnedMesh) {
     const attributes = object.geometry.attributes;
     for (const [joint,bone] of object.skeleton.bones.entries()) {
      const name=canonical(bone.name);if(!/^(upperarm|forearm|upperleg|lowerleg)[lr]\d*$/.test(name))continue;
      const pivot=object.worldToLocal(bone.getWorldPosition(new THREE.Vector3())),point=new THREE.Vector3();
      let best = -1, maximum = 0;
      for (let i=0; i<attributes.position.count; i++) {
       let sum=0;
       for (let slot=0; slot<4; slot++) if (attributes.skinIndex.array[i*4+slot]===joint) sum+=attributes.skinWeight.array[i*4+slot];
       // A vertex exactly at the joint pivot cannot demonstrate deformation.
       const score=sum*point.fromBufferAttribute(attributes.position,i).distanceToSquared(pivot);
       if (sum>0 && score>maximum) {maximum=score; best=i;}
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
   return {sample,restored,boneCount:bones.length,samples:samples.length,restSize:restSize.toArray(),rigSettings};
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
  before.resources={...view.renderer.info.memory};
  const move=app.commands.move({from:fixture.from,to:fixture.to},{source:'mouse'});
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
  return {move,frames,images,imageBounds,before,after:{version:app.game.version,history:app.game.history.length,resources:{...view.renderer.info.memory}},attackId:view.getMetrics().combat?.characterAttack,elapsedMs:performance.now()-started,attackerRestored:a.restored(),defenderRestored:d.restored(),attackerBoneCount:a.boneCount,defenderBoneCount:d.boneCount,attackerRestSize:a.restSize,defenderRestSize:d.restSize,attackerRigSettings:a.rigSettings,defenderRigSettings:d.rigSettings,weightedSamples:a.samples,defenderWeightedSamples:d.samples,fen:app.game.fen(),turn:app.game.turn,pieces:[...view.pieces.keys()],pieceCount:view.pieces.size,busy:app.busy,effects:view.getMetrics().effects,remainingEffects:['chess-combat-effects','character-attack-effects'].filter(name=>view.scene.getObjectByName(name)),reduced,canceled:didCancel};
 },{cancel,reduced,fixture});
 for (const [phase,png] of Object.entries(result.images||{})) {
  const file=path.join(out,`${fixture.id.replace('/','-')}-${cancel?'cancel-':reduced?'reduced-':''}${phase}.png`);
  fs.writeFileSync(file,Buffer.from(png.split(',')[1],'base64'));result.images[phase]=file;
 }
 return result;
}
function verify(result, fixture, {cancel=false,reduced=false}={}) {
 const id=fixture.id;
 assert.equal(result.move.ok,true,id+' legal capture');
 assert.equal(result.before.attackerIdentity.type,fixture.role,id+' actual role');assert.equal(result.before.attackerIdentity.player,fixture.side,id+' actual side');
 assert(result.attackerBoneCount>=17,id+' real attacker skeleton');
 if(!pilotRelease)assert(result.defenderBoneCount>=17,id+' real defender skeleton');
 for (const [width,height,depth] of [result.attackerRestSize,result.defenderRestSize]) assert(height<=.9001 && Math.max(width,depth)<=.7201,id+' actual skinned rest vertices fit the chess square');
 assert(result.weightedSamples>=4,id+' mesh vertices weighted to arms and legs');
 assert(result.attackerRestored && result.defenderRestored,id+' exact rest pose restored on saved live instances');
 assert.equal(result.effects,0,id+' effects cleanup');
 assert.deepEqual(result.remainingEffects,[],id+' temporary scene objects disposed');
 assert.equal(result.busy,false,id+' animation completes');
 assert(result.frames.every(frame=>frame.attacker.finite&&frame.defender.finite),id+' finite joint/vertex transforms');
 if (cancel) {assert.equal(result.canceled,true);assert.equal(result.pieceCount,32);return;}
 assert.equal(result.attackId,id,id+' character-specific choreography identity');
 assert(!result.pieces.includes(fixture.from) && result.pieces.includes(fixture.to),id+' capture updates board');
 assert.equal(result.fen,fixture.expectedFen,id+' exact authoritative position after capture');
 assert.equal(result.pieceCount,fixture.expectedPieces,id+' captured piece removed once');
 assert.equal(result.turn,fixture.expectedTurn,id+' correct side receives the turn');
 assert.equal(result.after.version,result.before.version+1,id+' state advances exactly once');
 assert.equal(result.after.history,result.before.history+1,id+' exactly one move recorded');
 for(const resource of ['geometries','textures'])assert(result.after.resources[resource]<=result.before.resources[resource],id+' '+resource+' reclaimed after capture');
 if (reduced) {assert(result.elapsedMs<700,id+' reduced motion is immediate');return;}
 // Quadruped forelimbs use the arm chains. Dresses may have bounded leg arcs,
 // but must still demonstrate real joint and skin motion at the same thresholds.
 const missing=new Set((result.attackerRigSettings.missingLimbs||[]).map(side=>String(side).toLowerCase()));
 assert(missing.size<2,id+' cannot exempt both arm chains');
 for (const chain of ['upperarm','forearm','upperleg','lowerleg'])for(const side of ['l','r']) {
  if(chain.includes('arm')&&missing.has(side))continue;
  const name=chain+side;
  assert(result.frames.some(frame=>frame.attacker.angles[name]>.06),id+' actual '+name+' rotation; settings='+JSON.stringify(result.attackerRigSettings));
 }
 const extraNames=Object.keys(result.frames[0]?.attacker.angles||{}).filter(name=>/^(upperarm|forearm|upperleg|lowerleg)[lr][2-9]\d*$/.test(name));
 for(const name of extraNames){assert(result.frames.some(frame=>frame.attacker.angles[name]>.06),id+' extra joint '+name+' rotates');assert(result.frames.some(frame=>frame.attacker.displacements.some(d=>d.limb===name&&d.distance>.002)),id+' extra joint '+name+' deforms real vertices');}
 if(!pilotRelease)assert(result.frames.some(frame=>frame.progress>=.25&&frame.progress<.5&&Object.entries(frame.defender.angles).some(([name,angle])=>name.startsWith('forearm')&&angle>.06)),id+' defender raises a guard');
 for (const limb of ['upperarm','upperleg']) assert(result.frames.some(frame=>frame.attacker.displacements.some(d=>d.limb.startsWith(limb)&&d.distance>.002)),id+' actual '+limb+' skin deformation');
 if(!pilotRelease){assert(result.defenderWeightedSamples>=4,id+' real weighted defender');assert(result.frames.some(frame=>frame.defender.displacements.some(d=>d.limb.startsWith('upperarm')&&d.distance>.002)),id+' defender guard deforms actual arm vertices');}
 assert(result.images.guard && result.images.strike,id+' unobstructed guard and contact screenshots');
}
async function verifyIsolation(page, fixture){
 await page.evaluate(crew=>window.chessApp.setCrew(crew),fixture.crew);
 await page.evaluate(()=>new Promise(requestAnimationFrame));
 const result=await page.evaluate(()=>['pirate','marine'].map(side=>{
  const pieces=[...window.chessApp.view.pieces.values()].filter(piece=>piece.userData.piece.type==='pawn'&&piece.userData.piece.player===side);
  const meshes=pieces.map(piece=>{const entries=[];piece.traverse(object=>{if(object.isSkinnedMesh)entries.push(object);});return entries;});
  const skeletons=meshes.map(entries=>new Set(entries.map(mesh=>mesh.skeleton))),bones=skeletons.map(entries=>new Set([...entries].flatMap(skeleton=>skeleton.bones)));
  const disjoint=sets=>sets.every((set,i)=>sets.slice(i+1).every(other=>[...set].every(value=>!other.has(value))));
  return {side,pieces:pieces.length,skinned:meshes.filter(entries=>entries.length).length,meshesPerPiece:meshes.map(entries=>entries.length),uniqueSkeletons:new Set(skeletons.flatMap(set=>[...set])).size,isolatedSkeletons:disjoint(skeletons),isolatedBones:disjoint(bones),sharedGeometry:meshes.every(entries=>entries.length===meshes[0].length&&entries.every((mesh,i)=>mesh.geometry===meshes[0][i].geometry))};
 }));
 const entry={team:fixture.team,crew:fixture.crew,sides:result};report.isolations.push(entry);persist();
 for(const side of result){assert.equal(side.pieces,8,fixture.team+' '+side.side+' eight pawns');assert.equal(side.skinned,8);assert(side.uniqueSkeletons>=8&&side.isolatedSkeletons&&side.isolatedBones,fixture.team+' independent pawn bones/skeletons');assert(side.sharedGeometry,fixture.team+' pawn geometry remains shared');}
}
async function provenance(cookie){
 const headers={Cookie:cookie};
 const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,'health endpoint');report.buildBefore=await response.json();
 const expected=option('--expected-build',null);if(expected)assert.equal(report.buildBefore.build,expected,'expected deployment revision');
 const manifestResponse=await fetch(base+'/assets/models/manifest.json',{headers,signal:AbortSignal.timeout(30000)});assert.equal(manifestResponse.status,200,'authenticated model manifest');
 const bytes=Buffer.from(await manifestResponse.arrayBuffer()),manifest=JSON.parse(bytes.toString());report.manifestSha256=createHash('sha256').update(bytes).digest('hex');
 const wanted=new Set([...selectedIds,...fixtures.map(f=>f.defenderId)]);
 const entries=manifest.assets.filter(asset=>wanted.has(asset.id));assert.equal(entries.length,wanted.size,'every selected asset in manifest');
 for(let start=0;start<entries.length;start+=4){
  const batch=await Promise.all(entries.slice(start,start+4).map(async asset=>{
   const url=new URL(asset.path,base);assert.equal(url.origin,new URL(base).origin,'same-origin model provenance');
   const response=await fetch(url,{headers,signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,asset.id+' authenticated GLB');
   const bytes=Buffer.from(await response.arrayBuffer()),sha256=createHash('sha256').update(bytes).digest('hex');
   assert.equal(sha256,asset.sha256,asset.id+' served bytes match manifest');return {id:asset.id,url:url.href,sha256,bytes:bytes.length,rig:asset.rig||null};
  }));report.assets.push(...batch);persist();
 }
}
try {
 assert.equal(allIds.length,66,'canonical attack roster must contain66 unique IDs');
 assert(!(allCharacters&&(pilotRelease||stagedPilots)),'Full-roster mode cannot use pilot exemptions or substitute assets');
 assert(!stagedPilots||selectedIds.every(id=>pilotIds.includes(id)),'Staged mode supports only its three declared pilot assets');
 if(fixtureCheckOnly){
  const allFixtures=allIds.map(makeFixture);
  report.fixtureLegality={checked:allFixtures.length,pirate:allFixtures.filter(f=>f.side==='pirate').length,marine:allFixtures.filter(f=>f.side==='marine').length,fixtures:allFixtures};
  assert.equal(report.fixtureLegality.pirate,60);assert.equal(report.fixtureLegality.marine,6);
  assert.equal(new Set(allFixtures.map(f=>f.team)).size,11);report.coverage='Offline fixture legality only; no browser, skin, asset or production verification';report.passed=true;persist();console.log('SKELETAL_FIXTURES_OK legalCaptures=66 pirate=60 marine=6');
 }else{
 if(pilotRelease){assert(!stagedPilots,'Production pilot verification cannot substitute assets');report.coverage='Three published articulated attackers with original rigid Marine defender; full66 articulation remains pending';report.pilotRelease=true;}
 browserServer=await chromium.launchServer({headless:true,channel,timeout:45000});
 report.runnerPid=process.pid;report.browserPid=browserServer.process().pid;
 browser=await chromium.connect(browserServer.wsEndpoint());
 context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'no-preference'});
 await context.route('**/api/voice/**',route=>{report.providerRequests.push(route.request().url());return route.abort();});
 await context.route(/^https:\/\/(?:api\.elevenlabs\.io|api\.replicate\.com|api\.meshy\.ai|api\.openai\.com)\//,route=>{report.providerRequests.push(route.request().url());return route.abort();});
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
 if(!stagedPilots)await provenance(cookie);
 await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:base,httpOnly:true,sameSite:'Lax',secure:base.startsWith('https:')}]);
 const page=await context.newPage();page.setDefaultTimeout(60000);
 page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 page.on('response',response=>{if(response.status()>=400)report.httpErrors.push({status:response.status(),url:response.url()});});
 await page.goto(base+'/',{waitUntil:'commit'});await ready(page);
 if(stagedPilots||pilotRelease)report.isolation={skippedReason:'Explicit pilot coverage: unreleased pawn rigs are not asserted'};
 await page.evaluate(()=>window.chessApp.combatAudio.setEnabled(false));
 const isolated=new Set();
 for (const fixture of fixtures) {
  if(!stagedPilots&&!pilotRelease&&!isolated.has(fixture.team)){await verifyIsolation(page,fixture);isolated.add(fixture.team);}
  await setup(page,fixture);const result=await capture(page,fixture);report.fixtures.push({id:fixture.id,fixture,result});persist();verify(result,fixture);console.log('SKELETAL_OK '+fixture.id);
 }
 await setup(page,fixtures[0]);report.cancel=await capture(page,fixtures[0],{cancel:true});persist();verify(report.cancel,fixtures[0],{cancel:true});
 await page.waitForTimeout(3800);assert.equal(await page.evaluate(()=>window.chessApp.view.pieces.size),32,'stale capture does not overwrite reset');
 await page.emulateMedia({reducedMotion:'reduce'});await page.reload({waitUntil:'commit'});await ready(page);await page.evaluate(()=>window.chessApp.combatAudio.setEnabled(false));
 await setup(page,fixtures[0]);report.reducedMotion=await capture(page,fixtures[0],{reduced:true});persist();verify(report.reducedMotion,fixtures[0],{reduced:true});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);assert.deepEqual(report.providerRequests,[]);
 if(!stagedPilots){const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);report.buildAfter=await response.json();assert.equal(report.buildAfter.build,report.buildBefore.build,'deployment unchanged during verification');}
 if(allCharacters&&!requestedIds.length){assert.equal(report.fixtures.length,66);assert.deepEqual(report.fixtures.map(f=>f.id).sort(),[...allIds].sort());assert.equal(report.isolations.length,11);assert.equal(report.assets.length,66);report.fullRosterVerified=true;}
 report.passed=true;report.completedAt=new Date().toISOString();persist();console.log(`SKELETAL_COMBAT_OK fullRoster=${report.fullRosterVerified} partial=${report.partial} staged=${stagedPilots} pilotRelease=${pilotRelease} captures=${report.fixtures.length} reset=1 reducedMotion=1`);
 }
} catch (error) {report.error=error.stack;persist();console.error(error.stack);process.exitCode=1;}
finally {
 const ownedProcess=browserServer?.process();
 if(process.platform==='win32'&&ownedProcess?.exitCode===null){
  try{execFileSync('taskkill',['/PID',String(ownedProcess.pid),'/T','/F'],{stdio:'ignore',timeout:5000});report.cleanup='owned browser tree terminated';}
  catch{report.cleanup='owned browser termination unconfirmed';}
 }else{let timer;try{await Promise.race([browserServer?.close(),new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);}finally{clearTimeout(timer);}}
 persist();process.exit(process.exitCode||0);
}
