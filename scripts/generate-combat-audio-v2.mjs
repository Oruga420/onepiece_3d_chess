import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const descriptions=JSON.parse(fs.readFileSync('scripts/combat-sound-prompts-v2.json','utf8'));
const clips=Object.entries(descriptions).flatMap(([family,cues])=>Object.entries(cues).map(([cue,text])=>({id:family+'-'+cue,family,cue,text,duration:cue==='impact'?1.2:1})));
clips.push({id:'parry',cue:'parry',family:null,duration:.6,text:'One short close weapon deflection: dry hard contact, tiny bright steel scrape and a quick air flick. Crisp restrained counter-hit, no ringing musical tone.'},
 {id:'land',cue:'land',family:null,duration:.8,text:'One heavy body lands on a solid wooden-and-stone surface immediately: low weighty thump, brief clothing scuff and a few tiny debris clicks. Detailed physical landing, no voice, no explosion.'});
const ledgerPath='docs/reports/sound-effects-v2-ledger.json',outDir='assets/audio/combat/v2',rawDir='.local/combat-audio-v2-raw';
const sum=file=>Object.values(JSON.parse(fs.readFileSync(file,'utf8')).operations).reduce((n,o)=>n+(o.reservedUSD||0),0);
// Ongoing voice was explicitly removed from the delivery spending cap by the
// owner on Oct 20. Asset/SFX generation retains its original USD30 ceiling.
const priorGenerationReserveUSD=sum('docs/reports/assets-ledger.json')+sum('docs/reports/sound-effects-ledger.json')+.14;
const reservePerClipUSD=.05;
if(priorGenerationReserveUSD+clips.length*reservePerClipUSD>30)throw Error('Generation spending authorization exceeded');
const ledger=fs.existsSync(ledgerPath)?JSON.parse(fs.readFileSync(ledgerPath,'utf8')):{version:2,provider:'ElevenLabs personal',model:'eleven_text_to_sound_v2',priorGenerationReserveUSD,reservePerClipUSD,maximumGenerationUSD:30,voicePolicy:'Owner removed ongoing voice spending cap on 2026-10-20; no runtime voice limit reintroduced',operations:{}};
const save=()=>{fs.writeFileSync(ledgerPath+'.tmp',JSON.stringify(ledger,null,2)+'\n');fs.renameSync(ledgerPath+'.tmp',ledgerPath);};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function samples(file){
 // Measure channels separately: a power-preserving mono downmix can exceed
 // full scale even when the original stereo file does not clip.
 const b=execFileSync('ffmpeg',['-v','error','-i',file,'-ac','2','-ar','44100','-f','f32le','pipe:1'],{maxBuffer:4*1024*1024});
 return Array.from({length:b.length/8},(_,i)=>{const l=b.readFloatLE(i*8),r=b.readFloatLE(i*8+4);return Math.abs(l)>Math.abs(r)?l:r;});
}
function inspect(pcm){let peak=0,squares=0;for(const x of pcm){peak=Math.max(peak,Math.abs(x));squares+=x*x;}return {peak,rms:Math.sqrt(squares/pcm.length),seconds:pcm.length/44100};}
function trimStart(pcm,cue){
 const windows=[];for(let i=0;i<pcm.length;i+=220){let energy=0;for(let j=i;j<Math.min(i+220,pcm.length);j++)energy+=pcm[j]*pcm[j];windows.push(Math.sqrt(energy/220));}
 const max=Math.max(...windows),threshold=max*(cue==='impact'||cue==='land'?.45:.035);
 const first=windows.findIndex(x=>x>=threshold);return Math.max(0,first*220/44100-.01);
}
if(!process.argv.includes('--generate')){console.log(JSON.stringify({clips:clips.length,newReservedUSD:clips.length*reservePerClipUSD,totalGenerationReservedUSD:priorGenerationReserveUSD+clips.length*reservePerClipUSD}));process.exit(0);}
const key=process.env.ELEVENLABS_API_KEY;if(!key)throw Error('Personal project key required');
const headers={'xi-api-key':key,'Content-Type':'application/json'};
const owned=JSON.parse(fs.readFileSync('.local/voice-agent.json','utf8'));
if(owned.agentId!==process.env.ELEVENLABS_AGENT_ID)throw Error('Personal project identity mismatch');
const account=await fetch('https://api.elevenlabs.io/v1/convai/agents/'+encodeURIComponent(owned.agentId),{headers,signal:AbortSignal.timeout(15000)});
if(!account.ok||(await account.json()).name!=='Brújula · One Piece Chess personal')throw Error('Personal project agent verification failed');
const sub=await fetch('https://api.elevenlabs.io/v1/user/subscription',{headers,signal:AbortSignal.timeout(15000)});if(!sub.ok)throw Error('Personal credits check failed');
const subscription=await sub.json();if(subscription.status!=='active'||subscription.character_limit-subscription.character_count<3400)throw Error('Insufficient existing personal credits');
fs.mkdirSync(outDir,{recursive:true});fs.mkdirSync(rawDir,{recursive:true});
for(const clip of clips){
 const output=outDir+'/'+clip.id+'.mp3',raw=rawDir+'/'+clip.id+'.mp3';let op=ledger.operations[clip.id];
 if(op?.state==='downloaded'){if(!fs.existsSync(output)||sha(fs.readFileSync(output))!==op.sha256)throw Error('Verified file missing or changed: '+clip.id);continue;}
 if(op&&op.state!=='raw_downloaded')throw Error('Unresolved prior request '+clip.id+'; no automatic paid retry');
 if(!op){
  const text=clip.text+' Professional isolated fighting-game sound effect stem. Dry, close, detailed and punchy. No speech, dialogue, music, melody, cartoon comedy or long reverb. '+(clip.cue==='impact'||clip.cue==='land'?'The main contact is at the very beginning; no preceding whoosh or buildup.':'Only the preparation movement, not the main hit.');
  op=ledger.operations[clip.id]={state:'reserved',reservedUSD:reservePerClipUSD,prompt:text,durationRequested:clip.duration,startedAt:new Date().toISOString()};save();
  const r=await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_192',{method:'POST',headers,body:JSON.stringify({text,duration_seconds:clip.duration,prompt_influence:.78,model_id:ledger.model,loop:false}),signal:AbortSignal.timeout(120000)});
  if(!r.ok){op.httpStatus=r.status;save();throw Error('Generation failed '+clip.id+' HTTP '+r.status);}
  const bytes=Buffer.from(await r.arrayBuffer());fs.writeFileSync(raw,bytes);
  const header=r.headers.get('character-cost'),credits=header===null?NaN:Number(header);if(!Number.isFinite(credits)||credits<0||credits>100){op.state='unverified-charge';save();throw Error('Charge verification failed '+clip.id);}
  Object.assign(op,{state:'raw_downloaded',credits,rawSha256:sha(bytes),requestId:r.headers.get('request-id')||r.headers.get('x-request-id')});save();
 }
 const pcm=samples(raw),stats=inspect(pcm);if(stats.peak<.001||!Number.isFinite(stats.rms))throw Error('Silent/invalid provider output '+clip.id);
 const trim=trimStart(pcm,clip.cue),targetDb=clip.cue==='impact'?-2:clip.cue==='windup'?-7:clip.cue==='land'?-5:-9;
 let gainDb=Math.min(12,targetDb-20*Math.log10(stats.peak));const duration=stats.seconds-trim;
 if(duration<.15)throw Error('Effect contact too late '+clip.id);
 const render=()=>execFileSync('ffmpeg',['-y','-v','error','-i',raw,'-af',`atrim=start=${trim},asetpts=PTS-STARTPTS,highpass=f=35,volume=${gainDb}dB,afade=t=in:d=0.003,afade=t=out:st=${Math.max(0,duration-.06)}:d=0.06,alimiter=limit=0.89:level=0`,'-ar','44100','-ac','2','-b:a','192k',output],{stdio:'pipe'});
 render();let final=inspect(samples(output));
 // Trimming and DC filtering can change the peak substantially. Correct from
 // the original provider audio, never by repeatedly transcoding the MP3 output.
 for(let pass=0;pass<2&&Math.abs(targetDb-20*Math.log10(final.peak))>.75;pass++){
  gainDb+=targetDb-20*Math.log10(final.peak);render();final=inspect(samples(output));
 }
 if(final.peak>.99||final.rms<.001)throw Error('Audio QC failed '+clip.id);
 Object.assign(op,{state:'downloaded',sha256:sha(fs.readFileSync(output)),bytes:fs.statSync(output).size,seconds:final.seconds,peakDb:20*Math.log10(final.peak),rmsDb:20*Math.log10(final.rms),trimSeconds:trim,gainDb,completedAt:new Date().toISOString()});save();
 console.log('SFX_V2_READY '+clip.id+' credits='+op.credits+' seconds='+final.seconds.toFixed(2)+' peakDb='+op.peakDb.toFixed(1));
}
const manifest={version:2,provider:'ElevenLabs',model:ledger.model,clips:clips.map(c=>{const o=ledger.operations[c.id];return {id:c.id,family:c.family,cue:c.cue,path:'/assets/audio/combat/v2/'+c.id+'.mp3',sha256:o.sha256,bytes:o.bytes,seconds:o.seconds,peakDb:o.peakDb,rmsDb:o.rmsDb};})};
fs.writeFileSync(outDir+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log('SFX_V2_COMPLETE clips='+manifest.clips.length+' credits='+Object.values(ledger.operations).reduce((n,o)=>n+o.credits,0));
