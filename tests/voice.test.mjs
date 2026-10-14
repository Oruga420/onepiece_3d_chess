import test from 'node:test';import assert from 'node:assert/strict';import{createVoiceSession,registerWebMCP}from'../src/voice.mjs';import{TOOL_REGISTRY,VOICE_TOOL_REGISTRY}from'../src/voice-registry.mjs';
test('native WebMCP registers the shared registry and executes shared controller',async()=>{const tools=[];const doc={modelContext:{registerTool:t=>{tools.push(t);}}};let called;const bridge=await registerWebMCP({runTool:(...args)=>{called=args;return{ok:true};}},{document:doc,navigator:{}});assert.equal(bridge.mode,'native');assert.deepEqual(tools.map(t=>t.name),TOOL_REGISTRY.map(t=>t.name));const r=await tools[1].execute({from:'E2'});assert.equal(JSON.parse(r.content[0].text).ok,true);assert.equal(called[2].source,'webmcp');});
test('real SDK-shaped voice tools omit confirmation and speech never starts a countdown',async()=>{let config,stops=0,ended=0,speech=0,calls=[];const controller={runTool:(name,args)=>({ok:true,speak:name,...args}),stop:()=>stops++,speechEnded:()=>speech++};const fetch=async(url,init)=>{calls.push([url,init]);return{ok:true,json:async()=>url==='/api/session'?{csrfToken:'csrf'}:{token:'ephemeral',leaseId:'lease'}};};const voice=createVoiceSession(controller,{speechEndDelayMs:0,fetch,loadSDK:async()=>({Conversation:{startSession:async options=>{config=options;return{setVolume:async()=>{},endSession:async()=>ended++,getOutputVolume:()=>0.2};}}})});await voice.start();assert.equal(config.connectionType,'webrtc');assert.equal(Object.keys(config.clientTools).length,VOICE_TOOL_REGISTRY.length);assert.equal(config.clientTools.confirm_action,undefined);assert.equal(JSON.parse(await config.clientTools.select_piece({from:'E2'})).speak,'select_piece');config.onModeChange({mode:'listening'});await new Promise(r=>setTimeout(r,2));assert.equal(speech,0);await voice.stop();assert.equal(ended,1);assert.ok(stops);assert.ok(calls.some(([url])=>url==='/api/voice/finish'));});
test('missing configuration fails honestly and does not call SDK',async()=>{let started=false;const voice=createVoiceSession({stop(){}},{fetch:async url=>({ok:url==='/api/session',status:503,json:async()=>({csrfToken:'csrf'})}),loadSDK:async()=>({Conversation:{startSession(){started=true;}}})});await assert.rejects(()=>voice.start(),/configuración personal/);assert.equal(started,false);});
test('voice burst guard disconnects a message flood and never returns oversized tool payload',async()=>{let config,ended=0;const voice=createVoiceSession({runTool:()=>({ok:true,speak:'x'.repeat(5000)}),stop(){},speechEnded(){}},{fetch:async url=>({ok:true,json:async()=>url==='/api/session'?{csrfToken:'csrf'}:{token:'x',leaseId:'y'}}),loadSDK:async()=>({Conversation:{startSession:async c=>{config=c;return{setVolume:async()=>{},endSession:async()=>ended++,getOutputVolume:()=>0};}}})});await voice.start();const reply=JSON.parse(await config.clientTools.get_board({}));assert.equal(reply.ok,false);assert.match(reply.speak,/demasiado largo/);for(let i=0;i<81;i++)config.onMessage({source:'user',message:'hola'});await new Promise(r=>setTimeout(r,5));assert.ok(ended>=1);await voice.stop();});
test('ElevenLabs ASR primary adapter executes immediately through shared registry',async t=>{
 const f=await voiceFixture(t);
 f.config.onMessage({source:'user',message:'Mueve a la reina.',event_id:1});
 assert.equal(f.controller.selected,'D1');
 f.config.onMessage({source:'user',message:'Mueve el peón de la casilla E dos a la casilla E cuatro.',event_id:2});
 assert.equal(f.controller.pending,null);
 assert.equal(f.game.board[1][4],null);assert.equal(f.game.board[3][4]?.type,'pawn');
 assert.equal(f.dispatches[1].result.ok,true);assert.equal(f.dispatches[1].source,'voice_asr');
 f.config.onModeChange({mode:'speaking'});f.config.onModeChange({mode:'listening'});
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(f.game.history.length,1);assert.equal(f.controller.pending,null);
 assert.ok(f.contexts.length>=2);
});


