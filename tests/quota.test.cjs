const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Quota,providerBill}=require('../api/lib/quota.cjs');
const {neon}=require('../api/lib/neon.cjs');
const agent='personal-test-agent',conversation='conv-test';
const bill=()=>({conversation_id:conversation,agent_id:agent,status:'done',metadata:{cost_fiat:0.044868060842751495,charging:{llm_price:0.0023024}}});
const durableEnv={CHESS_QUOTA_DATABASE_URL:'postgresql://user:password@example.neon.tech/db',ELEVENLABS_API_KEY:'unit-test-key',ELEVENLABS_AGENT_ID:agent,VOICE_RESERVATION_USD_PER_MINUTE:'0.3',VOICE_BUDGET_USD:'3'};
const response=rows=>({ok:true,json:async()=>({rows})});
const rejectedCall=()=>({conversation_id:conversation,agent_id:agent,status:'failed',has_audio:false,has_user_audio:false,has_response_audio:false,has_auxiliary_audio:false,transcript:[],metadata:{accepted_time_unix_secs:null,call_duration_secs:0,cost:null,cost_fiat:null,error:{code:4300,error_type:'call_initialization_error',reason:`Agent ${agent} has exceeded its daily call limit of 4.`},charging:{llm_price:null,llm_charge:null,call_charge:null,platform_charge:null,platform_price:null,tts_usage:null,asr_usage:null,analysis:null,free_minutes_consumed:0,free_llm_dollars_consumed:0,llm_usage:{irreversible_generation:{model_usage:{},detailed_model_usage:[]},initiated_generation:{model_usage:{},detailed_model_usage:[]}},platform_usage:{category_usage:{}}}}});

test('voice quota fails closed without Neon durable state',async()=>{
 await assert.rejects(new Quota({VOICE_MAX_USD_PER_MINUTE:'0.1'}).reserve('s','x'),/durable_unavailable/);
 await assert.rejects(new Quota({}).reserve('s','x'),/durable_unavailable/);
 assert.equal(new Quota({UPSTASH_REDIS_REST_URL:'https://example.invalid',UPSTASH_REDIS_REST_TOKEN:'unit-test-token'}).configured,false);
});
test('session reservation ignores old monetary limits and never prepays USD1.50',async()=>{
 for(const value of ['3','0','invalid',undefined]){
  const queries=[];
  const q=new Quota({...durableEnv,VOICE_BUDGET_USD:value,VOICE_RESERVATION_USD_PER_MINUTE:value,VOICE_MAX_USD_PER_MINUTE:value},async(url,options)=>{queries.push(JSON.parse(options.body));return response([['ok']]);});
  assert.deepEqual(await q.reserve('session','lease'),{reservedMicrousd:0});
  assert.equal(queries[0].query,'SELECT epic_chess.reserve_voice_session($1,$2,$3)');
  assert.deepEqual(queries[0].params,[q.scope,'session','lease']);
 }
});
test('durable outages, active sessions, rate limits and reused leases never grant a token',async()=>{
 await assert.rejects(new Quota(durableEnv,async()=>({ok:false})).reserve('s','a'),/durable_unavailable/);
 for(const reason of ['active','rate','lease_unavailable'])await assert.rejects(new Quota(durableEnv,async()=>response([[reason]])).reserve('s','b'),new RegExp(reason));
 await assert.rejects(new Quota(durableEnv,async()=>response([['unexpected']])).reserve('s','c'),/durable_unavailable/);
});
test('provider billing requires matching final identity and finite nonnegative charges',()=>{
 assert.equal(providerBill(bill(),conversation,agent).chargedMicrousd,57171);
 assert.equal(providerBill({...bill(),status:'processing'},conversation,agent),null);
 assert.equal(providerBill({...bill(),status:'failed'},conversation,agent).chargedMicrousd,57171);
 for(const value of [{...bill(),agent_id:'other-agent'},{...bill(),conversation_id:'other-conversation'},{...bill(),metadata:{}},...[-1,NaN,Infinity,'0.1',null].map(cost=>({...bill(),metadata:{cost_fiat:cost,charging:{llm_price:0}}})),{...bill(),metadata:{cost_fiat:0,charging:{llm_price:-1}}}])assert.throws(()=>providerBill(value,conversation,agent),/billing_unverified/);
});

test('verified daily-limit rejection before acceptance settles only the conservative one-cent margin',()=>{
 assert.deepEqual(providerBill(rejectedCall(),conversation,agent),{status:'failed',cost:0,llm:0,chargedMicrousd:10000,basis:'rejected_before_acceptance_daily_limit'});
});

