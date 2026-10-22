import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {cloneCharacter, createSkeletalCombat, disposeCharacterSkeletons} from '../src/skeletal-combat.mjs';
import {createMoveAnimation} from '../src/combat.mjs';
import {getCharacterAttack} from '../src/attacks.mjs';

function model({extraLimbs=false,propGrip=false,pocketContact=false}={}) {
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
 if(extraLimbs)for(const index of [2,3])for(const [side,x] of [['L',1],['R',-1]]) {
  const suffix=`${side}${index}`;
  const upperArm=bone(`upper_arm.${suffix}`,chest,[x*.19,-.07*(index-1),.05*(index-2)]);
  const forearm=bone(`forearm.${suffix}`,upperArm,[x*(.13+.04*index),index===2?-.08:.09,.03]);bone(`hand.${suffix}`,forearm,[x*.14,-.06,.06]);
  const thigh=bone(`upper_leg.${suffix}`,hips,[x*.12,0,(index-2.5)*.18]);
  const shin=bone(`lower_leg.${suffix}`,thigh,[x*.06,-.2,index===2?.12:-.12]);bone(`foot.${suffix}`,shin,[x*.01,-.2,.03]);
 }
 if(propGrip) {
  bone('weapon.R',byName.get('hand.R'),[.12,-.18,.24]);
  root.userData.combatRig={propGrips:[{bone:'weapon.R',parent:'hand.R',target:[.01,-.035,.012]}]};
 }
 if(pocketContact)root.userData.combatRig={...root.userData.combatRig,pocketContacts:[{side:'L',anchor:'hips',elbowSwivel:.18}]};
 root.updateMatrixWorld(true);
 // Four real skin vertices sit at each wrist and ankle, weighted to that joint.
 const tips = ['hand.L','hand.R','foot.L','foot.R'], positions = [], indices = [], weights = [];
 if(propGrip)tips.push('weapon.R');
 if(extraLimbs)for(const index of [2,3])for(const side of ['L','R'])tips.push(`hand.${side}${index}`,`foot.${side}${index}`);
 const palmStart=tips.length;if(pocketContact)tips.push('hand.L','hand.L');
 for (const [i,name] of tips.entries()) {
  const point=byName.get(name).getWorldPosition(new THREE.Vector3());
  if(pocketContact&&i>=palmStart)point.add(new THREE.Vector3(i===palmStart?.025:-.015,.012,.02));
  positions.push(...point.toArray());
  indices.push(bones.indexOf(byName.get(name)),0,0,0); weights.push(1,0,0,0);
 }
 const geometry = new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
 geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
 const mesh = new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial()); root.add(mesh);
 mesh.bind(new THREE.Skeleton(bones)); root.updateMatrixWorld(true);
 return {root,mesh,bones,byName,tips};
}
function vertex(mesh, i) { mesh.updateWorldMatrix(true,false); mesh.updateMatrixWorld(true); mesh.skeleton.update(); return mesh.getVertexPosition(i,new THREE.Vector3()); }
function transforms(root) { const result=[];root.traverse(o=>{if(o.isBone)result.push([o.name,o.position.toArray(),o.quaternion.toArray(),o.scale.toArray()]);});return result; }

