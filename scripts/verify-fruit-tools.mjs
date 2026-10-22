import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium} from 'playwright';
import {base,out,save,settle,browserChannel} from './browser-utils.mjs';

const report={base,startedAt:new Date().toISOString(),checks:[],errors:[],httpErrors:[],providerRequests:[],passed:false};
let browser;
const mark=text=>{report.checks.push(text);console.log(text);};
try{
 browser=await chromium.launch({headless:true,channel:browserChannel,timeout:30000});
 const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
 const page=await context.newPage();page.setDefaultTimeout(60000);
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400)report.httpErrors.push({status:response.status(),url:response.url()});});
 // This isolated browser must never open a real provider lease or affect a live call.
 await context.route('**/api/voice/**',route=>{report.providerRequests.push(route.request().url());return route.abort();});
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.fill('#password',process.env.APP_PASSWORD||'12345');
 await Promise.all([page.waitForURL(new URL('/',base).href,{waitUntil:'domcontentloaded'}),page.click('button')]);
 await page.waitForFunction(()=>Boolean(window.chessApp));await page.evaluate(()=>window.chessApp.whenReady);
 await page.waitForFunction(()=>window.chessApp.snapshot().webmcp!=='pending');
 await page.evaluate(()=>window.chessApp.setAI(false));await settle(page);
 report.tools=await page.evaluate(async()=>{const context=document.modelContext||navigator.modelContext;return(await context.getTools()).map(tool=>({name:tool.name,inputSchema:tool.inputSchema}));});
 assert.equal(report.tools.length,12);assert(report.tools.some(tool=>tool.name==='propose_fruit'));
 async function run(name,args={}){
  return page.evaluate(async({name,args})=>{const context=document.modelContext||navigator.modelContext,tool=(await context.getTools()).find(tool=>tool.name===name);if(!tool)throw Error('Missing ModelContext tool '+name);let value=await context.executeTool(tool,args);if(typeof value==='string')value=JSON.parse(value);return value.content?.[0]?.text?JSON.parse(value.content[0].text):value;},{name,args});
 }
 await run('select_piece',{from:'E2'});const board=await run('get_board');
 assert.equal(board.ok,true);assert.equal(board.fruits.length,4);assert.equal(board.selected,'E2');assert(board.eligiblePawns.includes('E2'));assert(board.fruits.every(fruit=>fruit.id&&fruit.name&&fruit.piece));report.board=board;
 const before=await page.evaluate(()=>({fen:window.chessApp.game.fen(),version:window.chessApp.game.version}));
 const proposed=await run('propose_fruit',{square:'E2',fruit:'gomu-gomu'});assert.equal(proposed.ok,true);assert.equal(proposed.proposal.action.kind,'fruit');assert.equal(await page.evaluate(()=>window.chessApp.game.fen()),before.fen);
 const confirmed=await run('confirm_action',{id:proposed.proposal.id,words:'sí, confirmo'});assert.equal(confirmed.ok,true);
 await page.waitForFunction(()=>window.chessApp.game.board[1][4]?.type==='queen'&&!window.chessApp.busy,null,{timeout:12000});
 const fruit=await page.evaluate(()=>{const app=window.chessApp,actor=app.view.pieces.get('E2'),meshes=[];actor.traverse(node=>{if(node.isMesh)meshes.push({texture:Boolean(node.material?.map),geometry:node.geometry.uuid});});const model=app.view.cache.get('mugiwara/queen'),expected=[];model.traverse(node=>{if(node.isMesh)expected.push(node.geometry.uuid);});return{type:actor.userData.piece.type,meshes,expected,stock:app.game.availableDevilFruits,history:app.game.history.length,version:app.game.version};});
 assert.equal(fruit.type,'queen');assert.equal(fruit.history,1);assert.equal(fruit.version,before.version+1);assert(!fruit.stock.includes('gomu-gomu'));assert(fruit.meshes.some(mesh=>mesh.texture));assert.deepEqual(fruit.meshes.map(mesh=>mesh.geometry),fruit.expected);report.webmcpFruit=fruit;
 mark('WEBMCP_FRUIT_OK 12tools get_board stock selected eligiblePawns propose confirm queenGLB consumed');
 const unknown=await run('propose_fruit',{square:'D2',fruit:'unknown-fruit'}),nonPawn=await run('propose_fruit',{square:'D1',fruit:'mera-mera'});
 assert.equal(unknown.ok,false);assert.equal(nonPawn.ok,false);assert.equal(await page.evaluate(()=>window.chessApp.game.history.length),1);report.rejections={unknown,nonPawn};
 await page.screenshot({path:path.join(out,'fruit-tools-queen.png'),fullPage:true});

 await page.evaluate(async()=>{const {START_FEN}=await import('/src/rules.mjs');await window.chessApp.loadFEN(START_FEN);});await settle(page);
 report.voice=await page.evaluate(async()=>{
  const {createVoiceSession}=await import('/src/voice.mjs'),app=window.chessApp,contexts=[],requests=[],results=[];let config,ends=0;
  const voice=createVoiceSession(app.commands,{
   fetch:async url=>{requests.push(url);return{ok:true,json:async()=>url==='/api/session'?{csrfToken:'test-only'}:{token:'test-only',leaseId:'test-only'}};},
   loadSDK:async()=>({Conversation:{startSession:async options=>{config=options;return{setVolume:async()=>{},endSession:async()=>{ends++;},getOutputVolume:()=>0,sendContextualUpdate:text=>contexts.push(text)};}}}),
   onToolResult:result=>results.push(result),
  });
  try{
   await voice.start();const initialContext=JSON.parse(contexts[0].split(' Datos: ')[1]);
   const board=JSON.parse(await config.clientTools.get_board({}));
   const initialVersion=app.game.version,transcript={source:'user',message:'dale Gomu Gomu al peón de E2',event_id:'fruit-browser-test'};
   config.onMessage(transcript);config.onMessage(transcript);
   const echo=JSON.parse(await config.clientTools.propose_fruit({square:'E2',fruit:'gomu-gomu'}));
   while(app.busy)await new Promise(requestAnimationFrame);
   return{initialContext,board,initialVersion,version:app.game.version,history:app.game.history.length,type:app.game.board[1][4].type,stock:app.game.availableDevilFruits,echo,pending:app.commands.pending,connected:Boolean(voice.session),endsBeforeStop:ends,results,requests};
  }finally{await voice.stop();}
 });
 const voice=report.voice;assert.equal(voice.initialContext.result.fruits.length,4);assert(voice.initialContext.result.eligiblePawns.includes('E2'));assert.equal(voice.board.fruits.length,4);assert.equal(voice.type,'queen');assert.equal(voice.history,1);assert.equal(voice.version,voice.initialVersion+1);assert.equal(voice.pending,null);assert.equal(voice.echo.ok,true);assert.equal(voice.echo.deduplicated,true);assert.equal(voice.connected,true);assert.equal(voice.endsBeforeStop,0);assert(!voice.stock.includes('gomu-gomu'));
 assert.equal(voice.results.filter(result=>result.name==='propose_fruit'&&!result.result.deduplicated).length,1);
 mark('VOICE_FRUIT_OK injected SDK initialstock ASR immediate oneaction duplicateecho deduplicated connected');
 assert.deepEqual(report.providerRequests,[]);assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);
 report.passed=true;report.completedAt=new Date().toISOString();save('fruit-tools.json',report);console.log('FRUIT_TOOLS_OK');
}catch(error){report.error=error.stack;save('fruit-tools.json',report);console.error(error.stack);process.exitCode=1;}
finally{if(browser)await Promise.race([browser.close(),new Promise(resolve=>{const timer=setTimeout(resolve,5000);timer.unref();})]);}
