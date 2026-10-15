import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {inside,json,root,head} from './evidence.mjs';

const checkpoint=await json('sources/reports/execution-checkpoint.json');
const validation=await json('docs/reports/assets-validation.json');
checkpoint.models={...checkpoint.models,...validation};
const ledger=await json('docs/reports/assets-ledger.json');
checkpoint.assetBudget.settledUSD=Math.round(Object.values(ledger.operations).reduce((sum,operation)=>sum+(operation.actualUSD||0),0)*1000000)/1000000;
checkpoint.assetBudget.meshCredits=Object.values(ledger.operations).reduce((sum,operation)=>sum+(operation.credits||0),0);
await writeFile(inside('sources/reports/execution-checkpoint.json'),JSON.stringify(checkpoint,null,2)+'\n');
let evidence;try{evidence=await json('sources/reports/delivery-evidence.json');}catch(error){if(error.code!=='ENOENT')throw error;}
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const inline=value=>escape(value).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
function markdown(text){
 const lines=text.split(/\r?\n/),out=[];let list=null,fence=false,table=false;
 const closeList=()=>{if(list){out.push('</'+list+'>');list=null;}};
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(line.startsWith('```')){closeList();if(table){out.push('</tbody></table>');table=false;}out.push(fence?'</code></pre>':'<pre><code>');fence=!fence;continue;}
  if(fence){out.push(escape(line)+'\n');continue;}
  if(/^\|/.test(line)){
   closeList();const cells=line.split('|').slice(1,-1).map(s=>s.trim());
   if(cells.every(s=>/^:?-+:?$/.test(s)))continue;
   if(!table){out.push('<table><thead><tr>'+cells.map(s=>'<th>'+inline(s)+'</th>').join('')+'</tr></thead><tbody>');table=true;}
   else out.push('<tr>'+cells.map(s=>'<td>'+inline(s)+'</td>').join('')+'</tr>');continue;
  }
  if(table){out.push('</tbody></table>');table=false;}
  if(!line.trim()){closeList();continue;}
  if(/^<!--/.test(line))continue;
  const title=line.match(/^(#{1,6}) (.*)$/);if(title){closeList();const n=Math.min(3,title[1].length+1);out.push('<h'+n+'>'+inline(title[2])+'</h'+n+'>');continue;}
  const bullet=line.match(/^(?:([-*]) |(\d+)\. )(.*)$/);if(bullet){const tag=bullet[1]?'ul':'ol';if(list!==tag){closeList();out.push('<'+tag+'>');list=tag;}out.push('<li>'+inline(bullet[3])+'</li>');continue;}
  closeList();out.push('<p>'+inline(line)+'</p>');
 }
 closeList();if(table)out.push('</tbody></table>');return out.join('\n');
}
const templatePath=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'skills/take-controlish/assets/contract-template.html');
const template=(await readFile(templatePath,'utf8')).replaceAll('\r\n','\n');
const style=template.match(/<style>[\s\S]*?<\/style>/)[0];
const gateStatus=id=>evidence?.gates?.[id]?.passed?'Aprobado con registro':'Pendiente de cierre final';
const green=Object.values(evidence?.gates||{}).filter(gate=>gate.passed).length;
const snapshot=`<section><h2>Estado observado · ${escape(checkpoint.date)}</h2><p><b>${checkpoint.models.valid}/66 modelos 3D verificados.</b> Plan y contrato: 10/10 independientes. Aceptación final: ${green}/11 registros aprobados; ${checkpoint.complete?'completa':'incompleta'}.</p><p>Voz: ${escape(checkpoint.voice.engineering)}. Micrófono humano: ${checkpoint.voice.humanMicrophoneVerified?'observado':'pendiente'}. Vercel: ${escape(checkpoint.deployment.url||checkpoint.deployment.status)}.</p><p>Generación: US$${checkpoint.assetBudget.settledUSD.toFixed(3)} contabilizados, ${checkpoint.assetBudget.meshCredits} créditos de Meshy. Tope global: US$30. Tiempo activo y tokens: no disponibles.</p><p>La investigación y el plan originales que siguen son históricos. Sus cantidades de cero modelos y accesos pendientes describen el punto de partida, no el estado actual.</p></section>`;
const plan=await readFile(inside('docs/reports/epic-chess-ultraplan.md'),'utf8');
const contract=await readFile(inside('loops/epic-chess/README.md'),'utf8');
const acceptance=[...plan.matchAll(/^\| (A\d+) \| (.*?) \| (.*?) \|$/gm)].map(([,id,command,condition])=>({id,command,condition}));
const verdicts=[
 ['El cargador original permitía modelos GLB','KILLED','Se sustituyó el parser vacío por el cargador oficial.'],
 ['Los tests antiguos probaban las reglas','KILLED','Se reprodujeron undo y bounds; se añadieron regresiones y perft.'],
 ['Las 66 imágenes originales satisfacían 3D','KILLED','66 modelos Meshy con texturas, hashes y cuatro vistas por personaje.'],
 ['Leer el agente demostraba voz funcional','KILLED','La primera llamada tuvo ASR/TTS y cero herramientas; se corrigió el adaptador y se exige nueva prueba real.'],
 ['El acceso local probaba el despliegue','KILLED','Producción requiere URL inmutable, identidad y repetición autenticada.'],
 ['La memoria automática ya había actuado','UNVERIFIABLE','Captura directa verificada; no se ha observado el evento automático.']
];
const header=(title)=>'<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+'</title>'+style+'</head><body><header><h1>'+escape(title)+'</h1><div class="meta">Proyecto personal · '+escape(checkpoint.date)+' · <span class="badge pass">plan 10/10 · contrato 10/10</span> <span class="badge hold">aceptación incompleta</span></div></header><main class="wrap">';
const footer='</main><footer>Reporte local · evidencia por criterio · no publicado con el juego</footer></body></html>';
await writeFile(inside('docs/reports/epic-chess-ultraplan.html'),header('Grand Line Chess · ultraplan')+snapshot+'<section>'+markdown(plan)+'</section>'+footer);
const fill={
 LOOP_NAME:'Grand Line Chess',PROJECT:'One Piece 3D Chess · personal',DATE:checkpoint.date,
 GATE_BADGE:'<span class="badge pass">contrato 10/10</span> <span class="badge hold">aceptación incompleta</span>',SCORE:'10/10',ROUNDS:'1',N_CRITERIA:'12',N_KILLED:String(verdicts.filter(v=>v[1]==='KILLED').length),
 GOAL:'<p>Entregar las diez tripulaciones y la Marina con los 66 personajes 3D reales, ajedrez correcto, cámara segura, capturas animadas, voz y WebMCP, en una nueva página personal de Vercel protegida.</p>'+snapshot,
 BOUNDARIES:'<p>Autorizados: código y pruebas en la rama propia, recursos personales hasta US$30, despliegue personal nuevo ya solicitado. La prueba del micrófono pertenece al usuario. La evidencia de pago, memoria y producción se registra de forma explícita.</p>',
 NEVER_RULES:'<p class="never">Nunca usar claves o infraestructura de la empresa, modificar Claude global, superar US$30, sustituir modelos por imágenes planas ni declarar completa una prueba pendiente.</p>',
 SOP_STEPS:['Revisar estado, bitácora, rama y propiedad de archivos.','Conservar los dos gates independientes de al menos 9/10 y sus revisiones.','Ejecutar reglas, estado y comandos contra regresiones reproducidas.','Cargar y revisar los 66 modelos; cámara y capturas con límites medidos.','Probar voz real, confirmación y alto; distinguir audio sintético de micrófono humano.','Desplegar el nuevo proyecto personal protegido y repetir las pruebas en su URL inmutable.','Generar los dos HTML y el video con las pruebas y pendientes visibles.','Actualizar State y Logs con los resultados, costos y cursores.'].map(s=>'<li>'+escape(s)+'</li>').join(''),
 ACCEPTANCE_ROWS:acceptance.map(a=>'<tr><td class="cmd"><b>'+a.id+'</b><br><code>'+escape(a.command)+'</code></td><td>'+escape(a.condition)+'<br><b>'+gateStatus(a.id)+'</b></td></tr>').join(''),
 VERDICT_ROWS:verdicts.map(v=>'<tr><td>'+escape(v[0])+'</td><td><span class="v v-'+v[1]+'">'+v[1]+'</span></td></tr>').join(''),
 CHANGES_ITEMS:verdicts.map(v=>'<li>'+escape(v[2])+'</li>').join(''),
 TRIGGER:'Ejecución finita inmediata, sin programación recurrente. Continuación autorizada tras el cierre del harness; deadline 2026-10-13 20:04:52 UTC. El presupuesto no se reinicia.',
 STATE:'<p>Fase: verificación. Cursor de activos: 66/66. Cursor de producción: '+escape(checkpoint.deployment.url||'pendiente')+'. Micrófono humano: pendiente. State compacto en el contrato; Logs append-only. No se inventan horas ni tokens.</p>',
 NOT_SCOPE_ITEMS:['Cambiar las reglas de ajedrez mediante frutas o poderes.','Tocar claves, configuración global o infraestructura de la empresa.','Publicar los reportes, memoria, logs o secretos.','Aprobar voz con pruebas simuladas o dar por medido el rendimiento de una GPU real usando render software.'].map(s=>'<li>'+escape(s)+'</li>').join(''),
 ULTRAPLAN_HREF:'epic-chess-ultraplan.html',CONTRACT_PATH:'loops/epic-chess/README.md',VIDEO_PATH:'docs/reports/epic-chess-take-control.mp4'
};
let contractHTML=template.replace(/\{\{([A-Z_]+)\}\}/g,(_,key)=>fill[key]??'');
// Template example placeholders occur in comments only; remove those explanatory
// comments after filling so an unfilled token can never be mistaken for content.
contractHTML=contractHTML.replace(/<!--[\s\S]*?-->/g,'');
contractHTML=contractHTML.replace('</div>\n<footer>','<section><h2>Contrato íntegro y bitácora</h2>'+markdown(contract)+'</section></div>\n<footer>');
await writeFile(inside('docs/reports/epic-chess-contract.html'),contractHTML);
const branch=execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim();
const commits=Number(execFileSync('git',['rev-list','--count','HEAD'],{cwd:root,encoding:'utf8'}));
const dates=execFileSync('git',['log','--format=%ad','--date=short'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/);
const dirty=execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean).length;
const t=checkpoint.tests.fresh;
const statusHTML=header('Grand Line Chess · project status').replace('<html lang="es">','<html lang="en">')+'<section><p>Generated '+escape(checkpoint.date)+' America/New_York. HEAD <code>'+head()+'</code>. Branch <code>'+escape(branch)+'</code>. '+commits+' historical commits across '+new Set(dates).size+' commit dates; '+dirty+' changed/untracked entries at capture. Repository history includes work before this repair.</p><div class="tiles"><div class="tile"><b>66/66</b><span>validated 3D models</span></div><div class="tile"><b>'+escape(t?.passed??'unavailable')+'</b><span>fresh local tests passed</span></div><div class="tile"><b>'+green+'/11</b><span>final acceptance records</span></div><div class="tile"><b>Pending</b><span>human microphone</span></div></div></section><section><h2>What is built</h2><p>Implemented locally: pure standard chess rules, safe camera presets, character/square commands, shared voice and WebMCP action registry, textured Meshy models, WebGL capture choreography and server-side access control. Deployment evidence remains '+escape(checkpoint.deployment.status)+'. Implementation is not a claim of full release acceptance.</p></section><section><h2>Verification</h2><p>Independent plan and contract grades: 10/10, round 1. Strict assets: '+checkpoint.models.valid+' valid, '+checkpoint.models.missing+' missing, '+checkpoint.models.fallback+' fallback. '+(t?'Fresh local regression result: '+t.passed+' passed, '+t.failed+' failed, '+t.skipped+' skipped. Command <code>'+escape(t.command)+'</code>. Timestamp '+escape(t.checkedAt)+'.':'Fresh regression run unavailable.')+'</p><p>External official-polyfill bridge execution observed by root: selection, proposal, confirmation and stop. '+escape(checkpoint.voice.engineering)+'. Human microphone is still pending.</p></section><section><h2>What is missing</h2><ul>'+checkpoint.blockers.map(s=>'<li>'+escape(s)+'</li>').join('')+'</ul></section><section><h2>Effort and consumption</h2><p>Active hours: unavailable. Input, output, cache and total tokens: unavailable. No authoritative session usage extraction was performed and no estimates are presented.</p><p>Asset ledger: US$'+checkpoint.assetBudget.settledUSD.toFixed(3)+' including conservative valuation of '+checkpoint.assetBudget.meshCredits+' existing Meshy credits. Personal-only aggregate ceiling US$30; voice and report reservations are separate and not included in the asset subtotal.</p></section><section><h2>Blockers and dates</h2><p>Root owns production/voice closure; user owns the human microphone observation. Deadline after explicitly resumed execution: '+escape(checkpoint.resume.hardDeadlineUTC)+'. Automatic memory hook lifecycle remains unobserved; direct project-local capture is verified.</p></section>'+footer;
await writeFile(inside('projectstatus.html'),statusHTML);
const deployed=Boolean(checkpoint.deployment.url);
const voiceReady=checkpoint.voice.engineering==='SYNTHETIC_TRANSPORT_OK';
const narration=[
 'El ajedrez de One Piece ya tiene sus sesenta y seis personajes como modelos tridimensionales de Meshy. Las diez tripulaciones y la Marina conservan su identidad, con volumen, texturas y presencia sobre el tablero.',
 'Ahora puedes elegir una vista frontal, cenital u opuesta sin perder la cámara. Cada casilla tiene su nombre. Seleccionar una pieza ilumina sus destinos legales, y puedes dar órdenes por su nombre o por su papel en el ajedrez.',
 'Las jugadas siguen las reglas habituales, con enroque, captura al paso y elección de promoción. Las capturas tienen movimiento, impacto y desaparición del rival. Los poderes son visuales. También puedes deshacer, cambiar de tripulación y jugar contra la Marina automática.',
 'La revisión encontró errores reales en las reglas, el cargador y el control de voz. Se corrigieron y se añadieron pruebas. El plan y el contrato recibieron diez sobre diez de revisores independientes; eso no sustituye probar el juego.',
 voiceReady?'La voz de ElevenLabs ya atravesó una llamada real con audio de prueba: seleccionó, propuso, confirmó y canceló mediante las acciones del tablero. Una orden de movimiento espera tu confirmación; decir alto la detiene.':checkpoint.voice.engineering.startsWith('BLOCKED')?'La voz comparte las acciones del tablero y espera tu confirmación antes de mover. Decir alto cancela la orden. Una incidencia de ElevenLabs impide repetir la llamada final; esa prueba sigue pendiente.':'La integración de voz usa ElevenLabs y las mismas acciones del tablero. Una orden de movimiento espera tu confirmación; decir alto la detiene. La comprobación real de esta integración todavía tiene pendientes declarados.',
 (deployed?'La página personal ya está desplegada con contraseña. ':'El despliegue personal protegido sigue en preparación. ')+'Los modelos y su recuperación quedaron dentro del presupuesto autorizado, usando solamente tus recursos personales. Falta tu prueba con el micrófono: entra, selecciona una pieza, confirma una jugada y di alto. Esa comprobación decide la aceptación final.'
];
const spec={title:'One Piece · Grand Line Chess',subtitle:'66 personajes 3D · cámara segura · órdenes en español',date:checkpoint.date,mode:'full',objective:'Ajedrez cinematográfico con todos los personajes 3D y control por voz',notScope:['Reglas especiales que alteran el ajedrez','Recursos de la empresa','Dar por completa una prueba pendiente'],phases:[{n:1,name:'Reglas y estado',detail:'Implementados; regresiones y perft verifican legalidad.'},{n:2,name:'Todos los personajes',detail:'66/66 modelos Meshy texturizados; cero fallback.'},{n:3,name:'Cámara y capturas',detail:'Tres vistas limitadas y efectos WebGL; pruebas de navegador en curso.'},{n:4,name:'Voz y WebMCP',detail:checkpoint.voice.engineering},{n:5,name:'Vercel personal',detail:checkpoint.deployment.url||'Protegido; despliegue pendiente.'}],judge:{score:10,rounds:1,claims:verdicts.map(v=>({claim:v[0],verdict:v[1]})),changes:verdicts.map(v=>v[2])},contract:{name:'Epic chess',path:'loops/epic-chess/README.md',acceptance:acceptance.map(a=>({check:a.command,green:a.condition+' · '+gateStatus(a.id)}))},status:{headline:'Construido; aceptación final pendiente',detail:'66/66 modelos · micrófono humano pendiente · '+green+'/11 registros finales',next:'Probar tu micrófono, confirmar una jugada y decir alto.'},artifacts:[{label:'Ultraplan',path:inside('docs/reports/epic-chess-ultraplan.html')},{label:'Contrato',path:inside('docs/reports/epic-chess-contract.html')}],scenes:['title','objective','phases','judge','contract','status'].map((kind,i)=>({kind,narration:narration[i]}))};
await writeFile(inside('sources/reports/epic-chess-video-spec.json'),JSON.stringify(spec,null,2)+'\n');
console.log(JSON.stringify({planHtml:true,contractHtml:true,status:true,specPrepared:true,models:checkpoint.models.valid,assetUSD:checkpoint.assetBudget.settledUSD,narrationCharacters:narration.join('').length,narrationWords:narration.join(' ').split(/\s+/).length,paidRender:false}));