async function voiceFixture(t,{controller:provided,...overrides}={}){
 const {ChessGame}=await import('../src/rules.mjs');
 const {createCommandController}=await import('../src/commands.mjs');
 const game=new ChessGame(),controller=provided||createCommandController(game,{countdownMs:5});
 let config;const dispatches=[],ignored=[],contexts=[],volumes=[];let ends=0;
 const voice=createVoiceSession(controller,{
  speechEndDelayMs:0,onToolResult:value=>dispatches.push(value),onToolIgnored:value=>ignored.push(value),
  fetch:async url=>({ok:true,json:async()=>url==='/api/session'?{csrfToken:'test'}:{token:'MOCK_NOT_LIVE',leaseId:'mock'}}),
  loadSDK:async()=>({Conversation:{startSession:async options=>{config=options;return{setVolume:async v=>volumes.push(v.volume),endSession:async()=>ends++,getOutputVolume:()=>0,sendContextualUpdate:value=>contexts.push(value)};}}}),
  ...overrides
 });
 t.after(()=>voice.stop());await voice.start();
 return {game,controller,voice,config,dispatches,ignored,contexts,volumes,get ends(){return ends;}};
}
test('ASR dedupes retransmission and late client tools even after the AI advances the board',async t=>{
 const f=await voiceFixture(t);
 f.config.onMessage({source:'user',message:'Peón de EcoDos a E de España cuatro.',event_id:'move'});
 assert.equal(f.game.board[3][4]?.type,'pawn');assert.equal(f.controller.pending,null);
 f.config.onMessage({source:'user',message:'Peón de EcoDos a E de España cuatro.',event_id:'move'});
 assert.equal(f.dispatches.length,1);assert.equal(f.game.history.length,1);
 f.game.move({from:'A7',to:'A6'});
 const version=f.game.version;
 const late=JSON.parse(await f.config.clientTools.propose_move({from:'E2',to:'E4'}));
 assert.equal(late.deduplicated,true);assert.equal(late.ok,true);
 assert.equal(f.game.version,version);assert.equal(f.game.history.length,2);
 assert.equal(f.dispatches.length,1);assert.equal(f.ignored.length,1);
 assert.equal(f.config.clientTools.confirm_action,undefined);
 assert.equal(f.voice.metrics.tools,1);
});
test('spoken stop mutes and disconnects without rewinding an executed move',async t=>{
 const f=await voiceFixture(t);
 f.config.onMessage({source:'user',message:'peón de E dos a E cuatro',event_id:1});
 assert.equal(f.game.board[3][4]?.type,'pawn');
 f.config.onModeChange({mode:'speaking'});f.config.onModeChange({mode:'listening'});
 f.config.onMessage({source:'user',message:'¡Alto!',event_id:2});
 assert.equal(f.controller.pending,null);assert.equal(f.voice.session,null);assert.deepEqual(f.volumes,[0]);
 f.config.onMessage({source:'user',message:'peón de E siete a E cinco',event_id:3});f.config.onModeChange({mode:'listening'});
 const late=JSON.parse(await f.config.clientTools.propose_move({from:'E7',to:'E5'}));
 assert.equal(late.ok,false);
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(f.game.board[1][4],null);assert.equal(f.game.board[3][4]?.type,'pawn');
 assert.equal(f.game.board[6][4]?.type,'pawn');assert.equal(f.game.board[4][4],null);
 assert.equal(f.game.history.length,1);assert.equal(f.ends,1);
 assert.equal(f.dispatches.at(-1).source,'voice_asr');
});
test('LLM client tool executes an unrecognized spoken move without a confirmation step',async t=>{
 const f=await voiceFixture(t);
 f.config.onMessage({source:'user',message:'Adelanta dos pasos el soldado frente al rey.',event_id:1});
 assert.equal(f.dispatches.length,0);
 const result=JSON.parse(await f.config.clientTools.propose_move({from:'E2',to:'E4'}));
 assert.equal(result.ok,true);assert.equal(f.controller.pending,null);
 assert.equal(f.game.board[1][4],null);assert.equal(f.game.board[3][4]?.type,'pawn');
 assert.equal(f.dispatches[0].source,'voice_client_tool');assert.equal(f.game.history.length,1);
 f.game.move({from:'A7',to:'A6'});
 const version=f.game.version;
 const late=JSON.parse(await f.config.clientTools.propose_move({from:'E2',to:'E4'}));
 assert.equal(late.deduplicated,true);assert.equal(late.ok,true);
 assert.equal(f.game.version,version);assert.equal(f.game.history.length,2);assert.equal(f.dispatches.length,1);
});
test('voice cannot undo committed moves through ASR or a client tool',async t=>{
 const f=await voiceFixture(t);
 f.config.onMessage({source:'user',message:'peón de E dos a E cuatro',event_id:1});
 const version=f.game.version;
 f.config.onMessage({source:'user',message:'deshacer el último movimiento',event_id:2});
 assert.equal(f.dispatches.at(-1).result.ok,false);
 assert.equal(f.controller.pending,null);assert.equal(f.game.version,version);
 f.config.onMessage({source:'user',message:'Vuelve atrás, por favor.',event_id:3});
 const result=JSON.parse(await f.config.clientTools.propose_game_action({action:'undo'}));
 assert.equal(result.ok,false);assert.equal(f.game.version,version);
 assert.equal(f.game.board[3][4]?.type,'pawn');assert.equal(f.game.history.length,1);
});
test('fresh ASR event IDs permit the same name again; invalid coordinates never guess',async t=>{
 const f=await voiceFixture(t);
 for(const event_id of [1,2])f.config.onMessage({source:'user',message:'Zoro',event_id});
 assert.equal(f.controller.selected,'D1');assert.equal(f.dispatches.length,2);
 f.config.onMessage({source:'user',message:'peón de 1D2 a E4',event_id:3});
 assert.equal(f.dispatches.length,2);assert.equal(f.controller.pending,null);
});
test('ambiguous spoken piece asks for its square without moving or creating a confirmation',async t=>{
 const f=await voiceFixture(t);
 const version=f.game.version;
 f.config.onMessage({source:'user',message:'Mueve el peón a E4',event_id:1});
 const result=f.dispatches.at(-1).result;
 assert.equal(result.ok,false);assert.equal(result.candidates.length,8);
 assert.equal(f.game.version,version);assert.equal(f.controller.pending,null);
 assert.match(result.speak,/casilla de origen/i);assert.doesNotMatch(result.speak,/confirma/i);
});
test('burst guard limits real tools and messages within ten seconds',async t=>{
 const errors=[],ends=[];
 const f=await voiceFixture(t,{onError:error=>errors.push(error.message),onEnd:value=>ends.push(value)});
 for(let i=0;i<24;i++)await f.config.clientTools.get_board({});
 assert.equal(f.dispatches.length,24);assert.equal(f.voice.metrics.tools,24);
 await f.config.clientTools.get_board({});await f.voice.stop();
 assert.equal(f.voice.session,null);assert.equal(f.dispatches.length,24);
 assert.equal(ends[0].reason,'rate_limit');assert.match(errors.at(-1),/bucle/);
 const g=await voiceFixture(t);
 for(let i=0;i<80;i++)g.config.onMessage({source:'ai',message:'mensaje'});
 assert.equal(g.voice.metrics.events,80);assert.ok(g.voice.session);
 g.config.onMessage({source:'ai',message:'uno más'});assert.equal(g.voice.session,null);
});

