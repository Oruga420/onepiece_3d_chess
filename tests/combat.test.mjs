import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {createMoveAnimation} from '../src/combat.mjs';
import {CHARACTER_ATTACKS, ATTACK_FAMILIES, getCharacterAttack} from '../src/attacks.mjs';

const captureTime = p => p * 3480 + (p > .62 ? 120 : 0);

function actor(position = [0, .17, 0], yaw = Math.PI) {
 const root = new THREE.Group(), body = new THREE.Group();
 body.add(new THREE.Mesh(new THREE.BoxGeometry(.3, .8, .3).translate(0, .4, 0), new THREE.MeshStandardMaterial()));
 body.userData.combatBounds = {halfWidth: .15, halfDepth: .15, height: .8};
 root.userData.combatBody = body;
 root.add(body); root.position.fromArray(position); root.rotation.y = yaw;
 return root;
}

function transform(object) {
 return {position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(), visible: object.visible, children: object.children.map(transform)};
}

function clock() {
 let time = 0, nextId = 1;
 const scheduled = new Map(), allCallbacks = [];
 return {
  now: () => time,
  requestFrame(callback) { const id = nextId++; scheduled.set(id, callback); allCallbacks.push(callback); return id; },
  cancelFrame: id => scheduled.delete(id),
  advance(ms) { time = ms; const current = [...scheduled.values()]; scheduled.clear(); current.forEach(callback => callback(time)); },
  stale(ms) { allCallbacks.forEach(callback => callback(ms)); },
  get pending() { return scheduled.size; },
 };
}

function fixture(options = {}) {
 const timer = clock(), scene = new THREE.Scene();
 const attacker = actor([0, .17, 0]), victim = actor([0, .17, -2], 0), rook = actor([3, .17, 0]);
 const end = new THREE.Vector3(0, .17, -2), impacts = [], phases = [];
 const original = [attacker, victim, rook].map(transform);
 scene.add(attacker, victim, rook);
 const animation = createMoveAnimation({attacker, victim, end, scene, seed: 'D2:D4:queen', role: 'queen',
  ...timer, onImpact: event => impacts.push(event), onPhase: event => phases.push(event), ...options});
 return {timer, scene, attacker, victim, rook, end, original, impacts, phases, animation};
}

test('capture motion and audio events use the character attack instead of chess rank', () => {
 const attack = getCharacterAttack('mugiwara', 'bishop'), f = fixture({role: 'bishop', attack});
 assert.equal(f.animation.metrics.profile, 'vault', 'Sanji kicks instead of using the bishop slash');
 assert.equal(f.animation.metrics.characterAttack, attack.id);
 assert.equal(f.animation.metrics.family, 'fire');
 assert(f.animation.metrics.signatureEffects > 0);
 f.timer.advance(captureTime(.35));
 assert.equal(f.phases[0].attack, attack);
 f.timer.advance(captureTime(.62));
 assert.equal(f.impacts[0].attack, attack);
 f.animation.cancel();
 assert.equal(f.animation.metrics.signatureEffects, 0);
});

test('character signatures replace the shared finisher and preserve their colors on light tiles', () => {
 for (const attack of [getCharacterAttack('mugiwara','rook'), getCharacterAttack('whitebeard','rook'), getCharacterAttack('whitebeard','queen'), getCharacterAttack('marines','queen')]) {
  const f = fixture({attack}); f.timer.advance(captureTime(.62));
  assert.equal(f.scene.getObjectByName('finisher-trail').visible, false);
  assert.equal(f.scene.getObjectByName('parry-trail').visible, true);
  const cores = f.scene.getObjectByName('character-attack-effects').children.filter(o => o.material.color.equals(new THREE.Color(attack.color)));
  assert(cores.length > 0, attack.id);
  for (const core of cores) { assert.equal(core.material.blending, THREE.NormalBlending); assert.equal(core.material.toneMapped, false); }
  f.animation.cancel();
 }
 const legacy = fixture(); assert.equal(legacy.scene.getObjectByName('finisher-trail').visible, true); legacy.animation.cancel();
});

