const {neon}=require('./neon.cjs');
const VOICE_SCOPE='personal-onepiece-v1';
const VOICE_CAP_MICROUSD=3000000;
const MIN_RESERVATION_USD_PER_MINUTE=0.30;
const SETTLEMENT_MARGIN_USD=0.01;
// The legacy Redis reservation remains conservative; production tokens require Neon.
const RESERVE = `local now=tonumber(ARGV[1]); local active=redis.call('GET',KEYS[2]); if active then return {0,'active'} end; local count=tonumber(redis.call('GET',KEYS[3]) or '0'); if count>=20 then return {0,'rate'} end; local spent=tonumber(redis.call('GET',KEYS[1]) or '0'); local cost=tonumber(ARGV[2]); if spent+cost>tonumber(ARGV[3]) then return {0,'budget'} end; redis.call('INCRBY',KEYS[1],cost); redis.call('SET',KEYS[2],ARGV[4],'PX',ARGV[5]); redis.call('INCR',KEYS[3]); if count==0 then redis.call('PEXPIRE',KEYS[3],600000) end; return {1,spent+cost}`;
const FINISH = `if redis.call('GET',KEYS[1])==ARGV[1] then redis.call('DEL',KEYS[1]); return 1 end; return 0`;

function providerBill(value,conversation,agent){
 if(value?.conversation_id!==conversation||value.agent_id!==agent)throw Error('billing_unverified');
 if(!['done','failed'].includes(value.status))return null;
 const cost=value.metadata?.cost_fiat,llm=value.metadata?.charging?.llm_price;
 if(typeof cost!=='number'||typeof llm!=='number'||!Number.isFinite(cost)||!Number.isFinite(llm)||cost<0||llm<0)throw Error('billing_unverified');
 // cost_fiat can include LLM charges. Counting llm_price again, plus one cent,
 // deliberately overstates the verified final charge instead of understating it.
 const chargedMicrousd=Math.ceil((cost+llm+SETTLEMENT_MARGIN_USD)*1000000);
 if(!Number.isSafeInteger(chargedMicrousd)||chargedMicrousd<10000)throw Error('billing_unverified');
 return {status:value.status,cost,llm,chargedMicrousd};
}

class Quota {
 constructor(env=process.env,request=fetch,{scope=VOICE_SCOPE}={}){this.env=env;this.request=request;this.scope=scope;}
 get configured(){return Boolean(this.env.CHESS_QUOTA_DATABASE_URL || (this.env.UPSTASH_REDIS_REST_URL && this.env.UPSTASH_REDIS_REST_TOKEN));}
 async command(args){if(!this.configured)throw Error('durable_unavailable');const r=await this.request(this.env.UPSTASH_REDIS_REST_URL,{method:'POST',headers:{Authorization:`Bearer ${this.env.UPSTASH_REDIS_REST_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('durable_unavailable');const v=await r.json();if(v.error)throw Error('durable_unavailable');return v.result;}
 async reserve(session,id){
  const rate=Number(this.env.VOICE_RESERVATION_USD_PER_MINUTE || this.env.VOICE_MAX_USD_PER_MINUTE);
  if(!Number.isFinite(rate)||rate<=0)throw Error('rate_unverified');
  const cost=Math.ceil(Math.max(MIN_RESERVATION_USD_PER_MINUTE,rate)*5*1000000);
  const ceiling=Math.min(VOICE_CAP_MICROUSD,Math.floor(Number(this.env.VOICE_BUDGET_USD||3)*1000000));
  if(!Number.isFinite(ceiling)||ceiling<=0)throw Error('budget');
  if(this.env.CHESS_QUOTA_DATABASE_URL){
   const value=await neon(this.env,'SELECT epic_chess.reserve($1,$2,$3,$4::bigint,$5::bigint)',[this.scope,session,id,cost,ceiling],this.request);
   const outcome=value.rows?.[0]?.[0];
   if(outcome!=='ok')throw Error(['active','rate','budget'].includes(outcome)?outcome:'durable_unavailable');
   return {reservedMicrousd:cost};
  }
  const prefix='personal:onepiece:voice:v1';
  const result=await this.command(['EVAL',RESERVE,3,`${prefix}:spent`,`${prefix}:active`,`${prefix}:rate:${session}`,Date.now(),cost,ceiling,`${session}:${id}`,300000]);
  if(Number(result[0])!==1)throw Error(result[1]);
  return {reservedMicrousd:cost};
 }
 async current(){const value=await neon(this.env,'SELECT active_session,lease,conversation FROM epic_chess.quota WHERE scope=$1 AND active_until>now()',[this.scope],this.request);return value.rows?.[0];}
 async register(session,id,conversation){
  if(typeof conversation!=='string'||!conversation||conversation.length>256||!this.env.ELEVENLABS_AGENT_ID)throw Error('lease_unavailable');
  const result=await neon(this.env,'SELECT epic_chess.register_voice($1,$2,$3,$4,$5)',[this.scope,session,id,conversation,this.env.ELEVENLABS_AGENT_ID],this.request);
  if(result.rows?.[0]?.[0]!=='ok')throw Error('lease_unavailable');
 }
 async conversation(session,id){const v=await neon(this.env,'SELECT conversation FROM epic_chess.voice_ledger WHERE scope=$1 AND lease=$2 AND session=$3',[this.scope,id,session],this.request);return v.rows?.[0]?.[0];}
 async provider(conversation){
  if(!this.env.ELEVENLABS_API_KEY||!this.env.ELEVENLABS_AGENT_ID)throw Error('billing_unverified');
  const result=await this.request(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversation)}`,{headers:{'xi-api-key':this.env.ELEVENLABS_API_KEY},signal:AbortSignal.timeout(10000)});
  if(!result.ok)throw Error('billing_unverified');
  return providerBill(await result.json(),conversation,this.env.ELEVENLABS_AGENT_ID);
 }
 async reconcile(session,id){
  const result=await neon(this.env,'SELECT conversation,agent_id,actual FROM epic_chess.voice_ledger WHERE scope=$1 AND lease=$2 AND session=$3',[this.scope,id,session],this.request);
  const row=result.rows?.[0];
  if(!row?.[0]||row[1]!==this.env.ELEVENLABS_AGENT_ID)throw Error('lease_unavailable');
  if(row[2]!==null&&row[2]!==undefined)return {reconciled:true,chargedMicrousd:Number(row[2])};
  const bill=await this.provider(row[0]);
  if(!bill)return {reconciled:false};
  const settled=await neon(this.env,'SELECT epic_chess.settle_voice($1,$2,$3,$4,$5,$6,$7::numeric,$8::numeric)',[this.scope,session,id,row[0],this.env.ELEVENLABS_AGENT_ID,bill.status,bill.cost,bill.llm],this.request);
  if(!['settled','already_settled'].includes(settled.rows?.[0]?.[0]))throw Error('billing_unverified');
  return {reconciled:true,chargedMicrousd:bill.chargedMicrousd};
 }
 // A legacy reservation is adopted only by an explicit operator migration;
 // neither a browser finish nor a failed token grant can refund an unknown cost.
 async finish(session,id){return this.command(['EVAL',FINISH,1,'personal:onepiece:voice:v1:active',`${session}:${id}`]);}
}
module.exports={Quota,RESERVE,FINISH,providerBill,VOICE_SCOPE,VOICE_CAP_MICROUSD};
