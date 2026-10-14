import * as THREE from '../vendor/three/three.module.js';

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const p = clamp(value); return p * p * (3 - 2 * p); };
const travel = value => { const p = clamp(value); return p * p * p * (p * (p * 6 - 15) + 10); };
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
   ringMaterial.opacity = p >= .61 ? (1 - hit) * .42 : 0;
   ring.scale.setScalar(1 + hit * 2.8);
   arcMaterial.opacity = slash * .58;
   arc.rotation.z = -.9 + segment(p, .555, .68) * 2.3;
   arc.scale.setScalar(.7 + slash * .45);
   sparkMaterial.opacity = Math.max(parry * .40, p >= .61 ? Math.max(0, 1 - hit * 8) * .52 : 0);
   counterArc.scale.setScalar(.6 + parry * .45);
   flash.scale.setScalar(.25 + Math.max(parry, pulse(p, .61, .69)) * .85);
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
 const rookBody = rook?.userData.combatBody || rook?.children[0] || null;
 const savedAttacker = snapshot(attacker), savedBody = snapshot(body), savedVictim = snapshot(victim), savedDefenderBody = snapshot(defenderBody), savedRook = snapshot(rook), savedRookBody = snapshot(rookBody);
 const originals = [savedAttacker, savedBody, savedVictim, savedDefenderBody, savedRook, savedRookBody];
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
 const rookDirection = rookDestination && savedRook ? rookDestination.clone().sub(savedRook.position).setY(0).normalize() : null;
 const rookFacing = rookDirection ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(rookDirection.x, rookDirection.z)) : null;
 const scratch = new THREE.Vector3(), corner = new THREE.Vector3(), inverse = new THREE.Quaternion(), poseRotation = new THREE.Quaternion(), poseEuler = new THREE.Euler();
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

 // Translate in board space; cached local bounds keep a tilted figure above the
 // floor without traversing model geometry during animation.
 function ground(saved, intendedHeight = saved.object.position.y) {
  const bounds = saved.object.userData.combatBounds;
  if (!bounds) return;
  let bottom = Infinity;
  for (let i = 0; i < 8; i++) {
   corner.set(i & 1 ? bounds.halfWidth : -bounds.halfWidth, i & 2 ? bounds.height : 0, i & 4 ? bounds.halfDepth : -bounds.halfDepth)
    .multiply(saved.object.scale).applyQuaternion(saved.object.quaternion);
   bottom = Math.min(bottom, corner.y);
  }
  saved.object.position.y = Math.max(intendedHeight, -bottom);
 }

 function pose(saved, parent, forward, lateral, height, lean, twist = 0, roll = 0, moveDirection = direction) {
  if (!saved) return;
  scratch.set(moveDirection.x * forward + moveDirection.z * lateral, 0, moveDirection.z * forward - moveDirection.x * lateral);
  scratch.y = height; inverse.copy(parent.quaternion).invert(); scratch.applyQuaternion(inverse);
  saved.object.position.copy(saved.position).add(scratch);
  poseEuler.set(lean, twist, roll); poseRotation.setFromEuler(poseEuler);
  saved.object.quaternion.copy(saved.quaternion).multiply(poseRotation);
  saved.object.scale.copy(saved.scale);
  ground(saved);
 }

 function move(p) {
  const eased = travel(p), envelope = Math.sin(p * Math.PI), steps = Math.min(6, Math.max(2, Math.round(distance * 2)));
  const gait = Math.sin(eased * Math.PI * steps * 2) * envelope;
  const turn = smooth(segment(p, 0, .18)), settle = smooth(segment(p, .82, 1));
  attacker.position.lerpVectors(from, destination, eased);
  attacker.quaternion.copy(savedAttacker.quaternion).slerp(facing, turn).slerp(savedAttacker.quaternion, settle);
  const leap = role === 'knight' ? Math.pow(Math.sin(eased * Math.PI), 1.35) * .65 : gait * gait * .065;
  const drive = .14 * pulse(p, .04, .5) - .10 * pulse(p, .65, .96);
  pose(savedBody, attacker, 0, role === 'knight' ? 0 : gait * .025, leap, drive, 0, gait * .055);
  if (role === 'knight' && body) {
   const landing = pulse(p, .82, .99);
   body.scale.set(savedBody.scale.x * (1 + landing * .045), savedBody.scale.y * (1 - landing * .085), savedBody.scale.z * (1 + landing * .045));
   ground(savedBody);
  }
  if (rook && rookDestination) {
   rook.position.lerpVectors(savedRook.position, rookDestination, eased);
   rook.quaternion.copy(savedRook.quaternion).slerp(rookFacing, turn).slerp(savedRook.quaternion, settle);
   const rookSteps = Math.min(6, Math.max(2, Math.round(savedRook.position.distanceTo(rookDestination) * 2)));
   const rookGait = Math.sin(eased * Math.PI * rookSteps * 2) * envelope;
   pose(savedRookBody, rook, 0, rookGait * .018, rookGait * rookGait * .045, drive * .7, 0, rookGait * .035, rookDirection);
  }
 }

 function battle(p) {
  const approach = smooth(segment(p, 0, .30)), windup = smooth(segment(p, .30, .43));
  const feint = pulse(p, .43, .55), strike = smooth(segment(p, .55, .65));
  const defeat = smooth(segment(p, .65, .88)), recover = smooth(segment(p, .88, 1));
  const faceProgress = smooth(segment(p, 0, .18));
  const lunge = smooth(segment(p, .55, .635)), followThrough = smooth(segment(p, .635, .76));
  const advance = (-windup * .09 + feint * .14 + lunge * .40 - followThrough * .10) * (1 - recover);
  attacker.position.lerpVectors(from, stand, approach).addScaledVector(direction, advance).lerp(destination, recover);
  attacker.quaternion.copy(savedAttacker.quaternion).slerp(facing, faceProgress).slerp(savedAttacker.quaternion, recover);
  const gait = Math.sin(segment(p, 0, .30) * Math.PI * 8) * Math.sin(segment(p, 0, .30) * Math.PI);
  const attackHold = 1 - recover;
  const recoil = -windup * .055 + feint * .06 + strike * profile.reach * .32;
  const twist = (-windup * profile.twist + strike * profile.twist * 1.8) * attackHold;
  const lean = (-windup * .14 + feint * .17 + strike * profile.lean) * attackHold;
  const jump = profile.jump * pulse(p, .50, .72);
  pose(savedBody, attacker, recoil * attackHold, gait * .018, Math.abs(gait) * .05 + jump, lean, twist, gait * .04);
  if (victim) {
   victim.quaternion.copy(savedVictim.quaternion).slerp(defenderFacing, smooth(segment(p, .18, .37)));
   // The defender steps in to meet the feint, then recoils before the fatal hit.
   const brace = pulse(p, .43, .55), stagger = pulse(p, .61, .73);
   const dodge = pulse(p, .42, .60), knockback = smooth(segment(p, .61, .78));
   victim.position.copy(savedVictim.position).addScaledVector(sideways, dodge * .20 + defeat * .11).addScaledVector(direction, -brace * .08 + knockback * .36);
   const fall = defeat * 1.42;
   pose(savedDefenderBody, victim, -brace * .04 + stagger * .04,
    0, brace * .035 + stagger * .07, -.18 * brace - .24 * stagger - fall, -brace * .24, defeat * .23);
   if (defenderBody) {
    // Hold the fallen silhouette before it dissolves into the fragments.
    const dissolve = smooth(segment(p, .82, .88));
    defenderBody.scale.copy(savedDefenderBody.scale).multiplyScalar(1 - dissolve * .96);
    if (dissolve > 0) ground(savedDefenderBody, 0);
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