test('36 spoken move turns with narration and duplicate SDK tools retain one connection',async t=>{
 let clock=0;
 const f=await voiceFixture(t,{now:()=>clock});
 for(let turn=0;turn<36;turn++){
  clock+=2000;
  const moves=f.game.legalMoves();
  const move=moves.find(m=>f.game.board[Number(m.from[1])-1][m.from.charCodeAt(0)-65]?.type==='pawn'&&!m.promotion)||moves.find(m=>!m.promotion);
  assert.ok(move,`legal move on turn ${turn}`);
  const role={pawn:'peon',rook:'torre',knight:'caballo',bishop:'alfil',queen:'reina',king:'rey'}[f.game.board[Number(move.from[1])-1][move.from.charCodeAt(0)-65].type];
  const message={source:'user',message:`${role} de ${move.from} a ${move.to}`,event_id:turn};
  f.config.onMessage(message);
  assert.equal(f.dispatches.at(-1).result.ok,true,`move ${turn}`);
  f.config.onMessage(message);
  const echo=JSON.parse(await f.config.clientTools.propose_move({from:move.from,to:move.to}));
  assert.equal(echo.deduplicated,true);
  f.config.onMessage({source:'ai',message:'Jugada ejecutada.'});
  f.config.onModeChange({mode:'speaking'});f.config.onModeChange({mode:'listening'});
  assert.ok(f.voice.session,`connection remains on turn ${turn}`);
 }
 assert.equal(f.game.history.length,36);assert.equal(f.dispatches.length,36);
 assert.equal(f.voice.metrics.tools,36);assert.equal(f.voice.metrics.asrTurn,36);assert.equal(f.ends,0);
 await f.voice.stop();assert.equal(f.ends,1);
});

test('transcript retransmissions do not consume quotas or reexecute',async t=>{
 const f=await voiceFixture(t);
 const message={source:'user',message:'peon de E2 a E4',event_id:'one-move'};
 f.config.onMessage(message);
 for(let i=0;i<100;i++)f.config.onMessage(message);
 assert.equal(f.game.history.length,1);assert.equal(f.dispatches.length,1);
 assert.equal(f.voice.metrics.events,2);assert.ok(f.voice.session);assert.equal(f.ends,0);
});

