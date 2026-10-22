import * as THREE from '../vendor/three/three.module.js';

const clamp = p => Math.max(0, Math.min(1, p));
const smooth = p => { p = clamp(p); return p * p * (3 - 2 * p); };
const canonicalName = name => name.replace(/_/g, '').replace(/\./g, '').toLowerCase();

// Object3D.clone shares Skeleton objects. Rebind the copied meshes to their own
// copied bones (the same mapping used by Three r160 SkeletonUtils.clone).
// Geometry, materials, and textures remain shared with the asset cache.
export function cloneCharacter(source) {
 const result = source.clone(true), copies = new Map(), skeletons = new Map();
 const visit = (original, copy) => {
  copies.set(original, copy);
  original.children.forEach((child, i) => visit(child, copy.children[i]));
 };
 visit(source, result);
 source.traverse(original => {
  if (!original.isSkinnedMesh) return;
  const copy = copies.get(original);
  let skeleton = skeletons.get(original.skeleton);
  if (!skeleton) {
   const bones = original.skeleton.bones.map(bone => copies.get(bone));
   if (bones.some(bone => !bone)) throw Error('Character skeleton has a bone outside its model root');
   skeleton = new THREE.Skeleton(bones, original.skeleton.boneInverses.map(matrix => matrix.clone()));
   skeletons.set(original.skeleton, skeleton);
  }
  copy.bind(skeleton, original.bindMatrix);
  // Rest-pose bounds are invalid once arms or legs extend outside them.
  copy.frustumCulled = false;
 });
 return result;
}

// Bone textures belong to each instance; shared character meshes do not.
export function disposeCharacterSkeletons(root) {
 const skeletons = new Set();
 root?.traverse(object => { if (object.isSkinnedMesh && !skeletons.has(object.skeleton)) { skeletons.add(object.skeleton); object.skeleton.dispose(); } });
}

const limbs = [
 ['upper_arm.L', 'forearm.L'], ['forearm.L', 'hand.L'],
 ['upper_arm.R', 'forearm.R'], ['forearm.R', 'hand.R'],
 ['upper_leg.L', 'lower_leg.L'], ['lower_leg.L', 'foot.L'],
 ['upper_leg.R', 'lower_leg.R'], ['lower_leg.R', 'foot.R'],
];
const guard = {
 'upper_arm.L':[.35,-.6,.6], 'forearm.L':[-.2,.88,.35],
 'upper_arm.R':[-.35,-.6,.6], 'forearm.R':[.2,.88,.35],
 'upper_leg.L':[.12,-.98,.15], 'lower_leg.L':[0,-.98,-.2],
 'upper_leg.R':[-.12,-.95,-.2], 'lower_leg.R':[0,-.98,.1],
};
const punch = {...guard, 'upper_arm.R':[-.08,.04,1], 'forearm.R':[.03,-.02,1]};
const windup = {...guard, 'upper_arm.R':[-.55,-.3,-.8], 'forearm.R':[.1,.95,.15]};
const swordReady = {...guard, 'upper_arm.R':[-.3,.9,.2], 'forearm.R':[.2,.75,-.5],
 'upper_arm.L':[.4,.6,.6], 'forearm.L':[-.3,.75,.5]};
const swordCut = {...guard, 'upper_arm.R':[.55,-.1,.8], 'forearm.R':[.55,-.6,.6],
 'upper_arm.L':[-.2,-.4,.9], 'forearm.L':[-.55,-.45,.75]};
const kickReady = {...guard, 'upper_leg.R':[-.08,.65,.76], 'lower_leg.R':[0,-.98,-.2],
 'upper_arm.L':[.65,-.35,-.4], 'forearm.L':[.3,.3,.8]};
const kick = {...kickReady, 'upper_leg.R':[-.1,.23,.97], 'lower_leg.R':[0,-.03,1],
 'upper_arm.R':[-.7,-.5,-.25], 'forearm.R':[-.3,.25,.85]};
const castReady = {...guard, 'upper_arm.L':[.7,-.3,.6], 'forearm.L':[-.3,.9,.2],
 'upper_arm.R':[-.7,-.3,.6], 'forearm.R':[.3,.9,.2]};
const cast = {...guard, 'upper_arm.L':[.2,.2,1], 'forearm.L':[-.1,.1,1],
 'upper_arm.R':[-.2,.2,1], 'forearm.R':[.1,.1,1]};
const slingDraw = {...guard, 'upper_arm.L':[.1,.05,1], 'forearm.L':[0,.05,1],
 'upper_arm.R':[-.9,.15,.2], 'forearm.R':[.75,.3,.4]};
