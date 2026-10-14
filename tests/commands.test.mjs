import test from 'node:test';import assert from 'node:assert/strict';
import {ChessGame} from '../src/rules.mjs';import {createCommandController} from '../src/commands.mjs';import {CREWS,MARINES} from '../src/roster.mjs';import{TOOL_REGISTRY,validateTool}from'../src/voice-registry.mjs';
test('registry exactly eleven validated tools with descriptions',()=>{assert.equal(TOOL_REGISTRY.length,11);for(const t of TOOL_REGISTRY){assert.ok(t.inputSchema.description);for(const s of Object.values(t.inputSchema.properties))assert.ok(s.description);}assert.throws(()=>validateTool('set_audio',{channel:'music',volume:2}));assert.throws(()=>validateTool('set_camera',{preset:'free'}));assert.throws(()=>validateTool('stop_action',{force:true}));});
test('Spanish selection, accents, IDs, ambiguity and all 66 roster identities',()=>{const game=new ChessGame(),c=createCommandController(game);assert.equal(c.text('MUEVE A LA REINA').square,'D1');assert.equal(c.text('peón').candidates.length,8);assert.equal(c.text('peón de E2 a E4').proposal.action.move.from,'E2');for(const [id,roster]of [...Object.entries(CREWS),['marines',MARINES]])for(const [type,item]of Object.entries(roster)){if(typeof item!=='object')continue;const g=new ChessGame();g.board=Array.from({length:8},()=>Array(8).fill(null));g.board[3][3]={type,player:id==='marines'?'marine':'pirate',id:'fixture'};g.turn=id==='marines'?'marine':'pirate';g.legalMoves=()=>[];const cc=createCommandController(g,{crew:id==='marines'?'mugiwara':id});assert.equal(cc.select(item.name).square,'D4',id+' '+item.name);}c.setCrew('kaido');assert.equal(c.select('King').piece.type,'queen');assert.equal(c.select({piece:'Queen',from:'A1'}).piece.type,'rook');assert.equal(c.select('rey').piece.type,'king');});
test('illegal movement never mutates; mouse and text share engine',()=>{const g=new ChessGame(),c=createCommandController(g);const fen=g.fen();assert.equal(c.text('alfil a D7').ok,false);assert.equal(g.fen(),fen);assert.equal(c.move({from:'E2',to:'E4'},{source:'mouse'}).ok,true);assert.equal(g.board[3][4].type,'pawn');});
test('confirmation waits for speech end and stop cancels',async()=>{const g=new ChessGame(),c=createCommandController(g,{countdownMs:10});const p=c.text('peon de E2 a E4').proposal;assert.equal(c.confirm(p.id,'tal vez').ok,false);c.confirm(p.id,'sí');await new Promise(r=>setTimeout(r,20));assert.equal(g.board[1][4].type,'pawn');c.speechEnded();c.stop();await new Promise(r=>setTimeout(r,20));assert.equal(g.board[1][4].type,'pawn');});
test('proposal binds game version, turn and expiry; legal revalidation at execute',async()=>{let clock=100;const g=new ChessGame(),c=createCommandController(g,{now:()=>clock,countdownMs:5});let p=c.text('peon de E2 a E4').proposal;g.move({from:'D2',to:'D4'});assert.equal(c.confirm(p.id,'si').ok,false);g.undo();p=c.text('peon de E2 a E4').proposal;clock=70000;assert.equal(c.confirm(p.id,'si').ok,false);clock=100;p=c.text('peon de E2 a E4').proposal;c.confirm(p.id,'si');c.speechEnded();g.move({from:'D2',to:'D4'});await new Promise(r=>setTimeout(r,15));assert.equal(g.board[1][4].type,'pawn');});
test('promotion is explicit and settings invalidate pending writes',()=>{const g=new ChessGame('7k/P7/8/8/8/8/8/7K w - - 0 1'),c=createCommandController(g);assert.equal(c.move({from:'A7',to:'A8'}).promotionRequired,true);assert.equal(c.move({from:'A7',to:'A8',promotion:'knight'},{source:'text'}).proposal.action.move.promotion,'knight');c.setCrew('heart');assert.equal(c.pending,null);});