test('five-minute hard timeout stays enforced and preserves its reason',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const statuses=[],errors=[],ends=[];
 const f=await voiceFixture(t,{onStatus:value=>statuses.push(value),onError:error=>errors.push(error.message),onEnd:value=>ends.push(value)});
 t.mock.timers.tick(299999);assert.ok(f.voice.session);
 t.mock.timers.tick(1);await f.voice.stop();
 assert.equal(f.voice.session,null);assert.equal(f.ends,1);assert.equal(ends[0].reason,'duration_limit');
 assert.equal(statuses.at(-1),'disconnected');assert.match(errors.at(-1),/5 minutos/);
});

test('delayed old lease release cannot overwrite a reconnected call status',async t=>{
 let finishFirst;let releases=0;const statuses=[];
 const f=await voiceFixture(t,{onStatus:value=>statuses.push(value),fetch:async url=>{
  if(url==='/api/voice/finish'&&++releases===1)return new Promise(resolve=>{finishFirst=resolve;});
  return {ok:true,json:async()=>url==='/api/session'?{csrfToken:'test'}:{token:'MOCK_NOT_LIVE',leaseId:'mock'}};
 }});
 const stopped=f.voice.stop();while(!finishFirst)await Promise.resolve();
 await f.voice.start();assert.equal(statuses.at(-1),'connected');
 finishFirst({ok:true});await stopped;
 assert.equal(statuses.at(-1),'connected');assert.ok(f.voice.session);
});

test('UTF8 user cap counts bytes and get_board reply stays below 4KiB',async t=>{
 const f=await voiceFixture(t);
 const encoded=await f.config.clientTools.get_board({});
 assert.ok(new TextEncoder().encode(encoded).length<=4096);assert.equal(JSON.parse(encoded).ok,true);
 f.config.onMessage({source:'user',message:'ñ'.repeat(4097),event_id:1});
 assert.equal(f.voice.session,null);assert.equal(f.dispatches.length,1);
});
test('stop while token is pending releases only that lease and never starts the SDK',async()=>{
 let resolveToken,configurations=0;const finishes=[];
 const voice=createVoiceSession({stop(){}},{
  fetch:async(url,init)=>url==='/api/session'?{ok:true,json:async()=>({csrfToken:'csrf'})}:url==='/api/voice/token'?new Promise(resolve=>{resolveToken=resolve;}):(finishes.push(JSON.parse(init.body)),{ok:true}),
  loadSDK:async()=>({Conversation:{startSession:async()=>{configurations++;return{};}}})
 });
 const pending=voice.start();while(!resolveToken)await new Promise(resolve=>setTimeout(resolve,0));
 await voice.stop();resolveToken({ok:true,json:async()=>({token:'x',leaseId:'cancelled-lease'})});await pending;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(configurations,0);assert.deepEqual(finishes,[{leaseId:'cancelled-lease'}]);
});

test('recorded real ASR formal verb executes and context forbids asking for confirmation',async t=>{
 const f=await voiceFixture(t);
 f.config.onMessage({source:'user',message:'Mueva el peón de la casilla E2 a la casilla E4.',event_id:146});
 assert.equal(f.dispatches[0].name,'propose_move');assert.equal(f.dispatches[0].source,'voice_asr');
 assert.match(f.contexts.at(-1),/no pidas confirmaci[oó]n/i);
 assert.doesNotMatch(f.contexts.at(-1),/PROPUESTA SIN CONFIRMAR|CONFIRMACIÓN RECIBIDA/);
 assert.equal(f.controller.pending,null);assert.equal(f.game.board[3][4]?.type,'pawn');
 f.config.onMessage({source:'user',message:'Alto.',event_id:438});
 assert.equal(f.controller.pending,null);assert.equal(f.game.board[3][4]?.type,'pawn');
});
test('ElevenLabs agent configuration exposes only direct voice tools and instructs immediate play',async()=>{
 const {buildAgentConfig}=await import('../scripts/sync-voice-agent.mjs');
 const {VOICE_TOOL_REGISTRY}=await import('../src/voice-registry.mjs');
 const {agent}=buildAgentConfig().conversation_config;
 assert.equal(agent.prompt.tools.length,VOICE_TOOL_REGISTRY.length);
 assert.deepEqual(agent.prompt.tools.map(tool=>tool.name),VOICE_TOOL_REGISTRY.map(tool=>tool.name));
 assert.equal(agent.prompt.tools.some(tool=>tool.name==='confirm_action'),false);
 const actions=agent.prompt.tools.find(tool=>tool.name==='propose_game_action').parameters.properties.action.enum;
 assert.deepEqual(actions,['new_game','claim_draw']);
 assert.match(agent.prompt.prompt,/MODO DIRECTO: ejecuta la orden legal de inmediato/);
 assert.match(agent.prompt.prompt,/No pidas confirmación/);
 assert.match(agent.prompt.prompt,/No existe deshacer por voz/);
 assert.doesNotMatch(agent.first_message,/confirma|permiso|cuenta atrás/i);
});