test('ranged characters attack from a stand-off distance and still occupy the captured square', async () => {
 for (const family of ['projectile','lightning','room','string','darkness']) {
  const attack = Object.values(CHARACTER_ATTACKS).find(a => a.family === family), f = fixture({attack});
  f.timer.advance(captureTime(.30)); assert(f.attacker.position.distanceTo(f.victim.position) >= 1.399, family);
  f.timer.advance(captureTime(.62)); assert(f.attacker.position.distanceTo(f.victim.position) > 1.2, family);
  f.timer.advance(3600); assert.deepEqual(await f.animation.finished, {cancelled:false});
  assert.deepEqual(f.attacker.position.toArray(), f.end.toArray());
 }
});

test('all 16 attack families have distinct real geometry and finite deterministic poses', () => {
 const signatures = new Set();
 for (const family of ATTACK_FAMILIES) {
  const attack = Object.values(CHARACTER_ATTACKS).find(a => a.family === family), dense = fixture({attack}), sparse = fixture({attack});
  const group = dense.scene.getObjectByName('character-attack-effects');
  assert(group?.children.length > 0, family);
  signatures.add(JSON.stringify(group.children.map(o => [o.geometry.type, o.geometry.parameters])));
  for (let time = 0; time < captureTime(.62); time += 31) dense.timer.advance(time);
  dense.timer.advance(captureTime(.62)); sparse.timer.advance(captureTime(.62));
  assert.deepEqual(transform(group), transform(sparse.scene.getObjectByName('character-attack-effects')), family);
  assert(group.children.some(o => o.visible && o.material.opacity > .25), `${family} has a visible signature at contact`);
  group.traverse(o => assert([...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()].every(Number.isFinite), family));
  dense.animation.cancel(); sparse.animation.cancel();
 }
 assert.equal(signatures.size, ATTACK_FAMILIES.length, 'family shapes differ, not just their colors or names');
});

test('all 66 character signatures release their GPU resources once on cancellation', () => {
 for (const attack of Object.values(CHARACTER_ATTACKS)) {
  const f = fixture({attack}), group = f.scene.getObjectByName('character-attack-effects'), resources = new Map();
  for (const mesh of group.children) for (const resource of [mesh.geometry, mesh.material]) {
   if (resources.has(resource)) continue;
   resources.set(resource, 0); resource.addEventListener('dispose', () => resources.set(resource, resources.get(resource) + 1));
  }
  for (const p of [.35, .48, .58, .62, .70, .82]) {
   f.timer.advance(captureTime(p));
   f.scene.updateMatrixWorld(true);
   const body = f.attacker.children[0], bounds = new THREE.Box3().setFromObject(body);
   assert(bounds.min.y >= .169, `${attack.id}: body remains above floor`);
  }
  f.animation.cancel(); f.animation.cancel(); f.timer.stale(5000);
  assert([...resources.values()].every(n => n === 1), attack.id);
  assert.equal(f.scene.getObjectByName('character-attack-effects'), undefined);
  assert.deepEqual(transform(f.attacker), f.original[0]);
 }
});

