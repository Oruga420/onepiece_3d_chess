import test from 'node:test';import assert from 'node:assert/strict';import{createVoiceSession,registerWebMCP}from'../src/voice.mjs';import{TOOL_REGISTRY}from'../src/voice-registry.mjs';
test('native WebMCP registers exactly same11 and executes shared controller',async()=>{const tools=[];const doc={modelContext:{registerTool:t=>{tools.push(t);}}};let called;const bridge=await registerWebMCP({runTool:(...args)=>{called=args;return{ok:true};}},{document:doc,navigator:{}});assert.equal(bridge.mode,'native');assert.deepEqual(tools.map(t=>t.name),TOOL_REGISTRY.map(t=>t.name));const r=await tools[1].execute({from:'E2'});assert.equal(JSON.parse(r.content[0].text).ok,true);assert.equal(called[2].source,'webmcp');});
test('real SDK-shaped client tool dispatch; speech end; teardown',async()=>{let config,stops=0,ended=0,speech=0,calls=[];const controller={runTool:(name,args)=>({ok:true,speak:name,...args}),stop:()=>stops++,speechEnded:()=>speech++};const fetch=async(url,init)=>{calls.push([url,init]);return{ok:true,json:async()=>url==='/api/session'?{csrfToken:'csrf'}:{token:'ephemeral',leaseId:'lease'}};};const voice=createVoiceSession(controller,{speechEndDelayMs:0,fetch,loadSDK:async()=>({Conversation:{startSession:async options=>{config=options;return{setVolume:async()=>{},endSession:async()=>ended++,getOutputVolume:()=>0.2};}}})});await voice.start();assert.equal(config.connectionType,'webrtc');assert.equal(Object.keys(config.clientTools).length,11);assert.equal(JSON.parse(await config.clientTools.select_piece({from:'E2'})).speak,'select_piece');config.onModeChange({mode:'listening'});await new Promise(r=>setTimeout(r,2));assert.equal(speech,1);await voice.stop();assert.equal(ended,1);assert.ok(stops);assert.ok(calls.some(([url])=>url==='/api/voice/finish'));});
test('missing configuration fails honestly and does not call SDK',async()=>{let started=false;const voice=createVoiceSession({stop(){}},{fetch:async url=>({ok:url==='/api/session',status:503,json:async()=>({csrfToken:'csrf'})}),loadSDK:async()=>({Conversation:{startSession(){started=true;}}})});await assert.rejects(()=>voice.start(),/configuración personal/);assert.equal(started,false);});
test('voice budget disconnects after event cap and never returns oversized tool payload',async()=>{let config,ended=0;const voice=createVoiceSession({runTool:()=>({ok:true,speak:'x'.repeat(5000)}),stop(){},speechEnded(){}},{fetch:async url=>({ok:true,json:async()=>url==='/api/session'?{csrfToken:'csrf'}:{token:'x',leaseId:'y'}}),loadSDK:async()=>({Conversation:{startSession:async c=>{config=c;return{setVolume:async()=>{},endSession:async()=>ended++,getOutputVolume:()=>0};}}})});await voice.start();const reply=JSON.parse(await config.clientTools.get_board({}));assert.equal(reply.ok,false);assert.match(reply.speak,/demasiado largo/);for(let i=0;i<21;i++)config.onMessage({source:'user',message:'hola'});await new Promise(r=>setTimeout(r,5));assert.ok(ended>=1);await voice.stop();});
test('ElevenLabs ASR primary adapter changes authoritative board through shared registry',async t=>{const{ChessGame}=await import('../src/rules.mjs');const{createCommandController}=await import('../src/commands.mjs');const game=new ChessGame(),controller=createCommandController(game,{countdownMs:5});let config;const dispatches=[],contexts=[];const voice=createVoiceSession(controller,{speechEndDelayMs:0,onToolResult:r=>dispatches.push(r),fetch:async url=>({ok:true,json:async()=>url==='/api/session'?{csrfToken:'csrf'}:{token:'x',leaseId:'y'}}),loadSDK:async()=>({Conversation:{startSession:async c=>{config=c;return{setVolume:async()=>{},endSession:async()=>{},getOutputVolume:()=>0,sendContextualUpdate:v=>contexts.push(v)};}}})});t.after(()=>voice.stop());await voice.start();config.onMessage({source:'user',message:'Mueve a la reina.',event_id:1});assert.equal(controller.selected,'D1');config.onMessage({source:'user',message:'Mueve el peón de la casilla E dos a la casilla E cuatro.',event_id:2});const id=controller.pending.id;config.onMessage({source:'user',message:'Mueve el peón de la casilla E dos a la casilla E cuatro.',event_id:2});assert.equal(dispatches.length,2);assert.equal(JSON.parse(await config.clientTools.propose_move({from:'E2',to:'E4'})).proposal.id,id);config.onMessage({source:'user',message:'Sí, confirmo.',event_id:3});assert.equal(controller.pending.state,'armed');assert.equal(game.board[1][4].type,'pawn');config.onModeChange({mode:'speaking'});config.onModeChange({mode:'listening'});for(let i=0;i<100&&!game.board[3][4];i++)await new Promise(r=>setTimeout(r,10));assert.equal(game.board[3][4]?.type,'pawn');assert.equal(dispatches[0].source,'voice_asr');assert.ok(contexts.length>=3);assert.ok(contexts.some(text=>text.includes('action_result')));await voice.stop();});


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
test('ASR turn dedupes retransmission and late client tools without replaying the write',async t=>{
 const f=await voiceFixture(t);
 f.config.onMessage({source:'user',message:'Peón de EcoDos a E de España cuatro.',event_id:'move'});
 const id=f.controller.pending.id;
 f.config.onMessage({source:'user',message:'Peón de EcoDos a E de España cuatro.',event_id:'move'});
 assert.equal(f.dispatches.length,1);
 const late=JSON.parse(await f.config.clientTools.propose_move({from:'E2',to:'E4'}));
 assert.equal(late.deduplicated,true);assert.equal(late.proposal.id,id);assert.equal(f.dispatches.length,1);assert.equal(f.ignored.length,1);
 const invented=JSON.parse(await f.config.clientTools.confirm_action({id,words:'sí'}));
 assert.equal(invented.ok,false);assert.equal(f.controller.pending.state,'proposed');
 f.config.onMessage({source:'user',message:'Sí, por favor.',event_id:'yes'});
 assert.equal(f.controller.pending.state,'armed');
 const yes=JSON.parse(await f.config.clientTools.confirm_action({id,words:'sí, confirmo'}));
 assert.equal(yes.deduplicated,true);assert.equal(f.dispatches.length,2);
 assert.equal(f.voice.metrics.tools,2);
});
test('spoken stop immediately cancels, mutes and disconnects; late callbacks cannot move',async t=>{
 const f=await voiceFixture(t);
 f.config.onMessage({source:'user',message:'peón de E dos a E cuatro',event_id:1});
 f.config.onMessage({source:'user',message:'sí',event_id:2});
 f.config.onModeChange({mode:'speaking'});f.config.onModeChange({mode:'listening'});
 f.config.onMessage({source:'user',message:'¡Alto!',event_id:3});
 assert.equal(f.controller.pending,null);assert.equal(f.voice.session,null);assert.deepEqual(f.volumes,[0]);
 f.config.onMessage({source:'user',message:'sí',event_id:4});f.config.onModeChange({mode:'listening'});
 const late=JSON.parse(await f.config.clientTools.propose_move({from:'E2',to:'E4'}));
 assert.equal(late.ok,false);
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(f.game.board[1][4].type,'pawn');assert.equal(f.game.board[3][4],null);assert.equal(f.ends,1);
 assert.equal(f.dispatches.at(-1).source,'voice_asr');
});
test('fresh ASR event IDs permit the same name again; invalid coordinates never guess',async t=>{
 const f=await voiceFixture(t);
 for(const event_id of [1,2])f.config.onMessage({source:'user',message:'Zoro',event_id});
 assert.equal(f.controller.selected,'D1');assert.equal(f.dispatches.length,2);
 f.config.onMessage({source:'user',message:'peón de 1D2 a E4',event_id:3});
 assert.equal(f.dispatches.length,2);assert.equal(f.controller.pending,null);
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

test('recorded real ASR formal verb now proposes through primary registry and context distinguishes confirmation',async t=>{
 const f=await voiceFixture(t);
 f.config.onMessage({source:'user',message:'Mueva el peón de la casilla E2 a la casilla E4.',event_id:146});
 assert.equal(f.dispatches[0].name,'propose_move');assert.equal(f.dispatches[0].source,'voice_asr');
 assert.match(f.contexts.at(-1),/PROPUESTA SIN CONFIRMAR/);assert.equal(f.controller.pending.state,'proposed');
 f.config.onMessage({source:'user',message:'Sí, confirmo.',event_id:245});
 assert.match(f.contexts.at(-1),/CONFIRMACIÓN RECIBIDA/);assert.equal(f.controller.pending.state,'armed');
 assert.equal(f.game.board[1][4].type,'pawn');
 f.config.onMessage({source:'user',message:'Alto.',event_id:438});assert.equal(f.controller.pending,null);
});
