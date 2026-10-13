const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Quota,RESERVE,providerBill}=require('../api/lib/quota.cjs');
const {neon}=require('../api/lib/neon.cjs');
const agent='personal-test-agent',conversation='conv-test';
const bill=()=>({conversation_id:conversation,agent_id:agent,status:'done',metadata:{cost_fiat:0.044868060842751495,charging:{llm_price:0.0023024}}});
const durableEnv={CHESS_QUOTA_DATABASE_URL:'postgresql://user:password@example.neon.tech/db',ELEVENLABS_API_KEY:'unit-test-key',ELEVENLABS_AGENT_ID:agent,VOICE_RESERVATION_USD_PER_MINUTE:'0.3',VOICE_BUDGET_USD:'3'};
const response=rows=>({ok:true,json:async()=>({rows})});

test('voice quota fails closed without durable state or verified maximum rate',async()=>{
 await assert.rejects(new Quota({VOICE_MAX_USD_PER_MINUTE:'0.1'}).reserve('s','x'),/durable_unavailable/);
 await assert.rejects(new Quota({}).reserve('s','x'),/rate_unverified/);
});
test('atomic reservation never falls below USD1.50 or raises the USD3 cap',async()=>{
 const commands=[];
 const q=new Quota({UPSTASH_REDIS_REST_URL:'https://example.invalid',UPSTASH_REDIS_REST_TOKEN:'unit-test-token',VOICE_MAX_USD_PER_MINUTE:'0.12',VOICE_BUDGET_USD:'99'},async(url,options)=>{commands.push(JSON.parse(options.body));return {ok:true,json:async()=>({result:[1,1500000]})};});
 assert.equal((await q.reserve('session','lease')).reservedMicrousd,1500000);
 assert.equal(commands[0][0],'EVAL');assert.equal(commands[0][2],3);assert.equal(commands[0][7],1500000);assert.equal(commands[0][8],3000000);
 assert.match(RESERVE,/count>=20/);assert.match(RESERVE,/spent\+cost/);assert.match(RESERVE,/'PX'/);
});
test('durable outages and active sessions never grant a token',async()=>{
 const env={UPSTASH_REDIS_REST_URL:'https://example.invalid',UPSTASH_REDIS_REST_TOKEN:'unit-test-token',VOICE_MAX_USD_PER_MINUTE:'0.1'};
 await assert.rejects(new Quota(env,async()=>({ok:false})).reserve('s','a'),/durable_unavailable/);
 await assert.rejects(new Quota(env,async()=>({ok:true,json:async()=>({result:[0,'active']})})).reserve('s','b'),/active/);
});
test('provider billing requires matching final identity and finite nonnegative charges',()=>{
 assert.equal(providerBill(bill(),conversation,agent).chargedMicrousd,57171);
 assert.equal(providerBill({...bill(),status:'processing'},conversation,agent),null);
 assert.equal(providerBill({...bill(),status:'failed'},conversation,agent).chargedMicrousd,57171);
 for(const value of [{...bill(),agent_id:'other-agent'},{...bill(),conversation_id:'other-conversation'},{...bill(),metadata:{}},...[-1,NaN,Infinity,'0.1',null].map(cost=>({...bill(),metadata:{cost_fiat:cost,charging:{llm_price:0}}})),{...bill(),metadata:{cost_fiat:0,charging:{llm_price:-1}}}])assert.throws(()=>providerBill(value,conversation,agent),/billing_unverified/);
});
test('unknown or nonfinal provider usage cannot submit a refund transaction',async()=>{
 for(const value of [null,{...bill(),status:'processing'},{...bill(),agent_id:'other-agent'},{...bill(),metadata:{}}]){
  const sql=[];const q=new Quota(durableEnv,async(url,options)=>{
   if(url.startsWith('https://api.elevenlabs.io/'))return {ok:value!==null,json:async()=>value};
   const query=JSON.parse(options.body).query;sql.push(query);return response([[conversation,agent,null]]);
  });
  if(value?.status==='processing')assert.deepEqual(await q.reconcile('session','lease'),{reconciled:false});
  else await assert.rejects(q.reconcile('session','lease'),/billing_unverified/);
  assert.equal(sql.some(query=>query.includes('settle_voice')),false);
 }
});
test('stored settlement is idempotent without trusting browser or repeating provider reads',async()=>{
 let vendorReads=0;
 const q=new Quota(durableEnv,async(url)=>{if(url.startsWith('https://api.elevenlabs.io/'))vendorReads++;return response([[conversation,agent,'57171']]);});
 assert.deepEqual(await q.reconcile('session','lease'),{reconciled:true,chargedMicrousd:57171});
 assert.equal(vendorReads,0);
});