test('claim draw uses shared action registry and pending move is fenced',()=>{const g=new ChessGame('7k/8/8/8/8/8/R7/7K w - - 100 51'),c=createCommandController(g);const p=c.runTool('propose_game_action',{action:'claim_draw',reason:'fifty-move'});assert.ok(p.proposal);assert.equal(g.status().over,false);c.stop();const r=c.runTool('propose_game_action',{action:'claim_draw',reason:'fifty-move'},{source:'mouse'});assert.equal(r.ok,true);assert.equal(g.status().reason,'fifty-move');});
test('animation lock rejects immediate and delayed action',async()=>{let locked=false;const g=new ChessGame(),c=createCommandController(g,{countdownMs:5,isLocked:()=>locked});const p=c.text('peon de E2 a E4').proposal;c.confirm(p.id,'si');locked=true;c.speechEnded();await new Promise(r=>setTimeout(r,15));assert.equal(g.board[1][4].type,'pawn');assert.equal(c.move({from:'E2',to:'E4'},{source:'mouse'}).ok,false);});
test('mouse confirmation while agent speaking waits for actual speech end',async()=>{const g=new ChessGame(),c=createCommandController(g,{countdownMs:5});const p=c.text('peon de E2 a E4').proposal;c.speechStarted();c.runTool('confirm_action',{id:p.id,words:'confirmo'},{source:'mouse'});await new Promise(r=>setTimeout(r,15));assert.equal(g.board[1][4].type,'pawn');c.speechFinished();await new Promise(r=>setTimeout(r,15));assert.equal(g.board[3][4].type,'pawn');});
test('natural explicit Spanish confirmations accepted, negation always rejected',()=>{for(const words of ['sí, confirma','sí, por favor','Sí, adelante!','confirmo']){const c=createCommandController(new ChessGame());const p=c.text('peon de E2 a E4').proposal;assert.equal(c.confirm(p.id,words).ok,true,words);c.stop();}for(const words of ['no','no confirmes','no, sí','quizá sí','sí no','sí, pero espera']){const c=createCommandController(new ChessGame());const p=c.text('peon de E2 a E4').proposal;assert.equal(c.confirm(p.id,words).ok,false,words);c.stop();}});
test('external WebMCP confirmation executes after stop window without app voice session',async()=>{const g=new ChessGame(),c=createCommandController(g,{countdownMs:5});const p=c.runTool('propose_move',{from:'E2',to:'E4'},{source:'webmcp'}).proposal;c.runTool('confirm_action',{id:p.id,words:'sí, confirma'},{source:'webmcp'});assert.equal(g.board[1][4].type,'pawn');await new Promise(r=>setTimeout(r,15));assert.equal(g.board[3][4].type,'pawn');});
test('reconfirm is idempotent: advertised countdown cannot hide old timer',async()=>{const g=new ChessGame(),c=createCommandController(g,{countdownMs:35});const p=c.text('peon de E2 a E4').proposal;c.confirm(p.id,'si');c.speechEnded();const deadline=c.pending.executeAt;await new Promise(r=>setTimeout(r,15));c.confirm(p.id,'si');assert.equal(c.pending.state,'countdown');assert.equal(c.pending.executeAt,deadline);await new Promise(r=>setTimeout(r,40));assert.equal(g.board[3][4].type,'pawn');});
test('fake clock reconfirm at t3000 preserves original t4000 execution deadline',t=>{t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});const g=new ChessGame(),c=createCommandController(g,{now:()=>Date.now(),countdownMs:4000});const p=c.text('peon de E2 a E4').proposal;c.confirm(p.id,'si');c.speechEnded();assert.equal(c.pending.executeAt,5000);t.mock.timers.tick(3000);c.confirm(p.id,'si');assert.equal(c.pending.executeAt,5000);assert.equal(c.pending.state,'countdown');t.mock.timers.tick(999);assert.equal(g.board[1][4].type,'pawn');t.mock.timers.tick(1);assert.equal(g.board[3][4].type,'pawn');});
test('ASR decoder accepts explicit Spanish commands and phonetic coordinates only',async()=>{const{decodeVoiceCommand}=await import('../src/commands.mjs');assert.equal(decodeVoiceCommand('Mueve a la reina.').name,'select_piece');assert.equal(decodeVoiceCommand('Selecciona a Zoro.').text,'zoro');assert.equal(decodeVoiceCommand('Mueve el peón de la casilla E dos a la casilla E cuatro.').name,'propose_move');assert.equal(decodeVoiceCommand('Peón de Eco dos a E de España cuatro.').text,'peon de E2 a E4');assert.equal(decodeVoiceCommand('Sí, confirmo.').name,'confirm_action');assert.equal(decodeVoiceCommand('Me gustaría jugar un rato'),null);assert.equal(decodeVoiceCommand('peón de 1D2 a E4'),null);});
test('late identical model proposal cannot repeat an immediate ASR move',()=>{const g=new ChessGame(),c=createCommandController(g);const first=c.text('peon de E2 a E4',{source:'voice_asr'});assert.deepEqual(first.action,{kind:'move',move:{from:'E2',to:'E4'}});const fen=g.fen(),version=g.version;assert.equal(c.runTool('propose_move',{from:'E2',to:'E4'},{source:'voice_client_tool'}).ok,false);assert.equal(g.fen(),fen);assert.equal(g.version,version);assert.equal(c.pending,null);});

