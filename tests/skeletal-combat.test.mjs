import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {cloneCharacter, createSkeletalCombat, disposeCharacterSkeletons} from '../src/skeletal-combat.mjs';
import {createMoveAnimation} from '../src/combat.mjs';
import {getCharacterAttack} from '../src/attacks.mjs';

function model() {
 const root = new THREE.Group(), bones = [], byName = new Map();
 const bone = (name, parent, position) => {
  const object = new THREE.Bone(); object.name = name; object.position.fromArray(position);
  parent.add(object); bones.push(object); byName.set(name,object); return object;
 };
 const hips = bone('hips',root,[0,.48,0]), spine = bone('spine',hips,[0,.12,0]);
 const chest = bone('chest',spine,[0,.15,0]), neck = bone('neck',chest,[0,.08,0]); bone('head',neck,[0,.08,0]);
 for (const [side, x] of [['L',1],['R',-1]]) {
  const upperArm = bone(`upper_arm.${side}`,chest,[x*.18,0,0]);
  const forearm = bone(`forearm.${side}`,upperArm,[x*.06,-.2,0]); bone(`hand.${side}`,forearm,[0,-.18,0]);
  const thigh = bone(`upper_leg.${side}`,hips,[x*.09,0,0]);
  const shin = bone(`lower_leg.${side}`,thigh,[0,-.22,0]); bone(`foot.${side}`,shin,[0,-.22,.03]);
 }
 root.updateMatrixWorld(true);
 // Four real skin vertices sit at each wrist and ankle, weighted to that joint.
 const tips = ['hand.L','hand.R','foot.L','foot.R'], positions = [], indices = [], weights = [];
 for (const name of tips) {
  positions.push(...byName.get(name).getWorldPosition(new THREE.Vector3()).toArray());
  indices.push(bones.indexOf(byName.get(name)),0,0,0); weights.push(1,0,0,0);
 }
 const geometry = new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
 geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
 const mesh = new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial()); root.add(mesh);
 mesh.bind(new THREE.Skeleton(bones)); root.updateMatrixWorld(true);
 return {root,mesh,bones,byName};
}
function vertex(mesh, i) { mesh.updateWorldMatrix(true,false); mesh.updateMatrixWorld(true); mesh.skeleton.update(); return mesh.getVertexPosition(i,new THREE.Vector3()); }
function transforms(root) { const result=[];root.traverse(o=>{if(o.isBone)result.push([o.name,o.position.toArray(),o.quaternion.toArray(),o.scale.toArray()]);});return result; }

test('each board character binds its own bones while retaining shared material and geometry', () => {
 const source=model(), first=cloneCharacter(source.root), second=cloneCharacter(source.root);
 const firstMesh=first.children.find(o=>o.isMesh), secondMesh=second.children.find(o=>o.isMesh);
 assert.notEqual(firstMesh.skeleton,source.mesh.skeleton); assert.notEqual(firstMesh.skeleton,secondMesh.skeleton);
 assert.equal(firstMesh.geometry,source.mesh.geometry); assert.equal(firstMesh.material,source.mesh.material);
 assert.notEqual(firstMesh.skeleton.boneInverses[0],source.mesh.skeleton.boneInverses[0]);
 const original=vertex(source.mesh,1), other=vertex(secondMesh,1);
 const controller=createSkeletalCombat(first,{attack:getCharacterAttack('mugiwara','king')}); controller.update(.62);
 assert(vertex(firstMesh,1).distanceTo(original)>.25,'actual skin vertex follows the punched wrist');
 assert(vertex(secondMesh,1).distanceTo(other)<1e-10,'another pawn does not inherit the attack');
 assert(vertex(source.mesh,1).distanceTo(original)<1e-10,'cached asset remains at rest');
 assert(controller.metrics.movedJoints>=6);
 controller.restore(); assert(vertex(firstMesh,1).distanceTo(original)<1e-10);
});

test('punch, sword and kick move different real joints and retain their bone lengths', () => {
 const endpoints=[];
 for(const role of ['king','queen','bishop']) {
  const f=model(), before=transforms(f.root), hand=vertex(f.mesh,1), foot=vertex(f.mesh,3);
  const rig=createSkeletalCombat(f.root,{attack:getCharacterAttack('mugiwara',role)});
  rig.update(.43);const prepared=vertex(f.mesh,1);rig.update(.62);
  endpoints.push([vertex(f.mesh,1).toArray(),vertex(f.mesh,3).toArray()]);
  assert(rig.metrics.active); assert(rig.metrics.maxJointAngle>.3);
  assert(vertex(f.mesh,1).distanceTo(hand)>.08);
  if(role==='bishop')assert(vertex(f.mesh,3).distanceTo(foot)>.35,'Sanji kicks with a skinned leg');
  else assert(vertex(f.mesh,1).distanceTo(prepared)>.1,'windup releases into strike');
  assert.deepEqual(transforms(f.root).map(t=>t[1]),before.map(t=>t[1]),'bone translations and limb lengths stay unchanged');
  rig.restore();assert.deepEqual(transforms(f.root),before);
 }
 assert.notDeepEqual(endpoints[0],endpoints[1]);assert.notDeepEqual(endpoints[1],endpoints[2]);
});

