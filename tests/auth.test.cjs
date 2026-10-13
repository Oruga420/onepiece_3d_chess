const {test}=require('node:test');const assert=require('node:assert/strict');const {issue,verify}=require('../api/lib/auth.cjs');const {createApp}=require('../api/app');
const env={APP_PASSWORD:'12345',SESSION_SECRET:'s'.repeat(48),APP_ORIGIN:'http://localhost'};
test('signed sessions reject tampering and expiry',()=>{const t=issue(env.SESSION_SECRET,1000);assert(verify(t,env.SESSION_SECRET,1001));assert.equal(verify(t+'x',env.SESSION_SECRET,1001),null);assert.equal(verify(t,env.SESSION_SECRET,1000+43200000),null);assert.equal(verify(t,'wrong',1001),null);});
test('authentication protects assets, API and private files; csrf and logout',async()=>{const server=createApp(env).listen(0);await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;try{for(const path of ['/assets/model.glb','/api/voice/status','/.env','/wiki/index.md','/server.js'])assert.equal((await fetch(base+path)).status,401);assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{Origin:'http://evil','Content-Type':'application/json'},body:'{"password":"12345"}'})).status,403);assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:'{"password":"wrong"}'})).status,401);const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:'{"password":"12345"}'});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);const headers={Cookie:cookie};const session=await (await fetch(base+'/api/session',{headers})).json();assert(session.csrfToken);assert.equal((await fetch(base+'/api/logout',{method:'POST',headers})).status,403);for(const path of ['/server.js','/wiki/index.md','/assets/../server.js','/assets/%2e%2e/server.js','/api/bg-images'])assert.equal((await fetch(base+path,{headers})).status,404);const status=await(await fetch(base+'/api/voice/status',{headers})).text();assert(!status.includes(env.SESSION_SECRET));assert(!status.includes('12345'));const logout=await fetch(base+'/api/logout',{method:'POST',headers:{...headers,Origin:env.APP_ORIGIN,'X-CSRF-Token':session.csrfToken}});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await fetch(base+'/api/session',{headers})).status,401);}finally{server.close();}});

test('client forwarding headers do not bypass local peer quota and production fails closed',async()=>{const server=createApp(env).listen(0);await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;try{for(let i=0;i<22;i++){const r=await fetch(base+'/api/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json','X-Forwarded-For':'198.51.100.'+i},body:'{"password":"wrong"}'});assert.equal(r.status,i<20?401:429);}}finally{server.close();}const prod=createApp({...env,NODE_ENV:'production'}).listen(0);await new Promise(r=>prod.once('listening',r));try{assert.equal((await fetch(`http://127.0.0.1:${prod.address().port}/api/login`,{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:'{"password":"12345"}'})).status,503);}finally{prod.close();}});
test('protected static commands and manifest never use stale caches',async()=>{const server=createApp(env).listen(0);await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;try{const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:'{"password":"12345"}'});const headers={Cookie:login.headers.get('set-cookie')};for(const path of ['/src/commands.mjs','/assets/models/manifest.json','/styles.css','/']){const r=await fetch(base+path,{headers});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');}}finally{server.close();}});
test('LIVE durable login atomic peer/global quotas survive parallel attempts',{skip:!process.env.CHESS_QUOTA_DATABASE_URL},async()=>{const {neon}=require('../api/lib/neon.cjs');const scope='qa-login-'+require('node:crypto').randomUUID();try{const calls=await Promise.all(Array.from({length:25},()=>neon(process.env,'SELECT epic_chess.login_attempt($1,$2)',[scope,'peer'])));assert.equal(calls.filter(v=>v.rows[0][0]==='t').length,20);await neon(process.env,'UPDATE epic_chess.login_limits SET count=100 WHERE key=$1',[scope+':global']);assert.equal((await neon(process.env,'SELECT epic_chess.login_attempt($1,$2)',[scope,'new-peer'])).rows[0][0],'f');}finally{await neon(process.env,'DELETE FROM epic_chess.login_limits WHERE key LIKE $1',[scope+'%']);}});

test('finish ignores browser billing, validates the provider and remains idempotent',async()=>{
 const voiceEnv={...env,CHESS_QUOTA_DATABASE_URL:'postgresql://user:password@example.neon.tech/db',ELEVENLABS_API_KEY:'unit-test-key',ELEVENLABS_AGENT_ID:'unit-test-agent'};
 const token=issue(env.SESSION_SECRET),session=verify(token,env.SESSION_SECRET);
 let actual=null,providerReads=0;const settlements=[];
 const server=createApp(voiceEnv,async(url,options)=>{
  if(url.startsWith('https://api.elevenlabs.io/')){providerReads++;return {ok:true,json:async()=>({agent_id:'unit-test-agent',conversation_id:'conv-unit',status:'done',metadata:{cost_fiat:0.044868060842751495,charging:{llm_price:0.0023024}}})};}
  const statement=JSON.parse(options.body);let rows=[];
  if(statement.query.includes('SELECT conversation,agent_id,actual'))rows=[['conv-unit','unit-test-agent',actual]];
  if(statement.query.includes('settle_voice')){settlements.push(statement.params);actual='57171';rows=[['settled']];}
  return {ok:true,json:async()=>({rows})};
 }).listen(0);
 await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`,headers={Origin:env.APP_ORIGIN,Cookie:`chess_session=${token}`,'Content-Type':'application/json','X-CSRF-Token':session.csrf};
 try{
  for(let i=0;i<2;i++){
   const result=await fetch(base+'/api/voice/finish',{method:'POST',headers,body:JSON.stringify({leaseId:'unit-lease',conversation_id:'forged-conversation',agent_id:'forged-agent',cost_fiat:-100,actual:0,status:'done'})});
   assert.equal(result.status,200);assert.deepEqual(await result.json(),{ok:true,reconciled:true,chargedMicrousd:57171});
  }
  assert.equal(providerReads,1);assert.equal(settlements.length,1);
  assert.deepEqual(settlements[0].slice(3),['conv-unit','unit-test-agent','done',0.044868060842751495,0.0023024]);
 }finally{server.close();}
});
test('token grants fail before provider access when durable budget rejects the reservation',async()=>{
 const voiceEnv={...env,CHESS_QUOTA_DATABASE_URL:'postgresql://user:password@example.neon.tech/db',ELEVENLABS_API_KEY:'unit-test-key',ELEVENLABS_AGENT_ID:'unit-test-agent',VOICE_PROVIDER_MAX_SECONDS:'300',VOICE_RESERVATION_USD_PER_MINUTE:'0.3',VOICE_BUDGET_USD:'3'};
 const token=issue(env.SESSION_SECRET),session=verify(token,env.SESSION_SECRET);let providerReads=0;
 const server=createApp(voiceEnv,async(url,options)=>{
  if(url.startsWith('https://api.elevenlabs.io/')){providerReads++;throw Error('provider access forbidden');}
  const statement=JSON.parse(options.body);return {ok:true,json:async()=>({rows:statement.query.includes('epic_chess.reserve')?[['budget']]:[]})};
 }).listen(0);
 await new Promise(resolve=>server.once('listening',resolve));
 try{
  const result=await fetch(`http://127.0.0.1:${server.address().port}/api/voice/token`,{method:'POST',headers:{Origin:env.APP_ORIGIN,Cookie:`chess_session=${token}`,'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:'{}'});
  assert.equal(result.status,429);assert.deepEqual(await result.json(),{error:'budget'});assert.equal(providerReads,0);
 }finally{server.close();}
});
