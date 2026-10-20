const {neon}=require('./neon.cjs');
const VOICE_SCOPE='personal-onepiece-v1';
const SETTLEMENT_MARGIN_USD=0.01;

function rejectedBeforeAcceptance(value,agent){
 const metadata=value.metadata,charging=metadata?.charging,error=metadata?.error;
 const emptyObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===0;
 const emptyArray=value=>Array.isArray(value)&&value.length===0;
 const emptyGeneration=value=>emptyObject(value?.model_usage)&&emptyArray(value?.detailed_model_usage)&&Object.keys(value).length===2;
 const reasonPrefix=`Agent ${agent} has exceeded its daily call limit of `;
 return value.status==='failed'&&error?.code===4300&&error.error_type==='call_initialization_error'
  &&typeof error.reason==='string'&&error.reason.startsWith(reasonPrefix)&&/^[1-9]\d*\.$/.test(error.reason.slice(reasonPrefix.length))
  &&metadata.accepted_time_unix_secs===null&&metadata.call_duration_secs===0
  &&['has_audio','has_user_audio','has_response_audio','has_auxiliary_audio'].every(key=>value[key]===false)&&emptyArray(value.transcript)
  &&metadata.cost===null&&metadata.cost_fiat===null
  &&charging!==null&&typeof charging==='object'
  &&['llm_price','llm_charge','call_charge','platform_charge','platform_price','tts_usage','asr_usage','analysis'].every(key=>charging[key]===null)
  &&charging.free_minutes_consumed===0&&charging.free_llm_dollars_consumed===0
  &&emptyGeneration(charging.llm_usage?.irreversible_generation)&&emptyGeneration(charging.llm_usage?.initiated_generation)
  &&Object.keys(charging.llm_usage).length===2&&emptyObject(charging.platform_usage?.category_usage)&&Object.keys(charging.platform_usage).length===1;
}

function providerBill(value,conversation,agent){
 if(value?.conversation_id!==conversation||value.agent_id!==agent)throw Error('billing_unverified');
 if(!['done','failed'].includes(value.status))return null;
 // Only this provider-verified pre-acceptance rejection can derive zero from
 // null billing. Unknown failures retain their reservation until costs exist.
 const rejected=rejectedBeforeAcceptance(value,agent);
 const cost=rejected?0:value.metadata?.cost_fiat,llm=rejected?0:value.metadata?.charging?.llm_price;
 if(typeof cost!=='number'||typeof llm!=='number'||!Number.isFinite(cost)||!Number.isFinite(llm)||cost<0||llm<0)throw Error('billing_unverified');
 // cost_fiat can include LLM charges. Counting llm_price again, plus one cent,
 // deliberately overstates the verified final charge instead of understating it.
 const chargedMicrousd=Math.ceil((cost+llm+SETTLEMENT_MARGIN_USD)*1000000);
 if(!Number.isSafeInteger(chargedMicrousd)||chargedMicrousd<10000)throw Error('billing_unverified');
 return {status:value.status,cost,llm,chargedMicrousd,basis:rejected?'rejected_before_acceptance_daily_limit':'provider_final_charges'};
}

class Quota {
 constructor(env=process.env,request=fetch,{scope=VOICE_SCOPE}={}){this.env=env;this.request=request;this.scope=scope;}
 get configured(){return Boolean(this.env.CHESS_QUOTA_DATABASE_URL);}
 async reserve(session,id){
  const value=await neon(this.env,'SELECT epic_chess.reserve_voice_session($1,$2,$3)',[this.scope,session,id],this.request);
  const outcome=value.rows?.[0]?.[0];
  if(outcome!=='ok')throw Error(['active','rate','lease_unavailable'].includes(outcome)?outcome:'durable_unavailable');
  return {reservedMicrousd:0};
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
}
module.exports={Quota,providerBill,VOICE_SCOPE};