test('retargeting tolerates glTF sanitized names, rotated rest bones and opposite board facing', () => {
 const f=model(); f.root.rotation.y=Math.PI;f.root.position.set(3,.146,-2);
 f.byName.get('upper_arm.R').rotation.z=.3; f.byName.get('forearm.R').rotation.x=.65;
 f.bones.forEach(b=>{b.name=b.name.replaceAll('.','');});
 f.root.updateMatrixWorld(true); const before=transforms(f.root),rig=createSkeletalCombat(f.root,{attack:getCharacterAttack('mugiwara','king')});
 rig.update(.62); assert(rig.metrics.active); assert(rig.metrics.movedJoints>=6);
 const arm=f.byName.get('upper_arm.R'),elbow=f.byName.get('forearm.R');
 const direction=elbow.getWorldPosition(new THREE.Vector3()).sub(arm.getWorldPosition(new THREE.Vector3())).normalize();
 assert(direction.z<-.95,'punch follows the pirate facing rather than global +Z');
 rig.restore();assert.deepEqual(transforms(f.root),before);
});

test('sparse and dense animation sampling produce the same skin pose without accumulated twist', () => {
 const a=model(),b=model(),attack=getCharacterAttack('mugiwara','bishop');
 const dense=createSkeletalCombat(a.root,{attack}),sparse=createSkeletalCombat(b.root,{attack});
 for(let i=0;i<62;i++)dense.update(i/100);
 dense.update(.62);sparse.update(.62);assert.deepEqual(transforms(a.root),transforms(b.root));
 dense.update(1);assert.deepEqual(transforms(a.root),transforms(model().root));
});

test('defender raises real forearms, counters and bends knees after contact', () => {
 const f=model(),rig=createSkeletalCombat(f.root,{defender:true}),rest=vertex(f.mesh,1);
 rig.update(.43);const guard=vertex(f.mesh,1);assert(guard.distanceTo(rest)>.15);
 rig.update(.49);assert(vertex(f.mesh,1).distanceTo(guard)>.1);
 const kneeBefore=f.byName.get('lower_leg.R').quaternion.clone();rig.update(.72);
 assert(f.byName.get('lower_leg.R').quaternion.angleTo(kneeBefore)>.15);
 rig.restore();assert(vertex(f.mesh,1).distanceTo(rest)<1e-10);
});

test('walking articulates opposite arms and legs and finishes in the original pose', () => {
 const f=model(),original=transforms(f.root),rig=createSkeletalCombat(f.root);
 rig.update(.2,{walking:true});assert(rig.metrics.movedJoints>=6);
 const left=f.byName.get('upper_leg.L').quaternion,right=f.byName.get('upper_leg.R').quaternion;
 assert(left.angleTo(right)>.1);rig.update(1,{walking:true});assert.deepEqual(transforms(f.root),original);
});

test('combat cancel, completion and reduced motion restore all bone transforms exactly', async () => {
 for(const mode of ['cancel','complete','reduced']) {
  const a=model(),v=model(),attacker=new THREE.Group(),victim=new THREE.Group();attacker.add(a.root);victim.add(v.root);victim.position.z=2;
  const before=[transforms(a.root),transforms(v.root)];let frame;const cues=[];
  const animation=createMoveAnimation({attacker,victim,end:victim.position.clone(),attack:getCharacterAttack('mugiwara','bishop'),
   reducedMotion:mode==='reduced',now:()=>0,requestFrame:f=>{frame=f;return 1;},cancelFrame(){},onImpact:()=>cues.push('impact'),onCue:()=>cues.push('land')});
  if(mode!=='reduced') {
   frame(.62*3480);assert(animation.metrics.articulation.attacker.movedJoints>=6);
   if(mode==='cancel')animation.cancel();else frame(3600);
  }
  assert.equal((await animation.finished).cancelled,mode==='cancel');
  assert.deepEqual([transforms(a.root),transforms(v.root)],before);
  assert.deepEqual(cues,mode==='complete'?['impact','land']:['impact']);
 }
});

test('disposing instance bone textures leaves shared meshes and other skeletons alive', () => {
 const source=model(),first=cloneCharacter(source.root),second=cloneCharacter(source.root);
 const firstMesh=first.children.find(o=>o.isMesh),other=second.children.find(o=>o.isMesh);
 firstMesh.skeleton.computeBoneTexture();other.skeleton.computeBoneTexture();
 let released=0,geometryDisposed=0,materialDisposed=0;
 firstMesh.skeleton.boneTexture.addEventListener('dispose',()=>released++);
 source.mesh.geometry.addEventListener('dispose',()=>geometryDisposed++);source.mesh.material.addEventListener('dispose',()=>materialDisposed++);
 disposeCharacterSkeletons(first);disposeCharacterSkeletons(first);
 assert.equal(released,1);assert.equal(geometryDisposed,0);assert.equal(materialDisposed,0);assert(other.skeleton.boneTexture);
});

