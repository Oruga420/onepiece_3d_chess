import {ATTACK_FAMILIES} from './attacks.mjs';

// One reusable audio element per generated family; no provider calls at runtime.
export function createCombatAudio({createAudio=path=>new Audio(path)}={}){
 const cache=new Map();let active=null,enabled=true,volume=.65,serial=0,plays=0,lastAttack=null,lastSource=null,lastError=null;
 function prepare(attack){
  if(!attack||!ATTACK_FAMILIES.includes(attack.sound))return null;
  let audio=cache.get(attack.sound);
  if(!audio){audio=createAudio('/assets/audio/combat/'+attack.sound+'.mp3');audio.preload='auto';audio.volume=volume;audio.load();cache.set(attack.sound,audio);}
  return audio;
 }
 function stop(){serial++;if(active){active.pause();active.currentTime=0;active=null;}}
 async function play(attack){
  if(!enabled)return false;
  const audio=prepare(attack);if(!audio)return false;
  stop();const token=serial;active=audio;audio.currentTime=0;audio.volume=volume;
  // Mild per-character weight, without turning voices or music into substitutes.
  audio.playbackRate=Math.max(.88,Math.min(1.12,1-(attack.power-1)*.18));
  try{await audio.play();if(token!==serial)return false;plays++;lastAttack=attack.id;lastSource=audio.src;lastError=null;return true;}
  catch{if(token===serial){active=null;lastError='Audio playback unavailable';}return false;}
 }
 return {prepare,play,stop,setEnabled(value){enabled=Boolean(value);if(!enabled)stop();},setVolume(value){if(!Number.isFinite(value))return;volume=Math.max(0,Math.min(1,value));for(const audio of cache.values())audio.volume=volume;},
  getMetrics:()=>({cached:cache.size,plays,lastAttack,lastSource,lastError,enabled,volume}),
  dispose(){stop();for(const audio of cache.values()){audio.removeAttribute?.('src');audio.load();}cache.clear();},
 };
}