const slingRelease = {...slingDraw,'upper_arm.R':[-.8,.25,-.25],'forearm.R':[.25,.5,.8]};
const rifleAim = {...guard, 'upper_arm.L':[.25,-.3,.85], 'forearm.L':[-.2,.35,.9],
 'upper_arm.R':[-.55,-.45,.5], 'forearm.R':[.3,.5,.8]};
const rifleRecoil = {...rifleAim,'upper_arm.R':[-.65,-.4,.3],'forearm.R':[.4,.65,.6]};
const wings = {...guard,'upper_arm.L':[1,.1,.1],'forearm.L':[1,-.1,.15],
 'upper_arm.R':[-1,.1,.1],'forearm.R':[-1,-.1,.15]};
const wingBeat = {...wings,'upper_arm.L':[.8,-.55,.1],'forearm.L':[.8,-.3,.5],
 'upper_arm.R':[-.8,-.55,.1],'forearm.R':[-.8,-.3,.5]};
const recoil = {...guard, 'upper_arm.L':[.7,.3,.45], 'forearm.L':[.15,.8,.4],
 'upper_arm.R':[-.7,.3,.45], 'forearm.R':[-.15,.8,.4],
 'upper_leg.L':[.2,-.65,.75], 'lower_leg.L':[0,-.9,-.4],
 'upper_leg.R':[-.1,-.8,.55], 'lower_leg.R':[0,-.75,-.65]};
const crouch = {
 'upper_arm.L':[.12,-.7,.7], 'forearm.L':[0,-.85,-.5],
 'upper_arm.R':[-.12,-.7,.7], 'forearm.R':[0,-.85,-.5],
 'upper_leg.L':[.12,-.65,.75], 'lower_leg.L':[0,-.85,-.5],
 'upper_leg.R':[-.12,-.65,.75], 'lower_leg.R':[0,-.85,-.5],
};
const pounce = {...crouch, 'upper_arm.L':[.12,-.2,1], 'forearm.L':[0,-.25,1],
 'upper_arm.R':[-.12,-.2,1], 'forearm.R':[0,-.25,1],
 'upper_leg.L':[.15,-.7,-.7], 'lower_leg.L':[0,-.65,-.75],
 'upper_leg.R':[-.15,-.7,-.7], 'lower_leg.R':[0,-.65,-.75]};

function choreography(attack, defender, quadruped) {
 if (quadruped) return defender
  ? [[0,null],[.30,crouch],[.43,crouch],[.49,pounce],[.57,crouch],[.70,crouch],[1,crouch]]
  : [[0,null],[.28,null],[.43,crouch],[.50,pounce],[.54,crouch],[.62,pounce],[.72,pounce],[.86,crouch],[1,null]];
 if (defender) return [[0,null],[.27,guard],[.43,guard],[.49,punch],[.55,guard],[.62,recoil],[.78,recoil],[1,recoil]];
 const kind = attack?.variant === 'kick' ? 'kick' : attack?.family === 'sword' ? 'sword'
  : ['projectile','lightning','room','string','darkness'].includes(attack?.family) ? 'cast' : 'punch';
 let ready = kind === 'kick' ? kickReady : kind === 'sword' ? swordReady : kind === 'cast' ? castReady : windup;
 let contact = kind === 'kick' ? kick : kind === 'sword' ? swordCut : kind === 'cast' ? cast : punch;
 if (attack?.variant === 'slingshot') { ready=slingDraw; contact=slingRelease; }
 if (attack?.variant === 'rifle' || attack?.variant === 'laser') { ready=rifleAim; contact=rifleRecoil; }
 if (['club','staff','whip'].includes(attack?.variant)) { ready=swordReady; contact=swordCut; }
 if (['phoenix','pteranodon'].includes(attack?.variant)) { ready=wings; contact=wingBeat; }
 const feint = kind === 'kick' ? kickReady : kind === 'sword' ? swordCut : kind === 'cast' ? ready : punch;
 return [[0,null],[.28,guard],[.43,ready],[.475,feint],[.54,ready],[.62,contact],[.70,contact],[.86,guard],[1,null]];
}

