/** Patch curated prop skin weights without exporting or changing a GLB surface.
 * node tools/assets/apply_prop_weights.mjs --id crew/role --source original.glb
 *   --input candidate.glb --recipes prop_bindings.json --output patched.glb
 * Output and its .provenance.json must not already exist. All work is offline.
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Matrix4, Quaternion, Vector3} from '../../vendor/three/three.module.js';

const sha = data => createHash('sha256').update(data).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const distance = (a,b) => Math.hypot(...a.map((v,i)=>v-b[i]));
const formats = {5121:['readUInt8','writeUInt8',1],5123:['readUInt16LE','writeUInt16LE',2],5125:['readUInt32LE','writeUInt32LE',4],5126:['readFloatLE','writeFloatLE',4]};
const widths = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};

function parse(buffer) {
 requireValue(buffer.length >= 20 && buffer.readUInt32LE(0)===0x46546c67 && buffer.readUInt32LE(4)===2 && buffer.readUInt32LE(8)===buffer.length,'Invalid GLB');
 let json, binaryStart, binaryLength;
 for(let cursor=12;cursor<buffer.length;) {
  const length=buffer.readUInt32LE(cursor), kind=buffer.readUInt32LE(cursor+4);
  requireValue(cursor+8+length<=buffer.length,'Truncated GLB chunk');
  if(kind===0x4e4f534a) { requireValue(!json,'Duplicate JSON'); json=JSON.parse(buffer.subarray(cursor+8,cursor+8+length).toString()); }
  if(kind===0x004e4942) { requireValue(binaryStart===undefined,'Duplicate BIN'); binaryStart=cursor+8; binaryLength=length; }
  cursor+=8+length;
 }
 requireValue(json && binaryStart!==undefined && json.buffers?.length===1 && !json.buffers[0].uri,'Expected embedded GLB');
 function accessor(index) {
  const a=json.accessors?.[index], view=json.bufferViews?.[a?.bufferView];
  requireValue(a && view && !a.sparse && !a.normalized && view.buffer===0 && formats[a.componentType] && widths[a.type],'Unsupported accessor');
  const [read,write,size]=formats[a.componentType], width=widths[a.type], stride=view.byteStride||size*width;
  const relative=(view.byteOffset||0)+(a.byteOffset||0), start=binaryStart+relative;
  requireValue(stride>=width*size && a.count>0 && relative+(a.count-1)*stride+width*size<=binaryLength,'Accessor exceeds buffer');
  return {a,start,size,width,stride,read,write, rows:Array.from({length:a.count},(_,i)=>Array.from({length:width},(_,j)=>buffer[read](start+i*stride+j*size)))};
 }
 const parents=new Map();
 json.nodes.forEach((node,i)=>(node.children||[]).forEach(child=>{ requireValue(!parents.has(child),'Multiple node parents'); parents.set(child,i); }));
 const worlds=new Map(), visiting=new Set();
 function world(i) {
  if(worlds.has(i)) return worlds.get(i);
  requireValue(!visiting.has(i),'Cyclic nodes'); visiting.add(i);
  const n=json.nodes[i], local=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3().fromArray(n.translation||[0,0,0]),new Quaternion().fromArray(n.rotation||[0,0,0,1]),new Vector3().fromArray(n.scale||[1,1,1]));
  const value=parents.has(i)?world(parents.get(i)).clone().multiply(local):local;
  visiting.delete(i); worlds.set(i,value); return value;
 }
 const meshNodes=json.nodes.map((node,index)=>({node,index})).filter(({node})=>node.mesh!==undefined);
 requireValue(meshNodes.length===1,'Expected one character mesh node');
 const {node,index}=meshNodes[0], primitives=json.meshes[node.mesh].primitives;
 requireValue(primitives.length===1 && (primitives[0].mode??4)===4,'Expected one triangle primitive');
 const primitive=primitives[0], position=accessor(primitive.attributes.POSITION);
 requireValue(position.width===3 && position.a.componentType===5126,'Expected float positions');
 const points=position.rows.map(p=>new Vector3().fromArray(p).applyMatrix4(world(index)).toArray());
 requireValue(points.flat().every(Number.isFinite),'Non-finite geometry');
 const indices=primitive.indices===undefined?points.map((_,i)=>i):accessor(primitive.indices).rows.flat();
 requireValue(indices.length%3===0 && indices.every(i=>Number.isInteger(i)&&i>=0&&i<points.length),'Invalid triangles');
 return {buffer,json,node,primitive,accessor,points,indices,binaryStart};
}

function spatial(points, cell) {
 const buckets=new Map(), key=p=>p.map(x=>Math.floor(x/cell));
 points.forEach((p,i)=>{const k=key(p).join(','); if(!buckets.has(k))buckets.set(k,[]); buckets.get(k).push(i);});
 return (point,tolerance) => {
  const c=key(point), reach=Math.ceil(tolerance/cell), found=[];
  for(let x=-reach;x<=reach;x++)for(let y=-reach;y<=reach;y++)for(let z=-reach;z<=reach;z++)
   for(const i of buckets.get([c[0]+x,c[1]+y,c[2]+z].join(','))||[])if(distance(point,points[i])<=tolerance)found.push(i);
  return found.sort((a,b)=>distance(point,points[a])-distance(point,points[b])||a-b);
 };
}

function sourceMesh(source,weldDistance) {
 const points=source.points.map(([x,y,z])=>[x,-z,y]), near=spatial(points,weldDistance);
 const parents=points.map((_,i)=>i), find=i=>parents[i]===i?i:(parents[i]=find(parents[i]));
 const union=(a,b)=>{a=find(a);b=find(b);if(a!==b)parents[Math.max(a,b)]=Math.min(a,b);};
 points.forEach((p,i)=>near(p,weldDistance).forEach(j=>union(i,j)));
 const roots=[...new Set(points.map((_,i)=>find(i)))], rootIndex=new Map(roots.map((r,i)=>[r,i]));
 const welded=roots.map(r=>points[r]), map=points.map((_,i)=>rootIndex.get(find(i)));
 const links=welded.map(()=>new Set());
 for(let i=0;i<source.indices.length;i+=3) {
  const triangle=source.indices.slice(i,i+3).map(v=>map[v]);
  triangle.forEach((a,j)=>{const b=triangle[(j+1)%3];links[a].add(b);links[b].add(a);});
 }
 const components=[], componentOf=[];
 welded.forEach((_,i)=>{if(componentOf[i]!==undefined)return;const group=[],stack=[i];componentOf[i]=components.length;
  while(stack.length){const v=stack.pop();group.push(v);for(const n of links[v])if(componentOf[n]===undefined){componentOf[n]=components.length;stack.push(n);}}
  components.push(group);
 });
 return {points:welded,components,componentOf,near:spatial(welded,1e-5)};
}

export function applyPropWeights(sourceBuffer,inputBuffer,recipe) {
 requireValue(recipe && sha(sourceBuffer)===recipe.sourceSha256,'Source hash mismatch');
 requireValue((recipe.weldDistance??1e-6)===1e-6,'Unsupported weld distance');
 const source=parse(sourceBuffer), input=parse(inputBuffer), mesh=sourceMesh(source,1e-6);
 const joints=input.accessor(input.primitive.attributes.JOINTS_0), weights=input.accessor(input.primitive.attributes.WEIGHTS_0);
 requireValue(joints.width===4 && [5121,5123].includes(joints.a.componentType) && weights.width===4 && weights.a.componentType===5126 && joints.rows.length===input.points.length && weights.rows.length===input.points.length,'Expected matching joint/float-weight VEC4 attributes');
 const skinBytes=new Uint8Array(inputBuffer.length);
 for(const attribute of [joints,weights])for(let row=0;row<attribute.rows.length;row++)for(let b=0;b<attribute.width*attribute.size;b++) {
  const offset=attribute.start+row*attribute.stride+b;requireValue(!skinBytes[offset],'Overlapping skin accessors');skinBytes[offset]=1;
 }
 input.json.accessors.forEach((_,index)=>{
  if([input.primitive.attributes.JOINTS_0,input.primitive.attributes.WEIGHTS_0].includes(index))return;
  const attribute=input.accessor(index);
  for(let row=0;row<attribute.rows.length;row++)for(let b=0;b<attribute.width*attribute.size;b++)requireValue(!skinBytes[attribute.start+row*attribute.stride+b],'Skin overlaps another accessor');
 });
 for(const image of input.json.images||[])if(image.bufferView!==undefined) {
  const view=input.json.bufferViews[image.bufferView], start=input.binaryStart+(view.byteOffset||0);
  requireValue(!skinBytes.subarray(start,start+view.byteLength).some(Boolean),'Skin overlaps embedded image');
 }
 const skin=input.json.skins?.[input.node.skin];requireValue(skin,'Missing skin');
 const names=skin.joints.map(i=>input.json.nodes[i].name), assignments=new Map(), details=[];
 const nearest=(point,tolerance,label)=>{requireValue(tolerance>0&&tolerance<=1e-5,'Tolerance exceeds strict 1e-5');const hits=mesh.near(point,tolerance);requireValue(hits.length,label+' does not match source geometry');return hits[0];};
 const boneIndex=bone=>{const i=names.indexOf(bone);requireValue(i>=0&&names.lastIndexOf(bone)===i,'Missing or ambiguous bone '+bone);return i;};
 const assign=(vertices,binding)=>vertices.forEach(v=>{requireValue(!assignments.has(v)||JSON.stringify(assignments.get(v))===JSON.stringify(binding),'Conflicting prop assignments');assignments.set(v,binding);});
 for(const entry of recipe.rigidComponents||[]) {
  boneIndex(entry.bone);
  const selected=nearest(entry.seed,entry.maxSeedDistance??1e-5,'Prop seed'), group=mesh.components[mesh.componentOf[selected]];
  requireValue(group.length>=(entry.minVertices??1)&&group.length<=entry.maxVertices,'Prop component count mismatch');
  const bounds={min:[0,1,2].map(axis=>Math.min(...group.map(i=>mesh.points[i][axis]))),max:[0,1,2].map(axis=>Math.max(...group.map(i=>mesh.points[i][axis])))};
  requireValue(Math.max(...bounds.min.map((v,i)=>bounds.max[i]-v))<=entry.maxExtent,'Prop component extent mismatch');
  const tolerance=entry.boundsTolerance??1e-5;requireValue(tolerance<=1e-5,'Bounds tolerance exceeds strict 1e-5');
  requireValue(['min','max'].every(key=>bounds[key].every((v,i)=>Math.abs(v-entry.expectedBounds[key][i])<=tolerance)),'Prop component bounds mismatch');
  let binding={bone:entry.bone};
  if(entry.surfaceSeed) {const surface=nearest(entry.surfaceSeed,entry.maxSurfaceSeedDistance??1e-5,'Surface seed');requireValue(!group.includes(surface),'Surface seed cannot sample own prop');binding={surface};}
  assign(group,binding);details.push({kind:'component',vertices:group.length,bone:entry.bone});
 }
 for(const entry of recipe.rigidVertexSets||[]) {
  boneIndex(entry.bone);
  const selected=[...new Set(entry.points.map(p=>nearest(p,entry.maxPointDistance??1e-5,'Painted prop vertex')))];
  requireValue(selected.length===entry.expectedVertices,'Painted prop vertex count mismatch');assign(selected,{bone:entry.bone});details.push({kind:'vertexSet',vertices:selected.length,bone:entry.bone});
 }
 requireValue(assignments.size,'No curated assignments');
 // Snapshot every candidate match before writes. UV seams must resolve to the
 // same source position; ambiguous nearby geometry is rejected rather than painted.
 const rowsBySource=new Map();
 input.points.forEach(([x,y,z],row)=>{
  const p=[x,-z,y], hits=mesh.near(p,1e-5);requireValue(hits.length,'Candidate rest position does not match source');
  const nearestDistance=distance(p,mesh.points[hits[0]]);
  requireValue(!hits.slice(1).some(i=>Math.abs(distance(p,mesh.points[i])-nearestDistance)<1e-9&&JSON.stringify(assignments.get(i))!==JSON.stringify(assignments.get(hits[0]))),'Ambiguous candidate source position');
  const sourceIndex=hits[0];if(!rowsBySource.has(sourceIndex))rowsBySource.set(sourceIndex,[]);rowsBySource.get(sourceIndex).push(row);
 });
 const snapshot=new Map();
 for(const binding of assignments.values())if(binding.surface!==undefined&&!snapshot.has(binding.surface)) {
  const rows=rowsBySource.get(binding.surface);requireValue(rows?.length,'Surface seed missing from candidate');
  const mixes=rows.map(row=>{const mix=new Map();weights.rows[row].forEach((w,k)=>{requireValue(Number.isFinite(w)&&w>=0&&joints.rows[row][k]<names.length,'Invalid surface skin weight');if(w)mix.set(joints.rows[row][k],(mix.get(joints.rows[row][k])||0)+w);});return [...mix].sort((a,b)=>a[0]-b[0]);});
  requireValue(mixes.every(m=>m.length===mixes[0].length&&m.every(([j,w],i)=>j===mixes[0][i][0]&&Math.abs(w-mixes[0][i][1])<=1e-6)),'Ambiguous coincident surface weights');
  const total=mixes[0].reduce((s,[,w])=>s+w,0);requireValue(total>0&&mixes[0].length<=4,'Surface seed has no valid weights');snapshot.set(binding.surface,mixes[0].map(([j,w])=>[j,w/total]));
 }
 const output=Buffer.from(inputBuffer), allowed=new Uint8Array(output.length);let patchedRows=0;
 for(const [sourceIndex,binding] of assignments) {
  const rows=rowsBySource.get(sourceIndex);requireValue(rows?.length,'Selected prop vertex missing from candidate');
  const mix=binding.bone?[[boneIndex(binding.bone),1]]:snapshot.get(binding.surface);
  for(const row of rows) {for(let k=0;k<4;k++)for(const [accessor,value] of [[joints,mix[k]?.[0]??0],[weights,mix[k]?.[1]??0]]) {
   const offset=accessor.start+row*accessor.stride+k*accessor.size;output[accessor.write](value,offset);allowed.fill(1,offset,offset+accessor.size);
  }patchedRows++;}
 }
 // A byte-level invariant covers JSON, triangles, texture payloads, every rest
 // transform and inverse bind, and all unselected body weights.
 let changedBytes=0;
 for(let i=0;i<output.length;i++)if(output[i]!==inputBuffer[i]){requireValue(allowed[i]===1,'Changed non-weight byte');changedBytes++;}
 return {buffer:output,provenance:{sourceSha256:sha(sourceBuffer),inputSha256:sha(inputBuffer),outputSha256:sha(output),recipeSha256:sha(JSON.stringify(recipe)),selectedSourceVertices:assignments.size,patchedCandidateRows:patchedRows,changedBytes,onlySelectedJointWeightBytesChanged:true,details}};
}

if(typeof process!=='undefined'&&process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 const args={};for(let i=2;i<process.argv.length;i+=2){requireValue(process.argv[i].startsWith('--')&&process.argv[i+1],'Expected --key value');args[process.argv[i].slice(2)]=process.argv[i+1];}
 for(const key of ['id','source','input','recipes','output'])requireValue(args[key],'Missing --'+key);
 const output=path.resolve(args.output), report=output+'.provenance.json';
 requireValue(![args.source,args.input,args.recipes].some(p=>path.resolve(p).toLowerCase()===output.toLowerCase()),'Output must be separate');
 requireValue(!fs.existsSync(output)&&!fs.existsSync(report),'Output already exists');
 const recipes=JSON.parse(fs.readFileSync(args.recipes)), result=applyPropWeights(fs.readFileSync(args.source),fs.readFileSync(args.input),recipes[args.id]);
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,result.buffer,{flag:'wx'});fs.writeFileSync(report,JSON.stringify({id:args.id,...result.provenance},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({id:args.id,output,report,...result.provenance}));
}
