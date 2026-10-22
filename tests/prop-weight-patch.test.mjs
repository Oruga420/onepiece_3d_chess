import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {applyPropWeights} from '../tools/assets/apply_prop_weights.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(rigged=false) {
 const points=[[0,0,0],[.1,0,0],[0,.1,0],[1,0,0],[1.1,0,0],[1,.1,0],[1,0,0],[2,0,0],[2.1,0,0],[2,.1,0]];
 const json={asset:{version:'2.0'},buffers:[{byteLength:0}],bufferViews:[],accessors:[],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{},mode:4}]}],images:[]};
 const chunks=[];let length=0;
 const add=(values,type,componentType)=>{
  const size=componentType===5121?1:componentType===5123?2:4, flat=values.flat(), buf=Buffer.alloc(Math.ceil(flat.length*size/4)*4);
  flat.forEach((v,i)=>buf[componentType===5121?'writeUInt8':componentType===5123?'writeUInt16LE':'writeFloatLE'](v,i*size));
  const view=json.bufferViews.push({buffer:0,byteOffset:length,byteLength:flat.length*size})-1;chunks.push(buf);length+=buf.length;
  return json.accessors.push({bufferView:view,componentType,count:values.length,type})-1;
 };
 const primitive=json.meshes[0].primitives[0];primitive.attributes.POSITION=add(points,'VEC3',5126);primitive.attributes.NORMAL=add(points.map(()=>[0,1,0]),'VEC3',5126);primitive.attributes.TEXCOORD_0=add(points.map(()=>[.2,.8]),'VEC2',5126);primitive.indices=add([0,1,2,3,4,5,6,4,5,7,8,9],'SCALAR',5123);
 if(rigged){
  primitive.attributes.JOINTS_0=add(points.map(()=>[0,2,0,0]),'VEC4',5121);primitive.attributes.WEIGHTS_0=add(points.map(()=>[.75,.25,0,0]),'VEC4',5126);
  json.nodes[0].skin=0;json.nodes.push(...['hips','hand.L','hand.R'].map(name=>({name})));
  json.skins=[{joints:[1,2,3],inverseBindMatrices:add([0,1,2].map(()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),'MAT4',5126)}];
 }
 const texture=Buffer.from('exact embedded texture payload!!');json.images=[{bufferView:json.bufferViews.length,mimeType:'image/png'}];json.bufferViews.push({buffer:0,byteOffset:length,byteLength:texture.length});chunks.push(texture);length+=texture.length;
 const padding=Buffer.alloc((4-length%4)%4);chunks.push(padding);length+=padding.length;json.buffers[0].byteLength=length;
 const text=Buffer.from(JSON.stringify(json)), padded=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]), binary=Buffer.concat(chunks), buffer=Buffer.alloc(12+8+padded.length+8+binary.length);
 buffer.writeUInt32LE(0x46546c67,0);buffer.writeUInt32LE(2,4);buffer.writeUInt32LE(buffer.length,8);buffer.writeUInt32LE(padded.length,12);buffer.writeUInt32LE(0x4e4f534a,16);padded.copy(buffer,20);
 const binaryStart=28+padded.length;buffer.writeUInt32LE(binary.length,binaryStart-8);buffer.writeUInt32LE(0x004e4942,binaryStart-4);binary.copy(buffer,binaryStart);
 const range=name=>{const a=json.accessors[primitive.attributes[name]],view=json.bufferViews[a.bufferView];return {start:binaryStart+view.byteOffset,length:view.byteLength};};
 return {buffer,json,range};
}
function recipe(source) {
 const component=(x,bone)=>({bone,seed:[x,0,0],minVertices:3,maxVertices:3,maxExtent:.101,expectedBounds:{min:[x,0,0],max:[x+.1,0,.1]}});
 return {sourceSha256:hash(source),weldDistance:1e-6,rigidComponents:[component(1,'hand.L'),{...component(2,'hand.R'),surfaceSeed:[1,0,0]}]};
}

