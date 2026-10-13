import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {issue} from '../api/lib/auth.cjs';
import {neon} from '../api/lib/neon.cjs';

const args=process.argv.slice(2),option=(flag,fallback)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
const base=option('--base-url',process.env.DEPLOY_URL)?.replace(/\/$/,'');
assert(base,'Provide --base-url URL or DEPLOY_URL for the immutable deployment');
const origin=new URL(base).origin,authOnly=args.includes('--auth-only');
const expectedBuild=option('--expected-build',process.env.EXPECTED_BUILD_SHA);
const deploymentId=option('--deployment-id',process.env.VERCEL_DEPLOYMENT_ID);
const LOGIN_SCOPE='personal-onepiece-login-v1',checks=[];
assert.equal(new URL(base).protocol,'https:','Production authentication requires HTTPS');
assert(process.env.APP_PASSWORD,'APP_PASSWORD is required');
if(args.includes('--cleanup-test-login-window')){assert(!authOnly,'Cleanup is a separate administrator command');await cleanupLoginWindow();process.exit(0);}
if(!authOnly){assert.match(expectedBuild||'',/^[a-f0-9]{40}$/,'Full A10 needs the final EXPECTED_BUILD_SHA');assert(deploymentId,'Full A10 needs VERCEL_DEPLOYMENT_ID');assert(process.env.SESSION_SECRET?.length>=32,'Full A10 needs SESSION_SECRET to sign an expired session fixture');}
async function request(route,{expected,...options}={}){
 const result=await fetch(base+route,{redirect:'manual',signal:AbortSignal.timeout(30000),...options});
 if(expected!==undefined){checks.push({path:route,status:result.status,expected});assert.equal(result.status,expected,route);}
 assert.equal(result.headers.get('cache-control'),'no-store',`${route} must not cache private responses`);
 return result;
}
async function cleanupLoginWindow(){
 assert(process.env.CHESS_QUOTA_DATABASE_URL,'Administrator database credentials are required; no HTTP bypass exists');
 const evidenceFile='.local/verification-deploy.json',proof=JSON.parse(readFileSync(evidenceFile,'utf8'));
 assert.equal(proof.url,base,'Cleanup must match the deployment that was tested');
 assert.equal(proof.authAssertionsComplete,true,'Cleanup requires completed production assertions');
 assert.equal(proof.rateLimit?.blocked,true,'Cleanup requires the recorded real throttle proof');
 assert.equal(proof.rateLimit.scope,LOGIN_SCOPE,'Cleanup cannot select another application scope');
 if(proof.rateLimit.cleanup?.freshLoginVerified){console.log('LOGIN_TEST_WINDOW_ALREADY_CLEANED freshLogin=1');return;}
 assert(Date.now()-Date.parse(proof.timestamp)>=0&&Date.now()-Date.parse(proof.timestamp)<15*60*1000,'Cleanup proof expired; do not reset a later window');
 const select='SELECT key,count,window_until::text FROM epic_chess.login_limits WHERE (key=$1||\':global\' OR key LIKE $1||\':peer:%\') AND window_until>clock_timestamp() ORDER BY key';
 const selected=await neon(process.env,select,[LOGIN_SCOPE]);
 const counters=selected.rows.map(([key,count,window_until])=>({key,count:Number(count),window_until}));
 assert(counters.length&&counters.every(row=>row.key===LOGIN_SCOPE+':global'||row.key.startsWith(LOGIN_SCOPE+':peer:')),'No matching active project test window');
 const archiveFile=`.local/login-quota-archive-${randomUUID()}.json`;
 writeFileSync(archiveFile,JSON.stringify({timestamp:new Date().toISOString(),scope:LOGIN_SCOPE,url:base,build:proof.build,deploymentId:proof.deploymentId,throttleProof:proof.rateLimit,counters},null,2));
 // Lock and compare the complete active snapshot before deleting. New/changed
 // counters abort cleanup, and every mutation is restricted to this app scope.
 const cleared=await neon(process.env,`WITH actual AS MATERIALIZED (
  SELECT key,count,window_until FROM epic_chess.login_limits
  WHERE (key=$1||':global' OR key LIKE $1||':peer:%') AND window_until>clock_timestamp() FOR UPDATE
 ), expected AS (
  SELECT key,count,window_until FROM jsonb_to_recordset($2::jsonb) AS e(key text,count integer,window_until timestamptz)
 ), difference AS (
  (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)
 ), permitted AS (SELECT NOT EXISTS(SELECT FROM difference) AS okay), removed AS (
  DELETE FROM epic_chess.login_limits l WHERE (l.key=$1||':global' OR l.key LIKE $1||':peer:%')
  AND l.window_until>clock_timestamp() AND (SELECT okay FROM permitted) RETURNING l.key
 ) SELECT (SELECT okay FROM permitted),count(*) FROM removed`,[LOGIN_SCOPE,JSON.stringify(counters)]);
 assert(['t',true].includes(cleared.rows?.[0]?.[0]),'Test counters changed after archival; cleanup refused');
 assert.equal(Number(cleared.rows[0][1]),counters.length,'Cleanup must remove exactly the archived active counters');
 proof.rateLimit.cleanup={archiveFile,clearedRows:counters.length,scope:LOGIN_SCOPE,clearedAt:new Date().toISOString(),freshLoginVerified:false};
 writeFileSync(evidenceFile,JSON.stringify(proof,null,2));
 const login=await request('/api/login',{expected:200,method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:process.env.APP_PASSWORD})});
 const headers={Cookie:login.headers.get('set-cookie')},session=await(await request('/api/session',{expected:200,headers})).json();assert(session.csrfToken);
 await request('/api/logout',{expected:200,method:'POST',headers:{...headers,Origin:origin,'X-CSRF-Token':session.csrfToken}});
 proof.rateLimit.cleanup.freshLoginVerified=true;proof.rateLimit.cleanup.verificationChecks=checks;proof.completeA10=true;
 writeFileSync(evidenceFile,JSON.stringify(proof,null,2));
 console.log('LOGIN_TEST_WINDOW_CLEANED freshLogin=1',JSON.stringify({scope:LOGIN_SCOPE,archivedRows:counters.length,archiveFile}));
}
const health=await(await request('/api/health',{expected:200})).json();assert.equal(health.ok,true);
if(expectedBuild)assert.equal(health.build,expectedBuild,'Deployment health does not identify the expected commit');
const protectedPaths=['/assets/models/manifest.json','/assets/models/mugiwara/king.glb','/src/app.mjs','/styles.css','/api/voice/status','/api/session','/.env.local','/.claude/settings.local.json','/wiki/index.md','/projectstatus.html'];
for(const route of protectedPaths)await request(route,{expected:401});
await request('/',{expected:303});
for(const token of ['invalid.tampered','x.y.z'])await request('/api/session',{expected:401,headers:{Cookie:`chess_session=${token}`}});
if(!authOnly){const expired=issue(process.env.SESSION_SECRET,Date.now()-13*60*60*1000);await request('/api/session',{expected:401,headers:{Cookie:`chess_session=${expired}`}});}
await request('/api/login',{expected:403,method:'POST',headers:{Origin:'https://wrong-origin.invalid','Content-Type':'application/json'},body:JSON.stringify({password:process.env.APP_PASSWORD})});
await request('/api/login',{expected:401,method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'definitely-wrong'})});
const login=await request('/api/login',{expected:200,method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:process.env.APP_PASSWORD})});
const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Secure/i);assert.match(cookie,/SameSite=Strict/i);
const headers={Cookie:cookie},session=await(await request('/api/session',{expected:200,headers})).json();assert(session.csrfToken);
await request('/',{expected:200,headers});
const privatePaths=['/server.js','/script.js','/wiki/index.md','/.env','/.env.local','/.local/voice-agent.json','/.claude/settings.local.json','/.omx/state/epic-chess/ralph-progress.json','/docs/reports/epic-chess-ultraplan.md','/loops/epic-chess/README.md','/projectstatus.html','/api/bg-images','/api/lib/quota.cjs','/assets/raw/test.glb','/assets/references/test.png','/assets/provider-output/test.glb','/assets/models/test.json','/assets/%2e%2e%2fserver.js','/assets/%2e%2e/%2e%2e/.env.local'];
for(const route of privatePaths)await request(route,{expected:404,headers});
const voiceStatus=await(await request('/api/voice/status',{expected:200,headers})).json();assert.equal(voiceStatus.configured,true);assert.equal(voiceStatus.durable,true);
await request('/api/logout',{expected:403,method:'POST',headers});
if(!authOnly)await request('/api/voice/token',{expected:403,method:'POST',headers}); // CSRF rejection occurs before reservation or provider access.

