import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium} from 'playwright';
import {base,out,save,settle,browserChannel} from './browser-utils.mjs';

const report={base,startedAt:new Date().toISOString(),checks:[],errors:[],httpErrors:[],passed:false};
let browser;
const mark=message=>{report.checks.push(message);console.log(message);};
try {
 browser=await chromium.launch({headless:true,channel:browserChannel,timeout:30000});
 const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
 const page=await context.newPage();page.setDefaultTimeout(60000);
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400)report.httpErrors.push({status:response.status(),url:response.url()});});
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.fill('#password',process.env.APP_PASSWORD||'12345');
 await Promise.all([page.waitForURL(new URL('/',base).href,{waitUntil:'domcontentloaded'}),page.click('button')]);
 await page.waitForFunction(()=>Boolean(window.chessApp));
 await page.evaluate(()=>window.chessApp.whenReady);
 await page.evaluate(()=>window.chessApp.setAI(false));await settle(page);

 const state=()=>page.evaluate(()=>({snapshot:window.chessApp.snapshot(),kings:window.chessApp.game.board.flat().filter(piece=>piece?.type==='king').map(piece=>piece.player),history:window.chessApp.game.history.map(record=>({kind:record.kind,from:record.from,to:record.to,promotion:record.promotion,captured:record.captured?.type})),overlay:{open:document.querySelector('#result-overlay').open,kind:document.querySelector('#result-overlay').dataset.kind}}));
 async function fruit(fen){
  await page.evaluate(fen=>window.chessApp.loadFEN(fen),fen);await settle(page);
  const selection=await page.evaluate(()=>window.chessApp.commands.select('H6'));assert.equal(selection.ok,true);
  await page.locator('[data-fruit="gomu-gomu"]').click();await settle(page);
 }

 await fruit('7k/5K2/7P/8/8/8/8/8 w - - 0 1');
 await page.locator('#result-overlay[open]').waitFor();
 const mate=await state();assert.equal(mate.snapshot.status.checkmate,true);assert.equal(mate.snapshot.status.winner,'pirate');assert.deepEqual(mate.kings.sort(),['marine','pirate']);assert.equal(mate.overlay.kind,'victory');
 await page.screenshot({path:path.join(out,'fruit-check-mate.png'),fullPage:true});report.mate=mate;mark('FRUIT_MATE_OK real fruit button opens victory with both kings retained');

 await page.evaluate(()=>window.chessApp.loadFEN('7k/8/7P/8/8/8/8/K7 w - - 0 1'));await settle(page);
 await page.evaluate(()=>window.chessApp.setAI(true));await settle(page);
 assert.equal((await page.evaluate(()=>window.chessApp.commands.select('H6'))).ok,true);
 await page.locator('[data-fruit="gomu-gomu"]').click();
 await page.waitForFunction(()=>window.chessApp.game.history.length===2&&window.chessApp.game.turn==='pirate'&&!window.chessApp.busy);
 const response=await state();assert.equal(response.snapshot.status.over,false);assert.deepEqual(response.kings.sort(),['marine','pirate']);assert.equal(response.history[0].kind,'devil_fruit');assert.equal(response.history[1].from,'H8');
 assert.equal(await page.evaluate(()=>window.chessApp.game.inCheck('marine')),false);assert.equal(response.overlay.open,false);
 report.aiResponse=response;mark('FRUIT_AI_OK checking transformation triggers automatic legal king escape');

 await page.evaluate(()=>window.chessApp.setAI(false));await settle(page);
 await page.evaluate(()=>window.chessApp.loadFEN('7k/P7/2r5/8/8/8/8/K7 w - - 0 1'));await settle(page);
 async function move(args){const result=await page.evaluate(args=>window.chessApp.commands.move(args,{source:'mouse'}),args);assert.equal(result.ok,true,result.speak);await settle(page);}
 await move({from:'A7',to:'A8',promotion:'queen'});
 assert.equal(await page.evaluate(()=>window.chessApp.game.board[7][0].type),'queen');
 await move({from:'H8',to:'H7'});await move({from:'A8',to:'C6'});
 const promotion=await state();assert.equal(promotion.history[2].captured,'rook');assert.deepEqual(promotion.kings.sort(),['marine','pirate']);assert.equal(await page.evaluate(()=>window.chessApp.game.board[5][2].type),'queen');
 report.promotion=promotion;mark('PROMOTION_OK last-rank queen moves and captures legally on next turn');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);
 report.passed=true;report.completedAt=new Date().toISOString();save('fruit-check.json',report);console.log('FRUIT_CHECK_OK');
}catch(error){report.error=error.stack;save('fruit-check.json',report);console.error(error.stack);process.exitCode=1;}
finally{if(browser)await Promise.race([browser.close(),new Promise(resolve=>{const timer=setTimeout(resolve,5000);timer.unref();})]);}
