import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createCombatAudio} from '../src/combat-audio.mjs';
import {ATTACK_FAMILIES} from '../src/attacks.mjs';

const zoro={id:'mugiwara/queen',sound:'sword',power:1.2};
const luffy={id:'mugiwara/king',sound:'rubber',power:1.4};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture({state='running',fetch,decode,resume,start}={}){
 const sources=[],gains=[],requests=[];
 let clock=0;
 const parameter=()=>({value:0,cancelScheduledValues(){},setTargetAtTime(value){this.value=value;}});
 const node=()=>({connect(){},disconnect(){this.disconnected=true;}});
 const context={state,currentTime:1,destination:{},
  createGain(){const gain={...node(),gain:parameter()};gains.push(gain);return gain;},
  createDynamicsCompressor(){return {...node(),threshold:parameter(),knee:parameter(),ratio:parameter(),attack:parameter(),release:parameter()};},
  createBufferSource(){const source={...node(),playbackRate:{value:1},start(){if(start)start();this.started=true;},stop(){this.stopped=true;}};sources.push(source);return source;},
  decodeAudioData:async data=>decode?decode(data):{duration:1},
  resume:async()=>{if(resume)await resume();context.state='running';},
  close:async()=>{context.state='closed';},
 };
 const sound=createCombatAudio({createContext:()=>context,fetch:async path=>{requests.push(path);return fetch?fetch(path):{ok:true,arrayBuffer:async()=>new ArrayBuffer(4)};},now:()=>clock});
 return {sound,context,sources,gains,requests,advance:ms=>{clock+=ms;}};
}

test('all v2 attack cues ship unique verified ElevenLabs audio files',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../assets/audio/combat/v2/manifest.json',import.meta.url),'utf8'));
 const expected=[...ATTACK_FAMILIES.flatMap(family=>[family+'-windup',family+'-impact']),'parry','land'];
 assert.equal(manifest.provider,'ElevenLabs');assert.deepEqual(manifest.clips.map(c=>c.id).sort(),expected.sort());
 const hashes=new Set();
 for(const clip of manifest.clips){const bytes=fs.readFileSync(new URL('..'+clip.path,import.meta.url));assert(bytes.length>1000);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),clip.sha256);assert(clip.seconds>.2&&clip.seconds<2.2);hashes.add(clip.sha256);}
 assert.equal(hashes.size,34);
});

test('preparation caches four decoded stems and cues overlap without cutting each other or pitch shifting',async()=>{
 const {sound,sources,requests}=fixture();
 await sound.prepare(zoro);await sound.prepare(zoro);assert.equal(requests.length,4);
 const duel=sound.begin(zoro);
 assert.equal(await sound.playCue(zoro,'windup',{duel}),true);
 assert.equal(await sound.playCue(zoro,'parry',{duel}),true);
 assert.equal(await sound.playCue(zoro,'impact',{duel}),true);
 assert.equal(await sound.playCue(zoro,'land',{duel}),true);
 assert.equal(sources.length,4);assert(sources.every(s=>s.started&&!s.stopped&&s.playbackRate.value===1));
 assert.equal(sound.getMetrics().active,4);
 assert.deepEqual(sound.getMetrics().cueCounts,{windup:1,parry:1,impact:1,land:1});
 assert.match(sound.getMetrics().lastSource,/v2\/land\.mp3$/);
 sources[0].onended();assert.equal(sound.getMetrics().active,3);assert(sources[0].disconnected);
 sound.dispose();assert.equal(sound.getMetrics().cached,0);assert.equal(sound.getMetrics().active,0);
});

test('duplicate phase callbacks play each cue once per duel and old duel callbacks cannot invade a new capture',async()=>{
 const {sound}=fixture();await sound.prepare(zoro);
 const first=sound.begin(zoro);
 assert.deepEqual(await Promise.all([sound.playCue(zoro,'impact',{duel:first}),sound.playCue(zoro,'impact',{duel:first})]),[true,false]);
 const second=sound.begin(zoro);
 assert.equal(await sound.playCue(zoro,'land',{duel:first}),false);
 assert.equal(await sound.playCue(luffy,'land',{duel:second}),false);
 assert.equal(await sound.playCue(zoro,'impact',{duel:second}),true);
 assert.equal(sound.getMetrics().plays,2);sound.dispose();
});

