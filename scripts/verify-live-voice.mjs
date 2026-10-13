import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const flags=process.argv.slice(2);
const third=flags.includes('--third');
const mode=flags.includes('--mock')?'mock':flags.includes('--preflight')?'ready':flags.includes('--prepare-tts')?'tts':flags.includes('--run')?'live':flags.includes('--reconcile')?'reconcile':null;
if(!mode)throw Error('Use --mock, --preflight, --prepare-tts, --run or --reconcile');
const local=resolve('.local',mode==='mock'?'voice-adapter-resume':third?'voice-probe-3':'voice-probe-2');
const base=process.env.PROBE_URL||'http://localhost:3042';
await mkdir(local,{recursive:true});
const phrases=third?['Chopper de Delta dos a Delta cuatro.','Alto.']:['Selecciona a Zoro.','Mueve el peón de la casilla E dos a la casilla E cuatro.','Sí, confirmo.','Mueve el peón de la casilla D dos a la casilla D cuatro.','Alto.'];

async function reserve(file,value){await writeFile(resolve(local,file),JSON.stringify({...value,startedAt:new Date().toISOString()},null,2),{flag:'wx'});}
async function verifyProviderReady(){
 const statusResponse=await fetch('https://status.elevenlabs.io/api/v2/components.json',{signal:AbortSignal.timeout(15000)});
 if(!statusResponse.ok)throw Error('Vendor public readiness status unavailable; paid probe held');
 const status=await statusResponse.json(),conversations=status.components?.find(component=>component.name==='Conversations');
 if(conversations?.status!=='operational')throw Error('ElevenLabs Conversations status '+(conversations?.status||'unknown')+'; paid probe held without creating a paid marker');
 const key=process.env.ELEVENLABS_API_KEY;if(!key)throw Error('Personal project ELEVENLABS_API_KEY missing');
 const owned=JSON.parse(await readFile('.local/voice-agent.json','utf8'));
 if(owned.agentId!=='agent_4001m4snq7mxed9v9a1z9d1jdhc7'||owned.agentId!==process.env.ELEVENLABS_AGENT_ID)throw Error('Refusing a voice call outside the owned personal agent');
 const response=await fetch('https://api.elevenlabs.io/v1/convai/agents/'+encodeURIComponent(owned.agentId),{headers:{'xi-api-key':key,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Vendor readiness read failed '+response.status+'; no paid marker or request created');
 const live=await response.json();
 if(live.platform_settings?.auth?.enable_auth!==true||live.platform_settings?.call_limits?.daily_limit!==4||live.platform_settings?.call_limits?.agent_concurrency_limit!==1||live.platform_settings?.call_limits?.bursting_enabled!==false||live.conversation_config?.conversation?.max_duration_seconds!==300||live.conversation_config?.agent?.prompt?.max_tokens!==128||live.conversation_config?.agent?.prompt?.tools?.length!==11)throw Error('Live personal provider limits differ from approved limits');
 return owned;
}
async function prepareTTS(){
 await verifyProviderReady();
 const key=process.env.ELEVENLABS_API_KEY;if(!key)throw Error('Personal project ELEVENLABS_API_KEY missing');
 const characters=phrases.join('').length;
 const maximumUSD=third?0.04:0.05;
 if(characters*0.30/1000>maximumUSD)throw Error('Additional TTS input exceeds its authorized conservative reservation');
 await reserve('tts-reserved.json',{maximumUSD,characters,provider:'personal ElevenLabs',mode:'SYNTHETIC_INPUT',phrases});
 for(let i=0;i<phrases.length;i++){
  const r=await fetch('https://api.elevenlabs.io/v1/text-to-speech/yBC2mYQTcyyzcXPWTrFD?output_format=mp3_44100_128',{method:'POST',headers:{'xi-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({text:phrases[i],model_id:'eleven_flash_v2_5'}),signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('Personal TTS failed '+r.status+'; marker retained, no automatic retry');
  await writeFile(resolve(local,i+'.mp3'),Buffer.from(await r.arrayBuffer()));
 }
 const args=['-y'];for(let i=0;i<phrases.length;i++)args.push('-i',resolve(local,i+'.mp3'));
 const waits=third?[10,25,10]:[10,12,15,15,12,20];
 const filters=[],concat=[];
 for(let i=0;i<waits.length;i++){
  filters.push('anullsrc=r=48000:cl=mono:d='+waits[i]+'[s'+i+']');concat.push('[s'+i+']');
  if(i<phrases.length){filters.push('['+i+':a]aresample=48000,aformat=channel_layouts=mono[a'+i+']');concat.push('[a'+i+']');}
 }
 filters.push(concat.join('')+'concat=n='+(phrases.length*2+1)+':v=0:a=1[out]');
 args.push('-filter_complex',filters.join(';'),'-map','[out]','-c:a','pcm_s16le',resolve(local,'input.wav'));
 execFileSync('ffmpeg',args,{stdio:'ignore'});
 console.log(JSON.stringify({ttsPrepared:true,characters,reservationUSD:maximumUSD,directory:local}));
}
async function openBrowser(fakeAudio=false){
 const {chromium}=await import('playwright');
 const server=await chromium.launchServer({headless:true,args:fakeAudio?['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+resolve(local,'input.wav'),'--autoplay-policy=no-user-gesture-required']:[]});
 const close=async()=>{let timer;try{await Promise.race([server.close(),new Promise(resolve=>{timer=setTimeout(()=>{void server.kill();resolve();},5000);})]);}finally{clearTimeout(timer);}};
 try{
  const browser=await chromium.connect(server.wsEndpoint());
  const context=await browser.newContext({permissions:['microphone'],viewport:{width:1440,height:1000}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
  await page.locator('input[type=password]').fill(process.env.APP_PASSWORD||'12345');
  await Promise.all([page.waitForURL(new URL('/',base).href,{waitUntil:'domcontentloaded'}),page.locator('button').click()]);
  await page.waitForFunction(()=>window.chessApp?.voice);
  await page.evaluate(()=>window.chessApp.whenReady);
  return {page,errors,close};
 }catch(error){await close();throw error;}
}
async function mockProof(){
 const harness=await openBrowser();
 try{
  const result=await harness.page.evaluate(async()=>{
   const a=window.chessApp;a.setAI(false);await new Promise(resolve=>setTimeout(resolve,50));
   const {createVoiceSession}=await import('/src/voice.mjs');
   let config,ended=0;const tools=[],contexts=[],ignored=[],volumes=[],registry=[];
   const original=a.commands.runTool;
   a.commands.runTool=(name,args,context)=>{registry.push({name,args,source:context.source});return original(name,args,context);};
   const voice=createVoiceSession(a.commands,{
    speechEndDelayMs:0,onToolResult:value=>tools.push(value),onToolIgnored:value=>ignored.push(value),
    fetch:async url=>({ok:true,json:async()=>url==='/api/session'?{csrfToken:'MOCK_NOT_REAL'}:{token:'MOCK_NOT_REAL',leaseId:'MOCK_NOT_REAL'}}),
    loadSDK:async()=>({Conversation:{startSession:async options=>{config=options;return{getOutputVolume:()=>0,setVolume:async({volume})=>volumes.push(volume),endSession:async()=>ended++,sendContextualUpdate:value=>contexts.push(value)};}}})
   });
   try{
    await voice.start();
    config.onMessage({source:'user',message:'Selecciona a Zoro.',event_id:1});
    const selection={square:a.commands.selected,highlights:a.view.highlights.children.length};
    config.onMessage({source:'user',message:'Mueve el peón de la casilla E dos a la casilla E cuatro.',event_id:2});
    const proposal={id:a.commands.pending?.id,state:a.commands.pending?.state,source:a.commands.pending?.action.move.from,selected:a.commands.selected,highlights:a.view.highlights.children.length};
    config.onMessage({source:'user',message:'Mueve el peón de la casilla E dos a la casilla E cuatro.',event_id:2});
    const duplicate=JSON.parse(await config.clientTools.propose_move({from:'E2',to:'E4'}));
    const beforeConfirmation=a.game.fen();
    config.onMessage({source:'user',message:'Sí, confirmo.',event_id:3});
    const armed=a.commands.pending?.state;
    config.onModeChange({mode:'speaking'});config.onModeChange({mode:'listening'});
    for(let i=0;i<120&&!a.game.board[3][4];i++)await new Promise(resolve=>setTimeout(resolve,50));
    for(let i=0;i<100&&a.busy;i++)await new Promise(resolve=>setTimeout(resolve,50));
    const moved=a.game.fen(),executedContext=contexts.some(text=>text.includes('action_result'));
    await a.loadFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    config.onMessage({source:'user',message:'Peón de D dos a D cuatro.',event_id:4});
    const stopProposal=a.commands.pending?.id;
    config.onMessage({source:'user',message:'Sí, confirma.',event_id:5});
    config.onModeChange({mode:'speaking'});config.onModeChange({mode:'listening'});
    config.onMessage({source:'user',message:'¡Alto!',event_id:6});
    await new Promise(resolve=>setTimeout(resolve,4500));
    const stopped={pending:a.commands.pending,session:!!voice.session,fen:a.game.fen(),ended,volumes};
    return {mode:'FREE_BROWSER_CALLBACK_INJECTION_NOT_LIVE',humanMicrophoneVerified:false,selection,proposal,beforeConfirmation,armed,moved,duplicate,stopProposal,stopped,executedContext,tools,ignored,registry,contexts};
   }finally{await voice.stop();a.commands.runTool=original;}
  });
  result.errors=harness.errors;result.passed=false;
  await writeFile(resolve(local,'evidence.json'),JSON.stringify(result,null,2));
  await harness.page.screenshot({path:resolve(local,'stopped.png')});
  assert.equal(result.selection.square,'D1');assert.equal(result.selection.highlights,1);
  assert.equal(result.proposal.selected,'E2');assert.equal(result.proposal.highlights,3);
  assert.equal(result.proposal.state,'proposed');assert.equal(result.armed,'armed');
  assert.equal(result.duplicate.proposal.id,result.proposal.id);assert.equal(result.duplicate.deduplicated,true);
  assert.match(result.beforeConfirmation,/PPPPPPPP/);assert.match(result.moved,/4P3/);
  assert.equal(result.stopped.pending,null);assert.equal(result.stopped.session,false);assert.equal(result.stopped.ended,1);assert.deepEqual(result.stopped.volumes,[0]);
  assert.match(result.stopped.fen,/PPPPPPPP/);assert.equal(result.executedContext,true);assert.equal(result.errors.length,0);
  assert.equal(result.tools.length,6);assert.equal(result.ignored.length,1);
  assert.ok(result.registry.every(entry=>entry.source==='voice_asr'));
  result.passed=true;
  await writeFile(resolve(local,'evidence.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({result:'FREE_ASR_BROWSER_OK',mode:result.mode,tools:result.tools.map(tool=>tool.name),deduplicated:result.ignored.length,selection:result.selection.square,legalHighlights:result.proposal.highlights,confirmedMove:'E2E4',stoppedMove:'D2D4',humanMicrophoneVerified:false}));
 }finally{await harness.close();}
}
async function liveProbe(){
 await access(resolve(local,'input.wav'));
 // The first probe's immutable artifacts and paid marker are never reused or overwritten.
 await access(resolve('.local/voice-probe/call-reserved.json'));
 if(third)await access(resolve('.local/voice-probe-2/call-reserved.json'));
 const agent=await verifyProviderReady();
 if(agent.agentId!=='agent_4001m4snq7mxed9v9a1z9d1jdhc7'||agent.private!==true||agent.toolCount!==11||agent.maxSeconds!==300)throw Error('Owned private agent preflight failed');
 const mock=JSON.parse(await readFile('.local/voice-adapter-resume/evidence.json','utf8'));
 if(mock.passed!==true||mock.mode!=='FREE_BROWSER_CALLBACK_INJECTION_NOT_LIVE'||mock.stopped?.session!==false||mock.tools?.length!==6||!mock.executedContext)throw Error('Free browser proof must pass before final authorized call');
 await reserve('call-reserved.json',{reservationUSD:1.5,mode:'SYNTHETIC_LOOPBACK',agentId:agent.agentId,attempt:third?3:2,maximumTotalAttempts:third?3:2,humanMicrophoneVerified:false});
 const harness=await openBrowser(true),{page}=harness;
 try{
  await page.evaluate(async third=>{
   const a=window.chessApp;a.setAI(!third);await new Promise(resolve=>setTimeout(resolve,50));
   const {Conversation}=await import('/vendor/voice/index.mjs');
   const real=Conversation.startSession.bind(Conversation);
   window.probe={events:[],clientToolCalls:[],registryDispatches:[],actionResults:[],contextUpdates:[],frames:[],maxOutput:0,audioPlays:0,volumeChanges:[],endSessionCalls:0};
   const original=a.commands.runTool;
   a.commands.runTool=(name,args,context)=>{const result=original(name,args,context);window.probe.registryDispatches.push({name,args,source:context.source,result:structuredClone(result),time:Date.now(),selected:a.commands.selected,pending:a.commands.pending?{id:a.commands.pending.id,state:a.commands.pending.state}:null,highlights:a.view.highlights.children.length,fen:a.game.fen()});return result;};
   a.commands.subscribe((event,result)=>{if(event==='onResult')window.probe.actionResults.push({result,time:Date.now(),fen:a.game.fen()});});
   const play=HTMLMediaElement.prototype.play;
   HTMLMediaElement.prototype.play=function(){window.probe.audioPlays++;return play.apply(this,arguments);};
   Conversation.startSession=async options=>{
    for(const key of ['onMessage','onModeChange','onStatusChange','onError']){const cb=options[key];options[key]=value=>{window.probe.events.push({key,value,time:Date.now()});cb?.(value);};}
    for(const[name,fn]of Object.entries(options.clientTools))options.clientTools[name]=async args=>{const result=await fn(args);window.probe.clientToolCalls.push({name,args,result,time:Date.now()});return result;};
    const session=await real(options);
    window.probe.conversationId=session.getId();
    const setVolume=session.setVolume.bind(session),endSession=session.endSession.bind(session);
    session.setVolume=options=>{window.probe.volumeChanges.push({volume:options.volume,time:Date.now()});return setVolume(options);};
    session.endSession=()=>{window.probe.endSessionCalls++;return endSession();};
    const contextUpdate=session.sendContextualUpdate.bind(session);
    session.sendContextualUpdate=(text,options)=>{window.probe.contextUpdates.push({text,time:Date.now()});return contextUpdate(text,options);};
    return session;
   };
   window.probeTimer=setInterval(()=>{const v=a.voice.session?.getOutputVolume?.()||0;window.probe.maxOutput=Math.max(window.probe.maxOutput,v);window.probe.frames.push({time:Date.now(),fen:a.game.fen(),selected:a.commands.selected,pending:a.commands.pending?{id:a.commands.pending.id,state:a.commands.pending.state}:null,volume:v,highlights:a.view.highlights.children.length,metrics:a.voice.metrics});},200);
  },third);
  await page.locator('#voice-orb').click();await page.locator('#voice-connect').click();
  for(let i=0;i<(third?7:13);i++){
   await page.waitForTimeout(10000);
   const state=await page.evaluate(()=>({conversationId:window.probe.conversationId,registry:window.probe.registryDispatches.map(tool=>({name:tool.name,source:tool.source})),clientTools:window.probe.clientToolCalls.map(tool=>tool.name),maxOutput:window.probe.maxOutput,session:!!window.chessApp.voice.session}));
   console.log(JSON.stringify(state));if(state.conversationId&&!state.session)break;
   if(!third||i===1)await page.screenshot({path:resolve(local,'frame-'+i+'.png'),timeout:15000});
  }
  await page.evaluate(async()=>{clearInterval(window.probeTimer);await window.chessApp.voice.stop();});
  const evidence=await page.evaluate(()=>({...window.probe,final:window.chessApp.snapshot(),mode:'SYNTHETIC_LOOPBACK',humanMicrophoneVerified:false}));
  evidence.errors=harness.errors;
  evidence.acceptance=third?{audio:evidence.maxOutput>0&&evidence.audioPlays>0,asr:evidence.events.some(event=>event.key==='onMessage'&&event.value.source==='user'),proposal:evidence.registryDispatches.some(tool=>tool.source==='voice_asr'&&tool.name==='propose_move'&&tool.result.proposal?.action.move.from==='D2'&&tool.result.proposal?.action.move.to==='D4'),pendingBeforeStop:evidence.frames.some(frame=>frame.pending&&frame.time<(evidence.registryDispatches.find(tool=>tool.source==='voice_asr'&&tool.name==='stop_action')?.time||0)),stop:evidence.registryDispatches.some(tool=>tool.source==='voice_asr'&&tool.name==='stop_action'),muted:evidence.volumeChanges.some(change=>change.volume===0),disconnected:evidence.endSessionCalls>0,noMove:evidence.actionResults.length===0&&evidence.final.fen==='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',humanMicrophone:false}:{audio:evidence.maxOutput>0&&evidence.audioPlays>0,asr:evidence.events.some(event=>event.key==='onMessage'&&event.value.source==='user'),selection:evidence.registryDispatches.some(tool=>tool.source==='voice_asr'&&tool.name==='select_piece'&&tool.result.square==='D1'),proposal:evidence.registryDispatches.some(tool=>tool.source==='voice_asr'&&tool.name==='propose_move'&&tool.result.proposal?.action.move.from==='E2'&&tool.result.proposal?.action.move.to==='E4'),confirmedMove:evidence.actionResults.some(action=>action.result.record?.from==='E2'&&action.result.record?.to==='E4'),stop:evidence.registryDispatches.some(tool=>tool.source==='voice_asr'&&tool.name==='stop_action'),humanMicrophone:false};
  evidence.engineeringPassed=Object.entries(evidence.acceptance).filter(([key])=>key!=='humanMicrophone').every(([,value])=>value)&&evidence.errors.length===0;
  await writeFile(resolve(local,'evidence.json'),JSON.stringify(evidence,null,2),{flag:'wx'});
  console.log(JSON.stringify({result:evidence.engineeringPassed?'SYNTHETIC_TRANSPORT_OK':'SYNTHETIC_TRANSPORT_FAILED',conversationId:evidence.conversationId,acceptance:evidence.acceptance,actualClientToolCalls:evidence.clientToolCalls.length,registryASRDispatches:evidence.registryDispatches.filter(tool=>tool.source==='voice_asr').length}));
  if(!evidence.engineeringPassed)process.exitCode=1;
 }finally{await harness.close();}
}
async function reconcile(){
 const key=process.env.ELEVENLABS_API_KEY;if(!key)throw Error('Personal project key missing');
 const evidence=JSON.parse(await readFile(resolve(local,'evidence.json'),'utf8'));
 if(!evidence.conversationId)throw Error('No conversation ID recorded; no extra token/call will be created');
 const response=await fetch('https://api.elevenlabs.io/v1/convai/conversations/'+encodeURIComponent(evidence.conversationId),{headers:{'xi-api-key':key},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Vendor conversation read failed '+response.status);
 const vendor=await response.json();
 await writeFile(resolve(local,'vendor-evidence.json'),JSON.stringify({conversationId:evidence.conversationId,status:vendor.status,metadata:vendor.metadata,analysis:vendor.analysis,transcript:vendor.transcript},null,2));
 console.log(JSON.stringify({conversationId:evidence.conversationId,status:vendor.status,seconds:vendor.metadata?.call_duration_secs,totalCostUSD:vendor.metadata?.cost_fiat,platformUSD:vendor.metadata?.charging?.platform_price,llmUSD:vendor.metadata?.charging?.llm_price,ttsCharacters:vendor.metadata?.charging?.tts_usage?.total_characters,asrAudioSeconds:vendor.metadata?.charging?.asr_usage?.total_audio_input_seconds,clientToolCalls:vendor.transcript?.flatMap(turn=>turn.tool_calls||[]).filter(tool=>tool.type==='client').length,humanMicrophoneVerified:false}));
}
try{
 if(mode==='tts')await prepareTTS();else if(mode==='mock')await mockProof();else if(mode==='live')await liveProbe();else if(mode==='ready'){await verifyProviderReady();console.log(JSON.stringify({result:'VOICE_PROVIDER_READY',paidRequests:0}));}else await reconcile();
}catch(error){
 const markers=[];for(const file of ['tts-reserved.json','call-reserved.json'])try{await access(resolve(local,file));markers.push(file);}catch{}
 await writeFile(resolve(local,'last-error.json'),JSON.stringify({mode,error:error.message,paidMarkers:markers,time:new Date().toISOString()},null,2));
 console.error(error.message);process.exitCode=1;
}
