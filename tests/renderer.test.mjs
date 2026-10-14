import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRenderer} from '../src/renderer.mjs';
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