test('a pocket contact anchors actual weighted palm vertices while other arm and legs retain exact choreography',()=>{
 for(const defender of [false,true])for(const nonuniform of [false,true]) {
  const f=model({pocketContact:true,propGrip:true}),control=model({propGrip:true}),attack=getCharacterAttack('shanks','queen');
  for(const root of [f.root,control.root]){root.position.set(3,.2,-4);root.rotation.set(.1,1.7,-.15);root.scale.set(nonuniform?1.2:1.6,nonuniform?.85:1.6,nonuniform?1.1:1.6);root.updateMatrixWorld(true);}
  const hip=f.byName.get('hips'),palmIndices=[0,5,6],anchors=palmIndices.map(i=>hip.worldToLocal(vertex(f.mesh,i).applyMatrix4(f.mesh.matrixWorld))),rest=transforms(f.root);
  const elbowAnchor=hip.worldToLocal(f.byName.get('forearm.L').getWorldPosition(new THREE.Vector3()));
  const rig=createSkeletalCombat(f.root,{attack,defender}),baseline=createSkeletalCombat(control.root,{attack,defender});let maxElbow=0,maxRightArm=0,maxLeg=0;
  for(const p of [.05,.1,.15,.2,.28,.43,.49,.54,.62,.78,.86]) {
   const t=Math.max(0,Math.min(1,(p-.18)/.12)),options=p<.3?{gaitProgress:p/.3,walkingBlend:1-t*t*(3-2*t)}:{};
   rig.update(p,options);baseline.update(p,options);
   for(let i=0;i<palmIndices.length;i++)assert(vertex(f.mesh,palmIndices[i]).applyMatrix4(f.mesh.matrixWorld).distanceTo(hip.localToWorld(anchors[i].clone()))<1e-6,'weighted wrist and off-axis palm remain in the pocket');
   const independent=t=>!['upper_arm.L','forearm.L','hand.L'].includes(t[0]);
   assert.deepEqual(transforms(f.root).filter(independent),transforms(control.root).filter(independent),'other arm, both legs and weapon joint are bit-for-bit unchanged');
   maxElbow=Math.max(maxElbow,f.byName.get('forearm.L').getWorldPosition(new THREE.Vector3()).distanceTo(hip.localToWorld(elbowAnchor.clone())));
   maxRightArm=Math.max(maxRightArm,f.byName.get('upper_arm.R').quaternion.angleTo(new THREE.Quaternion()));
   maxLeg=Math.max(maxLeg,f.byName.get('upper_leg.R').quaternion.angleTo(new THREE.Quaternion()));
  }
  assert(maxElbow>.001,'pocket elbow can swivel without freeing the palm');assert(maxRightArm>.1&&maxLeg>.06,'firing arm and legs remain active');
  assert.equal(rig.metrics.pocketContacts,1);assert(rig.metrics.maxPocketError<1e-6);
  rig.restore();assert.deepEqual(transforms(f.root),rest);
 }
});

test('pocket contacts are clone-isolated and deterministic under dense and sparse sampling',()=>{
 const source=model({pocketContact:true}),first=cloneCharacter(source.root),second=cloneCharacter(source.root),rest=transforms(source.root),attack=getCharacterAttack('shanks','queen');
 const dense=createSkeletalCombat(first,{attack}),sparse=createSkeletalCombat(second,{attack});
 for(let i=1;i<=62;i++)dense.update(i/100);
 assert.deepEqual(transforms(source.root),rest);assert.deepEqual(transforms(second),rest);
 sparse.update(.62);assert.deepEqual(transforms(first),transforms(second));
 dense.update(1);sparse.restore();assert.deepEqual(transforms(first),rest);assert.deepEqual(transforms(second),rest);
});

test('pocket contacts restore every bone and weighted vertex on cancellation, completion and reduced motion',async()=>{
 for(const mode of ['cancel','complete','reduced']) {
  const a=model({pocketContact:true,propGrip:true}),v=model({pocketContact:true}),attacker=new THREE.Group(),victim=new THREE.Group();attacker.add(a.root);victim.add(v.root);victim.position.z=2;
  attacker.updateMatrixWorld(true);victim.updateMatrixWorld(true);
  const before=[transforms(a.root),transforms(v.root)],vertices=[a,v].map(f=>f.tips.map((_,i)=>vertex(f.mesh,i).toArray()));let frame;
  const animation=createMoveAnimation({attacker,victim,end:victim.position.clone(),attack:getCharacterAttack('shanks','queen'),reducedMotion:mode==='reduced',now:()=>0,requestFrame:callback=>{frame=callback;return 1;},cancelFrame(){}});
  if(mode!=='reduced'){frame(.62*3480);assert.notDeepEqual(transforms(a.root),before[0]);if(mode==='cancel')animation.cancel();else frame(3600);}
  await animation.finished;assert.deepEqual([transforms(a.root),transforms(v.root)],before);
  attacker.updateMatrixWorld(true);victim.updateMatrixWorld(true);
  assert.deepEqual([a,v].map(f=>f.tips.map((_,i)=>vertex(f.mesh,i).toArray())),vertices);
 }
});

test('pocket metadata rejects ambiguous or missing anatomical contacts',()=>{
 for(const contacts of [[{side:'X',anchor:'hips'}],[{side:'L',anchor:'head'}],[{side:'L',elbowSwivel:NaN}],[{side:'L'},{side:'L'}]]) {
  const f=model();f.root.userData.combatRig={pocketContacts:contacts};assert.throws(()=>createSkeletalCombat(f.root),/pocket contact/i);
 }
});

