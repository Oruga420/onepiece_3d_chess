// Review actual runtime poses without effects hiding the skinned geometry.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {rigRuntimeFiles as runtimeFiles,rigRuntimeHash} from '../tools/assets/rig_runtime_fingerprint.mjs';

const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const base=option('--base-url','http://127.0.0.1:3044');
const staged=args.includes('--staged'),selected=option('--ids','').split(',').filter(Boolean);
const executablePath=option('--browser-executable','');
const softwareRenderer=args.includes('--software-renderer');
const stagedRoot=path.resolve(option('--asset-root','.local/rigging/candidates'));
const out=path.resolve(option('--out','.local/rigging/runtime-review'));
const manifest=JSON.parse(fs.readFileSync('assets/models/manifest.json'));
const assets=manifest.assets.filter(a=>!selected.length||selected.includes(a.id));
const runtimeHash=()=>rigRuntimeHash(path.resolve('.'));
const stressFile=option('--stress-report','');
const stressReport=stressFile?JSON.parse(fs.readFileSync(stressFile)):null;
const stressRows=stressReport?.characters||[];
if(stressReport)assert.equal(stressReport.runtimeHash,runtimeHash(),'Stress measurements must match the current choreography and runtime');
if(staged)for(const asset of assets)assert(fs.existsSync(path.join(stagedRoot,asset.id+'.glb')),'Missing staged candidate '+asset.id);
fs.mkdirSync(out,{recursive:true});
const report={base,staged,runtimeHash:runtimeHash(),runtimeFingerprintVersion:2,runtimeFiles,startedAt:new Date().toISOString(),characters:[],errors:[],passed:false,visualApproval:false};
const save=()=>fs.writeFileSync(path.join(out,'review.json'),JSON.stringify(report,null,2));
async function step(phase, action, timeout=45000){
 report.phase=phase;report.phaseStartedAt=new Date().toISOString();save();
 let timer;
 try{return await Promise.race([action(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Review timed out during '+phase)),timeout);})]);}
 finally{clearTimeout(timer);}
}
let browser,browserServer;const frozenAssets=new Map();
try{
 const browserEnv=process.platform==='win32'?{...process.env,SystemRoot:process.env.SystemRoot||'C:\\Windows',WINDIR:process.env.WINDIR||'C:\\Windows',PROGRAMFILES:process.env.PROGRAMFILES||'C:\\Program Files',LOCALAPPDATA:process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),APPDATA:process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming')}:process.env;
 browserServer=await step('launch browser',()=>chromium.launchServer({headless:true,env:browserEnv,...(executablePath?{executablePath}:{channel:option('--browser-channel','chrome')}),args:softwareRenderer?['--use-angle=swiftshader','--enable-unsafe-swiftshader','--renderer-process-limit=2']:[],timeout:45000}),55000);
 report.renderMode=softwareRenderer?'software WebGL (SwiftShader)':'browser default WebGL';
 report.browserPid=browserServer.process()?.pid;save();
 browser=await step('connect browser',()=>chromium.connect(browserServer.wsEndpoint(),{timeout:30000}));
 const context=await step('create browser context',()=>browser.newContext({viewport:{width:384,height:416},reducedMotion:'no-preference'}));
 await context.route('**/api/voice/**',route=>route.abort());
 if(staged)await context.route('**/assets/models/**/*.glb',async route=>{
  const suffix=new URL(route.request().url()).pathname.replace('/assets/models/','');
  const bytes=frozenAssets.get(suffix);
  if(!bytes){report.errors.push('Unstaged review request '+suffix);await route.abort();return;}
  await route.fulfill({body:bytes,contentType:'model/gltf-binary'});
 });
 const login=await step('authenticate preview',()=>fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:process.env.APP_PASSWORD||'12345'}),signal:AbortSignal.timeout(30000)}));
 assert.equal(login.status,200,'Real password login');
 const cookie=login.headers.get('set-cookie').split(';')[0],separator=cookie.indexOf('=');
 const served=await step('verify served runtime',()=>Promise.allSettled(runtimeFiles.map(async file=>{
  const response=await fetch(base+'/'+file,{headers:{Cookie:cookie},signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,file+' served to the authenticated browser');
  return createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
 })));
 for(const result of served)assert.equal(result.status,'fulfilled','Runtime file fetch must succeed');
 report.servedRuntimeHash=createHash('sha256').update(served.map(result=>result.value).join(':')).digest('hex');
 assert.equal(report.servedRuntimeHash,report.runtimeHash,'Served animation code matches the reviewed checkout');
 await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:base,httpOnly:true,sameSite:'Lax',secure:base.startsWith('https:')}]);
 const page=await step('create review page',()=>context.newPage());page.on('pageerror',e=>report.errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)report.errors.push(r.status()+' '+r.url());});
 await step('load authenticated manifest',()=>page.goto(base+'/assets/models/manifest.json',{waitUntil:'domcontentloaded'}));
 await page.setContent('<style>body{margin:0;background:#14232d;color:#eee;font:12px sans-serif}#label{height:32px;padding:0 8px;line-height:32px}canvas{display:block}</style><div id="label"></div><canvas></canvas>');
 await step('initialize WebGL renderer',()=>page.evaluate(async()=>{
  const T=await import('/vendor/three/three.module.js'),{GLTFLoader}=await import('/vendor/three/GLTFLoader.js');
  const {createSkeletalCombat,disposeCharacterSkeletons}=await import('/src/skeletal-combat.mjs');
  const {CHARACTER_ATTACKS}=await import('/src/attacks.mjs');
  const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(384,384);renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;
  const scene=new T.Scene();scene.background=new T.Color('#263c4b');
  scene.add(new T.HemisphereLight('#e1f7ff','#35414a',2.4));
  const key=new T.DirectionalLight('#fff0dc',3.2);key.position.set(-3,4,4);scene.add(key);
  const rim=new T.DirectionalLight('#75caff',1.8);rim.position.set(3,2,-3);scene.add(rim);
  const camera=new T.OrthographicCamera(-.67,.67,.67,-.67,.01,20);
  const loader=new GLTFLoader();let model,controller;
  function dispose(){if(!model)return;controller?.restore();scene.remove(model);disposeCharacterSkeletons(model);const seen=new Set();model.traverse(o=>{if(o.geometry&&!seen.has(o.geometry)){seen.add(o.geometry);o.geometry.dispose();}for(const mat of [o.material].flat().filter(Boolean)){if(seen.has(mat))continue;seen.add(mat);for(const value of Object.values(mat))if(value?.isTexture&&!seen.has(value)){seen.add(value);value.dispose();}mat.dispose();}});model=null;}
  window.rigReview={
   async load(id){dispose();model=(await loader.loadAsync('/assets/models/'+id+'.glb')).scene;scene.add(model);model.traverse(o=>{if(o.isSkinnedMesh)o.frustumCulled=false;});renderer.compile(scene,camera);return {id};},
   pose(id,pose,view,scenario=null){controller?.restore();const defender=scenario?.defender??(pose==='defend'),progress=scenario?.progress??(pose==='guard'?.30:.62);controller=createSkeletalCombat(model,{attack:CHARACTER_ATTACKS[id],defender});if(pose!=='rest'){const t=Math.max(0,Math.min(1,(progress-.18)/.12));controller.update(progress,!defender&&progress<.30?{gaitProgress:progress/.30,walkingBlend:1-t*t*(3-2*t)}:{});}controller.ground(0);model.updateMatrixWorld(true);const posedBox=new T.Box3().setFromObject(model,true),target=posedBox.getCenter(new T.Vector3()),extent=posedBox.getSize(new T.Vector3()),span=Math.max(extent.y,view==='side'?extent.z:extent.x)*1.15;camera.left=camera.bottom=-span/2;camera.right=camera.top=span/2;camera.updateProjectionMatrix();camera.position.copy(target).add(new T.Vector3(view==='side'?2.5:0,.07,view==='side'?0:2.5));camera.lookAt(target);renderer.render(scene,camera);document.querySelector('#label').textContent=id+' · '+pose+' · '+view;const box=new T.Box3();model.traverse(o=>{if(o.isSkinnedMesh){const v=new T.Vector3();for(let i=0;i<o.geometry.attributes.position.count;i++)box.expandByPoint(o.getVertexPosition(i,v).applyMatrix4(o.matrixWorld));}});return {metrics:{...controller.metrics},min:box.min.toArray(),max:box.max.toArray(),resources:{...renderer.info.memory}};},
   dispose,
  };
 }));
 for(const asset of assets){
  const bytes=staged?fs.readFileSync(path.join(stagedRoot,asset.id+'.glb')):null;
  if(bytes)frozenAssets.set(asset.id+'.glb',bytes);
  await step('load model '+asset.id,()=>page.evaluate(id=>window.rigReview.load(id),asset.id));
  const item={id:asset.id,sha256:bytes?createHash('sha256').update(bytes).digest('hex'):asset.sha256,poses:[]};
  const diagnostic=stressRows.find(row=>row.id===asset.id&&row.sha256===item.sha256);
  if(stressReport)assert(diagnostic,asset.id+' requires a matching measured stress pose');
  const stress=diagnostic?[...diagnostic.poses].sort((a,b)=>b.p99-a.p99)[0]:{progress:.43,defender:false};
  item.stressSource=diagnostic?'highest sampled p99 deformation':'windup default';
  for(const pose of ['rest','guard','attack','defend','stress'])for(const view of ['front','side']){
   const scenario=pose==='stress'?{progress:stress.progress,defender:stress.defender}:null;
   const result=await step('pose '+asset.id+' '+pose+' '+view,()=>page.evaluate(({id,pose,view,scenario})=>window.rigReview.pose(id,pose,view,scenario),{id:asset.id,pose,view,scenario}));
   assert(result.metrics.active,asset.id+' real skeletal controller');assert([...result.min,...result.max].every(Number.isFinite),asset.id+' finite posed mesh');
   const filename=asset.id.replace('/','-')+'-'+pose+'-'+view+'.png';
   await step('capture '+filename,()=>page.screenshot({path:path.join(out,filename)}));item.poses.push({pose,view,scenario,file:filename,...result});
  }
  if(bytes)assert.equal(createHash('sha256').update(fs.readFileSync(path.join(stagedRoot,asset.id+'.glb'))).digest('hex'),item.sha256,asset.id+' remained frozen during review');
  frozenAssets.delete(asset.id+'.glb');
  report.characters.push(item);save();console.log('RIG_REVIEW '+asset.id);
 }
 await page.evaluate(()=>window.rigReview.dispose());assert.equal(report.errors.length,0,JSON.stringify(report.errors));assert.equal(runtimeHash(),report.runtimeHash,'Runtime unchanged during review');
 report.passed=true;report.phase='complete';report.completedAt=new Date().toISOString();save();
}catch(error){report.failure=error.stack;save();process.exitCode=1;console.error(error.message);}
finally{
 if(browserServer){
  const ownedProcess=browserServer.process();
  if(process.platform==='win32'&&ownedProcess?.exitCode===null){
   // Windows may leave the remote browser socket pending after close(). This
   // dedicated review owns this browser tree; no user browser is targeted.
   try{execFileSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(ownedProcess.pid),'/T','/F'],{stdio:'ignore',windowsHide:true,timeout:5000});report.cleanup='owned browser tree terminated';}
   catch{report.cleanup='owned browser termination could not be confirmed';}
  }else{let timer;try{await Promise.race([browserServer.close(),new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);}finally{clearTimeout(timer);}}
  save();
 }
 process.exit(process.exitCode||0);
}