async function clean(scope){
 await neon(process.env,'DELETE FROM epic_chess.voice_ledger WHERE scope=$1',[scope]);
 await neon(process.env,'DELETE FROM epic_chess.session_rates WHERE scope=$1',[scope]);
 await neon(process.env,'DELETE FROM epic_chess.quota WHERE scope=$1',[scope]);
}
test('LIVE Neon serializes reservation contention and enforces session and budget limits',{skip:!process.env.CHESS_QUOTA_DATABASE_URL},async()=>{
 const scope='qa-'+randomUUID();
 try{
  const calls=await Promise.all(Array.from({length:20},(_,i)=>neon(process.env,'SELECT epic_chess.reserve($1,$2,$3,$4::bigint,$5::bigint)',[scope,'test-session','lease-'+i,1,100])));
  assert.equal(calls.filter(v=>v.rows[0][0]==='ok').length,1);assert.equal(calls.filter(v=>v.rows[0][0]==='active').length,19);
  await neon(process.env,"UPDATE epic_chess.quota SET active_until=now()-interval '1 second' WHERE scope=$1",[scope]);
  await neon(process.env,'UPDATE epic_chess.session_rates SET count=20 WHERE scope=$1',[scope]);
  assert.equal((await neon(process.env,'SELECT epic_chess.reserve($1,$2,$3,$4::bigint,$5::bigint)',[scope,'test-session','rate-lease',1,100])).rows[0][0],'rate');
  await neon(process.env,'UPDATE epic_chess.session_rates SET count=0 WHERE scope=$1',[scope]);
  assert.equal((await neon(process.env,'SELECT epic_chess.reserve($1,$2,$3,$4::bigint,$5::bigint)',[scope,'test-session','budget-lease',100,100])).rows[0][0],'budget');
  assert.equal((await neon(process.env,'SELECT epic_chess.reserve($1,$2,$3,$4::bigint,$5::bigint)',[scope,'test-session','raised-cap',1,3000001])).rows[0][0],'budget');
 }finally{await clean(scope);}
});
test('LIVE Neon settles once under contention and preserves a subsequent active lease',{skip:!process.env.CHESS_QUOTA_DATABASE_URL},async()=>{
 const scope='qa-settle-'+randomUUID(),session='qa-session',lease='first-lease';
 const env={...process.env,...durableEnv,CHESS_QUOTA_DATABASE_URL:process.env.CHESS_QUOTA_DATABASE_URL};
 const q=new Quota(env,async(url,options)=>url.startsWith('https://api.elevenlabs.io/')?{ok:true,json:async()=>bill()}:fetch(url,options),{scope});
 const state=async()=> (await neon(env,'SELECT spent,lease,active_session,conversation FROM epic_chess.quota WHERE scope=$1',[scope])).rows[0];
 const settle=async(...parameters)=>(await neon(env,'SELECT epic_chess.settle_voice($1,$2,$3,$4,$5,$6,$7::numeric,$8::numeric)',[scope,...parameters])).rows[0][0];
 try{
  await q.reserve(session,lease);await q.register(session,lease,conversation);
  assert.equal(await settle('other-session',lease,conversation,agent,'done',0,0),'lease_unavailable');
  assert.equal(await settle(session,lease,'other-conversation',agent,'done',0,0),'lease_unavailable');
  assert.equal(await settle(session,lease,conversation,'other-agent','done',0,0),'lease_unavailable');
  for(const [status,cost,llm]of [['processing',0,0],['done',-1,0],['done','NaN',0],['failed',null,0],['done',0,-1]])assert.equal(await settle(session,lease,conversation,agent,status,cost,llm),'billing_unverified');
  assert.deepEqual((await state()).slice(0,2),['1500000',lease]);
  const receipts=await Promise.all(Array.from({length:20},()=>q.reconcile(session,lease)));
  assert(receipts.every(receipt=>receipt.reconciled&&receipt.chargedMicrousd===57171));
  assert.deepEqual(await state(),['57171',null,null,null]);
  assert.equal((await neon(env,'SELECT actual,provider_cost_fiat,provider_llm_price FROM epic_chess.voice_ledger WHERE scope=$1 AND lease=$2',[scope,lease])).rows[0][0],'57171');
  await q.reserve(session,'second-lease');await q.register(session,'second-lease','conv-second');
  assert.deepEqual((await state()).slice(0,2),['1557171','second-lease']);
  await q.reconcile(session,lease);
  assert.equal(await settle(session,lease,'conv-second',agent,'done',0,0),'lease_unavailable');
  assert.deepEqual((await state()).slice(0,2),['1557171','second-lease']);
  await assert.rejects(q.reserve(session,'third-lease'),/active/);
 }finally{await clean(scope);}
});
