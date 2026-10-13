import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {base,openGame,closeBrowser,assertModels,settle} from './browser-utils.mjs';

// Real app and UI, injected SDK callbacks: no token request, microphone or paid call.
const report={mode:'FREE_BROWSER_CALLBACK_INJECTION_NOT_LIVE',base,startedAt:new Date().toISOString(),passed:false};
let browser;
try{
 const session=await openGame();browser=session.browser;
 const {page,errors,httpErrors}=session;
 report.models=await assertModels(page);
 await page.evaluate(()=>window.chessApp.setAI(false));
 await settle(page);
 assert.equal(await page.evaluate(()=>window.chessApp.aiEnabled),false);
 report.direct=await page.evaluate(async()=>{
  const app=window.chessApp,dispatches=[],ignored=[],contexts=[],volumes=[];
  let config,ends=0;
  const {createVoiceSession}=await import('/src/voice.mjs');
  const voice=createVoiceSession(app.commands,{
   onToolResult:result=>dispatches.push(result),onToolIgnored:result=>ignored.push(result),
   fetch:async url=>({ok:true,json:async()=>url==='/api/session'?{csrfToken:'TEST_NOT_LIVE'}:{token:'TEST_NOT_LIVE',leaseId:'TEST_NOT_LIVE'}}),
   loadSDK:async()=>({Conversation:{startSession:async options=>{
    config=options;return{getOutputVolume:()=>0,setVolume:async({volume})=>volumes.push(volume),endSession:async()=>ends++,sendContextualUpdate:text=>contexts.push(text)};
   }}})
  });
  const snapshot=()=>({fen:app.game.fen(),version:app.game.version,history:app.game.history.length,pending:app.commands.pending,historyText:document.getElementById('move-history').textContent,historyCount:document.getElementById('history-count').textContent,confirmVisible:Boolean(document.getElementById('voice-confirm').getClientRects().length)});
  try{
   await voice.start();
   config.onMessage({source:'user',message:'Mueve a la reina.',event_id:'select'});
   const selected=app.commands.selected;
   config.onMessage({source:'user',message:'Mueve el peón de la casilla E dos a la casilla E cuatro.',event_id:'move'});
   const immediate={...snapshot(),origin:app.game.board[1][4],destination:app.game.board[3][4]};
   config.onMessage({source:'user',message:'Mueve el peón de la casilla E dos a la casilla E cuatro.',event_id:'move'});
   const duplicate=JSON.parse(await config.clientTools.propose_move({from:'E2',to:'E4'}));
   config.onModeChange({mode:'speaking'});config.onModeChange({mode:'listening'});
   config.onMessage({source:'user',message:'¡Alto!',event_id:'stop'});
   await voice.stop();
   const afterStop=snapshot();
   const late=JSON.parse(await config.clientTools.propose_move({from:'E7',to:'E5'}));
   return{selected,tools:Object.keys(config.clientTools),immediate,duplicate,afterStop,late,disconnected:voice.session===null,ends,volumes,dispatches:dispatches.map(({name,source,result})=>({name,source,ok:result.ok})),ignored,contexts};
  }finally{await voice.stop();}
 });
 const r=report.direct;
 assert.equal(r.selected,'D1');assert.equal(r.tools.length,10);assert.equal(r.tools.includes('confirm_action'),false);
 assert.equal(r.immediate.origin,null);assert.equal(r.immediate.destination?.type,'pawn');
 assert.equal(r.immediate.pending,null);assert.equal(r.immediate.history,1);assert.equal(r.immediate.historyCount,'01');
 assert.match(r.immediate.historyText,/E2\s*→\s*E4/);assert.equal(r.immediate.confirmVisible,false);
 assert.equal(r.duplicate.ok,true);assert.equal(r.duplicate.deduplicated,true);assert.equal(r.ignored.length,1);
 assert.equal(r.afterStop.fen,r.immediate.fen);assert.equal(r.afterStop.version,r.immediate.version);
 assert.equal(r.afterStop.history,1);assert.equal(r.afterStop.pending,null);assert.equal(r.afterStop.confirmVisible,false);
 assert.equal(r.disconnected,true);assert.equal(r.ends,1);assert.deepEqual(r.volumes,[0]);assert.equal(r.late.ok,false);
 assert.deepEqual(r.dispatches.map(d=>d.name),['select_piece','propose_move','stop_action']);
 assert.ok(r.dispatches.every(d=>d.source==='voice_asr'&&d.ok));
 assert.ok(r.contexts.some(text=>/no pidas confirmación/i.test(text)));
 await settle(page);
 assert.equal(await page.locator('#voice-confirm').isVisible(),false);
 report.final=await page.evaluate(()=>({fen:window.chessApp.game.fen(),history:window.chessApp.game.history.length,pending:window.chessApp.commands.pending}));
 assert.equal(report.final.fen,r.immediate.fen);assert.equal(report.final.history,1);assert.equal(report.final.pending,null);
 report.consoleErrors=errors;report.httpErrors=httpErrors;
 assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);
 report.passed=true;
 console.log('VOICE_DIRECT_BROWSER_OK '+JSON.stringify({base,mode:report.mode,realModels:report.models.pieceCount,immediateMove:'E2→E4',confirmation:false,stopRewinds:false}));
}catch(error){report.error=error.message;throw error;}
finally{
 report.finishedAt=new Date().toISOString();await mkdir('.local',{recursive:true});
 await writeFile('.local/voice-direct-browser.json',JSON.stringify(report,null,2));
 await closeBrowser(browser);
}
