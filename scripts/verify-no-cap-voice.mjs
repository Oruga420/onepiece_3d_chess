import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';

const argument=name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:undefined;
const base=argument('--base-url');
assert(process.argv.includes('--live'),'Use --live only after confirming no personal voice lease is active.');
assert(base&&new URL(base).protocol==='https:','An explicit staged HTTPS URL is required.');
const directory=path.resolve('.local/no-cap-voice');fs.mkdirSync(directory,{recursive:true});
const filename=path.join(directory,new URL(base).hostname+'.json');
const report={base,startedAt:new Date().toISOString(),mode:'REAL_ELEVENLABS_FAKE_MICROPHONE',nodePid:process.pid,tokenRequests:0,tokenResponses:[],finishResponses:[],finishRetries:[],volumeSamples:[],passed:false};
const save=()=>fs.writeFileSync(filename,JSON.stringify(report,null,2));
const safeResponse=(status,value)=>({status,...Object.fromEntries(['ok','error','reconciled','chargedMicrousd'].filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]))});
let browser,context,page,ownLease=null,issued=false,stopped=false;
const pendingResponses=new Set();
async function stopOwnCall(){
 if(!page||!issued||stopped)return;
 stopped=true;
 // This isolated browser owns only the single call initiated below.
 await page.evaluate(async()=>{await window.chessApp?.voice.stop();}).catch(()=>{});
 await Promise.allSettled([...pendingResponses]);
}
async function reconcileOwnLease(){
 if(!page||!ownLease)return;
 for(let attempt=0;attempt<3;attempt++){
  if(report.finishResponses.some(item=>item.reconciled===true)||report.finishRetries.some(item=>item.reconciled===true))break;
  await page.waitForTimeout([2000,5000,10000][attempt]);
  const outcome=await page.evaluate(async leaseId=>{
   try{
    const session=await fetch('/api/session',{signal:AbortSignal.timeout(15000)});if(!session.ok)return {status:session.status,error:'session_unavailable'};
    const {csrfToken}=await session.json();
    const response=await fetch('/api/voice/finish',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({leaseId}),signal:AbortSignal.timeout(20000)});
    const data=await response.json();return {status:response.status,ok:data.ok,reconciled:data.reconciled,chargedMicrousd:data.chargedMicrousd,error:data.error};
   }catch(error){return {status:0,error:error.name};}
  },ownLease);
  report.finishRetries.push({attempt:attempt+1,...outcome});save();
 }
}
try{
 console.log('NO_CAP_VOICE_STAGE launch pid='+process.pid);save();
 browser=await chromium.launch({headless:true,channel:argument('--browser-channel')||'chrome',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'],timeout:30000});
 context=await browser.newContext({viewport:{width:1440,height:1050},permissions:['microphone']});page=await context.newPage();page.setDefaultTimeout(45000);
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/voice/token'&&request.method()==='POST'){report.tokenRequests++;save();}});
 page.on('response',response=>{
  const pathname=new URL(response.url()).pathname;if(!['/api/voice/token','/api/voice/finish'].includes(pathname))return;
  const task=(async()=>{
   const data=await response.json().catch(()=>({}));
   if(pathname==='/api/voice/token'){
    const entry={status:response.status(),error:data.error||null};
    if(response.ok()&&typeof data.leaseId==='string'){ownLease=data.leaseId;entry.leaseId=ownLease;entry.expiresAt=data.expiresAt;issued=true;}
    // Deliberately never retain or print the provider token.
    report.tokenResponses.push(entry);
   }else report.finishResponses.push(safeResponse(response.status(),data));
   save();
  })();pendingResponses.add(task);void task.finally(()=>pendingResponses.delete(task));
 });
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});await page.fill('#password',process.env.APP_PASSWORD||'12345');
 await Promise.all([page.waitForURL(new URL('/',base).href,{waitUntil:'domcontentloaded'}),page.click('button')]);
 await page.waitForFunction(()=>Boolean(window.chessApp));await page.evaluate(()=>window.chessApp.whenReady);
 report.preflight=await page.evaluate(async()=>{
  const [session,status]=await Promise.all([fetch('/api/session'),fetch('/api/voice/status')]);const auth=await session.json(),voice=await status.json();
  return {sessionHTTP:session.status,csrfPresent:typeof auth.csrfToken==='string'&&auth.csrfToken.length>0,statusHTTP:status.status,voice};
 });
 assert.equal(report.preflight.sessionHTTP,200);assert.equal(report.preflight.csrfPresent,true);assert.equal(report.preflight.statusHTTP,200);
 assert.equal(report.preflight.voice.configured,true);assert.equal(report.preflight.voice.durable,true);assert.equal(report.preflight.voice.monetaryLimitUSD,null);save();
 console.log('NO_CAP_VOICE_STAGE preflight passed; connecting single call');
 await page.click('#voice-orb');
 await page.waitForFunction(()=>Boolean(window.chessApp.voice.session)||(!window.chessApp.voice.metrics&&document.querySelector('#voice-orb').dataset.state!=='connecting'),null,{timeout:55000});
 await Promise.allSettled([...pendingResponses]);
 assert.equal(report.tokenRequests,1,'Exactly one token request; no retries or concurrent calls');
 assert.equal(report.tokenResponses[0]?.status,200,'Single token endpoint must accept this call');
 assert.equal(await page.evaluate(()=>Boolean(window.chessApp.voice.session)),true,'Actual ElevenLabs SDK session connected');
 report.connected={at:new Date().toISOString(),label:await page.locator('#voice-launch-label').textContent(),status:await page.locator('#voice-status').textContent()};save();
 for(let i=0;i<14;i++){
  const sample=await page.evaluate(()=>({connected:Boolean(window.chessApp.voice.session),outputVolume:window.chessApp.voice.session?.getOutputVolume?.()||0}));report.volumeSamples.push(sample);
  assert.equal(sample.connected,true,'Real voice session stays connected during short call');await page.waitForTimeout(500);
 }
 await page.screenshot({path:path.join(directory,new URL(base).hostname+'-connected.png')});
 // Use the actual visible Stop button, then explicitly await SDK cleanup.
 await page.click('#voice-stop');await stopOwnCall();
 assert.equal(await page.evaluate(()=>Boolean(window.chessApp.voice.session)),false);
 report.stoppedAt=new Date().toISOString();save();console.log('NO_CAP_VOICE_STAGE stopped; settling own lease');
 await reconcileOwnLease();await Promise.allSettled([...pendingResponses]);
 assert(report.finishResponses.some(item=>item.reconciled===true)||report.finishRetries.some(item=>item.reconciled===true),'Provider-confirmed final reconciliation required');
 report.passed=true;report.completedAt=new Date().toISOString();save();console.log('NO_CAP_VOICE_OK realSDK=1 tokenHTTP=200 singleCall=1 noGameDollarCap=1 providerReconciled=1');
}catch(error){
 report.error={name:error.name,message:error instanceof assert.AssertionError?error.message:'Browser or network operation failed; see stage and sanitized endpoint results.'};save();process.exitCode=1;
 console.error('NO_CAP_VOICE_FAILED '+report.error.name+' '+report.error.message);
}finally{
 await stopOwnCall();
 if(ownLease&&!report.finishResponses.some(item=>item.reconciled===true)&&!report.finishRetries.some(item=>item.reconciled===true)&&report.finishRetries.length===0)await reconcileOwnLease();
 save();
 if(context)await context.close();if(browser)await browser.close();report.browserClosed=true;save();
}
