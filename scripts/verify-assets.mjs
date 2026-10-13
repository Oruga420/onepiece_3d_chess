import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Box3,Matrix4,Quaternion,Vector3} from '../vendor/three/three.module.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/models/manifest.json'),'utf8'));
const strict=process.argv.includes('--strict');
const ledgerPath=path.join(root,'docs/reports/assets-ledger.json');
const ledger=fs.existsSync(ledgerPath)?JSON.parse(fs.readFileSync(ledgerPath,'utf8')):null;
const errors=[];
let valid=0, missing=0;
const ids=new Set();
const hashes=new Map(),taskIds=new Set();
function worldBounds(gltf){
  const bounds=new Box3();
  const visit=(index,parent,ancestors)=>{
    if(ancestors.has(index))throw Error('cyclic scene graph');
    const node=gltf.nodes[index];
    if(!node)throw Error('missing scene node');
    const local=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(
      new Vector3().fromArray(node.translation??[0,0,0]),
      new Quaternion().fromArray(node.rotation??[0,0,0,1]),
      new Vector3().fromArray(node.scale??[1,1,1]));
    const world=new Matrix4().multiplyMatrices(parent,local);
    if(node.mesh!==undefined)for(const primitive of gltf.meshes[node.mesh].primitives){
      const accessor=gltf.accessors[primitive.attributes.POSITION];
      if(!accessor.min||!accessor.max)throw Error('missing geometry bounds');
      for(let mask=0;mask<8;mask++)bounds.expandByPoint(new Vector3(
        mask&1?accessor.max[0]:accessor.min[0],
        mask&2?accessor.max[1]:accessor.min[1],
        mask&4?accessor.max[2]:accessor.min[2]).applyMatrix4(world));
    }
    const next=new Set(ancestors).add(index);
    for(const child of node.children??[])visit(child,world,next);
  };
  for(const index of gltf.scenes[gltf.scene??0].nodes)visit(index,new Matrix4(),new Set());
  return bounds;
}
for(const asset of manifest.assets){
  const problems=[];
  if(ids.has(asset.id)) problems.push('duplicate slot');
  ids.add(asset.id);
  const filename=path.join(root,asset.path.replace(/^\//,''));
  if(!fs.existsSync(filename)){missing++;continue;}
  try {
    const bytes=fs.readFileSync(filename);
    if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length) throw Error('invalid GLB header');
    if(bytes.readUInt32LE(16)!==0x4e4f534a) throw Error('missing JSON chunk');
    const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString().trim());
    if(!gltf.scenes?.length||!gltf.nodes?.length||!gltf.scenes[gltf.scene??0]?.nodes?.length) problems.push('missing scene graph');
    let triangles=0, volumetric=false;
    for(const mesh of gltf.meshes??[]) for(const primitive of mesh.primitives??[]){
      if((primitive.mode??4)!==4) problems.push('nontriangle mesh');
      const position=gltf.accessors[primitive.attributes.POSITION];
      if(position.min&&position.max&&position.max.every((v,i)=>v-position.min[i]>0.0001)) volumetric=true;
      triangles+=(primitive.indices===undefined?position.count:gltf.accessors[primitive.indices].count)/3;
    }
    if(!triangles||!volumetric) problems.push('empty/flat geometry');
    const bounds=worldBounds(gltf),size=bounds.getSize(new Vector3()),center=bounds.getCenter(new Vector3());
    if(Math.abs(size.y-1)>.005||Math.abs(bounds.min.y)>.005||Math.abs(center.x)>.005||Math.abs(center.z)>.005)problems.push('normalization must be height1/floorY0/centerXZ0');
    if(triangles>15000) problems.push('triangle cap');
    if(bytes.length>12*1024*1024) problems.push('byte cap');
    if(!gltf.images?.length||!gltf.textures?.length||!gltf.materials?.some(m=>m.pbrMetallicRoughness?.baseColorTexture)) problems.push('missing textured material');
    if(gltf.images?.some(image=>image.bufferView===undefined&&!image.uri?.startsWith('data:'))) problems.push('external texture dependency');
    const sha=crypto.createHash('sha256').update(bytes).digest('hex');
    if(asset.sha256!==sha) problems.push('checksum mismatch');
    if(hashes.has(sha))problems.push(`duplicate model geometry/texture bytes with ${hashes.get(sha)}`);
    hashes.set(sha,asset.id);
    if(asset.provider!=='meshy'||!asset.taskId||asset.credits!==15||!asset.referenceSha256) problems.push('missing provider provenance');
    if(taskIds.has(asset.taskId))problems.push('duplicate provider task ID');
    taskIds.add(asset.taskId);
    if(!asset.textures?.length||asset.textures.some(t=>Math.max(t.width,t.height)>2048)) problems.push('texture cap/proof');
    if(strict&&(asset.review?.status!=='approved'||asset.review?.views?.length!==4)) problems.push('visual review pending');
    if(strict){
      const modelOperation=ledger?.operations?.[`${asset.id}:model`];
      if(modelOperation?.taskId!==asset.taskId||modelOperation?.state!=='downloaded'||modelOperation?.credits!==15)problems.push('unsettled/mismatched provider operation');
      for(const [relative,expected,label] of [
        [asset.referenceImage,asset.referenceSha256,'reference'],
        [`tools/assets/raw/${asset.id}.glb`,asset.rawSha256,'raw paid output']]){
        const proof=relative&&path.join(root,relative.replace(/^\//,''));
        if(!proof||!expected||!fs.existsSync(proof))problems.push(`missing ${label} provenance`);
        else if(crypto.createHash('sha256').update(fs.readFileSync(proof)).digest('hex')!==expected)problems.push(`${label} checksum mismatch`);
      }
    }
    if(strict&&asset.review?.status==='approved'){
      if(!fs.existsSync(path.join(root,asset.review.sheet??'missing-sheet'))) problems.push('missing review sheet');
      for(const view of ['front','side','back','board'])if(!fs.existsSync(path.join(root,'tools/assets/reviews',asset.id,`${view}.png`)))problems.push(`missing ${view} evidence`);
    }
    if(!problems.length)valid++;
  } catch(error){problems.push(error.message);}
  if(problems.length) errors.push({id:asset.id,problems});
}
const crews=['mugiwara','buggy','shanks','bigmom','kaido','doflamingo','heart','kid','blackbeard','whitebeard','marines'];
for(const crew of crews)for(const role of ['king','queen','rook','bishop','knight','pawn'])if(!ids.has(`${crew}/${role}`))errors.push({id:`${crew}/${role}`,problems:['missing slot']});
for(const crew of crews.filter(c=>c!=='marines')){
  const active=manifest.assets.filter(a=>a.crew===crew||a.crew==='marines');
  if(active.reduce((n,a)=>n+(a.bytes??0),0)>120*1024*1024)errors.push({id:crew,problems:['active download cap']});
  if(active.reduce((n,a)=>n+(a.textures??[]).reduce((s,t)=>s+t.width*t.height*4*4/3,0),0)>256*1024*1024)errors.push({id:crew,problems:['active texture cap']});
}
const result={required:66,valid,missing,fallback:0,errors};
if(strict){
  const operations=Object.values(ledger?.operations??{});
  if(!ledger||operations.reduce((n,op)=>n+op.reservedUSD,0)>26.4+1e-8||operations.reduce((n,op)=>n+(op.credits??0),0)>1005)errors.push({id:'budget',problems:['asset USD/credits cap or ledger missing']});
}
fs.mkdirSync(path.join(root,'docs/reports'),{recursive:true});
fs.writeFileSync(path.join(root,'docs/reports/assets-validation.json'),JSON.stringify(result,null,2));
if(valid===66&&missing===0&&errors.length===0&&manifest.assets.length===66)console.log('ASSETS_OK required=66 valid=66 missing=0 fallback=0');
else {console.error('ASSETS_INCOMPLETE',JSON.stringify(result));process.exitCode=1;}
