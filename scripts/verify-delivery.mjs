import assert from 'node:assert/strict';
import {readFile,stat,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {inside,json,sha256,sourceSnapshot} from '../tools/report/evidence.mjs';

const manifestPath=process.argv.includes('--evidence')?process.argv[process.argv.indexOf('--evidence')+1]:'sources/reports/delivery-evidence.json';
const resultPath=process.argv.includes('--result')?process.argv[process.argv.indexOf('--result')+1]:'sources/reports/delivery-validation.json';
const problems=[],check=async(name,fn)=>{try{await fn();}catch(error){problems.push(name+': '+error.message);}};
let evidence;
await check('manifest',async()=>{evidence=await json(manifestPath);assert.equal(evidence.schemaVersion,1);});
if(evidence){
 const release=evidence.release||{};
 await check('release identity',async()=>{
  assert.match(release.commit||'',/^[a-f0-9]{40}$/);assert.match(release.sourceSha256||'',/^[a-f0-9]{64}$/);
  assert.match(release.deploymentId||'',/^dpl_/);const url=new URL(release.url);assert.equal(url.protocol,'https:');assert.equal(url.origin,release.url.replace(/\/$/,''));
  const snapshot=await sourceSnapshot();assert.equal(snapshot.commit,release.commit);assert.equal(snapshot.sourceSha256,release.sourceSha256);
  const saved=await json(release.sourceManifestPath);assert.equal(saved.sourceSha256,snapshot.sourceSha256);assert.deepEqual(saved.files,snapshot.files);
 });
 const markers={A2:/PERFT_OK initial=20,400,8902,197281/,A5:/ASSETS_OK required=66 valid=66 missing=0 fallback=0/,A6:/BROWSER_OK crews=10 pieces=32 presets=3/,A7:/EFFECTS_OK capture=1 legalState=1 cleanup=1 reducedMotion=1/,A8:/WEBMCP_OK registry=1 tools=1 propose=1 confirm=1 stop=1/,A9:/VOICE_LIVE_OK elevenlabs=1 audioIn=1 audioOut=1 selection=1 confirmedMove=1 stop=1/,A10:/DEPLOY_OK unauthBlocked=1 badPasswordBlocked=1 login=1 assetsProtected=1 apiProtected=1 logout=1 noSecrets=1 noInternalDocs=1/,A11:/QUALITY_OK syntax=1 dependencyDiff=0 secrets=0/};
 const assertions={
  A5:['all66','validScene','meshes','materials','textures','providerProvenance','sha256','noFallback','fourViewVisualReview','triangleCap','textureCap','compressedCap','activeMemoryCap'],
  A6:['all10Crews','all66ProductionModels','pieces32','presets3','squareIds64','legalHighlights','clickRoute','textRoute','desktop','mobile','cameraContainment','coldLoadBudget','cachedLoadBudget','frameBudget','hardwareMeasured','consoleErrorsZero'],
  A7:['attackerMotion','impact','victimDisappearance','legalState','cleanup','reducedMotion','captureCycles30','resourceBudget','visualEvidence'],
  A8:['registry11','officialAdapter','externalBridge','selection','propose','confirm','stop','adapterLabeled'],
  A9:['elevenlabs','realTransport','audioIn','audioOut','selection','legalHighlights','confirmedMove','stop','sessionClosed','durableAtomicQuota','oneActiveCall','max300Seconds','eventTokenEnvelope','noStore','csrf'],
  A10:['serverAuth','unauthHtml','unauthGLB','unauthAPI','badPassword','validLogin','malformedCookie','expiredCookie','logoutRevocation','rateLimit','assetsProtected','noSecrets','noInternalDocs','releaseIdentity'],
  A11:['syntax','dependencyDiffZero','secretsZero','allTestsPassed','consoleErrorsZero']
 };
 for(let n=1;n<=11;n++)await check('A'+n,async()=>{
  const gate=evidence.gates?.['A'+n];assert(gate,'missing actual result');assert.equal(gate.passed,true);assert.equal(gate.exitCode,0);assert(gate.command?.trim());assert(Number.isFinite(Date.parse(gate.checkedAt)));
  assert.equal(gate.commit,release.commit);assert.equal(gate.sourceSha256,release.sourceSha256);assert.equal(await sha256(inside(gate.outputPath)),gate.outputSha256);
  const output=await readFile(inside(gate.outputPath),'utf8');
  if([1,3,4].includes(n)){assert.match(output,/(?:#|ℹ) pass [1-9][0-9]*/);assert.match(output,/(?:#|ℹ) fail 0(?:\r?\n|$)/);assert.doesNotMatch(output,/(?:#|ℹ) (?:skipped|cancelled) [1-9]/);}else assert.match(output,markers['A'+n]);
  if(n>=6&&n<=10){assert.equal(gate.url,release.url);assert.equal(gate.deploymentId,release.deploymentId);}
  if(assertions['A'+n]){assert(gate.assertions,'missing detailed acceptance assertions');for(const name of assertions['A'+n])assert.equal(gate.assertions[name],true,'assertion missing or not green: '+name);for(const [name,value] of Object.entries(gate.assertions))assert.equal(value,true,'assertion not green: '+name);}
 });
 await check('human microphone',async()=>{
  const human=evidence.humanMicrophone;assert.equal(human?.verified,true,'genuine human microphone acceptance remains pending');assert(['root','user'].includes(human.observedBy),'only root/user may record this gate');assert(Number.isFinite(Date.parse(human.checkedAt)));
  const proof=await json(human.evidencePath);assert.equal(await sha256(inside(human.evidencePath)),human.sha256);assert.equal(proof.mode,'HUMAN_MICROPHONE');assert.equal(proof.url,release.url);assert.equal(proof.deploymentId,release.deploymentId);
  for(const name of ['audioIn','audioOut','selection','confirmedMove','stop','sessionClosed'])assert.equal(proof[name],true,name);
 });
 const required={planHtml:'docs/reports/epic-chess-ultraplan.html',contractHtml:'docs/reports/epic-chess-contract.html',video:'docs/reports/epic-chess-take-control.mp4'};
 for(const [key,file] of Object.entries(required))await check(key,async()=>{
  const artifact=evidence.artifacts?.[key];assert.equal(artifact?.path,file);assert.equal(await sha256(inside(file)),artifact.sha256);assert((await stat(inside(file))).size>1000);
  if(key!=='video'){const html=await readFile(inside(file),'utf8');assert.match(html,/<!doctype html>/i);assert.doesNotMatch(html,/\{\{[A-Z_]+\}\}/);assert.match(html,/66/);}
  else{
   const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',inside(file)],{encoding:'utf8'}));
   const seconds=Number(probe.format.duration);assert(seconds>=90&&seconds<=150,'video must be 90-150 measured seconds');assert(probe.streams.some(s=>s.codec_type==='audio'));assert(probe.streams.some(s=>s.codec_type==='video'&&s.width>=1280&&s.height>=720));
   const render=await json('sources/reports/video-render.json');assert.equal(render.videoSha256,artifact.sha256);assert.equal(render.voiceId,'yBC2mYQTcyyzcXPWTrFD');assert.equal(render.bgm,'tech');assert.equal(render.voiced,true);assert.equal(render.sceneCount,6);
  }
  const visible=evidence.visible?.find(v=>v.path===file&&v.sha256===artifact.sha256&&v.verdict==='visible'&&['root','user'].includes(v.observedBy));assert(visible,'no independent visible-open observation');assert(visible.evidencePath);await stat(inside(visible.evidencePath));
 });
 await check('budget',async()=>{const budget=evidence.budget;assert.equal(budget?.personalOnly,true);assert(Number.isFinite(budget.settledUSD)&&budget.settledUSD>=0);assert(Number.isFinite(budget.reservedUSD)&&budget.reservedUSD>=0);assert(budget.settledUSD+budget.reservedUSD<=30,'aggregate authorized ceiling exceeded');});
}
const result={checkedAt:new Date().toISOString(),passed:problems.length===0,problems,manifestPath};
await mkdir(inside('sources/reports'),{recursive:true});await writeFile(inside(resultPath),JSON.stringify(result,null,2)+'\n');
if(problems.length){console.error('DELIVERY_INCOMPLETE '+JSON.stringify(problems));process.exitCode=1;}else console.log('DELIVERY_OK planHtml=1 contractHtml=1 video=1 evidence=1 visible=1');
