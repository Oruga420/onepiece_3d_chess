import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.resolve(process.env.RIG_ADOPTION_SOURCE_ROOT || repository);
const {rigRuntimeFiles, rigRuntimeHash} = await import(pathToFileURL(path.join(sourceRoot, 'tools/assets/rig_runtime_fingerprint.mjs')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Adoption inspects GLB metadata and embedded texture bytes. This small fixture
// supplies those structures without requiring Blender or a paid character asset.
function fixtureGLB() {
 const json = {
  asset: {version: '2.0'},
  buffers: [{byteLength: 4}],
  bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 4}],
  images: [{bufferView: 0, mimeType: 'image/png'}],
  accessors: [{count: 3}, {count: 3}, {count: 3}],
  meshes: [{primitives: [{indices: 0, attributes: {POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2}}]}],
  nodes: Array.from({length: 17}, (_, index) => ({name: `joint-${index}`})),
  skins: [{joints: Array.from({length: 17}, (_, index) => index)}],
 };
 const encoded = Buffer.from(JSON.stringify(json));
 const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20);
 encoded.copy(padded);
 const bytes = Buffer.alloc(12 + 8 + padded.length + 8 + 4);
 bytes.writeUInt32LE(0x46546c67, 0);
 bytes.writeUInt32LE(2, 4);
 bytes.writeUInt32LE(bytes.length, 8);
 bytes.writeUInt32LE(padded.length, 12);
 bytes.writeUInt32LE(0x4e4f534a, 16);
 padded.copy(bytes, 20);
 bytes.writeUInt32LE(4, 20 + padded.length);
 bytes.writeUInt32LE(0x004e4942, 24 + padded.length);
 Buffer.from([1, 2, 3, 4]).copy(bytes, 28 + padded.length);
 return bytes;
}

function fixture(t, {approval = true, staleRuntime = false} = {}) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-rig-adoption-'));
 t.after(() => fs.rmSync(root, {recursive: true, force: true}));
 const write = (relative, bytes) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, bytes);
 };
 for (const script of ['adopt_rigs.mjs', 'rig_runtime_fingerprint.mjs']) {
  write('tools/assets/' + script, fs.readFileSync(path.join(sourceRoot, 'tools/assets', script)));
 }
 for (const file of rigRuntimeFiles) write(file, '// Fixture runtime: ' + file + '\n');
 const id = 'mugiwara/king', bytes = fixtureGLB(), hash = sha(bytes);
 const modelPath = 'assets/models/' + id + '.glb';
 write(modelPath, bytes);
 write('.local/rigging/originals/' + id + '.glb', bytes);
 write('.local/rigging/candidates/' + id + '.glb', bytes);
 write('.local/rigging/reviews/' + id + '/metrics.json', JSON.stringify({originalSha256: hash, sha256: hash}));
 write('assets/models/manifest.json', JSON.stringify({assets: [{id, path: '/' + modelPath, sha256: hash, bytes: bytes.length}]}));
 if (approval) {
  write('.local/rigging/reviews/visual-evidence.txt', 'Fixture independent visual evidence');
  write('.local/rigging/acceptance.json', JSON.stringify({[id]: {
   verdict: 'pass', score: 95, sha256: hash, runtimeHash: rigRuntimeHash(root),
   evidence: ['.local/rigging/reviews/visual-evidence.txt'],
  }}));
 }
 if (staleRuntime) write('src/attacks.mjs', '// Choreography changed after approval\n');
 const manifestBefore = fs.readFileSync(path.join(root, 'assets/models/manifest.json'));
 const result = spawnSync(process.execPath, ['tools/assets/adopt_rigs.mjs', '--all', '--apply'], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000,
 });
 assert.ifError(result.error);
 return {root, result, id, bytes, modelPath, manifestBefore};
}

function assertRejected(f, message) {
 assert.notEqual(f.result.status, 0, 'adoption must fail closed');
 assert.match(f.result.stderr, message);
 assert.doesNotMatch(f.result.stdout, /RIG_ADOPTED/);
 assert.deepEqual(fs.readFileSync(path.join(f.root, f.modelPath)), f.bytes);
 assert.deepEqual(fs.readFileSync(path.join(f.root, 'assets/models/manifest.json')), f.manifestBefore);
}

test('unchanged model bytes still reject visual approval from an older choreography', t => {
 assertRejected(fixture(t, {staleRuntime: true}), /review matches runtime/);
});

test('unchanged model bytes still require visual acceptance', t => {
 assertRejected(fixture(t, {approval: false}), /visual acceptance required before publication/);
});

test('unchanged model bytes can be adopted with matching current visual acceptance', t => {
 const f = fixture(t);
 assert.equal(f.result.status, 0, f.result.stderr);
 assert.match(f.result.stdout, /RIG_ADOPTED mugiwara\/king/);
 assert.deepEqual(fs.readFileSync(path.join(f.root, f.modelPath)), f.bytes);
 const manifest = JSON.parse(fs.readFileSync(path.join(f.root, 'assets/models/manifest.json')));
 assert.equal(manifest.assets[0].sha256, sha(f.bytes));
 assert.equal(manifest.assets[0].rig.originalOptimizedSha256, sha(f.bytes));
});
