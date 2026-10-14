import {DEVIL_FRUITS} from './rules.mjs';
const string = (description, extra={}) => ({type:'string',description,...extra});
const enumeration = (description,values) => string(description,{enum:values});
const tool = (name,description,kind,properties={},required=[]) => ({name,description,kind,inputSchema:{type:'object',description,properties,required,additionalProperties:false},annotations:{readOnlyHint:kind==='read',destructiveHint:kind==='consequential'}});
const square=string('Casilla del tablero A1 a H8',{pattern:'^[A-Ha-h][1-8]$'});
export const TOOL_REGISTRY=Object.freeze([
 tool('get_board','Leer tablero, turno, selección, frutas disponibles y casillas de peones propios que pueden comerlas','read'),
 tool('select_piece','Iluminar una pieza y sus movimientos legales sin moverla','view',{piece:string('Nombre del personaje o pieza en español'),from:square}),
 tool('propose_move','Proponer un movimiento legal; requiere confirmación','consequential',{piece:string('Nombre del personaje o pieza en español'),from:square,to:square,promotion:enumeration('Pieza de promoción',['queen','rook','bishop','knight'])},['to']),
 tool('propose_fruit','Proponer que un peón propio coma una fruta disponible y cambie de pieza en su casilla; requiere confirmación. Consulta get_board para stock y peones. Gomu Gomu: reina; Mera Mera: caballo; Ope Ope: torre; Gora Gora: alfil. Si da jaque, pasa el turno al rival.','consequential',{square,fruit:enumeration('ID de la fruta del diablo disponible',DEVIL_FRUITS.map(f=>f.id))},['square','fruit']),
 tool('propose_game_action','Proponer nueva partida o deshacer','consequential',{action:enumeration('Acción',['new_game','undo','claim_draw']),reason:enumeration('Motivo de tablas',['fifty-move','threefold-repetition']),intendedMove:{type:'object',description:'Movimiento legal que permitiría reclamar tablas sin jugarlo',properties:{from:square,to:square,promotion:enumeration('Promoción prevista',['queen','rook','bishop','knight'])},required:['from','to'],additionalProperties:false}},['action']),
 tool('propose_settings','Proponer cambios de tripulación o IA','consequential',{action:enumeration('Ajuste',['crew','ai_enabled','ai_difficulty']),value:string('Tripulación, true/false o dificultad')},['action','value']),
 tool('open_crew_selection','Abrir selector de tripulación','view'),
 tool('set_camera','Cambiar a una vista segura del tablero','view',{preset:enumeration('Vista',['board','overhead','player'])},['preset']),
 tool('set_audio','Cambiar música o efectos','view',{channel:enumeration('Canal',['music','effects']),enabled:{type:'boolean',description:'Activado'},volume:{type:'number',description:'Volumen entre cero y uno',minimum:0,maximum:1}},['channel']),
 tool('dismiss_message','Cerrar mensaje visible','view'),
 tool('confirm_action','Confirmar propuesta visible por ID; esperar fin de voz','control',{id:string('ID exacto de propuesta'),words:string('Palabras explícitas de confirmación')},['id','words']),
 tool('stop_action','Cancelar propuesta, cuenta atrás y reproducción','control')
]);
// Voice orders are immediate; WebMCP retains its explicit proposal contract.
const voiceDescriptions={
 propose_move:'Mover una pieza legal inmediatamente, sin confirmación ni cuenta atrás.',
 propose_fruit:'Dar inmediatamente una fruta disponible a un peón propio, sin confirmación: gomu-gomu→reina, mera-mera→caballo, ope-ope→torre, gora-gora→alfil. Consulta get_board para stock y peones. Cambia en la misma casilla; si da jaque, pasa el turno al rival.',
 propose_game_action:'Iniciar nueva partida o reclamar tablas inmediatamente. No permite deshacer.',
 propose_settings:'Cambiar tripulación o IA inmediatamente, sin confirmación.',
 stop_action:'Detener la voz y desconectar. No revierte movimientos ya ejecutados.'
};
export const VOICE_TOOL_REGISTRY=Object.freeze(TOOL_REGISTRY.filter(t=>t.name!=='confirm_action').map(t=>{
 const copy=structuredClone(t);
 if(voiceDescriptions[t.name])copy.description=copy.inputSchema.description=voiceDescriptions[t.name];
 if(t.name==='propose_game_action')copy.inputSchema.properties.action.enum=['new_game','claim_draw'];
 return copy;
}));
function validateNode(schema,value,path){
 if(typeof value!==schema.type||value===null||schema.type==='object'&&Array.isArray(value))throw Error('Valor inválido: '+path);
 if(schema.enum&&!schema.enum.includes(value)||schema.pattern&&!new RegExp(schema.pattern).test(value)||schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum)throw Error('Valor inválido: '+path);
 if(schema.type==='object'){for(const key of Object.keys(value)){if(!schema.properties[key])throw Error('Parámetro desconocido: '+path+'.'+key);validateNode(schema.properties[key],value[key],path+'.'+key);}for(const key of schema.required||[])if(value[key]===undefined)throw Error('Falta '+key);}
}
export function validateTool(name,args={}){const def=TOOL_REGISTRY.find(t=>t.name===name);if(!def)throw Error('Herramienta desconocida');validateNode(def.inputSchema,args,name);return def;}
export const exportRegistry=()=>TOOL_REGISTRY;
