// UI integration evidence with an explicitly simulated SDK. This does not prove
// real microphone/audio or provider availability and never mints a paid token.
import assert from 'node:assert/strict';
import path from 'node:path';
import {openGame,closeBrowser,base,out,save} from './browser-utils.mjs';

const fixture=await openGame();
const {page,context,browser,errors}=fixture;
const evidence={base,mode:'MOCK_SDK_NOT_LIVE',paidRequests:0,checks:[],viewports:[]};
let tokenRequests=0,finishRequests=0,releaseFirst;
const firstResponse=new Promise(resolve=>{releaseFirst=resolve;});
try{
 await context.route(/https:\/\/[^/]*elevenlabs[^/]*\//,route=>{evidence.paidRequests++;return route.abort();});
 await page.route('**/vendor/voice/index.mjs',route=>route.fulfill({contentType:'text/javascript',body:`
  window.__mockVoice={starts:0,ends:0};
  export const Conversation={async startSession(options){
   window.__mockVoice.starts++;window.__mockVoice.options=options;
   options.onStatusChange({status:'connected'});
   return {setVolume(){},endSession(){window.__mockVoice.ends++;options.onDisconnect();},getOutputVolume(){return 0;},sendContextualUpdate(){}};
  }};
 `}));
 await page.route('**/api/voice/token',async route=>{
  tokenRequests++;
  if(tokenRequests===1){await firstResponse;await route.fulfill({status:429,json:{error:'active'}});}
  else await route.fulfill({json:{token:'MOCK_NOT_LIVE',leaseId:'mock-header-call'}});
 });
 await page.route('**/api/voice/finish',route=>{finishRequests++;return route.fulfill({json:{ok:true}});});
 await page.locator('#voice-orb').click();
 await page.waitForFunction(()=>document.querySelector('#voice-panel').hidden===false&&document.querySelector('#voice-orb').dataset.state==='connecting');
 assert.match(await page.locator('#voice-launch-label').textContent(),/Conectando/);
 assert.equal(await page.locator('#voice-connect').isDisabled(),true);
 evidence.checks.push('header single click immediately opens connecting state');
 releaseFirst();
 await page.waitForFunction(()=>document.querySelector('#voice-status').textContent.includes('otra llamada activa'));
 assert.equal(await page.locator('#voice-panel').isVisible(),true);
 assert.equal(await page.locator('#voice-connect').isEnabled(),true);
 assert.equal(await page.evaluate(()=>Boolean(window.chessApp.voice.session)),false);
 await page.screenshot({path:path.join(out,'voice-header-error.png')});
 evidence.checks.push('active lease failure visible with retry enabled');
 await page.locator('#voice-connect').click();
 await page.waitForFunction(()=>Boolean(window.chessApp.voice.session));
 assert.equal(await page.locator('#voice-launch-label').textContent(),'Agente conectado');
 assert.equal(await page.evaluate(()=>window.__mockVoice.starts),1);
 await page.locator('#voice-close').click();
 assert.equal(await page.locator('#voice-panel').isHidden(),true);
 assert.equal(await page.evaluate(()=>window.__mockVoice.ends),0);
 await page.locator('#voice-orb').click();
 assert.equal(await page.locator('#voice-panel').isVisible(),true);
 assert.equal(await page.evaluate(()=>window.__mockVoice.starts),1);
 evidence.checks.push('hide panel retains connection and header reopens same call');
 await page.locator('#voice-stop').click();
 await page.waitForFunction(()=>!window.chessApp.voice.session&&window.__mockVoice.ends===1);
 assert.equal(await page.locator('#voice-connect').isEnabled(),true);
 assert.equal(await page.locator('#voice-launch-label').textContent(),'Conectar agente');
 evidence.checks.push('stop ends call and returns launcher to ready state');
 await page.locator('#voice-close').click();
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  const measured=await page.evaluate(()=>{
   const button=document.querySelector('#voice-orb'),box=button.getBoundingClientRect(),header=document.querySelector('.masthead').getBoundingClientRect();
   const point={x:box.left+box.width/2,y:box.top+box.height/2};
   return {scrollY,scrollWidth:document.documentElement.scrollWidth,innerWidth,innerHeight,button:{top:box.top,bottom:box.bottom,left:box.left,right:box.right},header:{top:header.top,bottom:header.bottom},hit:button.contains(document.elementFromPoint(point.x,point.y))};
  });
  assert.ok(measured.scrollY>0,'test really scrolls');
  assert.ok(measured.button.top>=0&&measured.button.bottom<=viewport.height,'launcher stays visible');
  assert.ok(measured.button.left>=0&&measured.button.right<=viewport.width,'launcher within width');
  assert.ok(measured.scrollWidth<=viewport.width,'no horizontal overflow');
  assert.ok(measured.hit,'launcher clickable above page content');
  evidence.viewports.push({...viewport,...measured});
  await page.screenshot({path:path.join(out,`voice-header-${viewport.width}.png`)});
 }
 evidence.checks.push('desktop and mobile sticky header remain visible and clickable after scrolling');
 assert.equal(evidence.paidRequests,0);
 assert.equal(tokenRequests,2);assert.equal(finishRequests,1);
 evidence.tokenRequests=tokenRequests;evidence.finishRequests=finishRequests;
 evidence.errors=errors.filter(error=>!error.includes('429'));
 assert.deepEqual(evidence.errors,[]);
 evidence.passed=true;save('voice-header.json',evidence);
 console.log('VOICE_HEADER_MOCK_BROWSER_OK',JSON.stringify(evidence));
}finally{releaseFirst();await closeBrowser(browser);}
