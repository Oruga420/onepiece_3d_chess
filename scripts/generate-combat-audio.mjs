import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const prompts=JSON.parse(fs.readFileSync('scripts/combat-sound-prompts.json','utf8'));
const ledgerPath='docs/reports/sound-effects-ledger.json';
const assets=JSON.parse(fs.readFileSync('docs/reports/assets-ledger.json','utf8'));
const reservedAssets=Object.values(assets.operations).reduce((n,o)=>n+(o.reservedUSD||0),0);
// Reserve the entire existing voice allowance, including future calls, plus all
// three historical TTS probes. SFX cannot borrow unused voice reservations.
const voiceCap=3,priorTts=.14,perClip=.05;
const ledger=fs.existsSync(ledgerPath)?JSON.parse(fs.readFileSync(ledgerPath,'utf8')):{
 provider:'ElevenLabs personal project key',model:'eleven_text_to_sound_v2',budgetUSD:30,
 assetReserveUSD:reservedAssets,voiceCapUSD:voiceCap,priorTtsReserveUSD:priorTts,
 priceSource:'https://elevenlabs.io/pricing/api',
 creditSource:'https://elevenlabs.io/docs/overview/capabilities/sound-effects',
 documentedUSDPerMinute:.12,documentedCreditsPerSecond:40,
 reservationPerClipUSD:perClip,operations:{},
};
const save=()=>fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
if(reservedAssets+voiceCap+priorTts+Object.keys(prompts).length*perClip>30)throw Error('Total project reserve exceeds USD30');
if(!process.argv.includes('--generate')){
 console.log(JSON.stringify({clips:Object.keys(prompts).length,seconds:Object.keys(prompts).length*2,newReservationUSD:.8,totalWorstCaseUSD:reservedAssets+voiceCap+priorTts+.8}));
 process.exit(0);
}
const key=process.env.ELEVENLABS_API_KEY;
if(!key)throw Error('Personal project key missing');
const headers={'xi-api-key':key,'Content-Type':'application/json'};
const subscriptionResponse=await fetch('https://api.elevenlabs.io/v1/user/subscription',{headers,signal:AbortSignal.timeout(15000)});
if(!subscriptionResponse.ok)throw Error('Personal subscription preflight '+subscriptionResponse.status);
const subscription=await subscriptionResponse.json();
if(subscription.status!=='active'||subscription.character_limit-subscription.character_count<1600)throw Error('Insufficient existing credits');
fs.mkdirSync('.local/combat-audio-raw',{recursive:true});
fs.mkdirSync('assets/audio/combat',{recursive:true});
for(const [id,description] of Object.entries(prompts)){
 const out='assets/audio/combat/'+id+'.mp3',existing=ledger.operations[id];
 if(existing?.state==='downloaded'){
  if(!fs.existsSync(out))throw Error('Missing generated audio '+id);
  continue;
 }
 if(existing)throw Error('Unsettled sound reservation '+id+'; no automatic paid retry');
 const prompt=description+' Powerful cinematic game combat one shot. Start the hit immediately, no buildup or leading silence. One isolated effect, no music, no melody, no speech, no dialogue. Exactly two seconds.';
 ledger.operations[id]={state:'reserved',reservedUSD:perClip,durationSeconds:2,prompt,startedAt:new Date().toISOString()};save();
 const response=await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128',{
  method:'POST',headers,body:JSON.stringify({text:prompt,duration_seconds:2,prompt_influence:.65,model_id:ledger.model,loop:false}),signal:AbortSignal.timeout(120000),
 });
 if(!response.ok){ledger.operations[id].httpStatus=response.status;save();throw Error('SFX generation '+id+' HTTP '+response.status);}
 const raw=Buffer.from(await response.arrayBuffer()),rawPath='.local/combat-audio-raw/'+id+'.mp3';fs.writeFileSync(rawPath,raw);
 const header=response.headers.get('character-cost'),credits=header===null?NaN:Number(header);
 if(!Number.isFinite(credits)||credits<0||credits>100){ledger.operations[id].state='downloaded-unverified-charge';save();throw Error('Unexpected audio charge '+id);}
 execFileSync('ffmpeg',['-y','-i',rawPath,'-af','silenceremove=start_periods=1:start_duration=0.005:start_threshold=-45dB,loudnorm=I=-18:TP=-2:LRA=7','-ar','44100','-ac','2','-b:a','128k',out],{stdio:'ignore'});
 const file=fs.readFileSync(out),probe=JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_format','-of','json',out],{encoding:'utf8'}));
 Object.assign(ledger.operations[id],{state:'downloaded',credits,requestId:response.headers.get('request-id')||response.headers.get('x-request-id'),rawSha256:crypto.createHash('sha256').update(raw).digest('hex'),sha256:crypto.createHash('sha256').update(file).digest('hex'),bytes:file.length,seconds:Number(probe.format.duration),completedAt:new Date().toISOString()});save();
 console.log('SFX_DOWNLOADED '+id+' credits='+credits+' bytes='+file.length);
}
const manifest={provider:'ElevenLabs',model:ledger.model,clips:Object.entries(ledger.operations).map(([id,o])=>({id,path:'/assets/audio/combat/'+id+'.mp3',sha256:o.sha256,bytes:o.bytes,seconds:o.seconds}))};
fs.writeFileSync('assets/audio/combat/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log('SFX_COMPLETE clips='+manifest.clips.length+' reservedUSD='+Object.values(ledger.operations).reduce((n,o)=>n+o.reservedUSD,0).toFixed(2));