test('cancelling a duel while decode is pending never starts audio after reset',async()=>{
 const pending=deferred();const {sound,sources}=fixture({decode:()=>pending.promise});
 const duel=sound.begin(zoro),playing=sound.playCue(zoro,'impact',{duel});
 sound.stop();pending.resolve({duration:1});
 assert.equal(await playing,false);assert.equal(sources.length,0);assert.equal(sound.getMetrics().plays,0);sound.dispose();
});

test('mute cancels pending fetch and every active source while master gain and speech ducking honor volume',async()=>{
 const {sound,gains,sources}=fixture();sound.setVolume(.4);await sound.prepare(zoro);
 const duel=sound.begin(zoro);await sound.playCue(zoro,'windup',{duel});await sound.playCue(zoro,'impact',{duel});
 assert.equal(gains[0].gain.value,.4);sound.setDucked(true);assert.equal(gains[0].gain.value,.4*.35);
 sound.setVolume(.6);assert.equal(gains[0].gain.value,.6*.35);sound.setDucked(false);assert.equal(gains[0].gain.value,.6);
 sound.setEnabled(false);assert(sources.every(s=>s.stopped));assert.equal(gains[0].gain.value,0);
 assert.equal(await sound.playCue(zoro,'land',{duel}),false);assert.equal(sound.getMetrics().active,0);
 sound.setVolume(2);sound.setEnabled(true);assert.equal(gains[0].gain.value,1);
 assert.equal(await sound.playCue(zoro,'land',{duel}),false);sound.dispose();
 const pending=deferred(),other=fixture({fetch:()=>pending.promise});
 const pendingDuel=other.sound.begin(zoro),playing=other.sound.playCue(zoro,'impact',{duel:pendingDuel});
 other.sound.setEnabled(false);pending.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});
 assert.equal(await playing,false);assert.equal(other.sources.length,0);other.sound.dispose();
});

test('late downloads are skipped rather than producing delayed impacts',async()=>{
 const pending=deferred(),f=fixture({fetch:()=>pending.promise});
 const duel=f.sound.begin(zoro),playing=f.sound.playCue(zoro,'impact',{duel});
 f.advance(400);pending.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});
 assert.equal(await playing,false);assert.equal(f.sources.length,0);assert.equal(f.sound.getMetrics().skipped,1);
 assert.equal(await f.sound.play(zoro),true);f.sound.dispose();
});

test('suspended autoplay skips cues and gesture resume enables future cues without replaying stale impacts',async()=>{
 const pending=deferred(),f=fixture({state:'suspended',resume:()=>pending.promise});
 await f.sound.prepare(zoro);const duel=f.sound.begin(zoro);
 assert.equal(await f.sound.playCue(zoro,'impact',{duel}),false);
 const unlocking=f.sound.unlock();f.sound.stop();pending.resolve();assert.equal(await unlocking,true);assert.equal(f.sources.length,0);
 assert.equal(await f.sound.play(zoro),true);f.sound.dispose();
});

test('resume rejection, decoder errors and source errors never escape into the game and can recover',async()=>{
 const blocked=fixture({state:'suspended',resume:()=>{throw Error('NotAllowedError');}});
 assert.equal(await blocked.sound.unlock(),false);assert.equal(blocked.sound.getMetrics().lastError,'Audio playback unavailable');blocked.sound.dispose();
 let fail=true;const f=fixture({decode:()=>{if(fail)throw Error('corrupt mp3');return {duration:1};}});
 assert.equal(await f.sound.play(zoro),false);assert.equal(f.sound.getMetrics().lastError,'Audio asset unavailable');
 fail=false;assert.equal(await f.sound.play(zoro),true);f.sound.dispose();
 const badSource=fixture({start:()=>{throw Error('start failed');}});await badSource.sound.prepare(zoro);
 assert.equal(await badSource.sound.play(zoro),false);assert.equal(badSource.sound.getMetrics().active,0);badSource.sound.dispose();
});

test('dispose during decode closes the graph and never repopulates cache or starts a source',async()=>{
 const pending=deferred(),f=fixture({decode:()=>pending.promise});
 const duel=f.sound.begin(zoro),playing=f.sound.playCue(zoro,'impact',{duel});
 await Promise.resolve();await Promise.resolve();f.sound.dispose();pending.resolve({duration:1});
 assert.equal(await playing,false);assert.equal(f.sound.getMetrics().cached,0);assert.equal(f.sources.length,0);
 assert.equal(await f.sound.unlock(),false);assert.deepEqual(await f.sound.prepare(zoro),[]);f.sound.dispose();
});
