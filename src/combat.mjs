import * as THREE from '../vendor/three/three.module.js';

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const p = clamp(value); return p * p * (3 - 2 * p); };
const segment = (p, from, to) => clamp((p - from) / (to - from));
const pulse = (p, from, to) => Math.sin(segment(p, from, to) * Math.PI);

export const COMBAT_PHASES = Object.freeze([
 ['approach', 0], ['windup', .30], ['parry', .43], ['strike', .55],
 ['defeat', .65], ['recover', .88], ['complete', 1],
]);

const PROFILES = Object.freeze({
 pawn: {name: 'brawl', lean: .28, twist: .32, jump: .12, reach: .32},
 knight: {name: 'vault', lean: .48, twist: .56, jump: .85, reach: .38},
 bishop: {name: 'slash', lean: .26, twist: 1.0, jump: .21, reach: .32},
 queen: {name: 'slash', lean: .32, twist: 1.22, jump: .25, reach: .36},
 rook: {name: 'charge', lean: .47, twist: .14, jump: .08, reach: .43},
 king: {name: 'charge', lean: .38, twist: .3, jump: .16, reach: .39},
});

function snapshot(object) {
 return object && {object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(), visible: object.visible};
}

function restore(saved) {
 if (!saved) return;
 const {object, position, quaternion, scale, visible} = saved;
 object.position.copy(position); object.quaternion.copy(quaternion); object.scale.copy(scale); object.visible = visible;
}

function randomSequence(seed) {
 let state = 2166136261;
 for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
 return () => { state = Math.imul(state ^ state >>> 15, 2246822519); state = Math.imul(state ^ state >>> 13, 3266489917); return ((state ^= state >>> 16) >>> 0) / 4294967296; };
}

// All effect resources belong to this battle. Cached character geometry and
// materials are never cloned, edited or disposed by the animation.
function createEffects(scene, origin, direction, side, seed) {
 const group = new THREE.Group(); group.name = 'chess-combat-effects'; group.position.copy(origin);
 const color = side === 'marine' ? '#ffc975' : '#79ffdf';
 const material = (tint = color) => new THREE.MeshBasicMaterial({color: tint, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending});
 const ringMaterial = material(), arcMaterial = material(), sparkMaterial = material('#fff4d5'), debrisMaterial = material('#d8b887');
 const ring = new THREE.Mesh(new THREE.RingGeometry(.42, .47, 48), ringMaterial);
 ring.rotation.x = -Math.PI / 2; ring.position.y = .035; group.add(ring);
 const arcGeometry = new THREE.TorusGeometry(.51, .024, 5, 36, Math.PI * 1.3);
 const arc = new THREE.Mesh(arcGeometry, arcMaterial), counterArc = new THREE.Mesh(arcGeometry, sparkMaterial);
 arc.position.y = .62; counterArc.position.y = .68;
 const yaw = Math.atan2(direction.x, direction.z);
 arc.rotation.set(.4, yaw, -.8); counterArc.rotation.set(-.35, yaw + Math.PI / 2, .3);
 group.add(arc, counterArc);
 const flash = new THREE.Mesh(new THREE.IcosahedronGeometry(.17, 1), sparkMaterial); flash.position.y = .58; group.add(flash);
 const shardGeometry = new THREE.IcosahedronGeometry(.065, 0), random = randomSequence(seed), shards = [];
 for (let i = 0; i < 24; i++) {
  const mesh = new THREE.Mesh(shardGeometry, debrisMaterial), angle = random() * Math.PI * 2;
  const speed = .45 + random() * 1.1;
  const velocity = new THREE.Vector3(Math.cos(angle) * speed + direction.x * .4, .7 + random() * 1.4, Math.sin(angle) * speed + direction.z * .4);
  const spin = new THREE.Vector3(random() * 9 - 4.5, random() * 9 - 4.5, random() * 9 - 4.5);
  mesh.visible = false; group.add(mesh); shards.push({mesh, velocity, spin});
 }
 scene?.add(group);
 let disposed = false;
 return {
  count: group.children.length,
  update(p) {
   const hit = segment(p, .61, .96), parry = pulse(p, .465, .54), slash = pulse(p, .555, .68);
   ringMaterial.opacity = p >= .61 ? (1 - hit) * .75 : 0;
   ring.scale.setScalar(1 + hit * 2.8);
   arcMaterial.opacity = slash * .94;
   arc.rotation.z = -.9 + segment(p, .555, .68) * 2.3;
   arc.scale.setScalar(.7 + slash * .45);
   sparkMaterial.opacity = Math.max(parry * .8, p >= .61 ? Math.max(0, 1 - hit * 6) : 0);
   counterArc.scale.setScalar(.6 + parry * .45);
   flash.scale.setScalar(.4 + Math.max(parry, pulse(p, .61, .69)) * 2.1);
   debrisMaterial.opacity = p >= .65 ? (1 - hit) * .9 : 0;
   for (const {mesh, velocity, spin} of shards) {
    mesh.visible = p >= .65 && p < .96;
    mesh.position.set(velocity.x * hit, Math.max(.02, .5 + velocity.y * hit - 2.7 * hit * hit), velocity.z * hit);
    mesh.rotation.set(spin.x * hit, spin.y * hit, spin.z * hit);
    mesh.scale.setScalar(1 - hit * .7);
   }
  },
  dispose() {
   if (disposed) return;
   disposed = true; group.removeFromParent();
   for (const geometry of [ring.geometry, arcGeometry, flash.geometry, shardGeometry]) geometry.dispose();
   for (const mat of [ringMaterial, arcMaterial, sparkMaterial, debrisMaterial]) mat.dispose();
   group.clear();
  },
 };
}

