import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {ChessGame} from '../src/rules.mjs';
import {packGame} from '../src/online-state.mjs';
import {base,out,save,openGame,closeBrowser,assertModels,settle} from './browser-utils.mjs';

const captureFEN='4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';
const report={base,startedAt:new Date().toISOString(),captures:[],races:[],passed:false};
// Observe the rendered miniatures throughout combat, independently of the sampler.
async function startObservedCapture(page){
  return page.evaluate(()=>{
    const app=window.chessApp,attacker=app.view.pieces.get('E4'),victim=app.view.pieces.get('D5');
    const actor=object=>({position:object.position.toArray(),rotation:object.rotation.toArray().slice(0,3),bodyPosition:object.children[0].position.toArray(),bodyRotation:object.children[0].rotation.toArray().slice(0,3),scale:object.scale.toArray(),visible:object.visible});
    const sample=()=>({combat:{...app.view.getMetrics().combat},attacker:actor(attacker),victim:actor(victim),effects:app.view.getMetrics().effects});
    window.__combatObservation={initial:sample(),frames:[],done:false};
    const observed=window.__combatObservation,started=performance.now();
    const record=()=>{const frame=sample();observed.frames.push(frame);if(!observed.impactPng&&frame.combat.phase==='strike'&&frame.combat.progress>=.615){app.view.renderer.render(app.view.scene,app.view.camera);observed.impactPng=app.view.canvas.toDataURL('image/png');}if(!app.busy||performance.now()-started>15000){observed.done=true;return;}requestAnimationFrame(record);};
    const result=app.commands.move({from:'E4',to:'D5'},{source:'mouse'});
    requestAnimationFrame(record);return result;
  });
}
async function phase(page,names){await page.waitForFunction(names=>names.includes(window.chessApp.view.getMetrics().combat?.phase),names,{timeout:15000,polling:'raf'});}
let browser,context;
try {
  const session=await openGame({video:true});
  ({browser,context}=session);
  const {page,errors,httpErrors}=session;
  let repeatedManifestRequests=0;
  page.on('request',request=>{if(new URL(request.url()).pathname==='/assets/models/manifest.json')repeatedManifestRequests++;});
  page.setDefaultTimeout(30000);
  await assertModels(page);
  await page.click('#sound-toggle');
  await page.evaluate(()=>window.chessApp.setAI(false));
  await settle(page);
  await page.evaluate(fen=>window.chessApp.loadFEN(fen),captureFEN);
  await page.screenshot({path:path.join(out,'capture-before.png'),fullPage:true});
  assert.equal((await startObservedCapture(page)).ok,true);
  await settle(page);
  await page.waitForFunction(()=>window.__combatObservation.done);
  const observed=await page.evaluate(()=>window.__combatObservation);
  if(observed.impactPng){fs.writeFileSync(path.join(out,'capture-impact.png'),Buffer.from(observed.impactPng.split(',')[1],'base64'));delete observed.impactPng;}
  report.observed=observed;
  const phases=[...new Set(observed.frames.map(frame=>frame.combat.phase))];
  for(const expected of ['approach','windup','parry','strike','defeat','recover'])assert(phases.includes(expected),'missing rendered combat phase '+expected);
  const facing=observed.frames.filter(frame=>['windup','parry'].includes(frame.combat.phase));
  assert(facing.length>1&&facing.every(frame=>frame.victim.visible),'both fighters remain visible during faceoff');
  const defending=observed.frames.filter(frame=>frame.combat.phase==='parry');
  assert(defending.some(frame=>frame.victim.bodyRotation.some((value,index)=>Math.abs(value-observed.initial.victim.bodyRotation[index])>.01)||frame.victim.bodyPosition.some((value,index)=>Math.abs(value-observed.initial.victim.bodyPosition[index])>.01)),'defender visibly reacts before defeat');
  assert(observed.frames.some(frame=>frame.attacker.rotation.some((value,index)=>Math.abs(value-observed.initial.attacker.rotation[index])>.01)),'attacker turns or tilts to strike');
  assert.equal(Math.max(...observed.frames.map(frame=>frame.combat.impactCount||0)),1,'exactly one combat impact');
  assert(observed.frames.some(frame=>frame.effects>0),'visible effect objects exist during combat');
  const final=await page.evaluate(()=>({metrics:window.chessApp.view.getMetrics(),legal:window.chessApp.game.board[4][3]?.player==='pirate'&&!window.chessApp.game.board[3][4],piece:window.chessApp.view.pieces.get('D5')?.position.toArray()}));
  assert(final.legal,'rendered fight must preserve the committed legal capture');
  assert.deepEqual(final.piece,[-.5,.17,-.5]);
  assert.equal(await page.evaluate(()=>window.chessApp.view.getMetrics().effects),0);
  assert.equal(await page.evaluate(()=>window.chessApp.view.getMetrics().pieceCount),3);
  await page.screenshot({path:path.join(out,'capture-after.png'),fullPage:true});
  report.combat={phases,observed,final};
  const baseline=await page.evaluate(()=>window.chessApp.view.getMetrics().resources);
  for(let i=0;i<30;i++){
    await page.evaluate(fen=>window.chessApp.loadFEN(fen),captureFEN);
    await page.evaluate(()=>window.chessApp.commands.move({from:'E4',to:'D5'},{source:'mouse'}));
    await settle(page);
    const metrics=await page.evaluate(()=>window.chessApp.view.getMetrics());
    assert.equal(metrics.pieceCount,3);
    assert.equal(metrics.effects,0);
    assert(metrics.resources.geometries<=baseline.geometries+2,'GPUgeometrygrowth');
    assert(metrics.resources.textures<=baseline.textures+2,'GPUtexturegrowth');
    report.captures.push({iteration:i+1,resources:metrics.resources});
  }
  report.captureResources={baseline,after:report.captures.at(-1).resources};
  for(const [action,combatPhase] of [['reset','windup'],['crew','parry'],['undo','defeat']]){
    await page.evaluate(fen=>window.chessApp.loadFEN(fen),captureFEN);
    await page.evaluate(()=>window.chessApp.commands.move({from:'E4',to:'D5'},{source:'mouse'}));
    await phase(page,[combatPhase]);
    if(action==='reset')await page.click('#reset-button');
    else if(action==='crew')await page.selectOption('#crew-select','buggy');
    else {assert.equal(await page.locator('#undo-button').isEnabled(),true);await page.click('#undo-button');}
    await settle(page);
    // Cross a former animation deadline to catch stale callbacks mutating a new board.
    await page.waitForFunction(start=>performance.now()-start>3500,await page.evaluate(()=>performance.now()),{timeout:5000,polling:'raf'});
    const snapshot=await page.evaluate(()=>window.chessApp.snapshot());
    assert.equal(snapshot.metrics.pieceCount,action==='undo'?4:32);
    assert.equal(await page.evaluate(()=>window.chessApp.game.history.length),0);
    assert.equal(snapshot.metrics.effects,0);
    if(action==='undo')assert.equal(snapshot.fen,captureFEN);
    report.races.push({action,combatPhase,snapshot});
  }
  await page.selectOption('#crew-select','mugiwara');
  await settle(page);
  await page.waitForFunction(()=>window.chessApp.view.getMetrics().pieceCount===32);
  const warmed=await page.evaluate(()=>window.chessApp.view.getMetrics().resources);
  for(let i=0;i<30;i++){
    const crew=['buggy','shanks','heart'][i%3];
    await page.selectOption('#crew-select',crew);
    await settle(page);
    await page.waitForFunction(()=>window.chessApp.view.getMetrics().pieceCount===32);
  }
  await page.selectOption('#crew-select','mugiwara');
  await settle(page);
  await page.waitForFunction(()=>window.chessApp.view.getMetrics().pieceCount===32);
  const after=await page.evaluate(()=>window.chessApp.view.getMetrics().resources);
  assert(after.geometries<=warmed.geometries+2,'same crew GPUgeometrygrowth after30crewcycles');
  assert(after.textures<=warmed.textures+2,'same crew GPUtexturegrowth after30crewcycles');
  report.crewResources={cycles:30,warmed,after};
  // A newer authoritative state can arrive while a 2.4 second duel is playing.
  // Serve deterministic room snapshots through the real transport without writes.
  const roomId='abcdef0123456789abcdef01',onlineGame=new ChessGame('4k3/8/2p5/3p4/4P3/8/8/4K3 w - - 0 1');
  const roomSnapshots=[];
  const roomSnapshot=revision=>{const state=packGame(onlineGame);return {id:roomId,revision,ready:true,seat:'pirate',crew:'mugiwara',state,result:null,lastAction:state.history.at(-1)||null};};
  roomSnapshots.push(roomSnapshot(0));
  onlineGame.move({from:'E4',to:'D5'});roomSnapshots.push(roomSnapshot(1));
  onlineGame.move({from:'C6',to:'D5'});roomSnapshots.push(roomSnapshot(2));
  let roomRevision=0;
  await page.route('**/api/rooms/'+roomId,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({room:roomSnapshots[roomRevision]})}));
  await page.evaluate(id=>window.chessApp.online.resume(id),roomId);await settle(page);
  await page.evaluate(()=>{const view=window.chessApp.view;window.__originalAnimateMove=view.animateMove;window.__onlineAnimatedMoves=[];view.animateMove=function(record){window.__onlineAnimatedMoves.push({from:record.from,to:record.to});return window.__originalAnimateMove.call(this,record);};});
  roomRevision=1;await page.evaluate(()=>window.chessApp.online.refresh());
  await phase(page,['windup']);
  roomRevision=2;await page.evaluate(()=>window.chessApp.online.refresh());await settle(page);
  const interruptedOnline=await page.evaluate(()=>({fen:window.chessApp.game.fen(),metrics:window.chessApp.view.getMetrics(),animated:window.__onlineAnimatedMoves,victim:window.chessApp.view.pieces.get('D5')?.userData.piece.player}));
  assert.equal(interruptedOnline.fen,onlineGame.fen());
  assert.equal(interruptedOnline.victim,'marine');
  assert.equal(interruptedOnline.metrics.effects,0);
  assert.deepEqual(interruptedOnline.animated,[{from:'E4',to:'D5'}],'new authoritative revision cancels stale duel without animating wrong actor');
  report.onlineInterruption=interruptedOnline;
  await page.evaluate(()=>{window.chessApp.view.animateMove=window.__originalAnimateMove;});
  await page.click('#online-leave');await settle(page);await page.unroute('**/api/rooms/'+roomId);
  await page.evaluate(()=>window.chessApp.setAI(true));
  await settle(page);
  await page.evaluate(()=>window.chessApp.commands.move({from:'E2',to:'E4'},{source:'mouse'}));
  await page.click('#reset-button');
  await settle(page);
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(()=>window.chessApp.game.history.length),0);
  report.aiResetRace=true;
  report.repeatedManifestRequests=repeatedManifestRequests;
  assert.equal(repeatedManifestRequests,0,'warmed renderer reuses asset manifest across moves/resets/crew changes');
  await page.evaluate(()=>window.chessApp.setAI(false));
  await settle(page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.chessApp));
  await page.evaluate(()=>window.chessApp.whenReady);
  await page.evaluate(()=>window.chessApp.setAI(false));
  await settle(page);
  await page.evaluate(fen=>window.chessApp.loadFEN(fen),captureFEN);
  const start=performance.now();
  await page.evaluate(()=>window.chessApp.commands.move({from:'E4',to:'D5'},{source:'mouse'}));
  await settle(page);
  report.reducedMotionMs=performance.now()-start;
  assert(report.reducedMotionMs<700);
  assert.equal(await page.evaluate(()=>window.chessApp.view.getMetrics().effects),0);
  assert.equal(errors.length,0,JSON.stringify(errors));
  assert.equal(httpErrors.length,0,JSON.stringify(httpErrors));
  report.consoleErrors=errors;
  report.httpErrors=httpErrors;
  const recording=page.video();
  await context.close();
  context=null;
  if(recording){report.video=path.join(out,'capture-proof.webm');await recording.saveAs(report.video);}
  report.passed=true;
  report.completedAt=new Date().toISOString();
  save('effects.json',report);
  console.log('EFFECTS_OK phasedCombat=1 defenderReaction=1 impactOnce=1 legalState=1 cleanup=1 reducedMotion=1 captureCycles=30 crewCycles=30');
} catch(error){report.passed=false;report.error=error.stack;save('effects.json',report);console.error(error.message);process.exitCode=1;}
finally {await context?.close();await closeBrowser(browser);}