test('a fitted weapon joint picks up into the moving palm without altering body motion',()=>{
 const attack=getCharacterAttack('kaido','king');
 for(const defender of [false,true]) {
  const f=model({propGrip:true}),control=model(),rest=transforms(f.root);
  for(const root of [f.root,control.root]){root.position.set(3,.2,-4);root.rotation.y=1.7;root.scale.setScalar(2.3);root.updateMatrixWorld(true);}
  const rig=createSkeletalCombat(f.root,{attack,defender}),baseline=createSkeletalCombat(control.root,{attack,defender}),weapon=f.byName.get('weapon.R'),hand=f.byName.get('hand.R');
  const target=new THREE.Vector3().fromArray(f.root.userData.combatRig.propGrips[0].target),start=weapon.position.clone();
  rig.update(.14);assert(weapon.position.distanceTo(start.clone().lerp(target,.5))<1e-12,'smooth halfway pickup');
  for(const p of [.28,.43,.49,.62,.78,.86]) {
   rig.update(p);baseline.update(p);
   const palm=hand.localToWorld(target.clone()),anchor=weapon.getWorldPosition(new THREE.Vector3());
   assert(anchor.distanceTo(palm)<1e-10,'weapon handle stays in the moving palm');
   assert(vertex(f.mesh,4).applyMatrix4(f.mesh.matrixWorld).distanceTo(palm)<1e-6,'actual weighted handle surface follows prop joint');
   assert.deepEqual(transforms(f.root).filter(t=>t[0]!=='weapon.R'),transforms(control.root),'limb poses unchanged');
   assert.deepEqual(f.root.position.toArray(),[3,.2,-4],'no whole-character offset');
  }
  if(defender){rig.update(1);assert(weapon.position.distanceTo(target)<1e-12);}else{rig.update(1);assert.deepEqual(transforms(f.root),rest);}
  rig.restore();assert.deepEqual(transforms(f.root),rest);
 }
});

test('weapon pickup is deterministic and independent for each cloned character',()=>{
 const source=model({propGrip:true}),first=cloneCharacter(source.root),second=cloneCharacter(source.root),rest=transforms(source.root),attack=getCharacterAttack('kaido','king');
 const dense=createSkeletalCombat(first,{attack}),sparse=createSkeletalCombat(second,{attack});
 for(let p=.01;p<.62;p+=.01)dense.update(p);dense.update(.62);
 assert.deepEqual(transforms(source.root),rest);assert.deepEqual(transforms(second),rest);
 sparse.update(.62);assert.deepEqual(transforms(first),transforms(second));
 dense.restore();sparse.restore();assert.deepEqual(transforms(first),rest);assert.deepEqual(transforms(second),rest);
});

test('weapon joints restore exactly on combat cancellation, completion and reduced motion',async()=>{
 for(const mode of ['cancel','complete','reduced']) {
  const a=model({propGrip:true}),v=model({propGrip:true}),attacker=new THREE.Group(),victim=new THREE.Group();attacker.add(a.root);victim.add(v.root);victim.position.z=2;
  const before=[transforms(a.root),transforms(v.root)];let frame;
  const animation=createMoveAnimation({attacker,victim,end:victim.position.clone(),attack:getCharacterAttack('kaido','king'),reducedMotion:mode==='reduced',now:()=>0,requestFrame:callback=>{frame=callback;return 1;},cancelFrame(){}});
  if(mode!=='reduced'){frame(.62*3480);assert.notDeepEqual(transforms(a.root),before[0]);if(mode==='cancel')animation.cancel();else frame(3600);}
  await animation.finished;assert.deepEqual([transforms(a.root),transforms(v.root)],before);
 }
});

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

