import assert from 'node:assert/strict';
import path from 'node:path';
import {base,out,save,openGame,closeBrowser,assertModels,settle} from './browser-utils.mjs';

const captureFEN='4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';
const report={base,startedAt:new Date().toISOString(),captures:[],races:[],passed:false};
let browser,context;
try {
  const session=await openGame({video:true});
  ({browser,context}=session);
  const {page,errors,httpErrors}=session;
  await assertModels(page);
  await page.evaluate(()=>window.chessApp.setAI(false));
  await settle(page);
  await page.evaluate(fen=>window.chessApp.loadFEN(fen),captureFEN);
  await page.screenshot({path:path.join(out,'capture-before.png'),fullPage:true});
  await page.evaluate(()=>window.chessApp.commands.move({from:'E4',to:'D5'},{source:'mouse'}));
  await page.waitForFunction(()=>window.chessApp.view.getMetrics().effects===2);
  await page.waitForTimeout(650);
  const impact=await page.evaluate(()=>({metrics:window.chessApp.view.getMetrics(),attacker:window.chessApp.view.pieces.get('E4').position.toArray(),victim:window.chessApp.view.pieces.get('D5').scale.toArray(),legal:window.chessApp.game.board[4][3]?.player==='pirate'&&!window.chessApp.game.board[3][4]}));
  assert(impact.legal);
  assert.equal(impact.metrics.effects,2);
  assert(impact.victim[0]<1);
  assert(impact.attacker[0]<.5,'attacker advances towardD5');
  await page.screenshot({path:path.join(out,'capture-impact.png'),fullPage:true});
  await settle(page);
  assert.equal(await page.evaluate(()=>window.chessApp.view.getMetrics().effects),0);
  assert.equal(await page.evaluate(()=>window.chessApp.view.getMetrics().pieceCount),3);
  await page.screenshot({path:path.join(out,'capture-after.png'),fullPage:true});
  report.impact=impact;
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
  for(const action of ['reset','crew','undo']){
    await page.evaluate(fen=>window.chessApp.loadFEN(fen),captureFEN);
    await page.evaluate(()=>window.chessApp.commands.move({from:'E4',to:'D5'},{source:'mouse'}));
    await page.waitForTimeout(200);
    if(action==='reset')await page.click('#reset-button');
    else if(action==='crew')await page.selectOption('#crew-select','buggy');
    else {assert.equal(await page.locator('#undo-button').isEnabled(),true);await page.click('#undo-button');}
    await settle(page);
    await page.waitForTimeout(1100);
    const snapshot=await page.evaluate(()=>window.chessApp.snapshot());
    assert.equal(snapshot.metrics.pieceCount,action==='undo'?4:32);
    assert.equal(await page.evaluate(()=>window.chessApp.game.history.length),0);
    assert.equal(snapshot.metrics.effects,0);
    if(action==='undo')assert.equal(snapshot.fen,captureFEN);
    report.races.push({action,snapshot});
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
  await page.evaluate(()=>window.chessApp.setAI(true));
  await settle(page);
  await page.evaluate(()=>window.chessApp.commands.move({from:'E2',to:'E4'},{source:'mouse'}));
  await page.click('#reset-button');
  await settle(page);
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(()=>window.chessApp.game.history.length),0);
  report.aiResetRace=true;
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
  console.log('EFFECTS_OK capture=1 legalState=1 cleanup=1 reducedMotion=1 captureCycles=30 crewCycles=30');
} catch(error){report.passed=false;report.error=error.stack;save('effects.json',report);console.error(error.message);process.exitCode=1;}
finally {await context?.close();await closeBrowser(browser);}
