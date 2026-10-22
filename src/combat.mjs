import * as THREE from '../vendor/three/three.module.js';
import {createAttackEffects} from './attack-effects.mjs';
import {createSkeletalCombat} from './skeletal-combat.mjs';

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
function createEffects(scene, origin, direction, side, seed, profile, characterSignature = false) {
 const group = new THREE.Group(); group.name = 'chess-combat-effects'; group.position.copy(origin);
 const random = randomSequence(seed), dummy = new THREE.Object3D(), geometries = new Set(), materials = new Set();
 const tint = side === 'marine' ? '#ffbc70' : '#7affdc';
 const material = (color, additive = false) => {
  const mat = new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
   blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending});
  materials.add(mat); return mat;
 };
 const goreMaterial = (color, roughness) => {
  const mat = new THREE.MeshStandardMaterial({color, roughness, metalness: .04, transparent: true, opacity: 0, depthWrite: false});
  materials.add(mat); return mat;
 };
 const mesh = (name, geometry, mat) => {
  geometries.add(geometry); const object = new THREE.Mesh(geometry, mat); object.name = name; group.add(object); return object;
 };
 const pool = (name, geometry, mat, count) => {
  geometries.add(geometry); const object = new THREE.InstancedMesh(geometry, mat, count); object.name = name;
  object.instanceMatrix.setUsage(THREE.DynamicDrawUsage); object.frustumCulled = false; group.add(object); return object;
 };
 const ring = mesh('impact-shockwave', new THREE.RingGeometry(.36, .39, 48), material(tint, true));
 ring.rotation.x = -Math.PI / 2; ring.position.y = .008;
 const trailGeometry = new THREE.TorusGeometry(.57, .014, 4, 40, Math.PI * 1.35);
 const arc = mesh('finisher-trail', trailGeometry, material(tint, true));
 arc.visible = !characterSignature;
 const counterArc = mesh('parry-trail', trailGeometry, material('#ffcf85', true));
 const yaw = Math.atan2(direction.x, direction.z);
 arc.position.y = .58; counterArc.position.y = .64;
 arc.rotation.set(.3, yaw, -.8); counterArc.rotation.set(-.35, yaw + Math.PI / 2, .3);
 const flash = mesh('contact-flash', new THREE.IcosahedronGeometry(.105, 0), material('#ffdfb2', true)); flash.position.y = .56;
 const blood = pool('blood-droplets', new THREE.SphereGeometry(1, 8, 6), goreMaterial('#90071b', .25), 72);
 const splats = pool('blood-floor-spatter', new THREE.CircleGeometry(1, 7), material('#620616'), 28);
 const shards = pool('impact-shards', new THREE.IcosahedronGeometry(1, 0), goreMaterial('#65222b', .42), 32);
 const sparks = pool('clash-sparks', new THREE.TetrahedronGeometry(1), material('#ffc372', true), 28);
 const dust = pool('landing-dust', new THREE.IcosahedronGeometry(1, 0), material('#a88a78'), 18);
 const lateral = new THREE.Vector3(direction.z, 0, -direction.x);
 const droplets = Array.from({length: blood.count}, (_, i) => {
  const sideways = (random() - .5) * (profile.name === 'slash' ? 4.2 : 2.3), forward = .6 + random() * 2.3;
  const vx = direction.x * forward + lateral.x * sideways, vz = direction.z * forward + lateral.z * sideways;
  const vy = .55 + random() * 2.3, height = .35 + random() * .36;
  const land = (vy + Math.sqrt(vy * vy + 11 * height)) / 5.5;
  return {vx, vz, vy, height, land, size: .022 + random() * .029, delay: i < 48 ? 0 : .075 + random() * .13, spin: random() * Math.PI};
 });
 const debris = Array.from({length: shards.count}, () => {
  const angle = random() * Math.PI * 2, speed = .4 + random() * 1.3;
  return {x: Math.cos(angle) * speed + direction.x * .8, z: Math.sin(angle) * speed + direction.z * .8,
   y: 1 + random() * 2, spin: random() * 10 - 5, size: .035 + random() * .065};
 });
 const motes = Array.from({length: sparks.count}, () => ({angle: random() * Math.PI * 2, speed: .4 + random() * 1.2, y: random() * 1.5}));
 const clouds = Array.from({length: dust.count}, () => ({angle: random() * Math.PI * 2, speed: .3 + random() * .8, size: .08 + random() * .12}));
 const put = (object, index, x, y, z, sx, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) => {
  dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(rx, ry, rz); dummy.updateMatrix(); object.setMatrixAt(index, dummy.matrix);
 };
 scene?.add(group);
 let disposed = false;
 const effects = {
  count: group.children.length, bloodParticles: blood.count, bloodSplats: splats.count, shards: shards.count,
  update(p) {
   const age = Math.max(0, (p - .62) * 3.48), fade = 1 - smooth(segment(p, .88, 1));
   const hit = segment(p, .62, .91), parry = pulse(p, .452, .487), counter = pulse(p, .50, .538);
   const slash = pulse(p, .563, .68), active = p >= .62;
   ring.material.opacity = active ? (1 - hit) * .32 : 0; ring.scale.setScalar(1 + hit * 3.4);
   arc.material.opacity = Math.max(slash * .85, pulse(p, .431, .47) * .40);
   arc.rotation.z = -.95 + segment(p, .563, .68) * (profile.name === 'slash' ? 3.6 : 2.1);
   arc.scale.setScalar(.7 + slash * .45);
   counterArc.material.opacity = Math.max(parry, counter) * .65;
   counterArc.rotation.z = .3 - segment(p, .49, .54) * 2.2;
   flash.material.opacity = Math.max(parry * .45, active ? Math.max(0, 1 - age * 11) * .5 : 0);
   flash.scale.setScalar(.5 + Math.max(parry, active ? Math.max(0, 1 - age * 8) : 0) * .6);
   blood.material.opacity = active ? .96 * fade : 0;
   droplets.forEach((drop, i) => {
    const t = age - drop.delay, airborne = active && t >= 0 && t < drop.land;
    put(blood, i, drop.vx * Math.max(0, t), Math.max(.008, drop.height + drop.vy * t - 2.75 * t * t), drop.vz * Math.max(0, t),
     airborne ? drop.size : 0, airborne ? drop.size * (1.7 + Math.abs(drop.vy - 5.5 * t) * .3) : 0, airborne ? drop.size : 0, drop.spin, 0, -drop.vx * .3);
   });
   splats.material.opacity = active ? .9 * fade : 0;
   for (let i = 0; i < splats.count; i++) {
    const drop = droplets[i], landed = age >= drop.land + drop.delay, bloom = smooth((age - drop.land - drop.delay) / .12);
    const radius = landed ? drop.size * (2.7 + bloom * 1.8) : 0;
    // Floor paint, not a floating particle: each droplet lands at its ballistic endpoint.
    put(splats, i, drop.vx * drop.land, .004 + i * .000035, drop.vz * drop.land, radius, radius * .64, radius, -Math.PI / 2, 0, drop.spin);
   }
   shards.material.opacity = active ? .95 * fade : 0;
   debris.forEach((shard, i) => {
    const t = age, y = .45 + shard.y * t - 3.6 * t * t;
    const size = active ? shard.size : 0;
    put(shards, i, shard.x * t, Math.max(size * .65, y), shard.z * t, size * .5, size * 1.7, size, shard.spin * t, shard.spin * t * .7, shard.spin * t * 1.2);
   });
   const sparkStart = p >= .62 ? .62 : p >= .50 ? .50 : .455;
   const sparkAge = Math.max(0, (p - sparkStart) * 3.48), sparkActive = p >= .455 && sparkAge < .22;
   sparks.material.opacity = sparkActive ? (1 - sparkAge / .22) * .85 : 0;
   motes.forEach((mote, i) => put(sparks, i, Math.cos(mote.angle) * sparkAge * mote.speed * 3,
    .58 + mote.y * sparkAge - sparkAge * sparkAge * 3, Math.sin(mote.angle) * sparkAge * mote.speed * 3,
    .009, .055, .009, mote.angle, sparkAge * 5, mote.angle));
   const dustAge = Math.max(0, (p - .77) * 3.48), dustActive = p >= .77;
   dust.material.opacity = dustActive ? Math.max(0, 1 - dustAge * 1.9) * .19 : 0;
   clouds.forEach((cloud, i) => {
    const size = dustActive ? cloud.size * (.4 + dustAge * 2) : 0;
    put(dust, i, direction.x * .52 + Math.cos(cloud.angle) * dustAge * cloud.speed, .04 + dustAge * .13,
     direction.z * .52 + Math.sin(cloud.angle) * dustAge * cloud.speed, size, size * .45, size);
   });
   for (const object of [blood, splats, shards, sparks, dust]) object.instanceMatrix.needsUpdate = true;
  },
  dispose() {
   if (disposed) return;
   disposed = true; group.removeFromParent();
   for (const object of [blood, splats, shards, sparks, dust]) object.dispose();
   for (const geometry of geometries) geometry.dispose();
   for (const mat of materials) mat.dispose();
   group.clear();
  },
 };
 effects.update(0);
 return effects;
}

