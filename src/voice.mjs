import {decodeVoiceCommand,normalize} from './commands.mjs';
import {TOOL_REGISTRY,VOICE_TOOL_REGISTRY} from './voice-registry.mjs';

export async function registerWebMCP(controller,{document:doc=globalThis.document,navigator:nav=globalThis.navigator}={}) {
 let context=doc?.modelContext||nav?.modelContext,mode=context?'native':'polyfill';
 if(!context){await new Promise((resolve,reject)=>{const script=doc.createElement('script');script.src='/vendor/webmcp/polyfill.js';script.onload=resolve;script.onerror=()=>reject(Error('No se pudo cargar WebMCP'));doc.head.append(script);});globalThis.WebMCPPolyfill.installWebMCP();context=doc.modelContext||nav?.modelContext;}
 if(!context?.registerTool)throw Error('WebMCP no disponible');
 const handles=[];
 for(const def of TOOL_REGISTRY){handles.push(await context.registerTool({name:def.name,description:def.description,inputSchema:def.inputSchema,annotations:{readOnlyHint:def.kind==='read',consequentialHint:def.kind==='consequential'},execute:async args=>({content:[{type:'text',text:JSON.stringify(controller.runTool(def.name,args,{source:'webmcp'}))}]})}));}
 return {mode,tools:TOOL_REGISTRY.map(t=>t.name),dispose(){for(const handle of handles)handle?.unregister?.();}};
}
const bytes=value=>new TextEncoder().encode(value).length;
function encodeResult(result){
 let encoded=JSON.stringify(result);
 if(bytes(encoded)>4096&&result.pieces)encoded=JSON.stringify({...result,pieces:result.pieces.map(p=>({square:p.square,type:p.piece.type,side:p.piece.player,name:p.name}))});
 return bytes(encoded)<=4096?encoded:JSON.stringify({ok:false,speak:'Resultado demasiado largo. Solicita una pieza o casilla concreta.'});
}
function sameAction(left,right){
 if(!left||!right||left.kind!==right.kind||left.value!==right.value||left.reason!==right.reason||left.square!==right.square||left.fruit!==right.fruit)return false;
 return ['move','intendedMove'].every(key=>['from','to','promotion'].every(field=>left[key]?.[field]===right[key]?.[field]));
}
function sameIntent(entry,name,args,controller){
 if(entry.name!==name)return false;
 if(!entry.result.action&&!entry.result.requestedAction&&entry.version!==controller.version)return false;
 if(name==='select_piece')return args.from?String(args.from).toUpperCase()===entry.result.square:normalize(args.piece)===normalize(entry.args.piece);
 if(name==='propose_fruit'){
  const action=entry.result.action||entry.result.requestedAction||entry.result.proposal?.action;
  return Boolean(action&&String(args.square).toUpperCase()===action.square&&args.fruit===action.fruit);
 }
 if(name==='propose_move'){
  const move=entry.result.action?.move||entry.result.requestedAction?.move||entry.result.proposal?.action?.move;
  return Boolean(move&&String(args.to).toUpperCase()===move.to&&(!args.from||String(args.from).toUpperCase()===move.from)&&(!args.piece||normalize(args.piece)===normalize(entry.args.piece))&&(args.promotion||null)===(move.promotion||null));
 }
 return JSON.stringify(args)===JSON.stringify(entry.args);
}
export function classifyVoiceError(error){
 const text=typeof error==='string'?error:`${error?.name||''} ${error?.message||''}`;
 if(/NotAllowedError|PermissionDenied|permission|denied|not allowed/i.test(text))return Error('Permite el micrófono en el navegador y vuelve a conectar.');
 if(/NotFoundError|NotReadableError|NotSupportedError|OverconstrainedError|SecurityError|getUserMedia|mediaDevices|no microphone/i.test(text))return Error('No se pudo abrir el micrófono. Comprueba que está conectado y disponible.');
 if(/network|connect|websocket|webrtc|livekit|timeout|timed out|socket|offline|fetch|\bice\b|1006/i.test(text))return Error('La conexión de voz no respondió. Comprueba tu conexión y vuelve a intentar.');
 return Error('El servicio de voz tuvo un problema. Si la llamada termina, vuelve a conectar.');
}
function bounded(task,ms,{signal,message='La conexión de voz no respondió a tiempo.'}={}){
 return new Promise((resolve,reject)=>{
  let timer,settled=false;
  const done=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value);};
  const abort=()=>done(reject,Object.assign(Error('Llamada cancelada.'),{name:'AbortError'}));
  Promise.resolve(task).then(value=>done(resolve,value),error=>done(reject,error));
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>done(reject,Error(message)),ms);
 });
}
export function createVoiceSession(controller,callbacks={}){
 let current=null,serial=0,lastClosing=null;
 const notify=(name,value)=>callbacks[name]?.(value);
 const fetcher=callbacks.fetch||globalThis.fetch;
 const load=callbacks.loadSDK||(()=>import('../vendor/voice/index.mjs'));
 const now=callbacks.now||Date.now;
 const requestTimeoutMs=callbacks.requestTimeoutMs??15000,connectTimeoutMs=callbacks.connectTimeoutMs??45000,cleanupTimeoutMs=callbacks.cleanupTimeoutMs??3000;
 const active=call=>current===call&&!call.closed;
 async function request(url,init={},signal){
  const aborter=new AbortController();
  const abort=()=>aborter.abort();signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  try{return await bounded(fetcher(url,{...init,signal:aborter.signal}).then(async response=>({response,data:await response.json().catch(()=>({}))})),requestTimeoutMs,{signal});}
  finally{abort();signal?.removeEventListener('abort',abort);}
 }
 async function finish(call){
  if(!call.leaseId)return;
  const lease=call.leaseId;call.leaseId=null;
  const aborter=new AbortController();
  try{await bounded(fetcher('/api/voice/finish',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':call.csrfToken},body:JSON.stringify({leaseId:lease}),signal:aborter.signal}),cleanupTimeoutMs);}catch{}finally{aborter.abort();}
 }
 async function endSession(session){
  if(!session)return;
  // A stuck audio operation must not prevent the actual hangup or lease release.
  try{await bounded(session.setVolume?.({volume:0}),cleanupTimeoutMs);}catch{}
  try{await bounded(session.endSession?.(),cleanupTimeoutMs);}catch{}
 }
 function close(call,{reason='stopped',error=null}={}){
  if(!call)return lastClosing;
  if(call.closed)return call.closePromise;
  call.closed=true;
  call.aborter.abort();
  call.endReason=reason;
  if(current===call)current=null;
  clearTimeout(call.hardTimer);clearTimeout(call.speechEndTimer);clearInterval(call.meter);call.unsubscribe?.();
  controller.stop();
  const session=call.session;call.session=null;
  // Publish failure before network cleanup: the user must always see the result
  // of clicking Connect, even if provider hangup or quota settlement is slow.
  if(serial===call.id){notify('onStatus','disconnected');if(error)notify('onError',error);}
  call.closePromise=(async()=>{
   await endSession(session);
   await finish(call);
   if(serial===call.id)notify('onEnd',{reason:call.endReason,callId:call.id,events:call.events,tools:call.tools});
  })();
  lastClosing=call.closePromise;
  return call.closePromise;
 }
 async function stop(){return close(current);}
 function budgetStop(call){void close(call,{reason:'rate_limit',error:Error('Demasiadas solicitudes de voz seguidas. La llamada se detuvo para evitar un bucle.')});}
 function count(call,{tool=false,message=null}={}){
  if(!active(call))return false;
  const userBytes=message?.source==='user'?bytes(message.message||''):0;
  call.events++;if(tool)call.tools++;call.userBytes+=userBytes;
  // Count bursts, not the lifetime of a conversation: a normal move generates
  // ASR, a dispatch, an LLM tool echo and narration. Cost stays bounded by the
  // server lease and the independent five-minute hard timer below.
  const at=now();
  call.recent=call.recent.filter(entry=>at-entry.at<10000);
  call.recent.push({at,tool,userBytes});
  if(call.recent.length>80||call.recent.filter(entry=>entry.tool).length>24||call.recent.reduce((sum,entry)=>sum+entry.userBytes,0)>8192){budgetStop(call);return false;}
  return true;
 }
 function boardContext(){
  const pending=controller.pending;
  return {version:controller.version,selected:controller.selected,pending:pending?{id:pending.id,state:pending.state,label:pending.label,action:pending.action,executeAt:pending.executeAt}:null};
 }
 function updateContext(call,name,result){
  let context={tool:name,result:JSON.parse(encodeResult(result)),state:boardContext(),legalMoves:(result.moves||[]).map(move=>move.to)};
  if(bytes(JSON.stringify(context))>4096)context={tool:name,result:{ok:result.ok,speak:result.speak},state:boardContext(),legalMoves:context.legalMoves};
  const encoded=encodeResult(context);
  const instruction='Modo de voz inmediato: no pidas confirmación ni ofrezcas cuenta atrás. Si result.ok y (result.queued o result.requestedAction sin result.action) existen, espera el resultado del servidor: la orden aún NO está ejecutada; no la repitas ni anuncies éxito. Solo si result.ok y result.action existen, la orden YA se ejecutó. Si result.ok es false, comunica el error sin anunciar ejecución. Alto solo detiene la voz; no revierte jugadas. Narra solo el resultado real.';
  const text='Resultado real del tablero. La herramienta ya se procesó; NO repitas su llamada. '+instruction+' Datos: '+encoded;
  if(call.session)call.session.sendContextualUpdate?.(text,{contextId:'chess-turn-'+call.turn});else call.updates.push(text);
 }
 function dispatch(call,name,args,source){
  if(!count(call,{tool:true}))return {ok:false,speak:'Límite de llamada alcanzado.'};
  const result=controller.runTool(name,args,{source});
  if(result.ok&&(result.action||result.requestedAction)){call.actions.push({turn:call.turn,name,args,result,version:controller.version,at:now()});call.actions=call.actions.slice(-10);}
  notify('onToolResult',{name,args,result,source,asrTurn:call.turn,version:controller.version,executed:!result.queued});
  updateContext(call,name,result);
  return result;
 }
 function clientTool(call,name,args){
  if(!active(call))return JSON.stringify({ok:false,speak:'La llamada ya terminó.'});
  const previous=call.actions.findLast(entry=>entry.turn<call.turn&&(entry.result.queued||now()-entry.at<30000)&&sameIntent(entry,name,args,controller));
  if(previous){
   if(!count(call))return JSON.stringify({ok:false,speak:'Límite de llamada alcanzado.'});
   notify('onToolIgnored',{name,args,source:'voice_client_tool',reason:'recent_executed_intent',asrTurn:call.turn,version:controller.version});
   return encodeResult({...previous.result,deduplicated:true,speak:previous.result.queued?'La orden sigue pendiente del servidor.':previous.result.ok?'Esa orden ya se ejecutó.':previous.result.speak});
  }
  const entry=call.lastASR;
  if(entry&&entry.turn===call.turn&&sameIntent(entry,name,args,controller)){
   if(!count(call))return JSON.stringify({ok:false,speak:'Límite de llamada alcanzado.'});
   notify('onToolIgnored',{name,args,source:'voice_client_tool',reason:'same_asr_intent',asrTurn:call.turn,version:controller.version});
   return encodeResult({...entry.result,deduplicated:true});
  }
  if(entry&&entry.turn===call.turn&&name!=='get_board'&&name!=='stop_action'){
   if(!count(call))return JSON.stringify({ok:false,speak:'Límite de llamada alcanzado.'});
   return encodeResult({ok:false,speak:'La orden hablada de este turno ya se procesó. Usa su resultado real.',state:boardContext()});
  }
  const result=dispatch(call,name,args,'voice_client_tool');
  if(result.ok&&(result.action||result.requestedAction))call.lastASR={turn:call.turn,name,args,result,version:controller.version};
  if(name==='stop_action')void close(call);
  return encodeResult(result);
 }
 function onMessage(call,message){
  if(!active(call))return;
  const command=message.source==='user'?decodeVoiceCommand(message.message):null;
  // Cancellation bypasses quotas, so a full budget can never delay a spoken stop.
  if(command?.name==='stop_action'){
   const result=controller.runTool('stop_action',{}, {source:'voice_asr'});
   notify('onMessage',message);
   notify('onToolResult',{name:'stop_action',args:{},result,source:'voice_asr',asrTurn:++call.turn,version:controller.version,executed:true});
   void close(call);return;
  }
  const eventId=message.event_id;
  if(message.source==='user'&&eventId!==undefined&&call.transcripts.has(String(eventId)))return;
  if(!count(call,{message}))return;
  notify('onMessage',message);
  if(message.source!=='user')return;
  if(eventId!==undefined){call.transcripts.add(String(eventId));if(call.transcripts.size>256)call.transcripts.delete(call.transcripts.values().next().value);}
  call.turn++;call.lastUser=message.message||'';call.lastASR=null;
  if(!command)return;
  const args={...command.args};
  if(command.name==='confirm_action')return;
  const queued=call.actions.findLast(entry=>entry.result.queued&&sameIntent(entry,command.name,args,controller));
  if(queued){
   const result={...queued.result,deduplicated:true};
   call.lastASR={turn:call.turn,name:command.name,args,result,version:controller.version};
   notify('onToolIgnored',{name:command.name,args,source:'voice_asr',reason:'pending_intent',asrTurn:call.turn,version:controller.version});
   updateContext(call,command.name,result);return;
  }
  const result=dispatch(call,command.name,args,'voice_asr');
  call.lastASR={turn:call.turn,name:command.name,args,result,version:controller.version};
 }
 async function start(){
  if(current)return current.startPromise;
  const call={id:++serial,closed:false,aborter:new AbortController(),session:null,leaseId:null,csrfToken:null,events:0,tools:0,userBytes:0,recent:[],turn:0,lastASR:null,lastUser:'',actions:[],transcripts:new Set(),updates:[]};
  current=call;notify('onStatus','connecting');
  call.unsubscribe=controller.subscribe?.((event,result)=>{
   if(!active(call)||event!=='onResult')return;
   const action=result.action||result.requestedAction;
   if(action){
    const matches=entry=>entry?.result.queued&&sameAction(entry.result.requestedAction,action);
    for(const entry of call.actions)if(matches(entry))entry.result={...result,queued:false,requestedAction:action};
    if(matches(call.lastASR))call.lastASR.result={...result,queued:false,requestedAction:action};
   }
   notify('onActionResult',{result,source:'voice_execution',version:controller.version});
   updateContext(call,'action_result',result);
  });
  call.startPromise=(async()=>{
   try{
    const sdk=await bounded(load(),requestTimeoutMs,{signal:call.aborter.signal,message:'No se pudo cargar el cliente de voz. Recarga la página e intenta otra vez.'});if(!active(call))return;
    const auth=await request('/api/session',{},call.aborter.signal);
    if(!auth.response.ok)throw Error('Inicia sesión para usar voz.');
    call.csrfToken=auth.data.csrfToken;if(!active(call))return;
    // Track a token arriving after cancellation so only its own lease is released.
    const tokenTask=fetcher('/api/voice/token',{method:'POST',headers:{'X-CSRF-Token':call.csrfToken},signal:call.aborter.signal}).then(async response=>{
     const data=await response.json().catch(()=>({}));
     if(response.ok){call.leaseId=data.leaseId;if(!active(call))await finish(call);}
     return {response,data};
    });
    const {response,data}=await bounded(tokenTask,requestTimeoutMs,{signal:call.aborter.signal});
    if(!response.ok){
     const messages={active:'Hay otra llamada activa o cerrándose. Espera unos segundos y vuelve a conectar.',rate:'Has iniciado varias llamadas seguidas. Espera un momento y vuelve a conectar.',budget:'Se alcanzó el presupuesto disponible para la voz.'};
     throw Error(messages[data.error]||(response.status===503?'Voz pendiente de configuración personal.':'No se pudo iniciar la llamada.'));
    }
    if(!active(call)){await finish(call);return;}
    const clientTools=Object.fromEntries(VOICE_TOOL_REGISTRY.map(def=>[def.name,async args=>clientTool(call,def.name,args)]));
    const connection=sdk.Conversation.startSession({
     conversationToken:data.token,connectionType:'webrtc',clientTools,
     onStatusChange:({status})=>{if(active(call))notify('onStatus',status);},
     onMessage:message=>onMessage(call,message),
     onModeChange:({mode})=>{
      if(!active(call))return;
      notify('onStatus',mode);
     },
     onDisconnect:()=>{void close(call,{reason:'connection_ended'});},
     // Like Saloon, an SDK notice alone is not proof that the transport ended.
     onError:(error,context)=>{if(active(call))notify('onError',classifyVoiceError(context instanceof Error?context:error));}
    });
    const connected=await bounded(Promise.resolve(connection).then(async session=>{if(!active(call)){await endSession(session);return null;}return session;}),connectTimeoutMs,{signal:call.aborter.signal});
    if(!active(call))return;
    call.session=connected;
    for(const text of call.updates)connected.sendContextualUpdate?.(text);
    call.updates=[];
    const board=controller.runTool?.('get_board',{}, {source:'voice_context'});
    if(board?.ok)updateContext(call,'get_board',board);
    call.hardTimer=setTimeout(()=>void close(call,{reason:'duration_limit',error:Error('La sesión alcanzó sus 5 minutos. Puedes conectar otra llamada si queda presupuesto.')}),300000);
    call.meter=setInterval(()=>notify('onVolume',call.session?.getOutputVolume?.()||0),100);
    notify('onStatus','connected');return connected;
   }catch(error){if(!active(call))return;const visible=/NotAllowedError|PermissionDenied|NotFoundError|NotReadableError|NotSupportedError|OverconstrainedError|SecurityError|network|fetch|SessionConnectionError/i.test(`${error?.name} ${error?.message}`)?classifyVoiceError(error):error;await close(call,{reason:'connection_error',error:visible});throw visible;}
  })();
  return call.startPromise;
 }
 return {start,stop,setVolume(volume){return current?.session?.setVolume({volume});},get session(){return current?.session||null;},get metrics(){return current?{events:current.events,tools:current.tools,userBytes:current.userBytes,asrTurn:current.turn}:null;}};
}