/**
 * Animate a miniature duel without changing the authoritative chess position.
 * cancel() restores every touched transform exactly and settles finished once.
 * The caller rebuilds board models only after finished. Reduced motion applies
 * the final positions immediately, with one capture impact and no effects.
 */
export function createMoveAnimation({
 attacker, victim = null, rook = null, start = attacker.position, end,
 rookEnd = null, capture = Boolean(victim), role = 'pawn', side = 'pirate',
 reducedMotion = false, scene = null, seed = `${role}:${start.x},${start.z}:${end.x},${end.z}`,
 onImpact = () => {}, onPhase = () => {},
 requestFrame = callback => requestAnimationFrame(callback),
 cancelFrame = id => cancelAnimationFrame(id), now = () => performance.now(),
}) {
 const body = attacker.userData.combatBody || attacker.children[0] || null;
 const defenderBody = victim?.userData.combatBody || victim?.children[0] || null;
 const savedAttacker = snapshot(attacker), savedBody = snapshot(body), savedVictim = snapshot(victim), savedDefenderBody = snapshot(defenderBody), savedRook = snapshot(rook);
 const originals = [savedAttacker, savedBody, savedVictim, savedDefenderBody, savedRook];
 const from = start.clone(), destination = end.clone(), rookDestination = rookEnd?.clone();
 const target = victim ? victim.position.clone() : destination.clone();
 const direction = target.clone().sub(from); direction.y = 0;
 if (direction.lengthSq() < .000001) direction.set(0, 0, side === 'pirate' ? -1 : 1);
 direction.normalize();
 const sideways = new THREE.Vector3(direction.z, 0, -direction.x);
 const distance = Math.hypot(target.x - from.x, target.z - from.z);
 const stand = target.clone().addScaledVector(direction, -Math.min(.76, distance)); stand.y = from.y;
 const profile = PROFILES[role] || PROFILES.pawn;
 const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(direction.x, direction.z));
 const defenderFacing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-direction.x, -direction.z));
 const scratch = new THREE.Vector3(), inverse = new THREE.Quaternion(), poseRotation = new THREE.Quaternion(), poseEuler = new THREE.Euler();
 const duration = reducedMotion ? 0 : capture ? 2400 : 600;
 const metrics = {phase: 'approach', progress: 0, impactCount: 0, effects: 0, profile: profile.name, duration};
 let frameId = null, settled = false, effects = null, resolveFinished;
 const finished = new Promise(resolve => { resolveFinished = resolve; });
 const restoreAll = () => originals.forEach(restore);
 const impact = () => {
  if (!settled && capture && metrics.impactCount === 0) { metrics.impactCount = 1; onImpact({position: target.clone(), profile: profile.name, side}); }
 };
 const finish = cancelled => {
  if (settled) return;
  settled = true;
  if (frameId !== null) cancelFrame(frameId);
  effects?.dispose(); metrics.effects = 0;
  restoreAll();
  if (!cancelled) {
   attacker.position.copy(destination);
   if (rook && rookDestination) rook.position.copy(rookDestination);
   if (capture && victim) victim.visible = false;
   metrics.phase = 'complete'; metrics.progress = 1;
  } else metrics.phase = 'cancelled';
  resolveFinished({cancelled});
 };
 const controller = {finished, cancel: () => finish(true), metrics};

 // Body translations are specified in board space, converted into the rotating
 // pedestal's local coordinates. The base stays level while the figure fights.
 function pose(saved, parent, forward, lateral, height, lean, twist = 0, roll = 0) {
  if (!saved) return;
  scratch.copy(direction).multiplyScalar(forward).addScaledVector(sideways, lateral);
  scratch.y = height; inverse.copy(parent.quaternion).invert(); scratch.applyQuaternion(inverse);
  saved.object.position.copy(saved.position).add(scratch);
  poseEuler.set(lean, twist, roll); poseRotation.setFromEuler(poseEuler);
  saved.object.quaternion.copy(saved.quaternion).multiply(poseRotation);
  saved.object.scale.copy(saved.scale);
 }

 function move(p) {
  const eased = smooth(p), gait = Math.sin(p * Math.PI * 8) * Math.sin(p * Math.PI);
  attacker.position.lerpVectors(from, destination, eased);
  const leap = role === 'knight' ? Math.sin(p * Math.PI) * .65 : Math.abs(gait) * .055;
  pose(savedBody, attacker, 0, gait * .018, leap, 0, 0, gait * .045);
  if (rook && rookDestination) rook.position.lerpVectors(savedRook.position, rookDestination, eased);
 }

 function battle(p) {
  const approach = smooth(segment(p, 0, .30)), windup = smooth(segment(p, .30, .43));
  const feint = pulse(p, .43, .55), strike = smooth(segment(p, .55, .65));
  const defeat = smooth(segment(p, .65, .88)), recover = smooth(segment(p, .88, 1));
  const faceProgress = smooth(segment(p, 0, .18));
  attacker.position.lerpVectors(from, stand, approach).lerp(destination, recover);
  attacker.quaternion.copy(savedAttacker.quaternion).slerp(facing, faceProgress).slerp(savedAttacker.quaternion, recover);
  const gait = Math.sin(segment(p, 0, .30) * Math.PI * 8) * Math.sin(segment(p, 0, .30) * Math.PI);
  const attackHold = 1 - recover;
  const recoil = -windup * .13 + feint * .19 + strike * profile.reach;
  const twist = (-windup * profile.twist + strike * profile.twist * 1.8) * attackHold;
  const lean = (-windup * .14 + feint * .17 + strike * profile.lean) * attackHold;
  const jump = profile.jump * pulse(p, .50, .72);
  pose(savedBody, attacker, recoil * attackHold, gait * .018, Math.abs(gait) * .05 + jump, lean, twist, gait * .04);
  if (victim) {
   victim.quaternion.copy(savedVictim.quaternion).slerp(defenderFacing, smooth(segment(p, .18, .37)));
   // The defender steps in to meet the feint, then recoils before the fatal hit.
   const brace = pulse(p, .43, .55), stagger = pulse(p, .61, .73);
   const fall = defeat * 1.42;
   pose(savedDefenderBody, victim, -brace * .13 + stagger * .12 + defeat * .32,
    defeat * .10, brace * .035 - defeat * .06, -.18 * brace - .24 * stagger - fall, -brace * .24, defeat * .23);
   if (defenderBody) {
    // Only the fallen figure shrinks into the stone fragments; its pedestal
    // remains solid until the actor is hidden, keeping the impact readable.
    const dissolve = smooth(segment(p, .78, .88));
    defenderBody.scale.copy(savedDefenderBody.scale).multiplyScalar(1 - dissolve * .96);
   }
   victim.visible = savedVictim.visible && p < .88;
  }
  effects?.update(p);
 }

 if (reducedMotion) {
  impact(); finish(false);
  return controller;
 }
 if (capture) { effects = createEffects(scene, target, direction, side, seed); metrics.effects = effects.count; }
 const started = now();
 const frame = time => {
  if (settled) return;
  const p = clamp((time - started) / duration);
  metrics.progress = p;
  if (capture) battle(p); else move(p);
  const phase = capture ? COMBAT_PHASES.findLast(([, boundary]) => p >= boundary)[0] : p < 1 ? 'move' : 'complete';
  if (metrics.phase !== phase) { metrics.phase = phase; onPhase({phase, progress: p}); }
  if (settled) return;
  if (p >= .61) impact();
  if (settled) return;
  if (p >= 1) finish(false); else frameId = requestFrame(frame);
 };
 frameId = requestFrame(frame);
 return controller;
}