test('late tool from a previous spoken turn cannot reset a newer board',async t=>{
 const f=await voiceFixture(t);
 f.config.onMessage({source:'user',message:'empieza una nueva partida',event_id:'reset'});
 assert.equal(f.dispatches.length,1);assert.equal(f.dispatches[0].result.action.kind,'new_game');
 f.controller.move({from:'E2',to:'E4'},{source:'mouse'});
 const fen=f.game.fen(),version=f.game.version;
 f.config.onMessage({source:'user',message:'gracias',event_id:'thanks'});
 const late=JSON.parse(await f.config.clientTools.propose_game_action({action:'new_game'}));
 assert.equal(late.ok,true);assert.equal(late.deduplicated,true);
 assert.equal(f.game.fen(),fen);assert.equal(f.game.version,version);assert.equal(f.game.history.length,1);
 assert.equal(f.dispatches.length,1);assert.equal(f.ignored.length,1);assert.equal(f.controller.pending,null);
});

test('a fresh explicit ASR new-game command executes even when the same action is in recent history',async t=>{
 const f=await voiceFixture(t);
 f.config.onMessage({source:'user',message:'empieza una nueva partida',event_id:'first-reset'});
 f.controller.move({from:'E2',to:'E4'},{source:'mouse'});
 const version=f.game.version;
 f.config.onMessage({source:'user',message:'empieza una nueva partida',event_id:'second-reset'});
 assert.equal(f.game.version,version+1);assert.equal(f.game.history.length,0);assert.equal(f.game.board[1][4]?.type,'pawn');assert.equal(f.game.board[3][4],null);
 assert.equal(f.dispatches.length,2);assert.equal(f.dispatches[1].source,'voice_asr');assert.equal(f.dispatches[1].result.action.kind,'new_game');assert.equal(f.controller.pending,null);
 const afterReset=f.game.version;
 const duplicate=JSON.parse(await f.config.clientTools.propose_game_action({action:'new_game'}));
 assert.equal(duplicate.deduplicated,true);assert.equal(f.game.version,afterReset);assert.equal(f.dispatches.length,2);
});

test('recoverable SDK errors show a notice while the same connection keeps executing moves',async t=>{
 const errors=[];const f=await voiceFixture(t,{onError:error=>errors.push(error.message)});
 f.config.onError('Temporary network error');
 assert.match(errors.at(-1),/conexión/i);assert.ok(f.voice.session);assert.equal(f.ends,0);
 f.config.onMessage({source:'user',message:'peón de E2 a E4',event_id:'after-warning'});
 assert.equal(f.game.history.length,1);assert.equal(f.ends,0);
 f.config.onDisconnect();await f.voice.stop();assert.equal(f.voice.session,null);assert.equal(f.ends,1);
});

test('startup HTTP timeout aborts the request and permits a clean retry',async t=>{
 let first=true,signal;const statuses=[],errors=[];
 const voice=createVoiceSession({stop(){}},{requestTimeoutMs:10,cleanupTimeoutMs:10,onStatus:value=>statuses.push(value),onError:error=>errors.push(error.message),
  fetch:async(url,init)=>{if(url==='/api/session'&&first){first=false;signal=init.signal;return new Promise(()=>{});}return{ok:true,json:async()=>url==='/api/session'?{csrfToken:'x'}:{token:'x',leaseId:'test'}};},
  loadSDK:async()=>({Conversation:{startSession:async()=>({endSession(){},setVolume(){},getOutputVolume:()=>0})}})
 });t.after(()=>voice.stop());
 await assert.rejects(voice.start(),/no respondió/);assert.equal(signal.aborted,true);assert.equal(statuses.at(-1),'disconnected');assert.ok(errors.length);
 await voice.start();assert.ok(voice.session);assert.equal(statuses.at(-1),'connected');
});

