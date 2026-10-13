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
function sameIntent(entry,name,args,controller){
 if(entry.name!==name)return false;
 if(!entry.result.action&&entry.version!==controller.version)return false;
 if(name==='select_piece')return args.from?String(args.from).toUpperCase()===entry.result.square:normalize(args.piece)===normalize(entry.args.piece);
 if(name==='propose_move'){
  const move=entry.result.action?.move||entry.result.proposal?.action?.move;
  return Boolean(move&&String(args.to).toUpperCase()===move.to&&(!args.from||String(args.from).toUpperCase()===move.from)&&(!args.piece||normalize(args.piece)===normalize(entry.args.piece))&&(args.promotion||null)===(move.promotion||null));
 }
 return JSON.stringify(args)===JSON.stringify(entry.args);
}
export function createVoiceSession(controller,callbacks={}){
 let current=null,serial=0,lastClosing=null;
 const notify=(name,value)=>callbacks[name]?.(value);
 const fetcher=callbacks.fetch||globalThis.fetch;
 const load=callbacks.loadSDK||(()=>import('../vendor/voice/index.mjs'));
 const now=callbacks.now||Date.now;
 const active=call=>current===call&&!call.closed;
 async function finish(call){
  if(!call.leaseId)return;
  const lease=call.leaseId;call.leaseId=null;
  await fetcher('/api/voice/finish',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':call.csrfToken},body:JSON.stringify({leaseId:lease})}).catch(()=>{});
 }
 function close(call,{reason='stopped',error=null}={}){
  if(!call)return lastClosing;
  if(call.closed)return call.closePromise;
  call.closed=true;
  call.endReason=reason;
  if(current===call)current=null;
  clearTimeout(call.hardTimer);clearTimeout(call.speechEndTimer);clearInterval(call.meter);call.unsubscribe?.();
  controller.stop();
  const session=call.session;call.session=null;
  call.closePromise=(async()=>{
   if(session){try{await session.setVolume({volume:0});}catch{}try{await session.endSession();}catch{}}
   await finish(call);
   // A slow lease release from an old call must not overwrite a new connection.
   if(serial===call.id){notify('onStatus','disconnected');if(error)notify('onError',error);}
   notify('onEnd',{reason:call.endReason,callId:call.id,events:call.events,tools:call.tools});
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
  const instruction='Modo de voz inmediato: no pidas confirmación ni ofrezcas cuenta atrás. Si result.ok y result.action existen, la orden YA se ejecutó. Alto solo detiene la voz; no revierte jugadas. Narra solo el resultado real.';
  const text='Resultado real del tablero. La herramienta ya se procesó; NO repitas su llamada. '+instruction+' Datos: '+encoded;
  if(call.session)call.session.sendContextualUpdate?.(text,{contextId:'chess-turn-'+call.turn});else call.updates.push(text);
 }
 function dispatch(call,name,args,source){
  if(!count(call,{tool:true}))return {ok:false,speak:'Límite de llamada alcanzado.'};
  const result=controller.runTool(name,args,{source});
  if(result.ok&&result.action){call.actions.push({turn:call.turn,name,args,result,version:controller.version,at:now()});call.actions=call.actions.slice(-10);}
  notify('onToolResult',{name,args,result,source,asrTurn:call.turn,version:controller.version,executed:true});
  updateContext(call,name,result);
  return result;
 }
 function clientTool(call,name,args){
  if(!active(call))return JSON.stringify({ok:false,speak:'La llamada ya terminó.'});
  const previous=call.actions.findLast(entry=>entry.turn<call.turn&&now()-entry.at<30000&&sameIntent(entry,name,args,controller));
  if(previous){
   if(!count(call))return JSON.stringify({ok:false,speak:'Límite de llamada alcanzado.'});
   notify('onToolIgnored',{name,args,source:'voice_client_tool',reason:'recent_executed_intent',asrTurn:call.turn,version:controller.version});
   return encodeResult({...previous.result,deduplicated:true,speak:'Esa orden ya se ejecutó.'});
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
  if(result.ok&&result.action)call.lastASR={turn:call.turn,name,args,result,version:controller.version};
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
  const result=dispatch(call,command.name,args,'voice_asr');
  call.lastASR={turn:call.turn,name:command.name,args,result,version:controller.version};
 }
 async function start(){
  if(current)return current.startPromise;
  const call={id:++serial,closed:false,session:null,leaseId:null,csrfToken:null,events:0,tools:0,userBytes:0,recent:[],turn:0,lastASR:null,lastUser:'',actions:[],transcripts:new Set(),updates:[]};
  current=call;notify('onStatus','connecting');
  call.unsubscribe=controller.subscribe?.((event,result)=>{
   if(!active(call)||event!=='onResult')return;
   notify('onActionResult',{result,source:'voice_execution',version:controller.version});
   updateContext(call,'action_result',result);
  });
  call.startPromise=(async()=>{
   try{
    const sdk=await load();if(!active(call))return;
    const auth=await fetcher('/api/session');
    if(!auth.ok)throw Error('Inicia sesión para usar voz.');
    call.csrfToken=(await auth.json()).csrfToken;if(!active(call))return;
    const response=await fetcher('/api/voice/token',{method:'POST',headers:{'X-CSRF-Token':call.csrfToken}});
    if(!response.ok)throw Error(response.status===503?'Voz pendiente de configuración personal.':'No se pudo iniciar la llamada.');
    const data=await response.json();call.leaseId=data.leaseId;
    if(!active(call)){await finish(call);return;}
    const clientTools=Object.fromEntries(VOICE_TOOL_REGISTRY.map(def=>[def.name,async args=>clientTool(call,def.name,args)]));
    const connected=await sdk.Conversation.startSession({
     conversationToken:data.token,connectionType:'webrtc',clientTools,
     onStatusChange:({status})=>{if(active(call))notify('onStatus',status);},
     onMessage:message=>onMessage(call,message),
     onModeChange:({mode})=>{
      if(!active(call))return;
      notify('onStatus',mode);
     },
     onDisconnect:()=>{void close(call,{reason:'connection_ended'});},
     onError:error=>{void close(call,{reason:'connection_error',error});}
    });
    if(!active(call)){try{await connected.setVolume({volume:0});await connected.endSession();}catch{}await finish(call);return;}
    call.session=connected;
    for(const text of call.updates)connected.sendContextualUpdate?.(text);
    call.updates=[];
    call.hardTimer=setTimeout(()=>void close(call,{reason:'duration_limit',error:Error('La sesión alcanzó sus 5 minutos. Puedes conectar otra llamada si queda presupuesto.')}),300000);
    call.meter=setInterval(()=>notify('onVolume',call.session?.getOutputVolume?.()||0),100);
    notify('onStatus','connected');return connected;
   }catch(error){await close(call,{reason:'connection_error',error});throw error;}
  })();
  return call.startPromise;
 }
 return {start,stop,setVolume(volume){return current?.session?.setVolume({volume});},get session(){return current?.session||null;},get metrics(){return current?{events:current.events,tools:current.tools,userBytes:current.userBytes,asrTurn:current.turn}:null;}};
}