test('null billing cannot release accepted, used, unknown, missing, or mismatched provider calls',()=>{
 const mutations=[
  value=>value.agent_id='other',value=>value.conversation_id='other',value=>value.status='done',
  value=>value.metadata.accepted_time_unix_secs=123,value=>delete value.metadata.accepted_time_unix_secs,
  value=>value.metadata.call_duration_secs=1,value=>value.metadata.call_duration_secs='0',
  ...['has_audio','has_user_audio','has_response_audio','has_auxiliary_audio'].flatMap(key=>[value=>value[key]=true,value=>delete value[key]]),
  value=>value.transcript=[{role:'user',message:'hola'}],value=>delete value.transcript,
  value=>value.metadata.error.code=1000,value=>value.metadata.error.code='4300',value=>value.metadata.error.error_type='other',
  value=>value.metadata.error.reason='Unknown initialization failure',value=>value.metadata.error.reason='Agent other has exceeded its daily call limit of 4.',
  value=>delete value.metadata.error,value=>value.metadata.cost=-1,value=>delete value.metadata.cost,
  ...['llm_price','llm_charge','call_charge','platform_charge','platform_price','tts_usage','asr_usage','analysis'].flatMap(key=>[value=>value.metadata.charging[key]=-1,value=>delete value.metadata.charging[key]]),
  ...['cost_fiat'].flatMap(key=>[value=>value.metadata[key]=-1,value=>delete value.metadata[key]]),
  value=>value.metadata.charging.free_minutes_consumed=1,value=>value.metadata.charging.free_llm_dollars_consumed=0.01,
  value=>value.metadata.charging.llm_usage.irreversible_generation.model_usage={model:1},
  value=>value.metadata.charging.llm_usage.initiated_generation.detailed_model_usage=[{}],
  value=>value.metadata.charging.llm_usage.other_usage={},value=>delete value.metadata.charging.llm_usage,
  value=>value.metadata.charging.platform_usage.category_usage={asr:1},value=>value.metadata.charging.platform_usage.other_usage={},
 ];
 for(const [index,mutate]of mutations.entries()){
  const value=rejectedCall();mutate(value);
  assert.throws(()=>providerBill(value,conversation,agent),/billing_unverified/,`unsafe rejection mutation ${index}`);
 }
 for(const status of ['processing','initiated','in-progress'])assert.equal(providerBill({...rejectedCall(),status},conversation,agent),null);
});

test('verified rejected call sends derived numeric charges through the existing settlement transaction',async()=>{
 const queries=[];
 const q=new Quota(durableEnv,async(url,options)=>{
  if(url.startsWith('https://api.elevenlabs.io/'))return {ok:true,json:async()=>rejectedCall()};
  const request=JSON.parse(options.body);queries.push(request);
  return response(request.query.includes('settle_voice')?[['settled']]:[[conversation,agent,null]]);
 });
 assert.deepEqual(await q.reconcile('session','lease'),{reconciled:true,chargedMicrousd:10000});
 assert.deepEqual(queries[1].params.slice(-3),['failed',0,0]);
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
test('LIVE Neon admits sessions above the retired USD3 cap with no prepayment and retains concurrency and rate limits',{skip:!process.env.CHESS_QUOTA_DATABASE_URL},async()=>{
 const scope='qa-unmetered-'+randomUUID(),session='qa-session';
 const env={...process.env,VOICE_BUDGET_USD:'3',VOICE_RESERVATION_USD_PER_MINUTE:'0.3'};
 const q=new Quota(env,fetch,{scope});
 const state=async()=>(await neon(env,'SELECT spent,lease,active_until>clock_timestamp(),active_until<=clock_timestamp()+interval \'6 minutes\' FROM epic_chess.quota WHERE scope=$1',[scope])).rows[0];
 try{
  await neon(env,'INSERT INTO epic_chess.quota(scope,spent) VALUES($1,5000000)',[scope]);
  const results=await Promise.allSettled(Array.from({length:20},(_,i)=>q.reserve(session,'lease-'+i)));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected'&&result.reason.message==='active').length,19);
  assert.deepEqual(results.find(result=>result.status==='fulfilled').value,{reservedMicrousd:0});
  const first=await state();assert.equal(first[0],'5000000');assert.deepEqual(first.slice(2),['t','t']);
  assert.deepEqual((await neon(env,'SELECT reserved FROM epic_chess.voice_ledger WHERE scope=$1',[scope])).rows,[['0']]);
  await neon(env,"UPDATE epic_chess.quota SET active_until=clock_timestamp()-interval '1 second' WHERE scope=$1",[scope]);
  await assert.rejects(q.reserve(session,first[1]),/lease_unavailable/);
  await neon(env,'UPDATE epic_chess.session_rates SET count=20 WHERE scope=$1',[scope]);
  await assert.rejects(q.reserve(session,'rate-lease'),/rate/);
  await neon(env,"UPDATE epic_chess.session_rates SET window_until=clock_timestamp()-interval '1 second' WHERE scope=$1",[scope]);
  assert.deepEqual(await q.reserve(session,'next-window'),{reservedMicrousd:0});
  assert.equal((await state())[0],'5000000');
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
  assert.deepEqual((await state()).slice(0,2),['0',lease]);
  const receipts=await Promise.all(Array.from({length:20},()=>q.reconcile(session,lease)));
  assert(receipts.every(receipt=>receipt.reconciled&&receipt.chargedMicrousd===57171));
  assert.deepEqual(await state(),['57171',null,null,null]);
  assert.equal((await neon(env,'SELECT actual,provider_cost_fiat,provider_llm_price FROM epic_chess.voice_ledger WHERE scope=$1 AND lease=$2',[scope,lease])).rows[0][0],'57171');
  await q.reserve(session,'second-lease');await q.register(session,'second-lease','conv-second');
  assert.deepEqual((await state()).slice(0,2),['57171','second-lease']);
  await q.reconcile(session,lease);
  assert.equal(await settle(session,lease,'conv-second',agent,'done',0,0),'lease_unavailable');
  assert.deepEqual((await state()).slice(0,2),['57171','second-lease']);
  await assert.rejects(q.reserve(session,'third-lease'),/active/);
 }finally{await clean(scope);}
});