test('signature variants distinguish related powers and skip effects with reduced motion', async () => {
 const names = (crew, role) => {
  const f = fixture({attack:getCharacterAttack(crew, role)}), result = f.scene.getObjectByName('character-attack-effects').children.map(o => o.name);
  f.animation.cancel(); return result;
 };
 assert.equal(names('mugiwara','queen').filter(n => n.startsWith('sword-cut-')).length, 3);
 assert(names('bigmom','queen').some(n => n.startsWith('mochi-')));
 assert(names('kid','king').some(n => n.startsWith('metal-magnetic-')));
 assert(names('kaido','rook').some(n => n.startsWith('cyborg-laser-')));
 assert(names('whitebeard','bishop').some(n => n.startsWith('diamond-crystal-')));
 assert(names('doflamingo','rook').some(n => n.startsWith('slime-tether-')));
 const f = fixture({attack:getCharacterAttack('mugiwara','king'), reducedMotion:true});
 assert.deepEqual(await f.animation.finished, {cancelled:false});
 assert.equal(f.animation.metrics.signatureEffects, 0); assert.equal(f.scene.children.length, 3);
 assert.equal(f.impacts[0].attack.character, 'Luffy'); assert.equal(f.timer.pending, 0);
});

test('a capture stages approach, anticipation, counterattack, strike, defeat and advance', async () => {
 const f = fixture(), {timer, animation, attacker, victim} = f;
 assert.equal(animation.metrics.duration, 3600);
 timer.advance(captureTime(.30));
 assert.equal(animation.metrics.phase, 'windup');
 assert.ok(attacker.position.distanceTo(victim.position) >= .75, 'figures stop apart before fighting');
 assert.equal(f.impacts.length, 0);
 timer.advance(captureTime(.48));
 assert.equal(animation.metrics.phase, 'parry');
 assert.ok(victim.children[0].position.length() > .02, 'defender visibly counters the feint');
 assert.equal(f.impacts.length, 0);
 timer.advance(captureTime(.62));
 assert.equal(animation.metrics.phase, 'strike');
 assert.equal(f.impacts.length, 1);
 assert.equal(f.impacts[0].profile, 'slash');
 timer.advance(captureTime(.79));
 assert.equal(animation.metrics.phase, 'defeat');
 assert.ok(victim.children[0].rotation.x < -.7, 'figure topples before it disappears');
 assert.equal(victim.visible, true);
 timer.advance(captureTime(.90));
 assert.equal(animation.metrics.phase, 'recover');
 assert.equal(victim.visible, false);
 timer.advance(3600);
 assert.deepEqual(await animation.finished, {cancelled: false});
 assert.equal(f.impacts.length, 1);
 assert.deepEqual(attacker.position.toArray(), f.end.toArray());
 assert.deepEqual(attacker.quaternion.toArray(), f.original[0].quaternion);
 assert.deepEqual(transform(attacker.children[0]), f.original[0].children[0]);
 assert.equal(f.scene.children.length, 3);
 assert.equal(animation.metrics.effects, 0);
 assert.equal(timer.pending, 0);
});

test('cancellation in every phase restores both actor roots, bodies and rook exactly', async () => {
 for (const progress of [0, .15, .35, .48, .58, .64, .76, .85, .93]) {
  const f = fixture();
  f.timer.advance(captureTime(progress));
  const impactCount = f.impacts.length;
  f.animation.cancel(); f.animation.cancel(); f.timer.stale(5000);
  assert.deepEqual(await f.animation.finished, {cancelled: true});
  assert.deepEqual([f.attacker, f.victim, f.rook].map(transform), f.original, `cancel at ${progress}`);
  assert.equal(f.impacts.length, impactCount);
  assert.equal(f.scene.children.length, 3);
  assert.equal(f.timer.pending, 0);
  assert.equal(f.animation.metrics.effects, 0);
 }
});

test('poses and seeded fragments depend on elapsed time, not frame cadence', () => {
 const dense = fixture(), sparse = fixture();
 for (let time = 8; time < 2700; time += 8) dense.timer.advance(time);
 dense.timer.advance(2700); sparse.timer.advance(2700);
 assert.deepEqual(transform(dense.attacker), transform(sparse.attacker));
 assert.deepEqual(transform(dense.victim), transform(sparse.victim));
 const effect = f => transform(f.scene.getObjectByName('chess-combat-effects'));
 assert.deepEqual(effect(dense), effect(sparse));
 assert.equal(dense.impacts.length, 1); assert.equal(sparse.impacts.length, 1);
 dense.animation.cancel(); sparse.animation.cancel();
});