test('spoken parser covers all eleven registry actions and coordinate spellings',async()=>{
 const{decodeVoiceCommand}=await import('../src/commands.mjs');
 const inputs=['lee el tablero','mueve a la reina','peón de E dos a E cuatro','deshaz el último movimiento','activa la ia','abre el selector de tripulación','vista cenital','apaga la música','cierra el mensaje','sí, confirma','alto'];
 assert.deepEqual(inputs.map(input=>decodeVoiceCommand(input).name).sort(),TOOL_REGISTRY.map(tool=>tool.name).sort());
 for(const from of ['EcoDos','E dos','E de España dos','E 2'])assert.deepEqual(decodeVoiceCommand('peón de '+from+' a E cuatro').args,{piece:'peon',from:'E2',to:'E4'});
 assert.deepEqual(decodeVoiceCommand('peón de D dos a D cuatro').args,{piece:'peon',from:'D2',to:'D4'});
 assert.deepEqual(decodeVoiceCommand('alfil al D siete').args,{piece:'alfil',to:'D7'});
 assert.deepEqual(decodeVoiceCommand('selecciona a Zoro en C uno').args,{piece:'zoro',from:'C1'});
 for(const [id,roster]of [...Object.entries(CREWS),['marines',MARINES]])for(const item of Object.values(roster)){if(typeof item!=='object')continue;assert.equal(decodeVoiceCommand(item.name)?.name,'select_piece',id+' '+item.name);}
 for(const text of ['peón de 1D2 a E4','peón de J2 a E4','peón de E9 a E4','no confirmes','quizá sí'])assert.equal(decodeVoiceCommand(text),null,text);
});
test('selection, cancellation and pending source describe the current visible piece',()=>{
 const c=createCommandController(new ChessGame());
 c.select('reina');assert.equal(c.selected,'D1');
 const p=c.runTool('propose_move',{from:'E2',to:'E4'},{source:'webmcp'}).proposal;
 assert.equal(c.selected,'E2');assert.equal(p.action.move.from,'E2');
 c.stop();assert.equal(c.selected,null);assert.equal(c.pending,null);
});