// Select extremal sole vertices once, not the whole model every frame. Keeping
// the actual skinned points (rather than just ankle joints) accounts for a heel
// or toe rotating below the board when a leg straightens or pivots.
function soleSupports(body, meshes, inverse, bones) {
 const height = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3()).y;
 const directions = [];
 for (let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)if(x||y||z)directions.push(new THREE.Vector3(x,y,z));
 const point = new THREE.Vector3(), indices = new THREE.Vector4(), weights = new THREE.Vector4(), supports = [];
 const footHeight = Math.max(...['foot.L','foot.R'].map(name=>bones.get(canonicalName(name)).getWorldPosition(point).applyMatrix4(inverse).y));
 for (const mesh of meshes) {
  if (!mesh.geometry.attributes.skinIndex || !mesh.geometry.attributes.skinWeight) continue;
  const minima = Array.from({length:directions.length*2},()=>({value:Infinity,index:-1}));
  const legSides = mesh.skeleton.bones.map(bone => /^(foot|lowerleg)[lr]$/.test(canonicalName(bone.name)) ? canonicalName(bone.name).at(-1) : null);
  for(let i=0;i<mesh.geometry.attributes.position.count;i++) {
   indices.fromBufferAttribute(mesh.geometry.attributes.skinIndex,i);weights.fromBufferAttribute(mesh.geometry.attributes.skinWeight,i);
   let left=0,right=0;
   for(let j=0;j<4;j++) { const side=legSides[indices.getComponent(j)];if(side==='l')left+=weights.getComponent(j);else if(side==='r')right+=weights.getComponent(j); }
   if(Math.max(left,right)<.25)continue;
   mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
   if(point.y>footHeight+height*.07)continue;
   const offset=left>=right?0:directions.length;
   for(let d=0;d<directions.length;d++) { const value=point.dot(directions[d]),candidate=minima[offset+d];if(value<candidate.value){candidate.value=value;candidate.index=i;} }
  }
  for(const index of new Set(minima.map(candidate=>candidate.index).filter(index=>index>=0)))supports.push({mesh,index});
 }
 return supports;
}

/** Pose real skin joints in character coordinates (+Y up, +Z forward).
 * Direction targets are retargeted onto the original elbow/knee chains, so
 * hanging arms and pre-bent Meshy poses do not require identical bind rotations.
 * Every sample starts from the saved rest pose: sparse frames and hit-stop are
 * deterministic and cannot accumulate rotation or stretch a limb.
 */