test('one delayed frame can finish a capture without missing or duplicating the impact', async () => {
 const f = fixture(); f.timer.advance(5000);
 assert.deepEqual(await f.animation.finished, {cancelled: false});
 f.timer.stale(6000); f.animation.cancel();
 assert.equal(f.impacts.length, 1); assert.equal(f.victim.visible, false);
 assert.equal(f.animation.metrics.phase, 'complete');
});

test('ordinary moves use a body gait, knight moves leap, and castling moves the rook together', async () => {
 for (const role of ['pawn', 'knight', 'king']) {
  const timer = clock(), attacker = actor(), rook = actor([3, .17, 0]), scene = new THREE.Scene();
  const end = new THREE.Vector3(2, .17, 0), rookEnd = new THREE.Vector3(1, .17, 0), impacts = [];
  const animation = createMoveAnimation({attacker, rook, rookEnd, end, scene, role, capture: false, ...timer, onImpact: event => impacts.push(event)});
  timer.advance(300);
  assert.equal(attacker.position.x, 1);
  assert.equal(rook.position.x, 2);
  assert.equal(attacker.position.y, .17, 'actor root stays at board level');
  if (role === 'knight') assert.ok(attacker.children[0].position.y >= .64);
  assert.equal(scene.children.length, 0, 'no battle effects allocated for an ordinary move');
  timer.advance(600);
  assert.deepEqual(await animation.finished, {cancelled: false});
  assert.deepEqual(attacker.position.toArray(), end.toArray());
  assert.deepEqual(rook.position.toArray(), rookEnd.toArray());
  assert.equal(impacts.length, 0);
  assert.deepEqual(attacker.children[0].position.toArray(), [0, 0, 0]);
 }
});

test('a cancelled castle restores every rook transform without a late completion', async () => {
 const timer = clock(), attacker = actor(), rook = actor([3, .17, 0]);
 rook.scale.set(1.1, .9, 1.2); rook.rotation.set(.1, .2, .3);
 const initial = [attacker, rook].map(transform);
 const animation = createMoveAnimation({attacker, rook, rookEnd: new THREE.Vector3(1, .17, 0), end: new THREE.Vector3(2, .17, 0), capture: false, ...timer});
 timer.advance(400); animation.cancel(); timer.stale(900);
 assert.deepEqual(await animation.finished, {cancelled: true});
 assert.deepEqual([attacker, rook].map(transform), initial);
});

test('reduced motion captures apply final state once without scheduling frames or effects', async () => {
 const f = fixture({reducedMotion: true});
 assert.deepEqual(await f.animation.finished, {cancelled: false});
 assert.deepEqual(f.attacker.position.toArray(), f.end.toArray());
 assert.equal(f.victim.visible, false);
 assert.equal(f.impacts.length, 1);
 assert.equal(f.timer.pending, 0); assert.equal(f.scene.children.length, 3);
 f.animation.cancel(); f.timer.stale(5000);
 assert.equal(f.impacts.length, 1);
 assert.equal(f.victim.visible, false);
});

test('en passant fights the actual victim but finishes on the destination square', async () => {
 const timer = clock(), attacker = actor([0, .17, 0]), victim = actor([1, .17, 0]);
 const end = new THREE.Vector3(1, .17, -1), impacts = [];
 const animation = createMoveAnimation({attacker, victim, end, ...timer, onImpact: event => impacts.push(event)});
 timer.advance(captureTime(.64));
 assert.deepEqual(impacts[0].position.toArray(), [1, .17, 0]);
 timer.advance(3600);
 await animation.finished;
 assert.deepEqual(attacker.position.toArray(), end.toArray());
 assert.equal(victim.visible, false);
});