test('only selected skin bytes change; duplicate UV vertices and surface snapshots stay consistent',()=>{
 const source=fixture(), candidate=fixture(true), original=Buffer.from(candidate.buffer), r=recipe(source.buffer);
 const result=applyPropWeights(source.buffer,candidate.buffer,r), joints=candidate.range('JOINTS_0'),weights=candidate.range('WEIGHTS_0');
 assert.deepEqual(candidate.buffer,original,'caller input remains immutable');
 assert(result.provenance.changedBytes>0);assert.equal(result.provenance.selectedSourceVertices,6);assert.equal(result.provenance.patchedCandidateRows,7);
 for(let i=0;i<original.length;i++)if(original[i]!==result.buffer[i])assert((i>=joints.start&&i<joints.start+joints.length)||(i>=weights.start&&i<weights.start+weights.length));
 for(const row of [3,4,5,6]){assert.equal(result.buffer.readUInt8(joints.start+row*4),1);assert.equal(result.buffer.readFloatLE(weights.start+row*16),1);}
 for(const row of [7,8,9]){assert.equal(result.buffer.readUInt8(joints.start+row*4+1),2);assert.equal(result.buffer.readFloatLE(weights.start+row*16),.75);assert.equal(result.buffer.readFloatLE(weights.start+row*16+4),.25);}
 assert.deepEqual(result.buffer.subarray(weights.start,weights.start+48),original.subarray(weights.start,weights.start+48),'body weights unchanged');
});

test('bad source hashes, components, missing bones and off-surface points fail closed',()=>{
 const source=fixture(),candidate=fixture(true),r=recipe(source.buffer);
 assert.throws(()=>applyPropWeights(source.buffer,candidate.buffer,{...r,sourceSha256:'wrong'}),/Source hash/);
 for(const [key,value,pattern] of [['maxVertices',2,/count mismatch/],['maxExtent',.01,/extent mismatch/],['bone','missing',/Missing or ambiguous bone/],['seed',[9,9,9],/does not match/]]) {
  const edited=structuredClone(r);edited.rigidComponents[0][key]=value;assert.throws(()=>applyPropWeights(source.buffer,candidate.buffer,edited),pattern);
 }
 const painted={sourceSha256:r.sourceSha256,rigidVertexSets:[{bone:'hand.L',points:[[1,0,0],[1.1,0,0],[1,0,.1]],expectedVertices:3}]};
 assert.equal(applyPropWeights(source.buffer,candidate.buffer,painted).provenance.patchedCandidateRows,4);
 painted.rigidVertexSets[0].expectedVertices=4;assert.throws(()=>applyPropWeights(source.buffer,candidate.buffer,painted),/Painted prop vertex count/);
});

test('real frozen character recipes preserve every byte outside joint/weight accessors',{skip:!process.env.PROP_PATCH_PROOF_ROOT},()=>{
 const root=process.env.PROP_PATCH_PROOF_ROOT, recipes=JSON.parse(fs.readFileSync(path.join(root,'tools/assets/prop_bindings.json')));
 for(const id of ['whitebeard/knight','heart/queen']) {
  const source=fs.readFileSync(path.join(root,'.local/rigging/originals',id+'.glb')), candidate=fs.readFileSync(path.join(root,'.local/rigging/candidates',id+'.glb'));
  const before=hash(candidate),result=applyPropWeights(source,candidate,recipes[id]);assert.equal(hash(candidate),before);assert(result.provenance.patchedCandidateRows>0);assert(result.provenance.onlySelectedJointWeightBytesChanged);
  const jsonLength=candidate.readUInt32LE(12),json=JSON.parse(candidate.subarray(20,20+jsonLength)),binaryStart=28+jsonLength,allowed=new Uint8Array(candidate.length);
  for(const primitive of json.meshes.flatMap(mesh=>mesh.primitives))for(const name of ['JOINTS_0','WEIGHTS_0']) {
   const attribute=json.accessors[primitive.attributes[name]],view=json.bufferViews[attribute.bufferView],size={5121:1,5123:2,5126:4}[attribute.componentType];
   for(let row=0;row<attribute.count;row++){const offset=binaryStart+(view.byteOffset||0)+(attribute.byteOffset||0)+row*(view.byteStride||size*4);allowed.fill(1,offset,offset+size*4);}
  }
  assert.equal(result.buffer.length,candidate.length);
  for(let byte=0;byte<candidate.length;byte++)if(result.buffer[byte]!==candidate[byte])assert.equal(allowed[byte],1,`${id}: unexpected changed byte ${byte}`);
  assert.throws(()=>applyPropWeights(source,candidate,{...recipes[id],sourceSha256:'wrong'}),/Source hash/);
 }
});