test('recorded real ASR formal verb and NATO coordinates decode without guessing truncation',async()=>{
 const {decodeVoiceCommand}=await import('../src/commands.mjs');
 assert.deepEqual(decodeVoiceCommand('Mueva el peón de la casilla E2 a la casilla E4.').args,{piece:'peon',from:'E2',to:'E4'});
 assert.deepEqual(decodeVoiceCommand('Chopper de Delta dos a Delta cuatro.').args,{piece:'chopper',from:'D2',to:'D4'});
 assert.equal(decodeVoiceCommand('Casilla de dos a la casilla de cuatro.'),null);
 assert.equal(decodeVoiceCommand('Chopper de 1D2 a Delta cuatro.'),null);
});


test('all voice sources and default moves execute immediately without proposal or countdown',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 for(const source of [undefined,'voice','voice_asr','voice_client_tool']){
  const g=new ChessGame(),proposals=[],c=createCommandController(g,{onProposal:p=>proposals.push(p)});
  c.speechStarted();
  const r=source===undefined?c.move({from:'E2',to:'E4'}):c.runTool('propose_move',{from:'E2',to:'E4'},{source});
  assert.equal(r.ok,true,source);assert.deepEqual(r.action,{kind:'move',move:{from:'E2',to:'E4'}});
  assert.equal(g.board[3][4].type,'pawn');assert.equal(c.pending,null);assert.ok(proposals.every(p=>p===null));
  const fen=g.fen(),version=g.version;c.speechFinished();c.stop();t.mock.timers.tick(10000);
  assert.equal(g.fen(),fen);assert.equal(g.version,version);assert.equal(c.pending,null);
 }
});

test('voice rejects ambiguous, illegal, locked moves and undo without board mutation',()=>{
 const g=new ChessGame(),c=createCommandController(g),fen=g.fen(),version=g.version;
 for(const args of [{piece:'peon',to:'E4'},{from:'E2',to:'E5'}]){
  assert.equal(c.runTool('propose_move',args,{source:'voice_asr'}).ok,false);assert.equal(g.fen(),fen);assert.equal(g.version,version);assert.equal(c.pending,null);
 }
 assert.equal(createCommandController(g,{isLocked:()=>true}).move({from:'E2',to:'E4'}).ok,false);assert.equal(g.fen(),fen);
 c.text('peon de E2 a E4',{source:'voice'});const moved=g.fen(),movedVersion=g.version;
 for(const source of ['voice','voice_asr','voice_client_tool']){assert.equal(c.runTool('propose_game_action',{action:'undo'},{source}).ok,false);assert.equal(g.fen(),moved);assert.equal(g.version,movedVersion);}
 assert.equal(c.runTool('propose_game_action',{action:'undo'},{source:'mouse'}).ok,true);assert.equal(g.fen(),fen);
});

test('voice actions and settings execute immediately; text and WebMCP preserve proposals',()=>{
 for(const source of ['voice','voice_asr','voice_client_tool']){
  const g=new ChessGame(),ai=[],c=createCommandController(g,{onAi:change=>ai.push(change)});
  c.move({from:'E2',to:'E4'});const reset=c.runTool('propose_game_action',{action:'new_game'},{source});assert.equal(reset.ok,true);assert.equal(reset.action.kind,'new_game');assert.equal(g.turn,'pirate');assert.equal(c.pending,null);
  for(const [action,value]of [['ai_enabled','false'],['ai_difficulty','hard'],['crew','heart']]){
   const r=c.runTool('propose_settings',{action,value},{source});assert.equal(r.ok,true);assert.deepEqual(r.action,{kind:action,value});assert.equal(c.pending,null);
  }
  assert.deepEqual(ai,[{enabled:false},{difficulty:'hard'}]);assert.equal(c.crew,'heart');
  const drawGame=new ChessGame('7k/8/8/8/8/8/R7/7K w - - 100 51'),draw=createCommandController(drawGame);
  assert.equal(draw.runTool('propose_game_action',{action:'claim_draw',reason:'fifty-move'},{source}).ok,true);assert.equal(drawGame.status().reason,'fifty-move');assert.equal(draw.pending,null);
 }
 for(const source of ['text','webmcp']){
  const g=new ChessGame(),c=createCommandController(g),fen=g.fen();
  assert.ok(c.runTool('propose_move',{from:'E2',to:'E4'},{source}).proposal);assert.equal(g.fen(),fen);
  assert.ok(c.runTool('propose_settings',{action:'crew',value:'heart'},{source}).proposal);assert.equal(c.crew,'mugiwara');
  assert.ok(c.runTool('propose_game_action',{action:'new_game'},{source}).proposal);
 }
});