test('30 battles release each owned GPU resource once and never dispose shared model resources', async () => {
 const scene = new THREE.Scene(), attacker = actor(), victim = actor([0, .17, -1]);
 const model = attacker.children[0].children[0];
 let modelDisposals = 0, fxDisposals = 0;
 model.geometry.addEventListener('dispose', () => modelDisposals++);
 model.material.addEventListener('dispose', () => modelDisposals++);
 scene.add(attacker, victim);
 for (let i = 0; i < 30; i++) {
  const timer = clock(); victim.visible = true; attacker.position.set(0, .17, 0);
  const animation = createMoveAnimation({attacker, victim, scene, end: victim.position.clone(), ...timer});
  const geometries = new Set(), materials = new Set();
  scene.getObjectByName('chess-combat-effects').traverse(object => {if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material);});
  assert.equal(geometries.size, 8); assert.equal(materials.size, 9);
  for (const resource of [...geometries, ...materials]) resource.addEventListener('dispose', () => fxDisposals++);
  timer.advance(captureTime(.75));
  if (i % 2) animation.cancel(); else timer.advance(3600);
  await animation.finished; animation.cancel();
  assert.equal(scene.children.length, 2);
 }
 assert.equal(modelDisposals, 0);
 assert.equal(fxDisposals, 30 * 17);
});

test('all six role profiles produce distinct body poses and restore custom scales on cancellation', () => {
 const poses = new Set();
 for (const role of ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king']) {
  const f = fixture({role}); f.timer.advance(captureTime(.605));
  poses.add(JSON.stringify(transform(f.attacker.children[0])));
  f.animation.cancel();
 }
 assert.equal(poses.size, 6);
 const timer = clock(), attacker = actor(), victim = actor([0, .17, -1]);
 attacker.scale.set(1.3, .9, .7); attacker.children[0].position.set(.03, .07, -.02);
 attacker.children[0].scale.set(.5, .8, 1.2); victim.children[0].rotation.set(.1, .2, .3);
 const original = [attacker, victim].map(transform);
 const animation = createMoveAnimation({attacker, victim, end: victim.position.clone(), ...timer});
 timer.advance(captureTime(.85)); animation.cancel();
 assert.deepEqual([attacker, victim].map(transform), original);
});

test('a phase callback can cancel before the strike without emitting a late impact', async () => {
 let animation, impacts = 0;
 const timer = clock(), attacker = actor(), victim = actor([0, .17, -1]);
 animation = createMoveAnimation({attacker, victim, end: victim.position.clone(), ...timer,
  onPhase: () => animation.cancel(), onImpact: () => impacts++});
 timer.advance(captureTime(.68));
 assert.deepEqual(await animation.finished, {cancelled: true});
 assert.equal(impacts, 0); assert.equal(timer.pending, 0);
});

test('ordinary travel faces its destination and restores the inward orientation on arrival', async () => {
 const timer = clock(), attacker = actor(), rook = actor([3, .17, 0]);
 const original = [attacker, rook].map(transform);
 const animation = createMoveAnimation({attacker, rook, end: new THREE.Vector3(2, .17, 0), rookEnd: new THREE.Vector3(1, .17, 0), capture: false, ...timer});
 timer.advance(150);
 assert.ok(new THREE.Vector3(0, 0, 1).applyQuaternion(attacker.quaternion).x > .99, 'attacker looks along +X travel');
 assert.ok(new THREE.Vector3(0, 0, 1).applyQuaternion(rook.quaternion).x < -.99, 'rook looks along its opposite travel');
 assert.notDeepEqual(transform(rook.children[0]), original[1].children[0], 'rook has its own gait');
 timer.advance(600); await animation.finished;
 assert.deepEqual(attacker.quaternion.toArray(), original[0].quaternion);
 assert.deepEqual(rook.quaternion.toArray(), original[1].quaternion);
 assert.deepEqual(transform(rook.children[0]), original[1].children[0]);
});

