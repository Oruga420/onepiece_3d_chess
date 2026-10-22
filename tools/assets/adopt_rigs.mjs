// Adopt reviewed offline rigs without changing their paid source provenance.
// All candidates are validated before any published asset is replaced.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const staging=path.join(root,'.local/rigging');
const manifestPath=path.join(root,'assets/models/manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const args=process.argv.slice(2),apply=args.includes('--apply');
const ids=args.includes('--all')?manifest.assets.map(a=>a.id):args.filter(a=>!a.startsWith('--'));
assert(ids.length,'Specify reviewed crew/role IDs or --all; add --apply to publish locally');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function readGLB(filename){
 const bytes=fs.readFileSync(filename);
 assert.equal(bytes.readUInt32LE(0),0x46546c67);
 assert.equal(bytes.readUInt32LE(8),bytes.length);
 const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length));
 return {bytes,json,bin:bytes.subarray(28+length)};
}
function images({json,bin}){return json.images.map(image=>{
 assert(image.bufferView!==undefined,'Embedded original textures required');
 const view=json.bufferViews[image.bufferView],start=view.byteOffset||0;
 return sha(bin.subarray(start,start+view.byteLength));
}).sort();}
function triangles({json}){return json.meshes.reduce((sum,mesh)=>sum+mesh.primitives.reduce((n,p)=>n+json.accessors[p.indices??p.attributes.POSITION].count/3,0),0);}
const prepared=ids.map(id=>{
 const asset=manifest.assets.find(a=>a.id===id);assert(asset,'Unknown slot '+id);
 const original=readGLB(path.join(staging,'originals',id+'.glb'));
 const candidate=readGLB(path.join(staging,'candidates',id+'.glb'));
 const report=JSON.parse(fs.readFileSync(path.join(staging,'reviews',id,'metrics.json'),'utf8'));
 assert.equal(report.originalSha256,sha(original.bytes),id+' original backup');
 assert.equal(report.sha256,sha(candidate.bytes),id+' candidate matches rig report');
 const destination=path.join(root,asset.path.replace(/^\//,''));
 const current=sha(fs.readFileSync(destination));
 assert([sha(original.bytes),sha(candidate.bytes)].includes(current),id+' changed since rigging');
 assert.deepEqual(images(candidate),images(original),id+' original embedded texture bytes');
 assert.equal(triangles(candidate),triangles(original),id+' original triangles');
 assert(candidate.json.skins?.length,id+' skin required');
 const boneNames=new Set(candidate.json.skins.flatMap(s=>s.joints.map(i=>candidate.json.nodes[i].name)));
 assert(boneNames.size>=17,id+' articulated skeleton');
 for(const mesh of candidate.json.meshes)for(const p of mesh.primitives){
  assert(p.attributes.JOINTS_0!==undefined&&p.attributes.WEIGHTS_0!==undefined,id+' weighted geometry');
 }
 return {asset,id,original,candidate,report,destination,boneNames};
});
for(const {asset,id,original,candidate,report,destination,boneNames} of prepared){
 if(apply){
  fs.copyFileSync(path.join(staging,'candidates',id+'.glb'),destination);
  asset.sha256=sha(candidate.bytes);asset.bytes=candidate.bytes.length;
  const rigMetadata=candidate.json.nodes.find(node=>node.extras?.combatRig)?.extras.combatRig||{};
  asset.rig={version:1,method:'offline-fitted-armature',joints:boneNames.size,
   originalOptimizedSha256:sha(original.bytes),trianglesPreserved:true,texturesPreserved:true,
   motionProfile:rigMetadata.motionProfile||report.motionProfile||'humanoid',missingLimbs:rigMetadata.missingLimbs||[]};
 }
 console.log((apply?'RIG_ADOPTED ':'RIG_VALIDATED ')+id+' joints='+boneNames.size+' bytes='+candidate.bytes.length);
}
if(apply)fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
