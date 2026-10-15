import {getCharacterAttack} from '../src/attacks.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {base,out,save,openGame,closeBrowser,settle} from './browser-utils.mjs';

// Legal small-board positions make the procedural miniature choreography visible.
// These are rigid textured meshes; this proof does not claim skeletal animation.
const fixtures=[
 {id:'pawn',title:'Peón · choque y defensa',fen:'7k/8/8/3p4/4P3/8/8/K7 w - - 0 1',from:'E4',to:'D5',profile:'brawl'},
 {id:'knight',title:'Caballo · salto y golpe',fen:'7k/8/8/3p4/8/4N3/8/K7 w - - 0 1',from:'E3',to:'D5',profile:'vault'},
 {id:'bishop',title:'Alfil · corte y respuesta',fen:'7k/8/8/3p4/4B3/8/8/K7 w - - 0 1',from:'E4',to:'D5',profile:'slash'},
 {id:'queen',title:'Reina · giro y estocada',fen:'7k/8/8/3p4/4Q3/8/8/K7 w - - 0 1',from:'E4',to:'D5',profile:'slash'},
 {id:'rook',title:'Torre · carga y derribo',fen:'7k/8/8/3p4/8/3R4/8/K7 w - - 0 1',from:'D3',to:'D5',profile:'charge'},
 {id:'king',title:'Rey · impacto y victoria',fen:'7k/8/8/3p4/4K3/8/8/8 w - - 0 1',from:'E4',to:'D5',profile:'charge'},
 {id:'en-passant',title:'Captura al paso · rival en la casilla correcta',fen:'7k/8/8/3pP3/8/8/8/K7 w - d6 0 1',from:'E5',to:'D6',victim:'D5',profile:'brawl'},
 {id:'castle',title:'Enroque · rey y torre coordinados',fen:'7k/8/8/8/8/8/8/4K2R w K - 0 1',from:'E1',to:'G1',capture:false,profile:'charge'},
];
const report={base,startedAt:new Date().toISOString(),animation:'procedural rigid miniatures, no skeletal rig',fixtures:[],passed:false};
let browser,context;
try{
 const session=await openGame({video:true,width:1280,height:900});
 ({browser,context}=session);
 const {page,errors,httpErrors}=session;
 page.setDefaultTimeout(30000);
 await page.evaluate(()=>{window.chessApp.setAI(false);window.chessApp.view.setCamera('front');window.chessApp.view.zoom(-.30);});
 await settle(page);
 await page.locator('#board-canvas').scrollIntoViewIfNeeded();
 for(const fixture of fixtures){
  await page.evaluate(fen=>window.chessApp.loadFEN(fen),fixture.fen);
  await page.evaluate(title=>{
   let caption=document.querySelector('#combat-proof-caption');
   if(!caption){caption=document.createElement('div');caption.id='combat-proof-caption';caption.style.cssText='position:fixed;bottom:20px;left:24px;z-index:10000;background:#071d26ed;border:1px solid #dfba72;color:#fff4dc;padding:12px 20px;border-radius:8px;font:600 18px system-ui;pointer-events:none';document.body.append(caption);}
   caption.textContent=title;
  },fixture.title);
  const before=await page.evaluate(()=>({fen:window.chessApp.game.fen(),pieces:window.chessApp.view.getMetrics().pieceCount}));
  const move=await page.evaluate(({from,to})=>window.chessApp.commands.move({from,to},{source:'mouse'}),fixture);
  assert.equal(move.ok,true,fixture.id+' legal fixture');
  if(fixture.capture!==false){
   const frames=await page.evaluate(({from,to,victim})=>new Promise((resolve,reject)=>{
    const view=window.chessApp.view,frames={};
    const timeout=setTimeout(()=>reject(Error('Missing exact combat phase frame')),15000);
    const capture=()=>{const combat={...view.getMetrics().combat};
     const id=combat.phase==='parry'&&combat.progress>=.48?'faceoff':combat.phase==='strike'&&combat.progress>=.615?'impact':null;
     if(id&&!frames[id]){view.renderer.render(view.scene,view.camera);frames[id]={combat,attacker:view.pieces.get(from)?.visible,victim:view.pieces.get(victim||to)?.visible,png:view.canvas.toDataURL('image/png')};}
     if(frames.faceoff&&frames.impact){clearTimeout(timeout);resolve(frames);}else requestAnimationFrame(capture);
    };requestAnimationFrame(capture);
   }),fixture);
   const faceoff=frames.faceoff;
   assert(faceoff.attacker&&faceoff.victim,fixture.id+' both visible before strike');
   assert.equal(faceoff.combat.profile,getCharacterAttack('mugiwara',fixture.id==='en-passant'?'pawn':fixture.id==='castle'?'king':fixture.id).style);
   for(const [phase,frame] of Object.entries(frames))fs.writeFileSync(path.join(out,`combat-${fixture.id}-${phase}.png`),Buffer.from(frame.png.split(',')[1],'base64'));
  }
  await settle(page);
  const after=await page.evaluate(()=>({fen:window.chessApp.game.fen(),metrics:window.chessApp.view.getMetrics(),squares:[...window.chessApp.view.pieces.keys()]}));
  assert.equal(after.metrics.effects,0,fixture.id+' effect cleanup');
  assert.equal(after.metrics.pieceCount,before.pieces-(fixture.capture===false?0:1));
  assert(!after.squares.includes(fixture.from)&&after.squares.includes(fixture.to));
  if(fixture.id==='en-passant')assert(!after.squares.includes('D5'),'en passant removes D5 actor');
  if(fixture.id==='castle')assert(after.squares.includes('F1')&&!after.squares.includes('H1'),'castle rook reaches F1');
  report.fixtures.push({id:fixture.id,before,after});
 }
 assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(httpErrors.length,0,JSON.stringify(httpErrors));
 report.consoleErrors=errors;report.httpErrors=httpErrors;
 const recording=page.video();await context.close();context=null;
 if(recording){report.video=path.join(out,'combat-showcase.webm');await recording.saveAs(report.video);}
 report.passed=true;report.completedAt=new Date().toISOString();save('combat-showcase.json',report);
 console.log('COMBAT_SHOWCASE_OK roles=6 profiles=4 enPassant=1 castle=1 cleanup=1');
}catch(error){report.error=error.stack;save('combat-showcase.json',report);console.error(error.stack);process.exitCode=1;}
finally{await context?.close();await closeBrowser(browser);}
