import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRenderer } from '../src/renderer.mjs';
import { PerspectiveCamera, Vector2 } from '../vendor/three/three.module.js';

function fixture() {
 const listeners = new Map(), captured = new Set(), clicks = [];
 const canvas = {
  clientHeight: 500,
  addEventListener: (name, handler, options) => listeners.set(name, {handler, options}),
  setPointerCapture: id => captured.add(id),
  hasPointerCapture: id => captured.has(id),
  releasePointerCapture: id => captured.delete(id),
  getBoundingClientRect: () => ({left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500}),
 };
 const view = Object.create(GameRenderer.prototype);
 Object.assign(view, {canvas, camera: new PerspectiveCamera(38, 1.6, .1, 100), pointer: new Vector2(), squareMeshes: [], onSquare: square => clicks.push(square), raycaster: {setFromCamera() {}, intersectObjects: () => [{object: {userData: {square: 'D4'}}}]}});
 const previousWindow = globalThis.window;
 globalThis.window = {addEventListener() {}};
 try { view.installCameraControls(); } finally { globalThis.window = previousWindow; }
 view.setCamera('front');
 const event = (name, values = {}) => {
  const e = {button: 0, pointerId: 1, clientX: 100, clientY: 100, ctrlKey: false, deltaY: 0, deltaMode: 0, prevented: false, preventDefault() {this.prevented = true;}, ...values};
  listeners.get(name).handler(e);
  return e;
 };
 return {view, clicks, captured, event, listeners};
}

test('Ctrl drag orbits around the board and never selects a piece, even after releasing Ctrl', () => {
 const {view, event, clicks, captured} = fixture(), yaw = view.cameraYaw;
 event('pointerdown', {ctrlKey: true});
 event('pointermove', {clientX: 200, clientY: 150, ctrlKey: true});
 assert.notEqual(view.cameraYaw, yaw);
 event('pointerup', {clientX: 200, clientY: 150});
 assert.deepEqual(clicks, []);
 assert.equal(captured.size, 0);
 assert.equal(view.down, null);
 event('pointerdown'); event('pointerup');
 assert.deepEqual(clicks, ['D4']);
});

test('Ctrl wheel alone prevents scrolling and zooms with finite safe bounds', () => {
 const {view, event, listeners} = fixture(), original = view.zoomLevel;
 assert.equal(listeners.get('wheel').options.passive, false);
 assert.equal(event('wheel', {deltaY: -100}).prevented, false);
 assert.equal(view.zoomLevel, original);
 assert.equal(event('wheel', {deltaY: -100, ctrlKey: true}).prevented, true);
 assert.ok(view.zoomLevel < original);
 for(let i = 0; i < 100; i++) event('wheel', {deltaY: -100, ctrlKey: true});
 assert.equal(view.zoomLevel, .35);
 for(let i = 0; i < 100; i++) event('wheel', {deltaY: 100, deltaMode: 1, ctrlKey: true});
 assert.equal(view.zoomLevel, 1.5);
 view.zoom(NaN);
 assert.ok(view.camera.position.toArray().every(Number.isFinite));
});

test('orbit elevation remains above the board and each preset restores the full board view', () => {
 const {view} = fixture();
 view.orbit(10000, -10000);
 assert.equal(view.cameraElevation, .38);
 assert.ok(view.camera.position.y > 0);
 assert.ok(Math.abs(view.cameraYaw) <= Math.PI);
 view.orbit(0, 10000);
 assert.ok(view.cameraElevation < Math.PI / 2);
 view.zoom(-100);
 for(const preset of ['front', 'opposite', 'top']) {
  view.setCamera(preset);
  assert.equal(view.zoomLevel, .9);
  assert.ok(view.camera.position.y >= 9);
  const target = view.camera.getWorldDirection(view.camera.position.clone());
  assert.ok(target.dot(view.camera.position.clone().normalize()) < -.9999);
 }
});

test('cancel, lost capture, outside release and a drag back to its start do not select', () => {
 const {view, event, clicks, captured} = fixture();
 for(const name of ['pointercancel', 'lostpointercapture']) {
  event('pointerdown', {ctrlKey: true}); event(name); event('pointerup');
  assert.equal(view.down, null);
 }
 event('pointerdown'); event('pointermove', {clientX: 150}); event('pointermove'); event('pointerup');
 event('pointerdown', {clientX: -5}); event('pointerup', {clientX: -5});
 event('pointerdown', {button: 2}); event('pointerup', {button: 2});
 assert.deepEqual(clicks, []);
 assert.equal(captured.size, 0);
});

test('modifier applied mid gesture suppresses selection and unrelated pointers cannot hijack it', () => {
 const {view, event, clicks} = fixture();
 event('pointerdown');
 event('pointermove', {ctrlKey: true, clientX: 104});
 event('pointerup', {pointerId: 2});
 assert.ok(view.down);
 event('pointerup');
 assert.deepEqual(clicks, []);
});