test('six arms and six legs move actual weighted tips while preserving their rest fan-out', () => {
 const f=model({extraLimbs:true}),before=transforms(f.root),restTips=f.tips.map((_,i)=>vertex(f.mesh,i));
 const direction=name=>{const upper=f.byName.get(name),child=upper.children.find(o=>o.isBone);return child.getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3())).normalize();};
 const restAngle=direction('upper_arm.R').angleTo(direction('upper_arm.R2'));
 const rig=createSkeletalCombat(f.root,{attack:getCharacterAttack('mugiwara','king')});
 rig.update(.62);
 assert.equal(rig.metrics.bones,41);assert.equal(rig.metrics.articulatedSegments,24);
 for(let i=0;i<f.tips.length;i++)assert(vertex(f.mesh,i).distanceTo(restTips[i])>.005,`${f.tips[i]} deforms its weighted vertex`);
 assert(rig.metrics.movedJoints>=20,'extra joints do not remain static');
 const posedAngle=direction('upper_arm.R').angleTo(direction('upper_arm.R2'));
 assert(Math.abs(posedAngle-restAngle)<1e-6,'extra arm retains its distinct angular offset');
 assert(posedAngle>.5,'six arms do not collapse onto the primary punch direction');
 rig.restore();assert.deepEqual(transforms(f.root),before);
 for(let i=0;i<f.tips.length;i++)assert(vertex(f.mesh,i).distanceTo(restTips[i])<1e-10);
});

test('extra limbs recognize sanitized glTF names, anatomical limits and separate foot supports', () => {
 const f=model({extraLimbs:true});
 f.bones.forEach(b=>{b.name=b.name.replaceAll('.','').replaceAll('_','');});
 f.root.userData.combatRig={limbLimits:{arms:.6,shoulders:.7,elbows:.8,legs:.5},maxJointAngles:{'upper_arm.R3':.1},missingLimbs:['L2']};
 const rig=createSkeletalCombat(f.root,{attack:getCharacterAttack('bigmom','rook')});rig.update(.62);
 assert.equal(rig.metrics.articulatedSegments,24);assert.equal(rig.metrics.soleSamples,6,'all six weighted feet contribute support points');
 assert(f.byName.get('upper_arm.R3').quaternion.angleTo(new THREE.Quaternion())<=.100001);
 assert.equal(f.byName.get('upper_arm.L2').quaternion.angleTo(new THREE.Quaternion()),0);
 assert.equal(f.byName.get('forearm.L2').quaternion.angleTo(new THREE.Quaternion()),0);
 assert(f.byName.get('upper_arm.L3').quaternion.angleTo(new THREE.Quaternion())>.05);
 f.root.position.y=-.5;rig.ground(0);
 for(let i=0;i<f.tips.length;i++)if(f.tips[i].startsWith('foot'))assert(vertex(f.mesh,i).applyMatrix4(f.mesh.matrixWorld).y>=-1e-7,`${f.tips[i]} remains above floor`);
 rig.restore();assert.deepEqual(f.root.position.toArray(),[0,0,0]);
});

test('extra-limb clone isolation and capture cancellation restore all41 bones and all weighted vertices', async () => {
 const source=model({extraLimbs:true}),first=cloneCharacter(source.root),other=cloneCharacter(source.root),attacker=new THREE.Group(),defender=new THREE.Group();
 attacker.add(first);defender.add(cloneCharacter(source.root));defender.position.z=2;
 const firstMesh=first.children.find(o=>o.isSkinnedMesh),otherMesh=other.children.find(o=>o.isSkinnedMesh);
 const before=transforms(first),rest=source.tips.map((_,i)=>vertex(otherMesh,i));let frame;
 const combat=createMoveAnimation({attacker,victim:defender,end:defender.position.clone(),attack:getCharacterAttack('bigmom','rook'),now:()=>0,requestFrame:f=>{frame=f;return 1;},cancelFrame(){}});
 frame(.62*3480);assert(combat.metrics.articulation.attacker.movedJoints>=20);
 for(let i=4;i<source.tips.length;i++){assert(vertex(firstMesh,i).distanceTo(rest[i])>.005);assert(vertex(otherMesh,i).distanceTo(rest[i])<1e-10);}
 combat.cancel();assert.deepEqual(await combat.finished,{cancelled:true});assert.deepEqual(transforms(first),before);
 for(let i=0;i<source.tips.length;i++)assert(vertex(firstMesh,i).distanceTo(rest[i])<1e-10);
});

test('adding extra chains does not change the canonical17-bone choreography', () => {
 for(const attack of [getCharacterAttack('mugiwara','king'),getCharacterAttack('mugiwara','queen'),getCharacterAttack('mugiwara','bishop')]) {
  const primary=model(),extra=model({extraLimbs:true}),a=createSkeletalCombat(primary.root,{attack}),b=createSkeletalCombat(extra.root,{attack});
  for(const p of [.28,.43,.49,.62,.81,1]) {
   a.update(p);b.update(p);
   for(const [name,bone] of primary.byName)assert(bone.quaternion.angleTo(extra.byName.get(name).quaternion)<1e-7,`${attack.id} ${p} ${name}`);
  }
 }
});