export function createSkeletalCombat(body, {attack = null, defender = false} = {}) {
 const bones = new Map(), saved = [], meshes = [];
 let rigSettings = {};
 body?.traverse(object => {
  if (object.userData.combatRig) rigSettings = object.userData.combatRig;
  if (object.isSkinnedMesh) meshes.push(object);
  if (object.isBone) {
   bones.set(canonicalName(object.name), object);
   saved.push({object, position:object.position.clone(), quaternion:object.quaternion.clone(), scale:object.scale.clone()});
  }
 });
 const get = name => bones.get(canonicalName(name));
 const active = meshes.some(mesh => mesh.geometry.attributes.skinWeight && mesh.geometry.attributes.skinIndex) && limbs.every(([name, child]) => get(name) && get(child));
 const quadruped = rigSettings.motionProfile === 'quadruped', limits = rigSettings.limbLimits || {};
 const metrics = {active, skinnedMeshes:meshes.length, bones:saved.length, movedJoints:0, maxJointAngle:0, motionProfile:quadruped?'quadruped':'humanoid',soleSamples:0,groundLift:0,maxGroundLift:0};
 const originalPosition = body?.position.clone(), groundShift = new THREE.Vector3(), groundedPosition = new THREE.Vector3();
 let correctedGround = false;
 const updateWorld = () => {
  body?.updateWorldMatrix(true,true);
  // SkinnedMesh updates its inverse bind matrix in updateMatrixWorld, not the
  // inherited updateWorldMatrix used for joint retargeting. CPU sole samples
  // must see the same bind transforms that the renderer will use.
  for(const mesh of meshes)mesh.updateMatrixWorld(true);
 };
 const clear = () => {
  // Combat may already have assigned this frame's body translation. Only undo
  // our own correction when that position still belongs to the previous sample.
  if(correctedGround&&body.position.distanceToSquared(groundedPosition)<1e-16)body.position.sub(groundShift);
  correctedGround=false;
  for (const item of saved) { item.object.position.copy(item.position); item.object.quaternion.copy(item.quaternion); item.object.scale.copy(item.scale); }
  updateWorld();
 };
 if (!active) return {metrics, update(){}, ground(){return 0;}, restore:clear};
 updateWorld();
 const modelInverse = body.matrixWorld.clone().invert();
 const supports = soleSupports(body,meshes,modelInverse,bones);
 metrics.soleSamples = supports.length;
 const restDirections = new Map(limbs.map(([name, child]) => [name,
  get(child).getWorldPosition(new THREE.Vector3()).applyMatrix4(modelInverse)
   .sub(get(name).getWorldPosition(new THREE.Vector3()).applyMatrix4(modelInverse)).normalize()]));
 const restRotations = new Map(saved.map(item => [item.object,item.quaternion]));
 const amplitudes = new Map(limbs.map(([name]) => {
  const arm = /arm/.test(name), shoulder = name.startsWith('upper_arm');
  const enabled = !(arm && rigSettings.missingLimbs?.includes(name.at(-1)));
  const finiteLimit = value => Number.isFinite(value) ? clamp(value) : 1;
  return [name, enabled ? finiteLimit(arm?limits.arms:limits.legs) * (arm?finiteLimit(shoulder?limits.shoulders:limits.elbows):1) : 0];
 }));
 const frames = choreography(attack, defender, quadruped);
 const a = new THREE.Vector3(), b = new THREE.Vector3(), current = new THREE.Vector3(), desired = new THREE.Vector3();
 const modelRotation = new THREE.Quaternion(), parentRotation = new THREE.Quaternion(), jointRotation = new THREE.Quaternion(), delta = new THREE.Quaternion();
 function aim(name, child, target) {
  const bone = get(name), tip = get(child);
  bone.updateWorldMatrix(true, true);
  current.subVectors(tip.getWorldPosition(a), bone.getWorldPosition(b)).normalize();
  desired.copy(target).applyQuaternion(modelRotation).normalize();
  delta.setFromUnitVectors(current, desired);
  bone.getWorldQuaternion(jointRotation); bone.parent.getWorldQuaternion(parentRotation).invert();
  bone.quaternion.copy(parentRotation).multiply(delta).multiply(jointRotation).normalize();
  const rest = restRotations.get(bone), angle = rest.angleTo(bone.quaternion);
  const configured = rigSettings.maxJointAngles?.[name];
  const maxAngle = Number.isFinite(configured) ? Math.max(0,configured) : name.startsWith('upper_arm') ? 2.25 : name.startsWith('forearm') ? 2.45 : name.startsWith('upper_leg') ? 1.85 : 2.25;
  const amount = amplitudes.get(name) * Math.min(1, maxAngle/Math.max(angle,.000001));
  delta.copy(bone.quaternion);
  bone.quaternion.copy(rest).slerp(delta,amount);
  bone.updateWorldMatrix(false, true);
 }
 function sample(p) {
  let i = 1; while (i < frames.length - 1 && p > frames[i][0]) i++;
  const [start, first] = frames[i-1], [end, second] = frames[i];
  return [first, second, smooth((p - start)/(end - start))];
 }
 return {
  metrics,
  ground(floorY) {
   metrics.groundLift = 0;
   if(!Number.isFinite(floorY)||!supports.length)return 0;
   updateWorld();
   let bottom=Infinity;
   for(const {mesh,index} of supports)bottom=Math.min(bottom,mesh.getVertexPosition(index,a).applyMatrix4(mesh.matrixWorld).y);
   const lift=Math.max(0,floorY-bottom);
   if(lift>1e-7) {
    groundShift.copy(body.position);
    body.getWorldPosition(a);a.y+=lift;
    body.position.copy(body.parent?body.parent.worldToLocal(a):a);
    groundShift.subVectors(body.position,groundShift);groundedPosition.copy(body.position);correctedGround=true;
    updateWorld();
    metrics.groundLift=lift;metrics.maxGroundLift=Math.max(metrics.maxGroundLift,lift);
   }
   return metrics.groundLift;
  },
  update(progress, {walking = false} = {}) {
   clear();
   const p = clamp(progress);
   if (p === 0 || (p === 1 && !defender)) { metrics.movedJoints = 0; return; }
   body.getWorldQuaternion(modelRotation);
   const [first, second, blend] = sample(p);
   const step = Math.sin(p * Math.PI * (walking ? 8 : 30)) * Math.sin(p * Math.PI);
   for (const [name, child] of limbs) {
    const rest = restDirections.get(name);
    if (walking) {
     desired.copy(rest);
     const side = name.endsWith('.L') ? 1 : -1;
     if (name.startsWith('upper_leg')) desired.z += step * side * .44;
     else if (name.startsWith('lower_leg')) desired.z -= Math.max(0, step * side) * .55;
     else if (name.startsWith('upper_arm')) desired.z -= step * side * .32;
     else desired.z += Math.abs(step) * .12;
    } else {
     a.copy(first?.[name] ? b.fromArray(first[name]).normalize() : rest);
     b.copy(second?.[name] ? desired.fromArray(second[name]).normalize() : rest);
     desired.lerpVectors(a, b, blend);
    }
    // aim uses its own scratch vectors; preserve this direction for the call.
    const x = desired.x, y = desired.y, z = desired.z;
    aim(name, child, {x,y,z});
   }
   updateWorld();
   metrics.movedJoints = saved.filter(item => item.object.quaternion.angleTo(item.quaternion) > .035).length;
   metrics.maxJointAngle = Math.max(metrics.maxJointAngle, ...saved.map(item => item.object.quaternion.angleTo(item.quaternion)));
  },
  restore() { clear(); body.position.copy(originalPosition); updateWorld(); metrics.movedJoints = 0; metrics.groundLift = 0; },
 };
}