test('articulated strikes leave torso spacing for the real arm or foot to make contact', async () => {
 for(const role of ['king','queen','bishop']) {
  const a=model(),v=model(),attacker=new THREE.Group(),victim=new THREE.Group();attacker.add(a.root);victim.add(v.root);victim.position.z=2;
  let frame;
  const animation=createMoveAnimation({attacker,victim,end:victim.position.clone(),attack:getCharacterAttack('mugiwara',role),now:()=>0,requestFrame:f=>{frame=f;return 1;},cancelFrame(){}});
  frame(.62*3480);
  const torsoGap=v.root.getWorldPosition(new THREE.Vector3()).z-a.root.getWorldPosition(new THREE.Vector3()).z;
  assert(torsoGap>.3&&torsoGap<.7,role+' torsos remain apart while limbs extend');
  assert(animation.metrics.articulation.attacker.movedJoints>=6);
  animation.cancel();await animation.finished;
 }
});

test('rigid legacy models report inactive rather than falsely claiming limb motion', () => {
 const root=new THREE.Group();root.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()));
 const rig=createSkeletalCombat(root);rig.update(.62);assert.equal(rig.metrics.active,false);assert.equal(rig.metrics.movedJoints,0);
});

test('exported coat limits and absent arms constrain articulation without disabling the other limbs', () => {
 const f=model(),before=transforms(f.root);
 f.root.userData.combatRig={motionProfile:'humanoid',limbLimits:{shoulders:.4,elbows:.6,legs:.15},missingLimbs:['L']};
 const rig=createSkeletalCombat(f.root,{attack:getCharacterAttack('mugiwara','queen')});rig.update(.43);
 assert.equal(f.byName.get('upper_arm.L').quaternion.angleTo(new THREE.Quaternion()),0);
 assert.equal(f.byName.get('forearm.L').quaternion.angleTo(new THREE.Quaternion()),0);
 const shoulderAngle=f.byName.get('upper_arm.R').quaternion.angleTo(new THREE.Quaternion());
 assert(shoulderAngle>.1&&shoulderAngle<=.901,'coat shoulder obeys exported amplitude');
 assert(f.byName.get('upper_leg.R').quaternion.angleTo(new THREE.Quaternion())<.28,'dress legs stay inside their envelope');
 rig.restore();assert.deepEqual(transforms(f.root),before);
});

test('quadruped uses foreleg pounce instead of an upright boxer guard', () => {
 const human=model(),lion=model();lion.root.userData.combatRig={motionProfile:'quadruped'};
 const attack=getCharacterAttack('buggy','knight'),a=createSkeletalCombat(human.root,{attack}),b=createSkeletalCombat(lion.root,{attack});
 a.update(.62);b.update(.62);assert.equal(b.metrics.motionProfile,'quadruped');
 assert.notDeepEqual(transforms(human.root),transforms(lion.root));assert(b.metrics.movedJoints>=6);
 const elbow=lion.byName.get('forearm.R'),paw=lion.byName.get('hand.R');
 const direction=paw.getWorldPosition(new THREE.Vector3()).sub(elbow.getWorldPosition(new THREE.Vector3())).normalize();
 assert(direction.z>.8&&direction.y<0,'front paw reaches forward and down');
});

test('projectile and winged characters get distinct articulated gestures', () => {
 const signatures=[];
 for(const [crew,role] of [['mugiwara','knight'],['marines','pawn'],['whitebeard','queen'],['mugiwara','king']]) {
  const f=model(),rig=createSkeletalCombat(f.root,{attack:getCharacterAttack(crew,role)});rig.update(.62);
  signatures.push(JSON.stringify([f.byName.get('upper_arm.R').quaternion.toArray(),f.byName.get('forearm.R').quaternion.toArray()]));
 }
 assert.equal(new Set(signatures).size,4);
});

test('bounded skinned sole samples ground extended legs in world space and restore without drift', () => {
 const f=model(),actor=new THREE.Group();actor.rotation.y=1.2;actor.scale.setScalar(1.4);actor.position.y=.146;actor.add(f.root);
 const original=f.root.position.clone(),rig=createSkeletalCombat(f.root,{attack:getCharacterAttack('mugiwara','bishop')});
 assert(rig.metrics.soleSamples>0&&rig.metrics.soleSamples<=52);
 for(let i=0;i<3;i++) {
  rig.update(.62);f.root.position.y=-.2;f.root.updateWorldMatrix(true,true);
  const lift=rig.ground(.146);assert(lift>0);
  const floor=Math.min(...[2,3].map(index=>vertex(f.mesh,index).applyMatrix4(f.mesh.matrixWorld).y));
  assert(floor>=.146-1e-7&&floor<=.146+1e-7,'lowest actual skin vertex meets tile surface');
  const grounded=f.root.position.clone();assert.equal(rig.ground(.146),0);assert.deepEqual(f.root.position.toArray(),grounded.toArray());
 }
 rig.restore();assert.deepEqual(f.root.position.toArray(),original.toArray());
});
