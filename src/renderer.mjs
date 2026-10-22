import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { createMoveAnimation } from './combat.mjs';
import { getCharacterAttack } from './attacks.mjs';
import { cloneCharacter, disposeCharacterSkeletons } from './skeletal-combat.mjs';

const squarePosition = square => new THREE.Vector3(square.charCodeAt(0)-65-3.5, .146, 3.5-(Number(square[1])-1));
const disposeTree = tree => { disposeCharacterSkeletons(tree); const seen=new Set(); tree.traverse(o=>{if(o.geometry&&!seen.has(o.geometry)){seen.add(o.geometry);o.geometry.dispose();}for(const m of [o.material].flat().filter(Boolean)){if(seen.has(m))continue;seen.add(m);for(const v of Object.values(m))if(v?.isTexture&&!seen.has(v)){seen.add(v);v.dispose();}m.dispose();}}); };

export function fitCharacterModel(root) {
 const box = new THREE.Box3(), size = new THREE.Vector3();
 const measure = object => {
  // glTF may list a mesh before its armature. Initialize every bone first,
  // then update SkinnedMesh.bindMatrixInverse before reading skinned vertices.
  object.updateWorldMatrix(true,true);
  object.updateMatrixWorld(true);
  return box.setFromObject(object,true);
 };
 measure(root).getSize(size);
 root.scale.multiplyScalar(Math.min(.9/Math.max(size.y,.001),.72/Math.max(size.x,size.z,.001)));
 measure(root);
 const center = box.getCenter(new THREE.Vector3());
 root.position.sub(new THREE.Vector3(center.x,box.min.y,center.z));
 const wrapper = new THREE.Group();wrapper.add(root);
 measure(wrapper).getSize(size);
 wrapper.userData.combatBounds={halfWidth:size.x/2,halfDepth:size.z/2,height:size.y};
 wrapper.traverse(object=>{
  if(object.isSkinnedMesh){object.computeBoundingBox();object.computeBoundingSphere();}
  if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}
 });
 return wrapper;
}
export class GameRenderer {
 constructor({canvas,onSquare=()=>{},onReady=()=>{}}){
  this.canvas=canvas;this.onSquare=onSquare;this.onReady=onReady;this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#071d26');this.scene.fog=new THREE.FogExp2('#071d26',.023);this.camera=new THREE.PerspectiveCamera(38,1,.1,100);this.cameraMode='front';this.zoomLevel=.9;this.cache=new Map();this.pieces=new Map();this.generation=0;this.combatMetrics=null;this.reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;this.metrics={loadedModels:0,missingModels:[],pieceCount:0,frameMs:0};
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;this.renderer.outputColorSpace=THREE.SRGBColorSpace;
  this.scene.add(new THREE.HemisphereLight('#c6f6f4','#172626',2));const sun=new THREE.DirectionalLight('#ffe0ae',3.5);sun.position.set(-4,12,4);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-7,right:7,top:7,bottom:-7});sun.shadow.bias=-.001;this.scene.add(sun);const rim=new THREE.DirectionalLight('#5ee9ff',2);rim.position.set(4,5,-5);this.scene.add(rim);
  this.boardGroup=new THREE.Group();this.scene.add(this.boardGroup);const base=new THREE.Mesh(new THREE.BoxGeometry(9,.42,9),new THREE.MeshStandardMaterial({color:'#604831',metalness:.45,roughness:.43}));base.position.y=-.13;base.receiveShadow=true;this.boardGroup.add(base);this.squareMeshes=[];
  const tileGeo=new THREE.BoxGeometry(.98,.12,.98),tileMats=[new THREE.MeshStandardMaterial({color:'#163d44',roughness:.58,metalness:.3}),new THREE.MeshStandardMaterial({color:'#c2af84',roughness:.66,metalness:.12})];
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){let sq=String.fromCharCode(65+c)+(r+1);const tile=new THREE.Mesh(tileGeo,tileMats[(r+c)%2]);tile.position.copy(squarePosition(sq));tile.position.y=.08;tile.receiveShadow=true;tile.userData.square=sq;this.squareMeshes.push(tile);this.boardGroup.add(tile);}
   for(let i=0;i<8;i++){this.label(String.fromCharCode(65+i),i-3.5,4.28);this.label(String.fromCharCode(65+i),i-3.5,-4.28);this.label(String(i+1),-4.28,3.5-i);this.label(String(i+1),4.28,3.5-i);}
   this.squareIds=this.addSquareIds();
  this.highlights=new THREE.Group();this.scene.add(this.highlights);this.pieceGroup=new THREE.Group();this.scene.add(this.pieceGroup);const sea=new THREE.Mesh(new THREE.PlaneGeometry(180,180,1,1),new THREE.MeshStandardMaterial({color:'#0b3540',roughness:.65,metalness:.35}));sea.rotation.x=-Math.PI/2;sea.position.y=-.68;sea.receiveShadow=true;this.scene.add(sea);this.sea=sea;
  const stars=[];for(let i=0;i<180;i++)stars.push((Math.random()-.5)*60,Math.random()*12-1,(Math.random()-.5)*60);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(stars,3));this.motes=new THREE.Points(g,new THREE.PointsMaterial({color:'#8ae8da',size:.035,transparent:true,opacity:.5}));this.scene.add(this.motes);
  this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.installCameraControls();this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);this.setCamera('front');this.tick=performance.now();const render=t=>{this.metrics.frameMs=t-this.tick;this.tick=t;if(!this.reducedMotion)this.motes.rotation.y=t*.000015;if(this.combatFocus)this.updateCamera();this.renderer.render(this.scene,this.camera);this.raf=requestAnimationFrame(render);};this.raf=requestAnimationFrame(render);this.resize();
 }
 label(text,x,z){const c=document.createElement('canvas');c.width=128;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#f3d39d';ctx.font='500 68px Georgia';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,64,64);const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;const m=new THREE.Mesh(new THREE.PlaneGeometry(.34,.34),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false}));m.rotation.x=-Math.PI/2;m.position.set(x,.102,z);this.boardGroup.add(m);}
 addSquareIds(){const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;const ctx=canvas.getContext('2d'),ids=[];ctx.font='500 24px Georgia';ctx.textBaseline='top';for(let row=0;row<8;row++)for(let col=0;col<8;col++){const rank=8-row,id=String.fromCharCode(65+col)+rank;ctx.fillStyle=(col+rank-1)%2?'#28484b':'#d9cdac';ctx.fillText(id,col*128+9,row*128+8);ids.push(id);}const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const overlay=new THREE.Mesh(new THREE.PlaneGeometry(8,8),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));overlay.rotation.x=-Math.PI/2;overlay.position.y=.145;this.boardGroup.add(overlay);return ids;}
 resize(){const {width,height}=this.canvas.getBoundingClientRect();if(!width||!height)return;this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.updateCamera();}
 installCameraControls(){
  const canvas=this.canvas;
  this.clearPointer=()=>{const id=this.down?.id;this.down=null;if(id!==undefined&&canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);};
  this.pointerDown=e=>{if(e.button!==0||this.down)return;this.down={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,orbit:e.ctrlKey,moved:false};canvas.setPointerCapture?.(e.pointerId);if(e.ctrlKey)e.preventDefault();};
  this.pointerMove=e=>{const down=this.down;if(!down||down.id!==e.pointerId)return;down.moved ||= Math.hypot(e.clientX-down.x,e.clientY-down.y)>8;down.orbit ||= e.ctrlKey;if(down.orbit){e.preventDefault();this.orbit((e.clientX-down.lastX)*-.006,(e.clientY-down.lastY)*.006);}down.lastX=e.clientX;down.lastY=e.clientY;};
  this.pointerUp=e=>{const down=this.down;if(!down||down.id!==e.pointerId)return;this.clearPointer();if(down.orbit||e.ctrlKey||down.moved||Math.hypot(e.clientX-down.x,e.clientY-down.y)>8)return;const rect=canvas.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)return;this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);const hit=this.raycaster.intersectObjects(this.squareMeshes)[0];if(hit)this.onSquare(hit.object.userData.square);};
  this.pointerCancel=e=>{if(this.down?.id===e.pointerId)this.clearPointer();};
  this.cameraWheel=e=>{if(!e.ctrlKey)return;e.preventDefault();const pixels=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1);this.zoom(this.zoomLevel*(Math.exp(THREE.MathUtils.clamp(pixels,-240,240)*.002)-1));};
  canvas.addEventListener('pointerdown',this.pointerDown);canvas.addEventListener('pointermove',this.pointerMove);canvas.addEventListener('pointerup',this.pointerUp);canvas.addEventListener('pointercancel',this.pointerCancel);canvas.addEventListener('lostpointercapture',this.pointerCancel);canvas.addEventListener('wheel',this.cameraWheel,{passive:false});window.addEventListener('blur',this.clearPointer);
 }
 setCamera(mode){if(!['front','top','opposite'].includes(mode))return;this.clearPointer?.();this.combatCameraSuppressed=true;this.cameraMode=mode;this.zoomLevel=.9;this.cameraYaw=mode==='opposite'?Math.atan2(-.35,-12):mode==='top'?0:Math.atan2(.35,12);this.cameraElevation=mode==='top'?Math.atan2(16,.01):Math.atan2(10,Math.hypot(.35,12));this.updateCamera();}
 updateCamera(){
  const narrow=Math.max(1,1.3/this.camera.aspect),baseDistance=(this.cameraMode==='top'?16:Math.hypot(.35,10,12))*this.zoomLevel*narrow;
  let distance=baseDistance,elevation=this.cameraElevation,yaw=this.cameraYaw;
  const target=this.cameraLookTarget??=new THREE.Vector3();target.set(0,0,0);
  const combat=this.activeAnimation?.metrics;
  if(this.combatFocus&&combat&&!this.reducedMotion&&!this.combatCameraSuppressed){
   const p=combat.progress,ease=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
   const focus=ease(p/.32)*(1-ease((p-.86)/.14));
   target.copy(this.combatFocus).multiplyScalar(focus);
   distance=THREE.MathUtils.lerp(baseDistance,Math.min(baseDistance,Math.max(4.2,baseDistance*.55)),focus);
   elevation=THREE.MathUtils.lerp(elevation,Math.min(elevation,.62),focus);
   yaw+=Math.sin(p*Math.PI)*.12*focus;
   const punch=(combat.cameraPunch||0)*focus;
   distance-=punch*.12;target.x+=Math.sin(p*137)*punch*.045;target.y+=Math.cos(p*113)*punch*.035;
  }
  const flat=Math.cos(elevation)*distance;
  this.camera.position.set(Math.sin(yaw)*flat,Math.sin(elevation)*distance,Math.cos(yaw)*flat).add(target);
  this.camera.lookAt(target);this.camera.updateMatrixWorld();
 }
 orbit(yaw,elevation){if(!Number.isFinite(yaw)||!Number.isFinite(elevation))return;this.combatCameraSuppressed=true;this.cameraYaw=Math.atan2(Math.sin(this.cameraYaw+yaw),Math.cos(this.cameraYaw+yaw));this.cameraElevation=THREE.MathUtils.clamp(this.cameraElevation+elevation,.38,Math.PI/2-.001);this.updateCamera();}
 zoom(delta){if(!Number.isFinite(delta))return;this.combatCameraSuppressed=true;this.zoomLevel=THREE.MathUtils.clamp(this.zoomLevel+delta,.35,1.5);this.updateCamera();}
 loadManifest(){
  if(!this.manifestPromise){
   const pending=fetch('assets/models/manifest.json',{cache:'no-cache'}).then(response=>{if(!response.ok)throw Error('Manifest unavailable');return response.json();});
   this.manifestPromise=pending;
   pending.catch(()=>{if(this.manifestPromise===pending)this.manifestPromise=null;});
  }
  return this.manifestPromise;
 }
 async setPosition(board,crew='mugiwara'){
  const generation=++this.generation;this.cancelAnimations();disposeCharacterSkeletons(this.pieceGroup);this.pieceGroup.clear();this.pieces.clear();this.metrics.pieceCount=0;
  if(this.crew!==crew){for(const m of this.cache.values())disposeTree(m);this.cache.clear();this.crew=crew;}
  this.metrics.missingModels=[];
  let manifest;try{manifest=await this.loadManifest();}catch(e){this.metrics.missingModels=['manifest'];this.onReady({ready:false,error:'Los modelos 3D todavía no están disponibles.'});return;}
  const entries=Array.isArray(manifest)?manifest:manifest.models||manifest.assets||manifest.entries||[];
  const lookup=(team,role)=>{let found=Array.isArray(entries)?entries.find(x=>(x.crew===team||x.team===team||x.faction===team)&&x.role===role):entries[`${team}/${role}`]||entries[`${team}:${role}`]||entries[team]?.[role];return found;};
   const roles=['king','queen','rook','bishop','knight','pawn'];const loader=new GLTFLoader();await Promise.all(['marines',crew].flatMap(team=>roles.map(async role=>{const key=`${team}/${role}`;if(this.cache.has(key))return;const entry=lookup(team,role);const url=typeof entry==='string'?entry:entry?.path||entry?.url||entry?.file||entry?.glb;if(!url||(entry.status&&entry.status!=='ready')){this.metrics.missingModels.push(key);return;}try{const gltf=await loader.loadAsync(url);if(generation!==this.generation){disposeTree(gltf.scene);return;}const wrapper=fitCharacterModel(gltf.scene);this.cache.set(key,wrapper);}catch(e){if(generation===this.generation)this.metrics.missingModels.push(key);}})));
  if(generation!==this.generation)return;
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){const piece=board[r]?.[c];if(!piece)continue;const team=piece.player==='marine'?'marines':crew;const model=this.cache.get(`${team}/${piece.type}`);if(!model)continue;const square=String.fromCharCode(65+c)+(r+1),root=new THREE.Group();const character=cloneCharacter(model);character.name='character-model';root.add(character);root.position.copy(squarePosition(square));root.rotation.y=piece.player==='pirate'?Math.PI:0;root.userData={square,piece};this.pieceGroup.add(root);this.pieces.set(square,root);}
  this.activeAssetBytes=['marines',crew].flatMap(t=>roles.map(r=>lookup(t,r))).reduce((sum,e)=>sum+(Number(e?.bytes)||0),0);this.metrics.loadedModels=this.cache.size;this.metrics.pieceCount=this.pieces.size;this.onReady({ready:this.metrics.missingModels.length===0,missing:[...this.metrics.missingModels]});
 }
 highlight({selected=null,candidates=[],moves=[]}={}){disposeTree(this.highlights);this.highlights.clear();const add=(square,color,ring=false)=>{if(!/^[A-H][1-8]$/.test(square))return;const mesh=new THREE.Mesh(ring?new THREE.RingGeometry(.35,.46,40):new THREE.CircleGeometry(.14,24),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false}));mesh.rotation.x=-Math.PI/2;mesh.position.copy(squarePosition(square));mesh.position.y=.155;this.highlights.add(mesh);};for(const s of candidates)add(typeof s==='string'?s:s.square,'#edc173',true);if(selected)add(selected,'#55ffe2',true);for(const m of moves)add(typeof m==='string'?m:m.to,'#55ffe2');}
 cancelAnimations(){this.activeAnimation?.cancel();this.activeAnimation=null;if(this.combatFocus){this.combatFocus=null;this.updateCamera();}}
 async prepareCombatEffects(){
  // compileAsync traverses hidden materials; warm the first actual draw as well.
  // All new effects have zero alpha here, so the player keeps seeing their board.
  const groups=['chess-combat-effects','character-attack-effects'].map(name=>this.scene.getObjectByName(name)).filter(Boolean);
  await this.renderer.compileAsync(this.scene,this.camera);
  if(groups.some(group=>!group.parent))return;
  const saved=[];
  for(const group of groups)group.traverse(object=>{saved.push([object,object.visible,object.frustumCulled]);object.visible=true;object.frustumCulled=false;});
  try {this.renderer.render(this.scene,this.camera);this.renderer.getContext().finish();}
  finally {for(const [object,visible,culled] of saved){object.visible=visible;object.frustumCulled=culled;}}
 }
 async animateMove(record,{onImpact,onPhase,onCue}={}){
  const from=record.from||record.move?.from,to=record.to||record.move?.to;
  const attacker=this.pieces.get(from);
  if(!attacker||!to)return;
  this.cancelAnimations();
  const victim=this.pieces.get(record.enPassant?to[0]+from[1]:to);
  const rook=record.castle?this.pieces.get((record.castle==='king'?'H':'A')+from[1]):null;
  const animation=createMoveAnimation({
   attacker,victim,rook,start:attacker.position.clone(),end:squarePosition(to),
   rookEnd:record.castle?squarePosition((record.castle==='king'?'F':'D')+from[1]):null,
   capture:Boolean(victim||record.captured),role:attacker.userData.piece.type,
   side:attacker.userData.piece.player,scene:this.scene,reducedMotion:this.reducedMotion,
   attack:getCharacterAttack(this.crew,attacker.userData.piece.type,attacker.userData.piece.player),
   seed:`${this.crew}:${from}:${to}:${attacker.userData.piece.type}`,onImpact,onPhase,onCue,prepare:()=>this.prepareCombatEffects()
  });
  this.activeAnimation=animation;this.combatMetrics=animation.metrics;
  if(victim&&!this.reducedMotion){this.combatFocus=victim.position.clone().addScaledVector(attacker.position.clone().sub(victim.position),.18);this.combatFocus.y=.46;this.combatCameraSuppressed=false;}
  try{return await animation.finished;}
  finally{if(this.activeAnimation===animation){this.activeAnimation=null;this.combatFocus=null;this.updateCamera();}}
 }
 squareToScreen(square){const rect=this.canvas.getBoundingClientRect(),p=squarePosition(square).project(this.camera);return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};}
 getMetrics(){const textures=new Set(),geometries=new Set(),modelBounds=[];let triangles=0,textureBytes=0;for(const [id,model] of this.cache){let meshCount=0,skinnedMeshCount=0,boneCount=0;model.traverse(o=>{if(o.isBone)boneCount++;if(o.isSkinnedMesh)skinnedMeshCount++;if(o.isMesh)meshCount++;if(o.geometry&&!geometries.has(o.geometry)){geometries.add(o.geometry);triangles+=(o.geometry.index?.count||o.geometry.attributes.position?.count||0)/3;}for(const material of [o.material].flat().filter(Boolean))for(const v of Object.values(material))if(v?.isTexture&&!textures.has(v)){textures.add(v);const image=v.image;textureBytes+=(image?.width||0)*(image?.height||0)*4*4/3;}});const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());modelBounds.push({id,width:size.x,height:size.y,depth:size.z,minY:box.min.y,centerX:center.x,centerZ:center.z,meshCount,skinnedMeshCount,boneCount});}return {...this.metrics,activeAssetBytes:this.activeAssetBytes||0,uniqueTriangles:triangles,decodedTextureBytes:Math.ceil(textureBytes),modelBounds,squareIds:[...this.squareIds],camera:this.cameraMode,zoom:this.zoomLevel,cameraControls:{yaw:this.cameraYaw,elevation:this.cameraElevation,target:this.cameraLookTarget?.toArray()||[0,0,0],position:this.camera.position.toArray(),dragging:Boolean(this.down?.orbit)},resources:{...this.renderer.info.memory},effects:this.activeAnimation?.metrics.effects||0,combat:this.combatMetrics?{...this.combatMetrics}:null};}
 dispose(){this.generation++;this.cancelAnimations();cancelAnimationFrame(this.raf);this.resizeObserver.disconnect();this.canvas.removeEventListener('pointerdown',this.pointerDown);this.canvas.removeEventListener('pointerup',this.pointerUp);this.canvas.removeEventListener('pointermove',this.pointerMove);this.canvas.removeEventListener('pointercancel',this.pointerCancel);this.canvas.removeEventListener('lostpointercapture',this.pointerCancel);this.canvas.removeEventListener('wheel',this.cameraWheel);window.removeEventListener('blur',this.clearPointer);this.clearPointer();disposeTree(this.scene);for(const m of this.cache.values())disposeTree(m);this.cache.clear();this.renderer.dispose();}
}