/**
 * Animate a miniature duel without changing the authoritative chess position.
 * cancel() restores every touched transform exactly and settles finished once.
 * The caller rebuilds board models only after finished. Reduced motion applies
 * the final positions immediately, with one capture impact and no effects.
 */
export function createMoveAnimation({
 attacker, victim = null, rook = null, start = attacker.position, end,
 rookEnd = null, capture = Boolean(victim), role = 'pawn', side = 'pirate', attack = null,
 reducedMotion = false, scene = null, seed = `${role}:${start.x},${start.z}:${end.x},${end.z}`,
 onImpact = () => {}, onPhase = () => {}, onCue = () => {}, prepare = () => {},
 requestFrame = callback => requestAnimationFrame(callback),
 cancelFrame = id => cancelAnimationFrame(id), now = () => performance.now(),
}) {
 const body = attacker.userData.combatBody || attacker.children[0] || null;
 const defenderBody = victim?.userData.combatBody || victim?.children[0] || null;
 const rookBody = rook?.userData.combatBody || rook?.children[0] || null;
 const savedAttacker = snapshot(attacker), savedBody = snapshot(body), savedVictim = snapshot(victim), savedDefenderBody = snapshot(defenderBody), savedRook = snapshot(rook), savedRookBody = snapshot(rookBody);
 const originals = [savedAttacker, savedBody, savedVictim, savedDefenderBody, savedRook, savedRookBody];
 const attackerRig = createSkeletalCombat(body, {attack}), defenderRig = createSkeletalCombat(defenderBody, {attack, defender:true}), rookRig = createSkeletalCombat(rookBody);
 const from = start.clone(), destination = end.clone(), rookDestination = rookEnd?.clone();
 const target = victim ? victim.position.clone() : destination.clone();
 const direction = target.clone().sub(from); direction.y = 0;
 if (direction.lengthSq() < .000001) direction.set(0, 0, side === 'pirate' ? -1 : 1);
 direction.normalize();
 const sideways = new THREE.Vector3(direction.z, 0, -direction.x);
 const distance = Math.hypot(target.x - from.x, target.z - from.z);
 const ranged = attack && ['projectile', 'lightning', 'room', 'string', 'darkness'].includes(attack.family);
 const stand = target.clone().addScaledVector(direction, -Math.min(ranged ? 1.4 : .76, distance)); stand.y = from.y;
 const styleRole = {brawl:'pawn', vault:'knight', slash:'queen', charge:'rook'};
 const profile = attack && styleRole[attack.style] ? PROFILES[styleRole[attack.style]] : PROFILES[role] || PROFILES.pawn;
 const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(direction.x, direction.z));
 const defenderFacing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-direction.x, -direction.z));
 const rookDirection = rookDestination && savedRook ? rookDestination.clone().sub(savedRook.position).setY(0).normalize() : null;
 const rookFacing = rookDirection ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(rookDirection.x, rookDirection.z)) : null;
 const scratch = new THREE.Vector3(), corner = new THREE.Vector3(), inverse = new THREE.Quaternion(), poseRotation = new THREE.Quaternion(), poseEuler = new THREE.Euler();
 const duration = reducedMotion ? 0 : capture ? 3600 : 600;
 const metrics = {phase: 'approach', progress: 0, impactCount: 0, effects: 0, profile: profile.name, duration, hitStop: false, cameraPunch: 0, bloodParticles: 0, bloodSplats: 0, shards: 0,
  characterAttack: attack?.id || null, character: attack?.character || null, family: attack?.family || null, signatureEffects: 0,
  articulation:{attacker:attackerRig.metrics, defender:defenderRig.metrics}};
 let landed = false;
 let frameId = null, settled = false, effects = null, signature = null, resolveFinished;
 const finished = new Promise(resolve => { resolveFinished = resolve; });
 const restoreAll = () => { originals.forEach(restore); attackerRig.restore(); defenderRig.restore(); rookRig.restore(); };
 const impact = () => {
  if (!settled && capture && metrics.impactCount === 0) { metrics.impactCount = 1; onImpact({position: target.clone(), profile: profile.name, side, attack}); }
 };
 const finish = cancelled => {
  if (settled) return;
  settled = true;
  if (frameId !== null) cancelFrame(frameId);
  effects?.dispose(); signature?.dispose(); metrics.effects = 0; metrics.signatureEffects = 0; metrics.hitStop = false; metrics.cameraPunch = 0;
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
   rookRig.update(p, {walking:true});
   rookRig.ground(savedRook.position.y);
  }
  attackerRig.update(p, {walking:true});
  attackerRig.ground(from.y);
 }

 function battle(p) {
  const approach = travel(segment(p, 0, .30)), windup = smooth(segment(p, .30, .43));
  const feint = pulse(p, .43, .485), counter = pulse(p, .485, .55), strike = smooth(segment(p, .55, .65));
  const defeat = smooth(segment(p, .65, .88)), recover = smooth(segment(p, .88, 1));
  const faceProgress = smooth(segment(p, 0, .18));
  const lunge = smooth(segment(p, .555, .625)), followThrough = smooth(segment(p, .65, .78));
  const advance = (-windup * .11 + feint * .24 - counter * .17 + lunge * .47 - followThrough * .12) * (1 - recover) * (ranged ? .25 : 1);
  attacker.position.lerpVectors(from, stand, approach).addScaledVector(direction, advance)
   .addScaledVector(sideways, (counter * -.13 + pulse(p, .55, .65) * .08) * (1 - recover)).lerp(destination, recover);
  attacker.quaternion.copy(savedAttacker.quaternion).slerp(facing, faceProgress).slerp(savedAttacker.quaternion, recover);
  const gait = Math.sin(segment(p, 0, .30) * Math.PI * 10) * Math.sin(segment(p, 0, .30) * Math.PI);
  const attackHold = 1 - recover;
  let recoil = -windup * .07 + feint * .09 - counter * .08 + strike * profile.reach * .38;
  const release = smooth(segment(p,.55,.62)), follow = smooth(segment(p,.65,.82));
  let twist = (-windup * profile.twist * .55 + feint * profile.twist * .30 - counter * .18 + release * profile.twist * .92 - follow * profile.twist * .36) * attackHold;
  let lean = (-windup * .18 + feint * .24 - counter * .18 + strike * profile.lean) * attackHold;
  let jump = profile.jump * .65 * pulse(p, .54, .73), roll = gait * .05 - counter * .17;
  const attackPulse = pulse(p, .55, .72), variant = attack?.variant;
  if (attack?.family === 'rubber') { lean -= windup * .18 * attackHold; recoil += attackPulse * .13; }
  if (attack?.family === 'projectile' || variant === 'laser') { recoil -= attackPulse * .12; twist *= .28; jump *= .15; }
  if (attack?.family === 'room' || attack?.family === 'string') { lean *= .45; twist *= .55; recoil *= .35; }
  if (attack?.family === 'sword' && variant === 'triple') { twist += attackPulse * .20; roll -= attackPulse * .11; }
  if (variant === 'kick') { twist += attackPulse * .48; roll += attackPulse * .25; jump = attackPulse * .18; }
  if (variant === 'phoenix' || variant === 'pteranodon') { jump += pulse(p, .44, .80) * .35; lean += attackPulse * .20; }
  if (attack?.family === 'beast') { lean += attackPulse * .20; recoil += attackPulse * .08; }
  if (attack?.family === 'quake' || variant === 'magma') { recoil += attackPulse * .09; lean += windup * .12 * attackHold; }
  pose(savedBody, attacker, recoil * attackHold, gait * .023, Math.abs(gait) * .06 + jump, lean, twist, roll);
  attackerRig.update(p);
  attackerRig.ground(from.y);
  if (victim) {
   victim.quaternion.copy(savedVictim.quaternion).slerp(defenderFacing, smooth(segment(p, .18, .37)));
   const brace = pulse(p, .43, .49), stagger = pulse(p, .62, .72);
   const dodge = pulse(p, .42, .50), knockback = smooth(segment(p, .62, .78));
   const collapse = smooth(segment(p, .67, .81)), bounce = pulse(p, .79, .855);
   victim.position.copy(savedVictim.position).addScaledVector(sideways, dodge * .25 - counter * .08 + defeat * .20)
    .addScaledVector(direction, -counter * .18 + knockback * (profile.name === 'charge' ? .68 : .53));
   const fall = collapse * 1.53;
   pose(savedDefenderBody, victim, -brace * .04 + stagger * .06, 0,
    brace * .04 + stagger * .16 + bounce * .07, -.22 * brace + counter * .22 - .32 * stagger - fall,
    -brace * .3 + counter * .32 + defeat * (profile.name === 'slash' ? .85 : .38), defeat * .36 - bounce * .12);
   if (defenderBody) {
    const dissolve = smooth(segment(p, .84, .88));
    defenderBody.scale.copy(savedDefenderBody.scale).multiplyScalar(1 - dissolve * .96);
    if (p >= .82) ground(savedDefenderBody, 0);
   }
   victim.visible = savedVictim.visible && p < .88;
   defenderRig.update(p);
   defenderRig.ground(savedVictim.position.y);
  }
  effects?.update(p);
  signature?.update(p);
 }

 if (reducedMotion) {
  impact(); finish(false);
  return controller;
 }
 if (capture) { effects = createEffects(scene, target, direction, side, seed, profile, Boolean(attack)); metrics.effects = effects.count; metrics.bloodParticles = effects.bloodParticles; metrics.bloodSplats = effects.bloodSplats; metrics.shards = effects.shards; }
 if (capture && attack) { signature = createAttackEffects({scene, origin: target, direction, attacker, attack}); metrics.signatureEffects = signature.count; metrics.effects += signature.count; }
 let started = 0;
 const frame = time => {
  if (settled) return;
  const elapsed = Math.max(0, time - started);
  // A real 120 ms hold: pose, particles and progress all stop at contact.
  const motionDuration = capture ? duration - 120 : duration;
  const contactTime = motionDuration * .62;
  metrics.hitStop = capture && elapsed >= contactTime && elapsed < contactTime + 120;
  const paused = capture ? Math.min(120, Math.max(0, elapsed - contactTime)) : 0;
  const p = clamp((elapsed - paused) / motionDuration);
  metrics.cameraPunch = capture && elapsed >= contactTime ? Math.max(0, 1 - (elapsed - contactTime) / 390) : 0;
  metrics.progress = p;
  if (capture) battle(p); else move(p);
  const phase = capture ? COMBAT_PHASES.findLast(([, boundary]) => p >= boundary)[0] : p < 1 ? 'move' : 'complete';
  if (metrics.phase !== phase) { metrics.phase = phase; onPhase({phase, progress: p, attack}); }
  if (settled) return;
  if (p >= .62) impact();
  if (settled) return;
  if (capture && !landed && p >= .80) { landed = true; onCue({cue:'land', attack, position:target.clone()}); }
  if (settled) return;
  if (p >= 1) finish(false); else frameId = requestFrame(frame);
 };
 const beginFrames = () => { if(settled) return; started=now(); frameId=requestFrame(frame); };
 try {
  const preparation = capture ? prepare() : null;
  if(preparation?.then) { metrics.phase='preparing'; preparation.then(beginFrames,()=>finish(true)); }
  else beginFrames();
 } catch { finish(true); }
 return controller;
}
