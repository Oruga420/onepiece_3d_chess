import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium} from 'playwright';
import {base,out,save,settle,assertModels,browserChannel} from './browser-utils.mjs';

const report={base,startedAt:new Date().toISOString(),crews:[],passed:false};
let browser,context;
try {
 console.log('NO_BASES_STAGE launch');
 browser=await chromium.launch({headless:true,channel:browserChannel,timeout:30000});
 context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'no-preference'});
 const page=await context.newPage(),errors=[],httpErrors=[];
 page.setDefaultTimeout(60000);
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400)httpErrors.push({status:response.status(),url:response.url()});});
 console.log('NO_BASES_STAGE login');
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.fill('#password',process.env.APP_PASSWORD||'12345');
 await Promise.all([page.waitForURL(new URL('/',base).href),page.click('button')]);
 await page.waitForFunction(()=>Boolean(window.chessApp));
 console.log('NO_BASES_STAGE assets');
 await page.waitForFunction(()=>window.chessApp.view.pieces.size===32,{},{timeout:60000});
 await page.evaluate(()=>window.chessApp.setAI(false));
 await settle(page);
 const crews=await page.locator('#crew-select option').evaluateAll(options=>options.map(option=>option.value));
 assert.equal(crews.length,10);
 for(const crew of crews){
  await page.selectOption('#crew-select',crew);await settle(page);
  await page.waitForFunction(()=>window.chessApp.view.pieces.size===32);
  await assertModels(page);
  const pieces=await page.evaluate(async()=>{
   const {Box3}=await import('/vendor/three/three.module.js');
   const view=window.chessApp.view;view.scene.updateMatrixWorld(true);
   return [...view.pieces].map(([square,root])=>{
    const box=new Box3().setFromObject(root),meshes=[];
    root.traverse(object=>{if(object.isMesh)meshes.push({geometry:object.geometry.type,texture:Boolean(object.material?.map)});});
    return {square,children:root.children.map(child=>child.name),meshes,floor:box.min.y,height:box.max.y-box.min.y,yaw:root.rotation.y,side:root.userData.piece.player};
   });
  });
  for(const piece of pieces){
   assert.deepEqual(piece.children,['character-model'],crew+' '+piece.square+' has only the real character');
   assert(piece.meshes.length>0&&piece.meshes.some(mesh=>mesh.texture),crew+' '+piece.square+' actual textured GLB');
   assert(!piece.meshes.some(mesh=>mesh.geometry==='CylinderGeometry'),crew+' '+piece.square+' no generated pedestal');
   assert(piece.floor>=.14&&piece.floor<=.15,crew+' '+piece.square+' feet rest on tile '+piece.floor);
   assert.equal(piece.yaw,piece.side==='pirate'?Math.PI:0,crew+' '+piece.square+' inward rest facing');
  }
  if (['shanks','heart','bigmom'].includes(crew)) await page.locator('#board-canvas').screenshot({path:path.join(out,`no-bases-${crew}.png`)});
  report.crews.push({crew,pieces});console.log('NO_BASES_CREW '+crew);
 }
 await page.selectOption('#crew-select','mugiwara');await settle(page);
 await page.screenshot({path:path.join(out,'no-bases-board.png'),fullPage:true});
 await page.evaluate(()=>{window.chessApp.view.zoom(-.33);});
 await page.locator('#board-canvas').screenshot({path:path.join(out,'no-bases-closeup.png')});
 await page.evaluate(()=>window.chessApp.view.setCamera('front'));
 const motion=await page.evaluate(()=>new Promise(resolve=>{
  const app=window.chessApp,actor=app.view.pieces.get('E2'),frames=[];
  const initial={position:actor.position.toArray(),body:actor.children[0].position.toArray(),rotation:actor.children[0].rotation.toArray().slice(0,3)};
  const result=app.commands.move({from:'E2',to:'E4'},{source:'mouse'});
  const sample=()=>{frames.push({position:actor.position.toArray(),yaw:actor.rotation.y,body:actor.children[0].position.toArray(),rotation:actor.children[0].rotation.toArray().slice(0,3)});if(app.busy)requestAnimationFrame(sample);else resolve({initial,result,frames});};
  requestAnimationFrame(sample);
 }));
 assert.equal(motion.result.ok,true);
 assert(motion.frames.length>4,'normal movement has visible intermediate frames');
 assert(motion.frames.some(frame=>frame.body.some((value,index)=>Math.abs(value-motion.initial.body[index])>.005)||frame.rotation.some((value,index)=>Math.abs(value-motion.initial.rotation[index])>.01)),'normal movement has character gait beyond translation');
 await settle(page);
 const final=await page.evaluate(()=>{const actor=window.chessApp.view.pieces.get('E4');return {position:actor.position.toArray(),yaw:actor.rotation.y,children:actor.children.map(child=>child.name),effects:window.chessApp.view.getMetrics().effects};});
 assert.deepEqual(final.position,[.5,.146,.5]);assert.equal(final.yaw,Math.PI);assert.deepEqual(final.children,['character-model']);assert.equal(final.effects,0);
 report.normalMove={...motion,final};
 await page.evaluate(()=>window.chessApp.loadFEN('7k/8/8/3p4/4P3/8/8/K7 w - - 0 1'));
 const capture=await page.evaluate(async()=>{
  const {Box3}=await import('/vendor/three/three.module.js');
  const app=window.chessApp,attacker=app.view.pieces.get('E4'),victim=app.view.pieces.get('D5'),frames=[];
  return new Promise(resolve=>{
   const result=app.commands.move({from:'E4',to:'D5'},{source:'mouse'});
   const sample=()=>{app.view.scene.updateMatrixWorld(true);const combat=app.view.getMetrics().combat;
    if(['parry','strike','defeat'].includes(combat?.phase))frames.push({phase:combat.phase,progress:combat.progress,attacker:{visible:attacker.visible,floor:new Box3().setFromObject(attacker).min.y},victim:{visible:victim.visible,floor:new Box3().setFromObject(victim).min.y}});
    if(app.busy)requestAnimationFrame(sample);else resolve({result,frames});
   };requestAnimationFrame(sample);
  });
 });
 assert.equal(capture.result.ok,true);
 for(const phase of ['parry','strike','defeat'])assert(capture.frames.some(frame=>frame.phase===phase),'actual capture samples '+phase);
 for(const frame of capture.frames)for(const key of ['attacker','victim'])if(frame[key].visible)assert(frame[key].floor>=.139,'actual '+key+' floor at '+frame.phase+' '+frame.progress+': '+frame[key].floor);
 report.captureGrounding=capture;
 assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(httpErrors.length,0,JSON.stringify(httpErrors));
 report.consoleErrors=errors;report.httpErrors=httpErrors;report.passed=true;report.completedAt=new Date().toISOString();
 save('no-bases.json',report);
 console.log('NO_BASES_OK crews=10 pieces=320 actualTexturedGLBs=1 floor=.146 inwardFacing=1 normalGait=1');
} catch(error){report.error=error.stack;save('no-bases.json',report);console.error(error.stack);process.exitCode=1;}
finally{await context?.close();await browser?.close();}
