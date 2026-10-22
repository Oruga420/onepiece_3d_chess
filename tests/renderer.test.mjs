import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRenderer,fitCharacterModel} from '../src/renderer.mjs';

test('normalization measures initialized skin joints rather than a stale compressed rest box',async()=>{
 const THREE=await import('../vendor/three/three.module.js');
 const root=new THREE.Group(),armature=new THREE.Group(),lower=new THREE.Bone(),upper=new THREE.Bone();
 lower.add(upper);upper.position.y=.7;armature.add(lower);
 const geometry=new THREE.BoxGeometry(.3,1,.2).translate(0,.5,0),indices=[],weights=[];
 for(let i=0;i<geometry.attributes.position.count;i++){indices.push(geometry.attributes.position.getY(i)>.5?1:0,0,0,0);weights.push(1,0,0,0);}
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
 const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial());
 root.add(mesh,armature);root.position.set(.3,2,-.4);root.scale.setScalar(1.2);root.updateMatrixWorld(true);
 mesh.bind(new THREE.Skeleton([lower,upper]));
 // This reproduces glTF's mesh-before-armature ordering plus a previously
 // computed invalid box. The final renderer must ignore both stale values.
 lower.matrixWorld.identity();upper.matrixWorld.identity();mesh.boundingBox=new THREE.Box3(new THREE.Vector3(-.1,0,-.1),new THREE.Vector3(.1,.3,.1));
 const fitted=fitCharacterModel(root);fitted.updateMatrixWorld(true);
 const actual=new THREE.Box3().setFromObject(fitted,true),size=actual.getSize(new THREE.Vector3()),center=actual.getCenter(new THREE.Vector3());
 assert(Math.abs(size.y-.9)<1e-6,'real skinned height fits one tile instead of growing to three');
 assert(size.x<=.72+1e-6&&size.z<=.72+1e-6);assert(Math.abs(actual.min.y)<1e-6);
 assert(Math.abs(center.x)<1e-6&&Math.abs(center.z)<1e-6);
 assert(Math.abs(fitted.userData.combatBounds.height-size.y)<1e-6);
 const cached=new THREE.Box3().setFromObject(fitted);assert(Math.abs(cached.getSize(new THREE.Vector3()).y-.9)<1e-6,'cached diagnostic bounds are refreshed too');
});