test('online action interception queues without mutating local state and undefined preserves local mode',()=>{
 const game=new ChessGame(),actions=[],changes=[],received=[];
 const controller=createCommandController(game,{executeAction:action=>{actions.push(action);return{ok:true,queued:true,requestedAction:action,speak:'Enviando...'};},onChange:value=>changes.push(value),onResult:value=>received.push(value)});
 const fen=game.fen(),version=game.version;
 const queued=controller.move({from:'E2',to:'E4'},{source:'voice_asr'});
 assert.equal(queued.queued,true);assert.equal(queued.action,undefined);assert.equal(game.fen(),fen);assert.equal(game.version,version);assert.deepEqual(changes,[]);
 controller.runTool('propose_settings',{action:'crew',value:'heart'},{source:'voice'});
 assert.equal(controller.crew,'mugiwara');assert.equal(game.fen(),fen);
 const subscribed=[];controller.subscribe((event,value)=>{if(event==='onResult')subscribed.push(value);});
 const ack={ok:true,action:actions[0],speak:'Jugada aceptada.'};assert.equal(controller.notifyResult(ack),ack);
 assert.deepEqual(received,[ack]);assert.deepEqual(subscribed,[ack]);
 const error={ok:false,requestedAction:actions[0],speak:'No es tu turno.'};controller.notifyResult(error);
 assert.deepEqual(received,[ack,error]);assert.deepEqual(subscribed,[ack,error]);
 createCommandController(game,{executeAction:()=>undefined}).move({from:'E2',to:'E4'});
 assert.equal(game.history.length,1);
});

test('online player seats resolve only their own current-turn pieces; spectators resolve none',()=>{
 const game=new ChessGame();let side='pirate';const c=createCommandController(game,{playerSide:()=>side});
 assert.equal(c.select({from:'E2'}).ok,true);side='marine';assert.equal(c.select({from:'E2'}).ok,false);
 game.move({from:'E2',to:'E4'});assert.equal(c.select({from:'E7'}).ok,true);
 side='pirate';assert.equal(c.select({from:'E7'}).ok,false);assert.equal(c.move({from:'E7',to:'E5'}).ok,false);
 side='spectator';assert.equal(c.select('peon').candidates.length,0);
 side=undefined;assert.equal(c.select({from:'E7'}).ok,true);
});

test('online locks explain turn or pending state before dispatching writes',()=>{
 const game=new ChessGame();let reason='Esperando la respuesta del servidor.',executions=0;
 const c=createCommandController(game,{isLocked:()=>true,lockReason:()=>reason,executeAction:()=>executions++});
 assert.equal(c.move({from:'E2',to:'E4'}).speak,reason);
 reason='Es el turno de tu rival.';
 assert.equal(c.runTool('propose_game_action',{action:'new_game'},{source:'mouse'}).speak,reason);
 assert.equal(executions,0);assert.equal(game.history.length,0);
});

test('attempting to capture a king explains checkmate without changing the board',()=>{
 const g=new ChessGame('7k/8/7Q/8/8/8/8/K7 w - - 0 1'),c=createCommandController(g),fen=g.fen();
 const r=c.move({from:'H6',to:'H8'},{source:'mouse'});
 assert.equal(r.ok,false);assert.match(r.speak,/rey no se captura/);assert.match(r.speak,/jaque mate/);assert.equal(g.fen(),fen);
});