test('capture approach walks actual hips and knees even under dress limits and cancels exactly', async () => {
 const f=model(),other=model(),attacker=new THREE.Group(),victim=new THREE.Group();attacker.add(f.root);victim.add(other.root);victim.position.z=2;
 f.root.userData.combatRig={limbLimits:{legs:.18}};
 const original=transforms(f.root),before=f.root.position.clone();let frame;
 const combat=createMoveAnimation({attacker,victim,end:victim.position.clone(),attack:getCharacterAttack('bigmom','king'),now:()=>0,requestFrame:f=>{frame=f;return 1;},cancelFrame(){}});
 const maxima=new Map([...f.byName].filter(([name])=>/^(upper|lower)_leg/.test(name)).map(([name])=>[name,0]));
 for(let p=.02;p<=.18;p+=.01) {
  frame(p*3480);
  for(const [name] of maxima)maxima.set(name,Math.max(maxima.get(name),f.byName.get(name).quaternion.angleTo(new THREE.Quaternion())));
  for(const index of [2,3])assert(vertex(f.mesh,index).applyMatrix4(f.mesh.matrixWorld).y>=-1e-7,'sole stays above the board during the approach');
 }
 for(const [name,angle] of maxima)assert(angle>.06,`${name} strides beyond .06rad despite dress limit: ${angle}`);
 combat.cancel();assert.deepEqual(await combat.finished,{cancelled:true});assert.deepEqual(transforms(f.root),original);assert.deepEqual(f.root.position.toArray(),before.toArray());
});

test('capture gait blends continuously into guard and leaves default attack and ordinary walking unchanged', () => {
 const a=model(),b=model(),attack=getCharacterAttack('mugiwara','king'),rig=createSkeletalCombat(a.root,{attack}),reference=createSkeletalCombat(b.root,{attack});
 const options=p=>{const t=Math.max(0,Math.min(1,(p-.18)/.12));return{gaitProgress:p/.30,walkingBlend:1-t*t*(3-2*t)};};
 rig.update(.30-1e-6,options(.30-1e-6));const before=new Map(a.bones.map(b=>[b.name,b.quaternion.clone()]));
 rig.update(.30+1e-6,options(.30+1e-6));
 for(const bone of a.bones)assert(bone.quaternion.angleTo(before.get(bone.name))<1e-4,`${bone.name} has no transition snap`);
 for(const p of [.30,.43,.62,.88]) {rig.update(p,options(p));reference.update(p);assert.deepEqual(transforms(a.root),transforms(b.root));}
 rig.update(.2,{walking:true});reference.update(.2,{walking:true,gaitProgress:.2,walkingBlend:0});assert.deepEqual(transforms(a.root),transforms(b.root));
});

test('approach stride transfers to all twelve Cracker leg joints with deterministic pose sampling', () => {
 const a=model({extraLimbs:true}),b=model({extraLimbs:true});
 a.root.userData.combatRig={limbLimits:{legs:.18}};b.root.userData.combatRig={limbLimits:{legs:.18}};
 const attack=getCharacterAttack('bigmom','rook'),dense=createSkeletalCombat(a.root,{attack}),sparse=createSkeletalCombat(b.root,{attack});
 const maxima=new Map([...a.byName].filter(([name])=>/^(upper|lower)_leg/.test(name)).map(([name])=>[name,0]));
 assert.equal(maxima.size,12);
 for(let i=1;i<=18;i++) {
  const p=i/100;dense.update(p,{gaitProgress:p/.30,walkingBlend:1});
  for(const [name] of maxima)maxima.set(name,Math.max(maxima.get(name),a.byName.get(name).quaternion.angleTo(new THREE.Quaternion())));
 }
 for(const [name,angle] of maxima)assert(angle>.06,`${name} is an active articulated approach joint: ${angle}`);
 sparse.update(.18,{gaitProgress:.6,walkingBlend:1});assert.deepEqual(transforms(a.root),transforms(b.root));
 dense.restore();sparse.restore();assert.deepEqual(transforms(a.root),transforms(b.root));
});
