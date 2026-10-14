import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {createMoveAnimation} from '../src/combat.mjs';

function actor(position = [0, .17, 0], yaw = Math.PI) {
 const root = new THREE.Group(), body = new THREE.Group();
 body.add(new THREE.Mesh(new THREE.BoxGeometry(.3, .8, .3), new THREE.MeshStandardMaterial()));
 root.add(body, new THREE.Group()); root.position.fromArray(position); root.rotation.y = yaw;
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

test('a capture stages approach, anticipation, counterattack, strike, defeat and advance', async () => {
 const f = fixture(), {timer, animation, attacker, victim} = f;
 assert.equal(animation.metrics.duration, 2400);
 timer.advance(720);
 assert.equal(animation.metrics.phase, 'windup');
 assert.ok(attacker.position.distanceTo(victim.position) >= .75, 'figures stop apart before fighting');
 assert.equal(f.impacts.length, 0);
 timer.advance(1150);
 assert.equal(animation.metrics.phase, 'parry');
 assert.ok(victim.children[0].position.length() > .02, 'defender visibly counters the feint');
 assert.equal(f.impacts.length, 0);
 timer.advance(1465);
 assert.equal(animation.metrics.phase, 'strike');
 assert.equal(f.impacts.length, 1);
 assert.equal(f.impacts[0].profile, 'slash');
 timer.advance(1900);
 assert.equal(animation.metrics.phase, 'defeat');
 assert.ok(victim.children[0].rotation.x < -.7, 'figure topples before it disappears');
 assert.equal(victim.visible, true);
 timer.advance(2150);
 assert.equal(animation.metrics.phase, 'recover');
 assert.equal(victim.visible, false);
 timer.advance(2400);
 assert.deepEqual(await animation.finished, {cancelled: false});
 assert.equal(f.impacts.length, 1);
 assert.deepEqual(attacker.position.toArray(), f.end.toArray());
 assert.deepEqual(attacker.quaternion.toArray(), f.original[0].quaternion);
 assert.deepEqual(transform(attacker.children[0]), f.original[0].children[0]);
 assert.equal(f.scene.children.length, 3);
 assert.equal(animation.metrics.effects, 0);
 assert.equal(timer.pending, 0);
});

test('cancellation in every phase restores both bodies, pedestals and rook exactly', async () => {
 for (const progress of [0, .15, .35, .48, .58, .64, .76, .85, .93]) {
  const f = fixture();
  f.timer.advance(progress * 2400);
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
 for (let time = 8; time < 1836; time += 8) dense.timer.advance(time);
 dense.timer.advance(1836); sparse.timer.advance(1836);
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
  assert.equal(attacker.position.y, .17, 'pedestal remains on the board');
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
 timer.advance(1500);
 assert.deepEqual(impacts[0].position.toArray(), [1, .17, 0]);
 timer.advance(2400);
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
  assert.equal(geometries.size, 4); assert.equal(materials.size, 4);
  for (const resource of [...geometries, ...materials]) resource.addEventListener('dispose', () => fxDisposals++);
  timer.advance(1700);
  if (i % 2) animation.cancel(); else timer.advance(2400);
  await animation.finished; animation.cancel();
  assert.equal(scene.children.length, 2);
 }
 assert.equal(modelDisposals, 0);
 assert.equal(fxDisposals, 30 * 8);
});

test('all six role profiles produce distinct body poses and restore custom scales on cancellation', () => {
 const poses = new Set();
 for (const role of ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king']) {
  const f = fixture({role}); f.timer.advance(1450);
  poses.add(JSON.stringify(transform(f.attacker.children[0])));
  f.animation.cancel();
 }
 assert.equal(poses.size, 6);
 const timer = clock(), attacker = actor(), victim = actor([0, .17, -1]);
 attacker.scale.set(1.3, .9, .7); attacker.children[0].position.set(.03, .07, -.02);
 attacker.children[0].scale.set(.5, .8, 1.2); victim.children[0].rotation.set(.1, .2, .3);
 const original = [attacker, victim].map(transform);
 const animation = createMoveAnimation({attacker, victim, end: victim.position.clone(), ...timer});
 timer.advance(2050); animation.cancel();
 assert.deepEqual([attacker, victim].map(transform), original);
});

test('a phase callback can cancel before the strike without emitting a late impact', async () => {
 let animation, impacts = 0;
 const timer = clock(), attacker = actor(), victim = actor([0, .17, -1]);
 animation = createMoveAnimation({attacker, victim, end: victim.position.clone(), ...timer,
  onPhase: () => animation.cancel(), onImpact: () => impacts++});
 timer.advance(1600);
 assert.deepEqual(await animation.finished, {cancelled: true});
 assert.equal(impacts, 0); assert.equal(timer.pending, 0);
});