test('renderer resolves fruit-transformed and marine attackers from their actual model slot', async () => {
 const THREE = await import('../vendor/three/three.module.js');
 for (const [crew, type, player, expected] of [['mugiwara','queen','pirate','Zoro'], ['heart','king','pirate','Law'], ['mugiwara','queen','marine','Akainu']]) {
  const attacker = new THREE.Group(), victim = new THREE.Group(), view = Object.create(GameRenderer.prototype), impacts = [];
  attacker.userData.piece = {type,player}; attacker.position.set(0,.146,0); victim.position.set(0,.146,-1);
  Object.assign(view, {crew, pieces:new Map([['E2',attacker],['E3',victim]]), scene:new THREE.Scene(), reducedMotion:true, updateCamera(){}});
  await view.animateMove({from:'E2',to:'E3',captured:{}}, {onImpact:e=>impacts.push(e)});
  assert.equal(impacts[0].attack.character, expected); assert.equal(view.combatMetrics.character, expected);
  assert.equal(view.combatMetrics.signatureEffects, 0);
 }
});
test('asset manifest is shared by overlapping loads and later board updates',async()=>{
 const original=globalThis.fetch;let calls=0,resolve;
 globalThis.fetch=()=>{calls++;return new Promise(r=>{resolve=r;});};
 try{const renderer=Object.create(GameRenderer.prototype),first=renderer.loadManifest(),second=renderer.loadManifest();resolve({ok:true,json:async()=>({assets:[]})});assert.deepEqual(await first,await second);await renderer.loadManifest();assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('a failed manifest load can retry instead of caching permanent failure',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>({ok:++calls>1,json:async()=>({assets:[]})});
 try{const renderer=Object.create(GameRenderer.prototype);await assert.rejects(()=>renderer.loadManifest(),/Manifest/);assert.deepEqual(await renderer.loadManifest(),{assets:[]});assert.equal(calls,2);}finally{globalThis.fetch=original;}
});

test('all32pieces contain only a character model with feet resting on the tile',async()=>{
 const THREE=await import('../vendor/three/three.module.js');const{ChessGame}=await import('../src/rules.mjs');
 const view=Object.create(GameRenderer.prototype),cache=new Map();
 for(const team of ['mugiwara','marines'])for(const role of ['king','queen','rook','bishop','knight','pawn']){const model=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(.2,.8,.2),new THREE.MeshBasicMaterial());mesh.position.y=.4;model.add(mesh);cache.set(`${team}/${role}`,model);}
 Object.assign(view,{crew:'mugiwara',cache,pieces:new Map(),pieceGroup:new THREE.Group(),generation:0,metrics:{},onReady(){},loadManifest:async()=>({assets:[]})});
 await view.setPosition(new ChessGame().board,'mugiwara');assert.equal(view.pieces.size,32);
 for(const piece of view.pieces.values()){assert.equal(piece.children.length,1);assert.equal(piece.children[0].name,'character-model');const bounds=new THREE.Box3().setFromObject(piece);assert.ok(bounds.min.y>=.14&&bounds.min.y<=.15,'feet stay at tile surface');piece.traverse(node=>assert.notEqual(node.geometry?.type,'CylinderGeometry'));}
 for(const model of cache.values())model.traverse(node=>{node.geometry?.dispose();node.material?.dispose();});
});

test('cinematic capture camera restores exactly and manual controls override it',async()=>{
 const THREE=await import('../vendor/three/three.module.js');
 const view=Object.create(GameRenderer.prototype);
 Object.assign(view,{camera:new THREE.PerspectiveCamera(38,1.4,.1,100),cameraMode:'front',zoomLevel:.7,cameraYaw:.2,cameraElevation:.7,reducedMotion:false});
 view.updateCamera();const before={position:view.camera.position.toArray(),rotation:view.camera.quaternion.toArray()};
 view.combatFocus=new THREE.Vector3(1,.46,-2);view.activeAnimation={metrics:{progress:.62,cameraPunch:1},cancel(){}};
 view.updateCamera();assert(view.camera.position.distanceTo(new THREE.Vector3(...before.position))>1);
 assert.equal(view.zoomLevel,.7);assert.equal(view.cameraYaw,.2);assert.equal(view.cameraElevation,.7);
 view.cancelAnimations();assert.deepEqual(view.camera.position.toArray(),before.position);assert.deepEqual(view.camera.quaternion.toArray(),before.rotation);
 view.combatFocus=new THREE.Vector3(1,.46,-2);view.activeAnimation={metrics:{progress:.62,cameraPunch:1},cancel(){}};
 view.orbit(.3,0);const manual=view.camera.position.toArray();view.updateCamera();assert.deepEqual(view.camera.position.toArray(),manual);
 view.cancelAnimations();assert.deepEqual(view.camera.position.toArray(),manual);
});

test('reduced motion skips combat camera even while impact metrics exist',async()=>{
 const THREE=await import('../vendor/three/three.module.js'),view=Object.create(GameRenderer.prototype);
 Object.assign(view,{camera:new THREE.PerspectiveCamera(38,.5,.1,100),cameraMode:'top',zoomLevel:.9,cameraYaw:0,cameraElevation:1.4,reducedMotion:true});
 view.updateCamera();const before=view.camera.position.toArray();view.combatFocus=new THREE.Vector3(3,.46,3);view.activeAnimation={metrics:{progress:.62,cameraPunch:1}};
 view.updateCamera();assert.deepEqual(view.camera.position.toArray(),before);
});
