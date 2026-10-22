import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {createAttackEffects} from '../src/attack-effects.mjs';
import {getCharacterAttack} from '../src/attacks.mjs';

test('Sanji fire follows the animated foot through a turn and a lifted knee',()=>{
 const scene=new THREE.Scene(),attacker=new THREE.Group(),body=new THREE.Group(),foot=new THREE.Bone();
 foot.name='foot.R';foot.position.set(-.1,.3,.35);body.add(foot);attacker.add(body);scene.add(attacker);
 attacker.position.set(2,.146,-1);attacker.rotation.y=.6;
 const origin=new THREE.Vector3(2,.146,0),direction=new THREE.Vector3(0,0,1);
 const fx=createAttackEffects({scene,origin,direction,attacker,attack:getCharacterAttack('mugiwara','bishop')});
 const flame=scene.getObjectByName('fire-tongue-0');
 for(const offset of [.3,.65]){
  foot.position.y=offset;attacker.updateMatrixWorld(true);fx.update(.62);
  const expected=foot.getWorldPosition(new THREE.Vector3()).sub(origin);
  assert(Math.abs(flame.position.y-expected.y-.025)<1e-9);
  assert(Math.abs(flame.position.z-expected.z)<1e-9);
  assert(Math.abs(flame.position.x-expected.x-.04)<1e-9);
 }
 fx.dispose();assert.equal(scene.getObjectByName('character-attack-effects'),undefined);
});

test('rubber extension begins at the real hand rather than a fixed body offset',()=>{
 const scene=new THREE.Scene(),attacker=new THREE.Group(),body=new THREE.Group(),hand=new THREE.Bone();
 hand.name='hand.R';hand.position.set(-.18,.64,.12);body.add(hand);attacker.add(body);scene.add(attacker);
 const fx=createAttackEffects({scene,origin:new THREE.Vector3(),direction:new THREE.Vector3(0,0,1),attacker,attack:getCharacterAttack('mugiwara','king')});
 const positions=scene.getObjectByName('rubber-stretched-arm-0').geometry.attributes.position;
 for(const x of [-.18,-.29]){
  hand.position.x=x;attacker.updateMatrixWorld(true);fx.update(.62);
  assert(Math.abs(positions.getX(0)-(x+.035))<1e-6);
  assert(Math.abs(positions.getY(0)-hand.position.y)<1e-6);
  assert(Math.abs(positions.getZ(0)-hand.position.z)<1e-6);
 }
 fx.dispose();
});

test('Zoro draws rigid blades that rotate with his articulated hands',()=>{
 const scene=new THREE.Scene(),attacker=new THREE.Group(),body=new THREE.Group(),hand=new THREE.Bone();
 hand.name='hand.R';hand.position.set(-.18,.64,.12);body.add(hand);attacker.add(body);scene.add(attacker);
 const fx=createAttackEffects({scene,origin:new THREE.Vector3(),direction:new THREE.Vector3(0,0,1),attacker,attack:getCharacterAttack('mugiwara','queen')});
 const blade=scene.getObjectByName('zoro-held-blade-0');assert(blade);
 for(const angle of [.3,1.2]){
  hand.rotation.x=angle;attacker.updateMatrixWorld(true);fx.update(.62);
  assert(blade.quaternion.angleTo(hand.getWorldQuaternion(new THREE.Quaternion()))<1e-7);
  assert(Math.abs(blade.position.distanceTo(hand.position)-.235)<1e-9);
  assert.equal(blade.material.opacity,1);
 }
 fx.dispose();assert.equal(scene.getObjectByName('zoro-held-blade-0'),undefined);
});
