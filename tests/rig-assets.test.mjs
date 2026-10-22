import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as THREE from '../vendor/three/three.module.js';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/models/manifest.json')));
const required = ['hips','spine','chest','neck','head', ...['L','R'].flatMap(side => ['upper_arm','forearm','hand','upper_leg','lower_leg','foot'].map(name => `${name}.${side}`))];
const canonical = name => name.replace(/[_.]/g, '').toLowerCase();
const hash = value => createHash('sha256').update(value).digest('hex');

function readGlb(file) {
 const buffer = fs.readFileSync(file);
 assert.equal(buffer.readUInt32LE(0), 0x46546c67, 'GLB magic');
 assert.equal(buffer.readUInt32LE(4), 2, 'GLB version');
 assert.equal(buffer.readUInt32LE(8), buffer.length, 'complete GLB');
 let json, binary;
 for (let cursor = 12; cursor < buffer.length;) {
  const length = buffer.readUInt32LE(cursor), type = buffer.readUInt32LE(cursor + 4);
  const chunk = buffer.subarray(cursor + 8, cursor + 8 + length);
  if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
  if (type === 0x004e4942) binary = chunk;
  cursor += 8 + length;
 }
 assert(json && binary, 'JSON and BIN chunks');
 return {json, binary};
}

function accessor(glb, index) {
 const a = glb.json.accessors[index], view = glb.json.bufferViews[a.bufferView];
 assert(!a.sparse, 'dense production skin attributes');
 const components = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type];
 const readers = {5120:['readInt8',1,127],5121:['readUInt8',1,255],5122:['readInt16LE',2,32767],5123:['readUInt16LE',2,65535],5125:['readUInt32LE',4,4294967295],5126:['readFloatLE',4,1]};
 const [read, size, max] = readers[a.componentType], stride = view.byteStride || components * size;
 const offset = (view.byteOffset || 0) + (a.byteOffset || 0);
 return Array.from({length:a.count}, (_, row) => Array.from({length:components}, (_, column) => {
  const value = glb.binary[read](offset + row * stride + column * size);
  return a.normalized ? Math.max(-1, value / max) : value;
 }));
}

function imageHashes(glb) {
 return (glb.json.images || []).map(image => {
  assert.equal(typeof image.bufferView, 'number', 'textures remain embedded');
  const view = glb.json.bufferViews[image.bufferView], start = view.byteOffset || 0;
  return hash(glb.binary.subarray(start, start + view.byteLength));
 }).sort();
}

function triangles(glb) {
 return glb.json.meshes.flatMap(mesh => mesh.primitives).reduce((sum, primitive) => {
  assert.equal(primitive.mode ?? 4, 4, 'triangle topology');
  return sum + glb.json.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
 }, 0);
}

function hierarchy(glb) {
 const nodes = glb.json.nodes.map(node => {
  const object = new THREE.Object3D();
  if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
  else {
   object.position.fromArray(node.translation || [0,0,0]);
   object.quaternion.fromArray(node.rotation || [0,0,0,1]);
   object.scale.fromArray(node.scale || [1,1,1]);
  }
  return object;
 });
 glb.json.nodes.forEach((node, i) => (node.children || []).forEach(child => nodes[i].add(nodes[child])));
 const update = () => nodes.filter(node => !node.parent).forEach(node => node.updateMatrixWorld(true));
 update();
 return {nodes, update};
}

const selected = process.env.RIG_ASSET_IDS?.split(',');
const requireAll = process.env.RIG_REQUIRE_ALL === '1' || Boolean(process.env.RIG_ASSET_ROOT);
const assets = selected ? manifest.assets.filter(asset => selected.includes(asset.id)) : requireAll ? manifest.assets : manifest.assets.filter(asset => asset.rig);
test('rig verification covers every released rig; all66 acceptance remains an explicit strict gate', () => {
 assert.equal(manifest.assets.length, 66);
 assert.equal(new Set(manifest.assets.map(asset => asset.id)).size, 66);
 if (selected) assert.equal(assets.length, selected.length, 'all selected pilot IDs exist');
 else if (requireAll) assert.equal(assets.length,66,'full articulated roster acceptance');
 else assert(assets.length>0,'release must contain verified articulated characters');
});

