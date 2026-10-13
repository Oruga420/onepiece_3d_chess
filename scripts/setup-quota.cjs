const {neon}=require('../api/lib/neon.cjs');
const statements=[
 'CREATE SCHEMA IF NOT EXISTS epic_chess',
 'CREATE TABLE IF NOT EXISTS epic_chess.quota (scope text PRIMARY KEY, spent bigint NOT NULL DEFAULT 0, active_until timestamptz, lease text)',
 'ALTER TABLE epic_chess.quota ADD COLUMN IF NOT EXISTS conversation text',
 'ALTER TABLE epic_chess.quota ADD COLUMN IF NOT EXISTS active_session text',
 'CREATE TABLE IF NOT EXISTS epic_chess.session_rates (scope text NOT NULL, session text NOT NULL, count integer NOT NULL DEFAULT 0, window_until timestamptz NOT NULL, PRIMARY KEY(scope,session))',
 'CREATE TABLE IF NOT EXISTS epic_chess.login_limits (key text PRIMARY KEY, count integer NOT NULL DEFAULT 0, window_until timestamptz NOT NULL)',
 'CREATE TABLE IF NOT EXISTS epic_chess.revocations (session text PRIMARY KEY, expires_at timestamptz NOT NULL)',
 `CREATE TABLE IF NOT EXISTS epic_chess.voice_ledger (
  scope text NOT NULL REFERENCES epic_chess.quota(scope), lease text NOT NULL, session text NOT NULL,
  reserved bigint NOT NULL CHECK(reserved>0), conversation text, agent_id text,
  actual bigint CHECK(actual>=10000), provider_status text, provider_cost_fiat numeric, provider_llm_price numeric,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), settled_at timestamptz,
  PRIMARY KEY(scope,lease), UNIQUE(scope,conversation)
 )`,
 `CREATE OR REPLACE FUNCTION epic_chess.reserve(p_scope text,p_session text,p_lease text,p_cost bigint,p_budget bigint) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE q epic_chess.quota%ROWTYPE; r epic_chess.session_rates%ROWTYPE;
 BEGIN
  IF p_cost IS NULL OR p_budget IS NULL OR p_cost<=0 OR p_budget<=0 OR p_budget>3000000 THEN RETURN 'budget'; END IF;
  INSERT INTO epic_chess.quota(scope) VALUES(p_scope) ON CONFLICT DO NOTHING;
  SELECT * INTO q FROM epic_chess.quota WHERE scope=p_scope FOR UPDATE;
  IF q.active_until>clock_timestamp() THEN RETURN 'active'; END IF;
  INSERT INTO epic_chess.session_rates(scope,session,window_until) VALUES(p_scope,p_session,clock_timestamp()+interval '10 minutes') ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM epic_chess.session_rates WHERE scope=p_scope AND session=p_session;
  IF r.window_until<=clock_timestamp() THEN UPDATE epic_chess.session_rates SET count=0,window_until=clock_timestamp()+interval '10 minutes' WHERE scope=p_scope AND session=p_session; r.count:=0; END IF;
  IF r.count>=20 THEN RETURN 'rate'; END IF;
  IF q.spent+p_cost>p_budget THEN RETURN 'budget'; END IF;
  IF EXISTS(SELECT FROM epic_chess.voice_ledger WHERE scope=p_scope AND lease=p_lease) THEN RETURN 'lease_unavailable'; END IF;
  INSERT INTO epic_chess.voice_ledger(scope,lease,session,reserved) VALUES(p_scope,p_lease,p_session,p_cost);
  UPDATE epic_chess.quota SET spent=spent+p_cost,active_until='infinity'::timestamptz,lease=p_lease,active_session=p_session,conversation=NULL WHERE scope=p_scope;
  UPDATE epic_chess.session_rates SET count=count+1 WHERE scope=p_scope AND session=p_session;
  RETURN 'ok';
 END $$`,
 `CREATE OR REPLACE FUNCTION epic_chess.register_voice(p_scope text,p_session text,p_lease text,p_conversation text,p_agent text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE q epic_chess.quota%ROWTYPE; l epic_chess.voice_ledger%ROWTYPE;
 BEGIN
  IF p_conversation IS NULL OR length(p_conversation)=0 OR length(p_conversation)>256 OR p_agent IS NULL OR length(p_agent)=0 THEN RETURN 'lease_unavailable'; END IF;
  SELECT * INTO q FROM epic_chess.quota WHERE scope=p_scope FOR UPDATE;
  IF NOT FOUND OR q.lease IS DISTINCT FROM p_lease OR q.active_session IS DISTINCT FROM p_session THEN RETURN 'lease_unavailable'; END IF;
  SELECT * INTO l FROM epic_chess.voice_ledger WHERE scope=p_scope AND lease=p_lease AND session=p_session FOR UPDATE;
  IF NOT FOUND OR l.actual IS NOT NULL OR (l.conversation IS NOT NULL AND l.conversation<>p_conversation) OR (l.agent_id IS NOT NULL AND l.agent_id<>p_agent) THEN RETURN 'lease_unavailable'; END IF;
  IF EXISTS(SELECT FROM epic_chess.voice_ledger WHERE scope=p_scope AND conversation=p_conversation AND lease<>p_lease) THEN RETURN 'lease_unavailable'; END IF;
  UPDATE epic_chess.voice_ledger SET conversation=p_conversation,agent_id=p_agent WHERE scope=p_scope AND lease=p_lease;
  UPDATE epic_chess.quota SET conversation=p_conversation WHERE scope=p_scope;
  RETURN 'ok';
 END $$`,
 `CREATE OR REPLACE FUNCTION epic_chess.settle_voice(p_scope text,p_session text,p_lease text,p_conversation text,p_agent text,p_status text,p_cost_fiat numeric,p_llm_price numeric) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE q epic_chess.quota%ROWTYPE; l epic_chess.voice_ledger%ROWTYPE; charge bigint;
 BEGIN
  SELECT * INTO q FROM epic_chess.quota WHERE scope=p_scope FOR UPDATE;
  IF NOT FOUND THEN RETURN 'lease_unavailable'; END IF;
  SELECT * INTO l FROM epic_chess.voice_ledger WHERE scope=p_scope AND lease=p_lease AND session=p_session FOR UPDATE;
  IF NOT FOUND OR l.conversation IS NULL OR l.agent_id IS NULL OR l.conversation IS DISTINCT FROM p_conversation OR l.agent_id IS DISTINCT FROM p_agent THEN RETURN 'lease_unavailable'; END IF;
  IF l.actual IS NOT NULL THEN RETURN 'already_settled'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('done','failed') OR p_cost_fiat IS NULL OR p_llm_price IS NULL OR p_cost_fiat<0 OR p_llm_price<0 OR p_cost_fiat::text IN ('NaN','Infinity','-Infinity') OR p_llm_price::text IN ('NaN','Infinity','-Infinity') THEN RETURN 'billing_unverified'; END IF;
  IF p_cost_fiat+p_llm_price+0.01>9007199254.740991 OR q.spent<l.reserved THEN RETURN 'billing_unverified'; END IF;
  charge:=ceil((p_cost_fiat+p_llm_price+0.01)*1000000)::bigint;
  UPDATE epic_chess.quota SET spent=spent-l.reserved+charge WHERE scope=p_scope;
  UPDATE epic_chess.voice_ledger SET actual=charge,provider_status=p_status,provider_cost_fiat=p_cost_fiat,provider_llm_price=p_llm_price,settled_at=clock_timestamp() WHERE scope=p_scope AND lease=p_lease;
  UPDATE epic_chess.quota SET active_until=NULL,lease=NULL,conversation=NULL,active_session=NULL WHERE scope=p_scope AND lease=p_lease AND active_session=p_session AND conversation=p_conversation;
  RETURN 'settled';
 END $$`,
 `CREATE OR REPLACE FUNCTION epic_chess.login_attempt(p_scope text,p_peer text) RETURNS boolean LANGUAGE plpgsql AS $$
 DECLARE global_row epic_chess.login_limits%ROWTYPE; peer_row epic_chess.login_limits%ROWTYPE;
 BEGIN
  INSERT INTO epic_chess.login_limits(key,window_until) VALUES(p_scope||':global',clock_timestamp()+interval '10 minutes') ON CONFLICT DO NOTHING;
  SELECT * INTO global_row FROM epic_chess.login_limits WHERE key=p_scope||':global' FOR UPDATE;
  IF global_row.window_until<=clock_timestamp() THEN UPDATE epic_chess.login_limits SET count=0,window_until=clock_timestamp()+interval '10 minutes' WHERE key=p_scope||':global';global_row.count:=0;END IF;
  IF global_row.count>=100 THEN RETURN false;END IF;
  UPDATE epic_chess.login_limits SET count=count+1 WHERE key=p_scope||':global';
  INSERT INTO epic_chess.login_limits(key,window_until) VALUES(p_scope||':peer:'||p_peer,clock_timestamp()+interval '10 minutes') ON CONFLICT DO NOTHING;
  SELECT * INTO peer_row FROM epic_chess.login_limits WHERE key=p_scope||':peer:'||p_peer FOR UPDATE;
  IF peer_row.window_until<=clock_timestamp() THEN UPDATE epic_chess.login_limits SET count=0,window_until=clock_timestamp()+interval '10 minutes' WHERE key=p_scope||':peer:'||p_peer;peer_row.count:=0;END IF;
  IF peer_row.count>=20 THEN RETURN false;END IF;
  UPDATE epic_chess.login_limits SET count=count+1 WHERE key=p_scope||':peer:'||p_peer;RETURN true;
 END $$`
];
async function setupSchema(env=process.env,request=fetch){for(const statement of statements)await neon(env,statement,[],request);}
if(require.main===module)setupSchema().then(()=>console.log('EPIC_CHESS_DURABLE_SCHEMA_READY')).catch(()=>{console.error('Durable schema setup failed');process.exitCode=1;});
module.exports={setupSchema,statements};