test('acceleration and braking keep launch and arrival slower than mid-travel', () => {
 const timer = clock(), attacker = actor();
 const animation = createMoveAnimation({attacker, end: new THREE.Vector3(4, .17, 0), capture: false, ...timer});
 const positions = [];
 for (const time of [60, 240, 300, 540, 600]) {timer.advance(time); positions.push(attacker.position.x);}
 assert.ok(positions[0] < .05);
 assert.ok(positions[2] - positions[1] > positions[0] * 5);
 assert.ok(positions[4] - positions[3] < .05);
 animation.cancel();
});

test('defender sidesteps before contact and is physically knocked away after impact', () => {
 const f = fixture();
 f.timer.advance(captureTime(.47));
 assert.ok(Math.abs(f.victim.position.x) > .1, 'defender root leaves the attack line');
 assert.equal(f.impacts.length, 0);
 const preHitAttackerZ = f.attacker.position.z;
 f.timer.advance(captureTime(.67));
 assert.ok(f.attacker.position.z < preHitAttackerZ - .15, 'attacker root lunges into the strike');
 assert.ok(f.victim.position.z < -2.05, 'impact displaces defender root away from attacker');
 assert.equal(f.impacts.length, 1);
 f.animation.cancel();
});

test('cached bounds keep leaning, falling and dissolving characters above the board', () => {
 const f = fixture();
 for (let time = 0; time < captureTime(.88); time += 16) {
  f.timer.advance(time);
  for (const root of [f.attacker, f.victim]) {
   root.updateMatrixWorld(true);
   const bounds = new THREE.Box3().setFromObject(root);
   assert.ok(bounds.min.y >= root.position.y - 1e-8, `floor penetration at ${time}: ${bounds.min.y}`);
   if (time > captureTime(.83) && root === f.victim) assert.ok(Math.abs(bounds.min.y - root.position.y) < 1e-8, 'dissolving corpse rests on the floor instead of floating');
  }
 }
 f.animation.cancel();
});

test('ordinary move and castle poses are frame independent and cancel at every point', async () => {
 for (const progress of [.05, .22, .49, .72, .87, .98]) {
  const make = () => {
   const timer = clock(), attacker = actor(), rook = actor([3, .17, 0]);
   const original = [attacker, rook].map(transform);
   const animation = createMoveAnimation({attacker, rook, end: new THREE.Vector3(2, .17, 0), rookEnd: new THREE.Vector3(1, .17, 0), role: 'knight', capture: false, ...timer});
   return {timer, attacker, rook, original, animation};
  };
  const dense = make(), sparse = make(), time = progress * 600;
  for (let t = 8; t < time; t += 8) dense.timer.advance(t);
  dense.timer.advance(time); sparse.timer.advance(time);
  assert.deepEqual([dense.attacker, dense.rook].map(transform), [sparse.attacker, sparse.rook].map(transform));
  for (const f of [dense, sparse]) {
   f.animation.cancel(); f.timer.stale(1200);
   assert.deepEqual(await f.animation.finished, {cancelled: true});
   assert.deepEqual([f.attacker, f.rook].map(transform), f.original);
  }
 }
});

test('impact flash remains compact and translucent so combat silhouettes stay visible', () => {
 const f = fixture(); f.timer.advance(captureTime(.62));
 const effects = f.scene.getObjectByName('chess-combat-effects');
 const flash = effects.getObjectByName('contact-flash');
 assert.ok(flash.material.opacity <= .52);
 assert.ok(flash.geometry.parameters.radius * flash.scale.x < .20);
 f.animation.cancel();
});