test('SDK connection timeout releases its lease and a late session cannot replace a retry',async t=>{
 let late,started=0,lateEnded=0;const statuses=[],ends=[],finished=[];
 const session={endSession(){},setVolume(){},getOutputVolume:()=>0};
 const voice=createVoiceSession({stop(){}},{connectTimeoutMs:10,cleanupTimeoutMs:10,onStatus:value=>statuses.push(value),onEnd:value=>ends.push(value),
  fetch:async(url,init)=>{if(url==='/api/voice/finish')finished.push(JSON.parse(init.body).leaseId);return{ok:true,json:async()=>url==='/api/session'?{csrfToken:'x'}:{token:'x',leaseId:`lease-${started}`}};},
  loadSDK:async()=>({Conversation:{startSession:()=>++started===1?new Promise(resolve=>{late=resolve;}):Promise.resolve(session)}})
 });t.after(()=>voice.stop());
 await assert.rejects(voice.start(),/no respondió/);assert.deepEqual(finished,['lease-0']);
 await voice.start();assert.equal(voice.session,session);const count=ends.length;
 late({endSession(){lateEnded++;},setVolume(){}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(lateEnded,1);assert.equal(voice.session,session);assert.equal(statuses.at(-1),'connected');assert.equal(ends.length,count);
});

test('failure is visible immediately even when hangup and lease cleanup never answer',async t=>{
 let configuration;const statuses=[],errors=[];
 const voice=createVoiceSession({stop(){}},{cleanupTimeoutMs:10,onStatus:value=>statuses.push(value),onError:error=>errors.push(error.message),
  fetch:async url=>url==='/api/voice/finish'?new Promise(()=>{}):{ok:true,json:async()=>url==='/api/session'?{csrfToken:'x'}:{token:'x',leaseId:'test'}},
  loadSDK:async()=>({Conversation:{startSession:async options=>{configuration=options;return{setVolume(){return new Promise(()=>{});},endSession(){return new Promise(()=>{});},getOutputVolume:()=>0};}}})
 });t.after(()=>voice.stop());await voice.start();
 for(let i=0;i<81;i++)configuration.onMessage({source:'user',message:'hola'});
 assert.equal(statuses.at(-1),'disconnected');assert.match(errors.at(-1),/bucle/);assert.equal(voice.session,null);
 await voice.stop();
});

test('voice token rejections explain active call, rate limit and budget separately',async()=>{
 for(const [code,pattern] of [['active',/otra llamada activa/],['rate',/varias llamadas/],['budget',/presupuesto/]]){
  const voice=createVoiceSession({stop(){}},{fetch:async url=>({ok:url==='/api/session',status:429,json:async()=>url==='/api/session'?{csrfToken:'x'}:{error:code}}),loadSDK:async()=>({})});
  await assert.rejects(voice.start(),pattern);
 }
});

test('microphone denial and missing device yield specific recoverable startup messages',async()=>{
 for(const [name,pattern] of [['NotAllowedError',/Permite el micrófono/],['NotFoundError',/conectado y disponible/]]){
  const voice=createVoiceSession({stop(){}},{fetch:async url=>({ok:true,json:async()=>url==='/api/session'?{csrfToken:'x'}:{token:'x',leaseId:'test'}}),loadSDK:async()=>({Conversation:{startSession:async()=>{throw Object.assign(Error('SDK startup failed'),{name});}}})});
  await assert.rejects(voice.start(),pattern);
 }
});


test('online queued ASR and model echoes remain deduplicated through server acknowledgement and version advances',async t=>{
 const {ChessGame}=await import('../src/rules.mjs');const {createCommandController}=await import('../src/commands.mjs');
 const game=new ChessGame(),requests=[],acks=[];
 const controller=createCommandController(game,{executeAction:action=>{requests.push(action);return{ok:true,queued:true,requestedAction:action,speak:'Enviando...'};}});
 const f=await voiceFixture(t,{controller,onActionResult:value=>acks.push(value)});
 f.config.onMessage({source:'user',message:'peon de E2 a E4',event_id:'first'});
 assert.equal(requests.length,1);assert.equal(game.history.length,0);assert.equal(f.dispatches[0].executed,false);
 assert.match(f.contexts.at(-1),/espera el resultado del servidor/);
 game.version++;
 let echo=JSON.parse(await f.config.clientTools.propose_move({from:'E2',to:'E4'}));
 assert.equal(echo.deduplicated,true);assert.equal(echo.queued,true);assert.equal(echo.action,undefined);
 f.config.onMessage({source:'user',message:'peon de E2 a E4',event_id:'new-duplicate'});
 assert.equal(requests.length,1);assert.equal(f.dispatches.length,1);
 game.move({from:'E2',to:'E4'});
 controller.notifyResult({ok:true,action:{move:{to:'E4',from:'E2'},kind:'move'},speak:'Movimiento a E4 realizado.'});
 assert.equal(acks.length,1);assert.match(f.contexts.at(-1),/Movimiento a E4 realizado/);
 f.config.onMessage({source:'user',message:'gracias',event_id:'thanks'});game.move({from:'A7',to:'A6'});
 echo=JSON.parse(await f.config.clientTools.propose_move({from:'E2',to:'E4'}));
 assert.equal(echo.deduplicated,true);assert.equal(echo.queued,false);assert.equal(echo.action.kind,'move');
 assert.equal(requests.length,1);assert.equal(game.history.length,2);
});

test('online client-tool-only queued writes cannot execute twice and server errors are reported honestly',async t=>{
 const {ChessGame}=await import('../src/rules.mjs');const {createCommandController}=await import('../src/commands.mjs');
 const game=new ChessGame(),requests=[],acks=[];
 const controller=createCommandController(game,{executeAction:action=>{requests.push(action);return{ok:true,queued:true,requestedAction:action,speak:'Enviando...'};}});
 const f=await voiceFixture(t,{controller,onActionResult:value=>acks.push(value)});
 f.config.onMessage({source:'user',message:'Adelanta el soldado del rey dos pasos',event_id:'first'});
 await f.config.clientTools.propose_move({from:'E2',to:'E4'});game.version++;
 const duplicate=JSON.parse(await f.config.clientTools.propose_move({from:'E2',to:'E4'}));
 assert.equal(duplicate.queued,true);assert.equal(duplicate.deduplicated,true);assert.equal(requests.length,1);
 controller.notifyResult({ok:false,requestedAction:requests[0],speak:'La sala ya terminó.'});
 assert.equal(acks[0].result.ok,false);assert.match(f.contexts.at(-1),/La sala ya terminó/);
 f.config.onMessage({source:'user',message:'gracias',event_id:'thanks'});
 const late=JSON.parse(await f.config.clientTools.propose_move({from:'E2',to:'E4'}));
 assert.equal(late.ok,false);assert.equal(late.queued,false);assert.equal(late.deduplicated,true);assert.equal(late.speak,'La sala ya terminó.');
 assert.equal(requests.length,1);assert.equal(game.history.length,0);
});

test('fruit ASR and SDK echoes transform once while the same voice call stays connected',async t=>{
 const f=await voiceFixture(t);
 const initial=JSON.parse(f.contexts[0].split(' Datos: ')[1]);
 assert.equal(initial.tool,'get_board');assert.equal(initial.result.fruits.length,4);
 assert.ok(initial.result.eligiblePawns.includes('E2'));
 const before=f.game.version;
 const transcript={source:'user',message:'Dale Gomu Gomu al peón de E2',event_id:'fruit'};
 f.config.onMessage(transcript);
 assert.equal(f.dispatches.at(-1).name,'propose_fruit');
 assert.equal(f.dispatches.at(-1).result.ok,true);
 assert.equal(f.game.board[1][4].type,'queen');
 assert.equal(f.game.version,before+1);assert.equal(f.game.history.length,1);
 assert.equal(f.controller.pending,null);
 f.config.onMessage(transcript);
 const echo=JSON.parse(await f.config.clientTools.propose_fruit({square:'e2',fruit:'gomu-gomu'}));
 assert.equal(echo.deduplicated,true);assert.equal(echo.action.kind,'fruit');
 assert.equal(f.game.history.length,1);assert.equal(f.dispatches.length,1);
 f.config.onMessage({source:'user',message:'Dale Mera Mera al peón de D2',event_id:'other-fruit'});
 assert.equal(f.game.board[1][3].type,'knight');assert.equal(f.game.history.length,2);
 assert.equal(f.dispatches.length,2);assert.ok(f.voice.session);assert.equal(f.ends,0);
});

test('queued fruit dedup and acknowledgements compare both fruit ID and origin square',async t=>{
 const {ChessGame}=await import('../src/rules.mjs');const {createCommandController}=await import('../src/commands.mjs');
 const game=new ChessGame(),requests=[];
 const controller=createCommandController(game,{executeAction:action=>{requests.push(action);return{ok:true,queued:true,requestedAction:action,speak:'Enviando...'};}});
 const f=await voiceFixture(t,{controller});
 const commands=[['E2','gomu-gomu','Dale Gomu Gomu al peón de E2'],['E2','ope-ope','Dale Ope Ope al peón de E2'],['D2','gomu-gomu','Dale Gomu Gomu al peón de D2']];
 for(const [square,fruit,message] of commands){
  f.config.onMessage({source:'user',message,event_id:fruit+square});
  const echo=JSON.parse(await f.config.clientTools.propose_fruit({square,fruit}));
  assert.equal(echo.deduplicated,true);assert.equal(echo.queued,true);
 }
 assert.equal(requests.length,3);assert.equal(game.history.length,0);
 game.useDevilFruit({square:'E2',fruit:'gomu-gomu'});
 controller.notifyResult({ok:true,action:{kind:'fruit',square:'E2',fruit:'gomu-gomu'},speak:'Peón de E2 transformado en reina.'});
 f.config.onMessage({source:'user',message:'gracias',event_id:'after-ack'});
 const first=JSON.parse(await f.config.clientTools.propose_fruit({square:'e2',fruit:'gomu-gomu'}));
 assert.equal(first.deduplicated,true);assert.equal(first.queued,false);assert.equal(first.action.fruit,'gomu-gomu');
 for(const [square,fruit] of commands.slice(1)){
  const pending=JSON.parse(await f.config.clientTools.propose_fruit({square,fruit}));
  assert.equal(pending.deduplicated,true);assert.equal(pending.queued,true);assert.equal(pending.action,undefined);
 }
 controller.notifyResult({ok:false,requestedAction:{kind:'fruit',square:'E2',fruit:'ope-ope'},speak:'La pieza ya no es un peón.'});
 const failed=JSON.parse(await f.config.clientTools.propose_fruit({square:'E2',fruit:'ope-ope'}));
 assert.equal(failed.ok,false);assert.equal(failed.queued,false);assert.match(failed.speak,/ya no es un peón/);
 const unrelated=JSON.parse(await f.config.clientTools.propose_fruit({square:'D2',fruit:'gomu-gomu'}));
 assert.equal(unrelated.queued,true);assert.equal(unrelated.ok,true);
 assert.equal(requests.length,3);assert.equal(game.history.length,1);assert.ok(f.voice.session);assert.equal(f.ends,0);
});

test('client-tool fruit calls execute unrecognized language once and preserve direct mode',async t=>{
 const f=await voiceFixture(t);
 f.config.onMessage({source:'user',message:'Quiero darle elasticidad al soldado del rey',event_id:'unparsed'});
 assert.equal(f.dispatches.length,0);
 const result=JSON.parse(await f.config.clientTools.propose_fruit({square:'E2',fruit:'gomu-gomu'}));
 assert.equal(result.ok,true);assert.equal(result.action.kind,'fruit');assert.equal(f.game.board[1][4].type,'queen');
 assert.equal(f.controller.pending,null);assert.equal(f.game.history.length,1);
 const echo=JSON.parse(await f.config.clientTools.propose_fruit({square:'E2',fruit:'gomu-gomu'}));
 assert.equal(echo.deduplicated,true);assert.equal(f.game.history.length,1);assert.ok(f.voice.session);
});

test('voice configuration teaches all fruit powers within the existing provider budget',async()=>{
 const {buildAgentConfig}=await import('../scripts/sync-voice-agent.mjs');
 const config=buildAgentConfig(),agent=config.conversation_config.agent;
 assert.ok(Buffer.byteLength(JSON.stringify(agent),'utf8')<=8192);
 for(const [fruit,piece] of [['gomu-gomu','reina'],['mera-mera','caballo'],['ope-ope','torre'],['gora-gora','alfil']])assert.ok(agent.prompt.prompt.includes(`(${fruit})=${piece}`));
 assert.match(agent.prompt.prompt,/consulta get_board/);assert.match(agent.prompt.prompt,/propose_fruit/);
 assert.match(agent.prompt.prompt,/Si da jaque pasa turno al rival/);
 const tool=agent.prompt.tools.find(tool=>tool.name==='propose_fruit');assert.ok(tool);
 assert.deepEqual(tool.parameters.required,['square','fruit']);
 assert.equal(agent.prompt.max_tokens,128);assert.equal(config.conversation_config.conversation.max_duration_seconds,300);
 assert.deepEqual(config.platform_settings.call_limits,{agent_concurrency_limit:1,daily_limit:20,bursting_enabled:false});
 assert.equal(config.platform_settings.auth.enable_auth,true);assert.equal(config.platform_settings.privacy.record_voice,false);
});

test('initial voice context includes fruit stock and eligible pawns for every crew',async t=>{
 const {ChessGame}=await import('../src/rules.mjs');const {createCommandController}=await import('../src/commands.mjs');
 const {CREWS}=await import('../src/roster.mjs');
 for(const crew of Object.keys(CREWS)){
  const controller=createCommandController(new ChessGame(),{crew});
  const f=await voiceFixture(t,{controller});
  const initial=JSON.parse(f.contexts[0].split(' Datos: ')[1]);
  assert.equal(initial.result.fruits?.length,4,crew);assert.equal(initial.result.eligiblePawns?.length,8,crew);
  assert.ok(Buffer.byteLength(JSON.stringify(initial),'utf8')<=4096,crew);
  await f.voice.stop();
 }
});
