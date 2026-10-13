import assert from 'node:assert/strict';
import path from 'node:path';
import {base,out,save,openGame,closeBrowser,assertModels,clickSquare,settle,performanceSample} from './browser-utils.mjs';

const report={base,startedAt:new Date().toISOString(),crews:[],camera:[],crewCycles:[],consoleErrors:[],performance:[],passed:false};
let browser;
try {
  const session=await openGame();
  browser=session.browser;
  const {page,errors,httpErrors}=session;
  report.coldLoadMs=session.loadMs;
  assert(session.loadMs<(/localhost|127\.0\.0\.1/.test(base)?30000:60000),'cold GLB load budget');
  await assertModels(page);
  await page.evaluate(()=>window.chessApp.setAI(false));
  await settle(page);
  const crewIds=await page.locator('#crew-select option').evaluateAll(nodes=>nodes.map(n=>n.value));
  assert.equal(crewIds.length,10);
  for(const id of crewIds){
    const start=performance.now();
    await page.selectOption('#crew-select',id);
    await settle(page);
    await page.waitForFunction(id=>window.chessApp.crew===id&&window.chessApp.view.getMetrics().pieceCount===32,id);
    const metrics=await assertModels(page);
    await page.screenshot({path:path.join(out,`crew-${id}.png`),fullPage:true});
    report.crews.push({id,loadMs:performance.now()-start,metrics});
  }
  const warmedMax={geometries:Math.max(...report.crews.map(c=>c.metrics.resources.geometries)),textures:Math.max(...report.crews.map(c=>c.metrics.resources.textures))};
  for(let i=0;i<30;i++){
    const id=crewIds[i%crewIds.length];
    await page.selectOption('#crew-select',id);
    await settle(page);
    await page.waitForFunction(id=>window.chessApp.crew===id&&window.chessApp.view.getMetrics().pieceCount===32,id);
    const metrics=await assertModels(page);
    assert(metrics.resources.geometries<=warmedMax.geometries*2,'crew GPU geometry cap: twice warmed count');
    assert(metrics.resources.textures<=warmedMax.textures*2,'crew GPU texture cap: twice warmed count');
    report.crewCycles.push({iteration:i+1,id,resources:metrics.resources});
  }
  report.crewResources={warmedMax};
  await page.selectOption('#crew-select','mugiwara');
  await settle(page);
  await page.waitForFunction(()=>window.chessApp.view.getMetrics().pieceCount===32);
  const returnedResources=(await assertModels(page)).resources;
  const originalResources=report.crews.find(c=>c.id==='mugiwara').metrics.resources;
  assert(returnedResources.geometries<=originalResources.geometries+2,'same crew geometry count after30switches');
  assert(returnedResources.textures<=originalResources.textures+2,'same crew texture count after30switches');
  report.crewResources={...report.crewResources,originalResources,returnedResources};
  for(const mode of ['front','top','opposite']){
    await page.click(`[data-camera="${mode}"]`);
    assert.equal(await page.locator(`[data-camera="${mode}"]`).getAttribute('aria-pressed'),'true');
    await clickSquare(page,'E2');
    assert.equal(await page.evaluate(()=>window.chessApp.commands.selected),'E2');
    const destinations=await page.evaluate(()=>window.chessApp.game.legalMoves('E2').map(m=>m.to));
    assert.deepEqual(destinations,['E3','E4']);
    const ids=await page.evaluate(()=>window.chessApp.view.squareIds);
    await page.evaluate(()=>{const v=window.chessApp.view;window.__squareHandler=v.onSquare;window.__raycastHits=[];v.onSquare=s=>window.__raycastHits.push(s);});
    try {for(const id of ids)await clickSquare(page,id);assert.deepEqual(await page.evaluate(()=>window.__raycastHits),ids,`all64raycasts ${mode}`);}
    finally {await page.evaluate(()=>{window.chessApp.view.onSquare=window.__squareHandler;delete window.__squareHandler;delete window.__raycastHits;});}
    report.camera.push({mode,raycast:'64 square IDs',destinations});
    await page.screenshot({path:path.join(out,`camera-${mode}.png`),fullPage:true});
  }
  await page.evaluate(()=>window.chessApp.view.zoom(-100));
  assert.equal(await page.evaluate(()=>window.chessApp.view.getMetrics().zoom),.87);
  await page.evaluate(()=>window.chessApp.view.zoom(100));
  assert.equal(await page.evaluate(()=>window.chessApp.view.getMetrics().zoom),1.3);
  const before=await page.evaluate(()=>window.chessApp.view.camera.position.toArray());
  for(const key of ['w','a','s','d','q','e','ArrowLeft','ArrowRight'])await page.keyboard.press(key);
  assert.deepEqual(await page.evaluate(()=>window.chessApp.view.camera.position.toArray()),before);
  await page.click('#camera-reset');
  await page.fill('#command-input','mueve a la reina');
  await page.click('#command-form button');
  assert.equal(await page.evaluate(()=>window.chessApp.commands.selected),'D1');
  await page.fill('#command-input','peón de E2 a E4');
  await page.click('#command-form button');
  assert.equal(await page.evaluate(()=>window.chessApp.commands.pending.action.move.to),'E4');
  await page.click('#voice-confirm');
  await page.waitForFunction(()=>window.chessApp.game.board[3][4]?.type==='pawn');
  await settle(page);
  assert.equal(await page.evaluate(()=>window.chessApp.game.turn),'marine');
  await page.fill('#command-input','mueve a Marine');
  await page.click('#command-form button');
  assert.match(await page.locator('#command-feedback').innerText(),/origen/);
  if(!await page.locator('#voice-stop').isVisible())await page.click('#voice-orb');
  await page.click('#voice-stop');
  await page.click('#undo-button');
  await settle(page);
  assert.equal(await page.evaluate(()=>window.chessApp.game.turn),'pirate');
  await page.click('#reset-button');
  await settle(page);
  assert.equal(await page.evaluate(()=>window.chessApp.game.history.length),0);
  await page.evaluate(()=>window.chessApp.loadFEN('4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1'));
  await page.fill('#command-input','mueve a la reina');
  await page.click('#command-form button');
  report.queenSelection=await page.evaluate(()=>({square:window.chessApp.commands.selected,moves:window.chessApp.game.legalMoves('D4').map(m=>m.to),highlights:window.chessApp.view.highlights.children.length,pending:window.chessApp.commands.pending}));
  assert.equal(report.queenSelection.square,'D4');
  assert(report.queenSelection.moves.length>0);
  assert.equal(report.queenSelection.highlights,report.queenSelection.moves.length+1);
  assert.equal(report.queenSelection.pending,null);
  await page.screenshot({path:path.join(out,'queen-legal-moves.png'),fullPage:true});
  const intendedFen='4k3/8/8/8/8/8/8/R3K3 w - - 99 1';
  await page.evaluate(fen=>window.chessApp.loadFEN(fen),intendedFen);
  await page.fill('#command-input','tablas por cincuenta movimientos con A1 a A2');
  await page.click('#command-form button');
  assert.equal(await page.evaluate(()=>window.chessApp.commands.pending.action.intendedMove.to),'A2');
  await page.click('#voice-confirm');
  await page.waitForFunction(()=>window.chessApp.game.status().reason==='fifty-move');
  await settle(page);
  assert.equal(await page.evaluate(()=>window.chessApp.game.fen()),intendedFen);
  report.intendedDraw={reason:'fifty-move',from:'A1',to:'A2',executedMove:false};
  await page.click('#reset-button');
  await settle(page);
  await page.selectOption('#crew-select','kaido');
  await settle(page);
  await page.waitForFunction(()=>window.chessApp.crew==='kaido'&&window.chessApp.view.getMetrics().pieceCount===32);
  for(const [alias,square] of [['King','D1'],['Queen','A1']]){
    const result=await page.evaluate(alias=>window.chessApp.commands.select(alias),alias);
    if(alias==='King')assert.equal(result.square,square);
    else assert.deepEqual(result.candidates.map(x=>x.square),['A1','H1']);
  }
  await page.selectOption('#crew-select','mugiwara');
  await settle(page);
  await page.waitForFunction(()=>window.chessApp.view.getMetrics().pieceCount===32);
  const warmStart=performance.now();
  await page.click('#reset-button');
  await settle(page);
  report.warmLoadMs=performance.now()-warmStart;
  assert(report.warmLoadMs<5000,'warm GLB reset5s');
  report.performance.push({...await performanceSample(page),targetMs:33.4});
  await page.screenshot({path:path.join(out,'desktop-final.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const mode of ['front','top','opposite'])for(const zoom of [.87,1.3]){
    const contained=await page.evaluate(({mode,zoom})=>{const v=window.chessApp.view;v.zoomLevel=zoom;v.setCamera(mode);const r=v.canvas.getBoundingClientRect();return ['A1','A8','H1','H8','D7'].every(s=>{const p=v.squareToScreen(s);return p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom;});},{mode,zoom});
    assert(contained,`mobile containment ${mode} ${zoom}`);
  }
  await page.click('#camera-reset');
  report.performance.push({...await performanceSample(page),targetMs:50});
  await page.screenshot({path:path.join(out,'mobile-final.png'),fullPage:true});
  report.performance=report.performance.map(p=>({...p,targetStatus:p.software?'pending-hardware-verification':p.p95Ms<=p.targetMs?'pass':'fail'}));
  assert(!report.performance.some(p=>p.targetStatus==='fail'),'hardware framebudget failed');
  assert.equal(errors.length,0,JSON.stringify(errors));
  assert.equal(httpErrors.length,0,JSON.stringify(httpErrors));
  report.consoleErrors=errors;
  report.httpErrors=httpErrors;
  report.passed=true;
  report.completedAt=new Date().toISOString();
  save('browser.json',report);
  console.log('BROWSER_OK crews=10 pieces=32 presets=3 squareIds=64 crewCycles=30 consoleErrors=0');
  console.log('PERFORMANCE_STATUS '+JSON.stringify(report.performance.map(({p95Ms,renderer,targetStatus})=>({p95Ms,renderer,targetStatus}))));
} catch(error){report.error=error.stack;save('browser.json',report);console.error(error.message);process.exitCode=1;}
finally {await closeBrowser(browser);}
