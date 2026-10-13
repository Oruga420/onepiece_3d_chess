import test from 'node:test';import assert from 'node:assert/strict';import{createVoiceSession,registerWebMCP}from'../src/voice.mjs';import{TOOL_REGISTRY}from'../src/voice-registry.mjs';
test('native WebMCP registers exactly same11 and executes shared controller',async()=>{const tools=[];const doc={modelContext:{registerTool:t=>{tools.push(t);}}};let called;const bridge=await registerWebMCP({runTool:(...args)=>{called=args;return{ok:true};}},{document:doc,navigator:{}});assert.equal(bridge.mode,'native');assert.deepEqual(tools.map(t=>t.name),TOOL_REGISTRY.map(t=>t.name));const r=await tools[1].execute({from:'E2'});assert.equal(JSON.parse(r.content[0].text).ok,true);assert.equal(called[2].source,'webmcp');});
test('real SDK-shaped voice tools omit confirmation and speech never starts a countdown',async()=>{let config,stops=0,ended=0,speech=0,calls=[];const controller={runTool:(name,args)=>({ok:true,speak:name,...args}),stop:()=>stops++,speechEnded:()=>speech++};const fetch=async(url,init)=>{calls.push([url,init]);return{ok:true,json:async()=>url==='/api/session'?{csrfToken:'csrf'}:{token:'ephemeral',leaseId:'lease'}};};const voice=createVoiceSession(controller,{speechEndDelayMs:0,fetch,loadSDK:async()=>({Conversation:{startSession:async options=>{config=options;return{setVolume:async()=>{},endSession:async()=>ended++,getOutputVolume:()=>0.2};}}})});await voice.start();assert.equal(config.connectionType,'webrtc');assert.equal(Object.keys(config.clientTools).length,10);assert.equal(config.clientTools.confirm_action,undefined);assert.equal(JSON.parse(await config.clientTools.select_piece({from:'E2'})).speak,'select_piece');config.onModeChange({mode:'listening'});await new Promise(r=>setTimeout(r,2));assert.equal(speech,0);await voice.stop();assert.equal(ended,1);assert.ok(stops);assert.ok(calls.some(([url])=>url==='/api/voice/finish'));});
test('missing configuration fails honestly and does not call SDK',async()=>{let started=false;const voice=createVoiceSession({stop(){}},{fetch:async url=>({ok:url==='/api/session',status:503,json:async()=>({csrfToken:'csrf'})}),loadSDK:async()=>({Conversation:{startSession(){started=true;}}})});await assert.rejects(()=>voice.start(),/configuración personal/);assert.equal(started,false);});
test('voice budget disconnects after event cap and never returns oversized tool payload',async()=>{let config,ended=0;const voice=createVoiceSession({runTool:()=>({ok:true,speak:'x'.repeat(5000)}),stop(){},speechEnded(){}},{fetch:async url=>({ok:true,json:async()=>url==='/api/session'?{csrfToken:'csrf'}:{token:'x',leaseId:'y'}}),loadSDK:async()=>({Conversation:{startSession:async c=>{config=c;return{setVolume:async()=>{},endSession:async()=>ended++,getOutputVolume:()=>0};}}})});await voice.start();const reply=JSON.parse(await config.clientTools.get_board({}));assert.equal(reply.ok,false);assert.match(reply.speak,/demasiado largo/);for(let i=0;i<21;i++)config.onMessage({source:'user',message:'hola'});await new Promise(r=>setTimeout(r,5));assert.ok(ended>=1);await voice.stop();});
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
test('combined messages and dispatches obey 20 events and real tools obey 10',async t=>{
 const f=await voiceFixture(t);
 for(let i=0;i<10;i++)await f.config.clientTools.get_board({});
 assert.equal(f.dispatches.length,10);assert.equal(f.voice.metrics.tools,10);
 await f.config.clientTools.get_board({});assert.equal(f.voice.session,null);assert.equal(f.dispatches.length,10);
 const g=await voiceFixture(t);
 for(let i=0;i<10;i++)g.config.onMessage({source:'ai',message:'mensaje'});
 for(let i=0;i<5;i++)g.config.onMessage({source:'user',message:'Zoro',event_id:i});
 assert.deepEqual(g.voice.metrics,{events:20,tools:5,userBytes:20,asrTurn:5});
 g.config.onMessage({source:'ai',message:'uno más'});assert.equal(g.voice.session,null);
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
 await voice.stop();resolveToken({ok:true,json:async()=>({token:'x',leaseId:'cancelled-lease'})});await pending;
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
 assert.equal(agent.prompt.tools.length,10);
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
