import {ATTACK_FAMILIES} from './attacks.mjs';

const CUE_GAIN = Object.freeze({windup: .4, parry: .5, impact: .95, land: .6});
const CUES = Object.keys(CUE_GAIN);
const cuePath = (attack, cue) => '/assets/audio/combat/v2/' +
 (cue === 'parry' || cue === 'land' ? cue : `${attack.sound}-${cue}`) + '.mp3';

// Decode once, then play independent stems. No provider calls or pitch shifting.
export function createCombatAudio({
 createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
 fetch: fetcher = (...args) => globalThis.fetch(...args),
 now = () => performance.now(),
} = {}) {
 const cache = new Map(), voices = new Set(), heard = new Set();
 const cueCounts = {windup: 0, parry: 0, impact: 0, land: 0};
 let context, master, compressor, enabled = true, volume = .72, ducked = false;
 let serial = 0, duelAttack = null, disposed = false, plays = 0, skipped = 0;
 let lastAttack = null, lastSource = null, lastError = null, resuming = null;
 const valid = attack => attack && ATTACK_FAMILIES.includes(attack.sound);

 function mix() {
  if (!master) return;
  const target = enabled ? volume * (ducked ? .35 : 1) : 0;
  master.gain.cancelScheduledValues(context.currentTime);
  master.gain.setTargetAtTime(target, context.currentTime, .025);
 }
 function audioContext() {
  if (disposed) return null;
  if (!context) {
   context = createContext();
   master = context.createGain();
   compressor = context.createDynamicsCompressor();
   compressor.threshold.value = -8; compressor.knee.value = 6;
   compressor.ratio.value = 12; compressor.attack.value = .003; compressor.release.value = .18;
   master.connect(compressor); compressor.connect(context.destination);
   master.gain.value = enabled ? volume * (ducked ? .35 : 1) : 0;
  }
  return context;
 }
 function unlock() {
  if (disposed || !enabled) return Promise.resolve(false);
  try {
   const ctx = audioContext();
   if (ctx.state === 'running') return Promise.resolve(true);
   if (!resuming) resuming = Promise.resolve(ctx.resume()).then(() => !disposed && ctx.state === 'running')
    .catch(() => { if (!disposed) lastError = 'Audio playback unavailable'; return false; })
    .finally(() => { resuming = null; });
   return resuming;
  } catch { lastError = 'Audio playback unavailable'; return Promise.resolve(false); }
 }
 function load(path) {
  if (cache.has(path)) return cache.get(path).promise;
  const entry = {buffer: null, promise: null};
  // Queue the fetch after registering the entry so synchronous failures are retryable.
  entry.promise = Promise.resolve().then(async () => {
   const ctx = audioContext();
   if (!ctx) return null;
   const response = await fetcher(path);
   if (!response.ok) throw Error('Audio asset unavailable');
   const bytes = await response.arrayBuffer();
   if (disposed) return null;
   const buffer = await ctx.decodeAudioData(bytes);
   if (disposed) return null;
   entry.buffer = buffer;
   return buffer;
  }).catch(() => { if (cache.get(path) === entry) cache.delete(path); return null; });
  cache.set(path, entry);
  return entry.promise;
 }
 function prepare(attack) {
  if (disposed || !valid(attack)) return Promise.resolve([]);
  return Promise.all(CUES.map(cue => load(cuePath(attack, cue))));
 }
 function release(voice) {
  voices.delete(voice);
  voice.source.onended = null;
  voice.source.disconnect(); voice.gain.disconnect();
 }
 function stop() {
  serial++; duelAttack = null; heard.clear();
  for (const voice of [...voices]) {
   voice.source.onended = null;
   try { voice.source.stop(); } catch { /* Already ended. */ }
   release(voice);
  }
 }
 function begin(attack) {
  stop();
  if (!disposed && valid(attack)) {
   duelAttack = attack.id;
   if (enabled) void prepare(attack);
  }
  return serial;
 }
 async function playCue(attack, cue, {duel = serial} = {}) {
  if (disposed || !enabled || !valid(attack) || !CUES.includes(cue) ||
      duel !== serial || duelAttack !== attack.id || heard.has(cue)) return false;
  heard.add(cue);
  const started = now(), path = cuePath(attack, cue);
  const buffer = cache.get(path)?.buffer || await load(path);
  if (disposed || !enabled || duel !== serial) return false;
  if (!buffer) { lastError = 'Audio asset unavailable'; skipped++; return false; }
  // A delayed download must never play an impact after the victim has fallen.
  if (now() - started > 150) { skipped++; return false; }
  let voice;
  try {
   const ctx = audioContext();
   if (ctx.state !== 'running') {
    void unlock(); skipped++; return false;
   }
   const source = ctx.createBufferSource(), gain = ctx.createGain();
   voice = {source, gain};
   source.buffer = buffer; gain.gain.value = CUE_GAIN[cue];
   source.connect(gain); gain.connect(master);
   source.onended = () => release(voice);
   voices.add(voice);
   source.start(ctx.currentTime);
   plays++; cueCounts[cue]++; lastAttack = attack.id; lastSource = path; lastError = null;
   return true;
  } catch {
   if (voice) release(voice);
   lastError = 'Audio playback unavailable'; return false;
  }
 }
 return {
  prepare, begin, playCue, unlock, stop,
  // Legacy callers can still audition one impact independently of a duel.
  play(attack) { const duel = begin(attack); return playCue(attack, 'impact', {duel}); },
  setEnabled(value) { enabled = Boolean(value); if (!enabled) stop(); mix(); },
  setVolume(value) { if (Number.isFinite(value)) { volume = Math.max(0, Math.min(1, value)); mix(); } },
  setDucked(value) { ducked = Boolean(value); mix(); },
  getMetrics: () => ({cached: cache.size, decoded: [...cache.values()].filter(e => e.buffer).length,
   active: voices.size, plays, cueCounts: {...cueCounts}, skipped, lastAttack, lastSource, lastError, enabled, volume, ducked}),
  dispose() {
   if (disposed) return;
   stop(); disposed = true; cache.clear();
   master?.disconnect(); compressor?.disconnect();
   if (context) void Promise.resolve(context.close()).catch(() => {});
  },
 };
}