for (const asset of assets) test(`${asset.id}: genuine weighted limbs, preserved geometry and textures`, () => {
 const file = process.env.RIG_ASSET_ROOT ? path.join(process.env.RIG_ASSET_ROOT, asset.id + '.glb') : path.join(root, asset.path);
 const glb = readGlb(file), {json} = glb;
 assert(json.skins?.length > 0, 'must contain an actual glTF skin');
 const {nodes, update} = hierarchy(glb);
 for (const skin of json.skins) {
  const names = skin.joints.map(index => canonical(json.nodes[index].name || ''));
  for (const name of required) assert(names.includes(canonical(name)), 'missing joint ' + name);
  const inverseBinds = accessor(glb, skin.inverseBindMatrices).map(values => new THREE.Matrix4().fromArray(values));
  assert.equal(inverseBinds.length, skin.joints.length);
  assert(inverseBinds.every(matrix => matrix.elements.every(Number.isFinite)), 'finite inverse bind matrices');
  const meshNodes = json.nodes.filter(node => node.skin === json.skins.indexOf(skin));
  assert(meshNodes.length > 0, 'skin is attached to a visible mesh');
  const primitives = meshNodes.flatMap(node => json.meshes[node.mesh].primitives).map(primitive => {
   assert.equal(typeof primitive.attributes.JOINTS_0, 'number', 'real joint indices');
   assert.equal(typeof primitive.attributes.WEIGHTS_0, 'number', 'real vertex weights');
   const positions = accessor(glb, primitive.attributes.POSITION), joints = accessor(glb, primitive.attributes.JOINTS_0), weights = accessor(glb, primitive.attributes.WEIGHTS_0);
   assert.equal(typeof primitive.attributes.TEXCOORD_0, 'number', 'original textured character retains UV coordinates');
   const uvs = accessor(glb, primitive.attributes.TEXCOORD_0);
   assert.equal(uvs.length, positions.length, 'every vertex retains its UV');
   assert(uvs.every(uv => uv.every(Number.isFinite)), 'finite UV coordinates');
   assert(json.materials[primitive.material], 'mesh retains a material');
   assert.equal(joints.length, positions.length); assert.equal(weights.length, positions.length);
   positions.forEach((position, i) => {
    assert(position.every(Number.isFinite), 'finite rest vertex');
    assert(weights[i].every(w => Number.isFinite(w) && w >= 0 && w <= 1), 'finite nonnegative normalized skin weights');
    assert(Math.abs(weights[i].reduce((a,b) => a+b, 0) - 1) < 2e-5, 'weights sum to one');
    assert(joints[i].every(j => Number.isInteger(j) && j >= 0 && j < skin.joints.length), 'joint indices in range');
   });
   return {positions,joints,weights};
  });
  function skinVertex(primitive, i) {
   const result = new THREE.Vector3();
   for (let slot = 0; slot < 4; slot++) {
    const weight = primitive.weights[i][slot], joint = primitive.joints[i][slot];
    if (!weight) continue;
    const value = new THREE.Vector3().fromArray(primitive.positions[i]).applyMatrix4(inverseBinds[joint]).applyMatrix4(nodes[skin.joints[joint]].matrixWorld);
    result.addScaledVector(value, weight);
   }
   return result;
  }
  for (const jointName of ['upper_arm.L','forearm.L','upper_arm.R','forearm.R','upper_leg.L','lower_leg.L','upper_leg.R','lower_leg.R']) {
   // A documented missing arm (for example Shanks) must not acquire invented
   // skin weights merely to satisfy the full humanoid skeleton contract.
   const missingLimbs = json.nodes.find(node => node.extras?.combatRig)?.extras.combatRig.missingLimbs || [];
   if (jointName.includes('arm') && missingLimbs.includes(jointName.at(-1))) continue;
   const joint = nodes[skin.joints[names.indexOf(canonical(jointName))]], rest = joint.quaternion.clone();
   const before = primitives.map(primitive => primitive.positions.map((_, i) => skinVertex(primitive, i)));
   joint.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,.3,.2).normalize(), .4)); update();
   let maximum = 0, displaced = 0;
   primitives.forEach((primitive, p) => primitive.positions.forEach((_, i) => {
    const distance = skinVertex(primitive, i).distanceTo(before[p][i]);
    maximum = Math.max(maximum, distance); if (distance > 1e-5) displaced++;
   }));
   joint.quaternion.copy(rest); update();
   assert(maximum > .001 && displaced >= 3, jointName + ' must deform actual mesh vertices');
  }
 }
 const originals = path.join(root, '.local/rigging/originals', asset.id + '.glb');
 if (fs.existsSync(originals)) {
  const original = readGlb(originals);
  assert.deepEqual(imageHashes(glb), imageHashes(original), 'embedded texture bytes preserved');
  assert.equal(json.materials.length, original.json.materials.length, 'material count preserved');
  assert.equal(triangles(glb), triangles(original), 'no topology removed during rigging');
 }
 assert.equal(triangles(glb), asset.triangles, 'triangle count preserved');
});
