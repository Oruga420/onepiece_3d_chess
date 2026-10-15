import test from 'node:test';
import assert from 'node:assert/strict';
import {createCombatAudio} from '../src/combat-audio.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {ATTACK_FAMILIES} from '../src/attacks.mjs';

function fixture(){const instances=[];const sound=createCombatAudio({createAudio:src=>{const a={src,currentTime:0,loads:0,pauses:0,played:0,load(){this.loads++;},pause(){this.pauses++;},async play(){this.played++;},removeAttribute(){this.src='';}};instances.push(a);return a;}});return {sound,instances};}
const zoro={id:'mugiwara/queen',sound:'sword',power:1.2},luffy={id:'mugiwara/king',sound:'rubber',power:1.4};
test('all attack families ship unique verified ElevenLabs audio files',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../assets/audio/combat/manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.provider,'ElevenLabs');assert.deepEqual(manifest.clips.map(c=>c.id).sort(),[...ATTACK_FAMILIES].sort());
 const hashes=new Set();
 for(const clip of manifest.clips){const bytes=fs.readFileSync(new URL('..'+clip.path,import.meta.url));assert(bytes.length>1000);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),clip.sha256);assert(clip.seconds>.2&&clip.seconds<2.2);hashes.add(clip.sha256);}
 assert.equal(hashes.size,16);
});
test('character sound uses generated family, reuses loaded audio and interrupts old effects',async()=>{
 const {sound,instances}=fixture();sound.prepare(zoro);assert.equal(instances[0].loads,1);
 assert.equal(await sound.play(zoro),true);assert.equal(await sound.play(zoro),true);assert.equal(instances.length,1);assert.equal(instances[0].played,2);
 assert.equal(await sound.play(luffy),true);assert.equal(instances.length,2);assert.equal(instances[0].currentTime,0);assert(instances[0].pauses>=2);
 assert.match(sound.getMetrics().lastSource,/rubber\.mp3$/);assert.equal(sound.getMetrics().lastAttack,luffy.id);sound.dispose();assert.equal(sound.getMetrics().cached,0);
});
test('mute, volume and cancellation cannot leave delayed audio playing',async()=>{
 const {sound,instances}=fixture();sound.setVolume(.2);sound.prepare(zoro);assert.equal(instances[0].volume,.2);
 let resolve;instances[0].play=()=>new Promise(r=>resolve=r);const pending=sound.play(zoro);sound.stop();resolve();assert.equal(await pending,false);assert.equal(sound.getMetrics().plays,0);
 sound.setEnabled(false);assert.equal(await sound.play(luffy),false);assert.equal(instances.length,1);
 sound.setVolume(2);assert.equal(instances[0].volume,1);sound.dispose();
});
test('blocked audio is handled without throwing or changing game state',async()=>{
 const {sound,instances}=fixture();sound.prepare(zoro);instances[0].play=async()=>{throw Error('NotAllowedError');};assert.equal(await sound.play(zoro),false);assert.equal(sound.getMetrics().lastError,'Audio playback unavailable');sound.dispose();
});