const publishedHashes=[];
if(!authOnly){
 const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});assert.equal(head.status,0);assert.equal(head.stdout.trim(),expectedBuild,'Local source must be at the final deployment commit');
 const walk=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(`${directory}/${entry.name}`):[`${directory}/${entry.name}`]);
 const manifest=JSON.parse(readFileSync('assets/models/manifest.json','utf8'));assert.equal(manifest.required,66);assert.equal(manifest.assets.length,66);
 const music=walk('assets/bg_music').filter(file=>/\.(?:mp3|wav|ogg)$/.test(file)).sort((a,b)=>statSync(b).size-statSync(a).size)[0];assert(music,'Preserved music asset missing');
 const files=[['/','index.html'],['/styles.css','styles.css'],['/assets/models/manifest.json','assets/models/manifest.json'],...['src','vendor'].flatMap(walk).map(file=>['/'+file,file]),...manifest.assets.map(asset=>[asset.path,asset.path.replace(/^\//,'')]),['/'+music.split('/').map(encodeURIComponent).join('/'),music]];
 const secrets=Object.entries(process.env).filter(([key,value])=>/(?:API_KEY|API_TOKEN|SESSION_SECRET|DATABASE_URL|REST_TOKEN)$/.test(key)&&value.length>=16).map(([,value])=>value);
 for(let offset=0;offset<files.length;offset+=4){
  const results=await Promise.allSettled(files.slice(offset,offset+4).map(async([route,file])=>{
   const downloaded=Buffer.from(await(await request(route,{expected:200,headers})).arrayBuffer());
   const sha256=createHash('sha256').update(downloaded).digest('hex'),local=createHash('sha256').update(readFileSync(file)).digest('hex');
   assert.equal(sha256,local,`Published bytes differ from final source: ${file}`);
   if(/\.(?:m?js|cjs|html|css|json)$/.test(file)){const text=downloaded.toString('utf8');assert(!secrets.some(secret=>text.includes(secret)),`An environment secret reached published file ${file}`);}
   return {path:route,sha256,bytes:downloaded.length};
  }));
  for(const result of results){if(result.status==='rejected')throw result.reason;publishedHashes.push(result.value);}
 }
}
const logout=await request('/api/logout',{expected:200,method:'POST',headers:{...headers,Origin:origin,'X-CSRF-Token':session.csrfToken}});assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
await request('/api/session',{expected:401});await request('/api/session',{expected:401,headers});await request('/assets/models/manifest.json',{expected:401,headers});

let rateLimit=null;
if(!authOnly){
 // Run this final check after other production replays: it intentionally exhausts
 // the existing 10-minute login window, never a voice or provider allowance.
 for(let attempt=1;attempt<=101;attempt++){
  const response=await request('/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Forwarded-For':`198.51.100.${attempt}`},body:JSON.stringify({password:'rate-limit-verification-wrong'})});
  assert([401,429].includes(response.status),'Login throttle must reject with 401 or 429');
  if(response.status===429){rateLimit={blocked:true,scope:LOGIN_SCOPE,attempt,rotatedForwardingHeaders:true};break;}
 }
 assert(rateLimit?.blocked,'Durable global login throttle did not close within 101 attempts');
}
const evidence={timestamp:new Date().toISOString(),url:base,deploymentId:deploymentId||null,build:health.build,authAssertionsComplete:!authOnly,completeA10:false,checks,cookieFlags:{httpOnly:true,secure:true,sameSiteStrict:true},publishedHashes,rateLimit,limits:authOnly?['Auth-only preview check; final build hashes, expired signed session and endpoint rate-limit remain pending']:[]};
mkdirSync('.local',{recursive:true});writeFileSync('.local/verification-deploy.json',JSON.stringify(evidence,null,2));
if(!authOnly){
 const cleanup=spawnSync(process.execPath,[import.meta.filename,'--cleanup-test-login-window','--base-url',base],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
 if(cleanup.status!==0){process.stderr.write(cleanup.stderr||cleanup.stdout||'');throw Error('Administrator test-window cleanup failed; no final A10 claim');}
 process.stdout.write(cleanup.stdout);
 const complete=JSON.parse(readFileSync('.local/verification-deploy.json','utf8'));assert.equal(complete.rateLimit.cleanup.freshLoginVerified,true);assert.equal(complete.completeA10,true);
}
console.log(authOnly?'DEPLOY_AUTH_OK preview=1 A10=INCOMPLETE':'DEPLOY_OK unauthBlocked=1 badPasswordBlocked=1 login=1 assetsProtected=1 apiProtected=1 logout=1 noSecrets=1 noInternalDocs=1 rateLimit=1',JSON.stringify({build:health.build,url:base,deploymentId:deploymentId||null,verifiedFileHashes:publishedHashes.length}));
