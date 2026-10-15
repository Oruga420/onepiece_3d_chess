const express=require('express');
const path=require('node:path');
const crypto=require('node:crypto');
const {equal,issue,verify,SESSION_MS}=require('./lib/auth.cjs');
const {Quota}=require('./lib/quota.cjs');
const {neon}=require('./lib/neon.cjs');
const {roomRouter,ROOM_ID}=require('./lib/rooms.cjs');
const root=path.resolve(__dirname,'..');
const loginPage=`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grand Line · Acceso</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230d1c28'/%3E%3Ctext x='32' y='47' text-anchor='middle' font-size='48' fill='%23d49a66'%3E%E2%99%9A%3C/text%3E%3C/svg%3E"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at top,#183648,#07121c);color:#f4e4c9;font:18px system-ui}main{width:min(360px,80vw);border:1px solid #976b48;padding:40px;border-radius:18px;background:#0d1c28}small{color:#d49a66;letter-spacing:.18em}h1{font-size:36px}input,button{box-sizing:border-box;width:100%;padding:15px;border-radius:9px;font:inherit}input{background:#06121c;border:1px solid #77858b;color:white}button{margin-top:18px;background:#d49a66;border:0;color:#101b24;cursor:pointer}p{color:#c3c5bf;font-size:15px}</style><main><small>GRAND LINE CHESS</small><h1>Tu tripulación<br>te espera.</h1><p>Introduce la contraseña para entrar al tablero.</p><form action="/api/login" method="post"><label for="password">Contraseña</label><input id="password" name="password" type="password" required autocomplete="current-password" autofocus><button>Entrar al tablero →</button></form></main></html>`;
function invite(value){return typeof value==='string'&&ROOM_ID.test(value)?value:null;}
function loginHTML(value){const room=invite(value);return room?loginPage.replace('<label for="password">',`<input type="hidden" name="room" value="${room}"><label for="password">`):loginPage;}
function createApp(env=process.env,request=fetch){
 const app=express(),quota=new Quota(env,request);const secure=env.NODE_ENV==='production'||Boolean(env.VERCEL);const secret=env.SESSION_SECRET; const ready=typeof secret==='string'&&secret.length>=32&&Boolean(env.APP_PASSWORD);
 app.disable('x-powered-by');app.set('trust proxy',false);app.use(express.json({limit:'8kb'}));app.use(express.urlencoded({extended:false,limit:'2kb'}));
 app.use((req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"frame-ancestors 'none'; base-uri 'self'; object-src 'none'"});next();});
 const cookie=(res,value,maxAge)=>res.cookie('chess_session',value,{httpOnly:true,secure,sameSite:'strict',path:'/',maxAge});
 function origin(req){const expected=env.APP_ORIGIN||`${secure?'https':req.protocol}://${req.get('host')}`;return req.get('origin')===expected;}
 function session(req){const match=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('chess_session='));return ready&&match?verify(match.slice(14),secret):null;}
 app.get('/api/health',(req,res)=>res.json({ok:true,version:'2.0.0',build:env.VERCEL_GIT_COMMIT_SHA||env.BUILD_SHA||'local'}));
 app.get('/login',(req,res)=>ready?res.type('html').send(loginHTML(req.query.room)):res.status(503).send('Acceso temporalmente no disponible.'));
 const attempts=new Map();
 app.post('/api/login',async(req,res)=>{if(!ready)return res.status(503).json({error:'unavailable'});if(!origin(req))return res.status(403).json({error:'origin'});const key=crypto.createHash('sha256').update(req.socket.remoteAddress||'unknown-peer').digest('hex');if(env.CHESS_QUOTA_DATABASE_URL){try{const result=await neon(env,'SELECT epic_chess.login_attempt($1,$2)',['personal-onepiece-login-v1',key],request);if(result.rows?.[0]?.[0]!=='t'&&result.rows?.[0]?.[0]!==true)return res.status(429).json({error:'rate'});}catch{return res.status(503).json({error:'unavailable'});}}else{if(secure)return res.status(503).json({error:'unavailable'});const now=Date.now(),previous=attempts.get(key),state=previous&&previous.exp>now?previous:{count:0,exp:now+600000};attempts.set(key,state);if(++state.count>20)return res.status(429).json({error:'rate'});}if(!equal(req.body.password||'',env.APP_PASSWORD))return res.status(401).type('html').send(loginHTML(req.body.room).replace('Introduce la contraseña','Contraseña incorrecta. Introduce la contraseña'));cookie(res,issue(secret),SESSION_MS);return req.is('application/json')?res.json({ok:true}):res.redirect(303,invite(req.body.room)?'/?room='+invite(req.body.room):'/');});
 const revoked=new Map();
 app.use(async(req,res,next)=>{req.session=session(req);if(req.session){try{if(env.CHESS_QUOTA_DATABASE_URL){const value=await neon(env,'SELECT session FROM epic_chess.revocations WHERE session=$1 AND expires_at>now()',[req.session.id],request);if(value.rows.length)req.session=null;}else if(revoked.has(req.session.id))req.session=null;}catch{return res.status(503).json({error:'unavailable'});}}if(!req.session)return req.path==='/'?res.redirect(303,invite(req.query.room)?'/login?room='+invite(req.query.room):'/login'):res.status(401).json({error:'authentication_required'});next();});
 app.get('/api/session',(req,res)=>res.json({csrfToken:req.session.csrf}));
 app.use('/api',(req,res,next)=>{if(!['GET','HEAD'].includes(req.method)&&(!origin(req)||!equal(req.get('x-csrf-token')||'',req.session.csrf)))return res.status(403).json({error:'csrf'});next();});
 app.use('/api/rooms',roomRouter(env,request));
 app.post('/api/logout',async(req,res)=>{try{if(env.CHESS_QUOTA_DATABASE_URL)await neon(env,'INSERT INTO epic_chess.revocations(session,expires_at) VALUES($1,to_timestamp($2::double precision/1000)) ON CONFLICT DO NOTHING',[req.session.id,req.session.exp],request);else{for(const [id,exp]of revoked)if(exp<Date.now())revoked.delete(id);revoked.set(req.session.id,req.session.exp);}cookie(res,'',0);res.json({ok:true});}catch{res.status(503).json({error:'unavailable'});}});
 app.get('/api/voice/status',(req,res)=>res.json({configured:Boolean(env.ELEVENLABS_API_KEY&&env.ELEVENLABS_AGENT_ID),durable:quota.configured}));
 app.post('/api/voice/token',async(req,res)=>{
  if(!env.CHESS_QUOTA_DATABASE_URL||!env.ELEVENLABS_API_KEY||!env.ELEVENLABS_AGENT_ID||Number(env.VOICE_PROVIDER_MAX_SECONDS)!==300)return res.status(503).json({error:'voice_unavailable'});
  const leaseId=crypto.randomUUID();
  try{
   const active=await quota.current();
   if(active?.[2])await quota.reconcile(active[0],active[1]);
   await quota.reserve(req.session.id,leaseId);
  }catch(e){return res.status(['active','rate','budget'].includes(e.message)?429:503).json({error:['active','rate','budget'].includes(e.message)?e.message:'voice_unavailable'});}
  try{
   const r=await request(`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(env.ELEVENLABS_AGENT_ID)}`,{headers:{'xi-api-key':env.ELEVENLABS_API_KEY},signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error();
   const v=await r.json();
   if(typeof v.token!=='string'||!v.token||typeof v.conversation_id!=='string')throw Error();
   await quota.register(req.session.id,leaseId,v.conversation_id);
   res.json({token:v.token,leaseId,expiresAt:Date.now()+300000});
  }catch{res.status(503).json({error:'voice_unavailable'});}
 });
 // A browser disconnect or browser-supplied cost is not billing evidence. Only
 // the server's matching provider GET can settle a durable ledger reservation.
 app.post('/api/voice/finish',async(req,res)=>{
  try{const result=await quota.reconcile(req.session.id,String(req.body.leaseId||''));res.status(result.reconciled?200:202).json({ok:true,...result});}
  catch(e){res.status(e.message==='lease_unavailable'?409:503).json({error:e.message==='lease_unavailable'?'lease_unavailable':'voice_unavailable'});}
 });
 app.get('/',(req,res)=>res.sendFile(path.join(root,'index.html')));
 app.get('/styles.css',(req,res)=>res.sendFile(path.join(root,'styles.css')));
 app.use('/assets',(req,res,next)=>{if(req.path.startsWith('/references/')||req.path.startsWith('/raw/')||req.path.startsWith('/provider-output/')||(!/\.(glb|png|jpe?g|webp|gif|mp3|wav|ogg)$/i.test(req.path)&&req.path!=='/models/manifest.json'))return res.status(404).json({error:'not_found'});next();});
 for(const directory of ['src','vendor','assets'])app.use('/'+directory,express.static(path.join(root,directory),{dotfiles:'deny',index:false,fallthrough:true,setHeaders(res){res.set('Cache-Control','no-store');}}));
 app.use((req,res)=>res.status(404).json({error:'not_found'}));app.use((err,req,res,next)=>res.status(400).json({error:'invalid_request'}));return app;
}
module.exports=createApp();module.exports.createApp=createApp;