test('fatal impact holds poses and particles for 120 ms while camera punch decays', () => {
 const f = fixture(), contact = captureTime(.62);
 f.timer.advance(contact + 1);
 const actorPose = transform(f.attacker), victimPose = transform(f.victim);
 const matrices = () => Array.from(f.scene.getObjectByName('blood-droplets').instanceMatrix.array);
 const before = matrices(), punch = f.animation.metrics.cameraPunch;
 assert.equal(f.animation.metrics.hitStop, true);
 assert.equal(f.impacts.length, 1);
 f.timer.advance(contact + 119);
 assert.equal(f.animation.metrics.hitStop, true);
 assert.deepEqual(transform(f.attacker), actorPose); assert.deepEqual(transform(f.victim), victimPose);
 assert.deepEqual(matrices(), before);
 assert.ok(f.animation.metrics.cameraPunch < punch);
 f.timer.advance(contact + 150);
 assert.equal(f.animation.metrics.hitStop, false);
 assert.ok(f.animation.metrics.progress > .62);
 assert.notDeepEqual(transform(f.attacker), actorPose);
 assert.equal(f.impacts.length, 1);
 f.animation.cancel();
});

test('blood is opaque dark red, directional, lands as spatter and disappears on cleanup', () => {
 const f = fixture(); f.timer.advance(captureTime(.74));
 const group = f.scene.getObjectByName('chess-combat-effects');
 const blood = group.getObjectByName('blood-droplets'), spatter = group.getObjectByName('blood-floor-spatter');
 assert.equal(blood.isInstancedMesh, true); assert.equal(blood.count, 72);
 assert.equal(blood.material.blending, THREE.NormalBlending);
 assert.ok(blood.material.opacity >= .9); assert.ok(blood.material.color.r > blood.material.color.g * 4);
 assert.equal(f.animation.metrics.bloodSplats, 28); assert.equal(f.animation.metrics.shards, 32);
 assert.ok(group.children.length <= 12, 'pooled gore adds bounded draw calls');
 const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
 let airborne = 0, forward = 0;
 for (let i = 0; i < blood.count; i++) {
  blood.getMatrixAt(i, matrix); matrix.decompose(position, rotation, scale);
  if (scale.x > 0) {airborne++; if (position.z < 0) forward++;}
 }
 assert.ok(airborne > 20); assert.ok(forward >= airborne * .8, 'spray follows the fatal strike direction');
 f.timer.advance(captureTime(.94));
 let landed = 0;
 for (let i = 0; i < spatter.count; i++) {
  spatter.getMatrixAt(i, matrix); matrix.decompose(position, rotation, scale);
  if (scale.x > 0) {landed++; assert.ok(position.y < .006, 'spatter lies on board surface');}
 }
 assert.ok(landed >= 20); assert.ok(spatter.material.opacity > 0 && spatter.material.opacity < .9);
 f.animation.cancel(); assert.equal(f.scene.getObjectByName('chess-combat-effects'), undefined);
});

test('seeded instanced effects are identical across sparse and dense frame schedules', () => {
 const dense = fixture(), sparse = fixture(), time = captureTime(.81);
 for (let t = 16; t < time; t += 16) dense.timer.advance(t);
 dense.timer.advance(time); sparse.timer.advance(time);
 for (const name of ['blood-droplets', 'blood-floor-spatter', 'impact-shards', 'clash-sparks', 'landing-dust']) {
  assert.deepEqual(Array.from(dense.scene.getObjectByName(name).instanceMatrix.array), Array.from(sparse.scene.getObjectByName(name).instanceMatrix.array), name);
 }
 dense.animation.cancel(); sparse.animation.cancel();
});

test('instanced GPU buffers are disposed exactly once on repeated cancellation', () => {
 const f = fixture(); let disposed = 0;
 f.scene.getObjectByName('chess-combat-effects').traverse(object => {
  if (object.isInstancedMesh) object.addEventListener('dispose', () => disposed++);
 });
 f.timer.advance(captureTime(.72)); f.animation.cancel(); f.animation.cancel(); f.timer.stale(5000);
 assert.equal(disposed, 5); assert.equal(f.animation.metrics.cameraPunch, 0); assert.equal(f.animation.metrics.hitStop, false);
});
