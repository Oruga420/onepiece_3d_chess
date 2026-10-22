// Review actual runtime poses without effects hiding the skinned geometry.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';

const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const base=option('--base-url','http://127.0.0.1:3044');
const staged=args.includes('--staged'),selected=option('--ids','').split(',').filter(Boolean);
const out=path.resolve(option('--out','.local/rigging/runtime-review'));
const manifest=JSON.parse(fs.readFileSync('assets/models/manifest.json'));
const assets=manifest.assets.filter(a=>!selected.length||selected.includes(a.id));
if(staged)for(const asset of assets)assert(fs.existsSync(path.join('.local/rigging/candidates',asset.id+'.glb')),'Missing staged candidate '+asset.id);
fs.mkdirSync(out,{recursive:true});
const report={base,staged,startedAt:new Date().toISOString(),characters:[],errors:[],passed:false,visualApproval:false};
const save=()=>fs.writeFileSync(path.join(out,'review.json'),JSON.stringify(report,null,2));
let browser,browserServer;
try{
 browserServer=await chromium.launchServer({headless:true,channel:option('--browser-channel','chrome'),timeout:45000});
 report.browserPid=browserServer.process()?.pid;save();
 browser=await chromium.connect(browserServer.wsEndpoint());
 const context=await browser.newContext({viewport:{width:384,height:416},reducedMotion:'no-preference'});
 await context.route('**/api/voice/**',route=>route.abort());
 if(staged)await context.route('**/assets/models/**/*.glb',async route=>{
  const suffix=new URL(route.request().url()).pathname.replace('/assets/models/','');
  const candidate=path.join('.local/rigging/candidates',suffix);
  if(!fs.existsSync(candidate)){report.errors.push('Missing staged candidate '+suffix);await route.abort();return;}
  await route.fulfill({path:candidate,contentType:'model/gltf-binary'});
 });
 const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:process.env.APP_PASSWORD||'12345'}),signal:AbortSignal.timeout(30000)});
 assert.equal(login.status,200,'Real password login');
 const cookie=login.headers.get('set-cookie').split(';')[0],separator=cookie.indexOf('=');
 await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:base,httpOnly:true,sameSite:'Lax',secure:base.startsWith('https:')}]);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)report.errors.push(r.status()+' '+r.url());});
 await page.goto(base+'/assets/models/manifest.json',{waitUntil:'domcontentloaded'});
 await page.setContent('<style>body{margin:0;background:#14232d;color:#eee;font:12px sans-serif}#label{height:32px;padding:0 8px;line-height:32px}canvas{display:block}</style><div id="label"></div><canvas></canvas>');
 await page.evaluate(async()=>{
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
   async load(id){dispose();model=(await loader.loadAsync('/assets/models/'+id+'.glb')).scene;scene.add(model);model.traverse(o=>{if(o.isSkinnedMesh)o.frustumCulled=false;});await renderer.compileAsync(scene,camera);return {id};},
   pose(id,pose,view){controller?.restore();controller=createSkeletalCombat(model,{attack:CHARACTER_ATTACKS[id],defender:pose==='defend'});if(pose!=='rest')controller.update(pose==='guard'?.28:.62);model.updateMatrixWorld(true);camera.position.set(view==='side'?2.5:0,.62,view==='side'?0:2.5);camera.lookAt(0,.5,0);renderer.render(scene,camera);document.querySelector('#label').textContent=id+' · '+pose+' · '+view;const box=new T.Box3();model.traverse(o=>{if(o.isSkinnedMesh){const v=new T.Vector3();for(let i=0;i<o.geometry.attributes.position.count;i++)box.expandByPoint(o.getVertexPosition(i,v).applyMatrix4(o.matrixWorld));}});return {metrics:{...controller.metrics},min:box.min.toArray(),max:box.max.toArray(),resources:{...renderer.info.memory}};},
   dispose,
  };
 });
 for(const asset of assets){
  await page.evaluate(id=>window.rigReview.load(id),asset.id);
  const item={id:asset.id,sha256:staged?createHash('sha256').update(fs.readFileSync(path.join('.local/rigging/candidates',asset.id+'.glb'))).digest('hex'):asset.sha256,poses:[]};
  for(const pose of ['rest','guard','attack','defend'])for(const view of ['front','side']){
   const result=await page.evaluate(({id,pose,view})=>window.rigReview.pose(id,pose,view),{id:asset.id,pose,view});
   assert(result.metrics.active,asset.id+' real skeletal controller');assert([...result.min,...result.max].every(Number.isFinite),asset.id+' finite posed mesh');
   const filename=asset.id.replace('/','-')+'-'+pose+'-'+view+'.png';
   await page.screenshot({path:path.join(out,filename)});item.poses.push({pose,view,file:filename,...result});
  }
  report.characters.push(item);save();console.log('RIG_REVIEW '+asset.id);
 }
 await page.evaluate(()=>window.rigReview.dispose());assert.equal(report.errors.length,0,JSON.stringify(report.errors));
 report.passed=true;report.completedAt=new Date().toISOString();save();
}catch(error){report.failure=error.stack;save();process.exitCode=1;console.error(error.message);}
finally{
 if(browserServer){
  const ownedProcess=browserServer.process();
  if(process.platform==='win32'&&ownedProcess?.exitCode===null){
   // Windows may leave the remote browser socket pending after close(). This
   // dedicated review owns this browser tree; no user browser is targeted.
   try{execFileSync('taskkill',['/PID',String(ownedProcess.pid),'/T','/F'],{stdio:'ignore',timeout:5000});report.cleanup='owned browser tree terminated';}
   catch{report.cleanup='owned browser termination could not be confirmed';}
  }else{let timer;try{await Promise.race([browserServer.close(),new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);}finally{clearTimeout(timer);}}
  save();
 }
 process.exit(process.exitCode||0);
}
