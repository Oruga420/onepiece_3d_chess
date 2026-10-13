const crypto=require('node:crypto');
const express=require('express');
const {neon}=require('./neon.cjs');
const ROOM_ID=/^[a-f0-9]{24}$/;
const TTL=24*60*60*1000;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const fail=(code,status=409)=>{throw Object.assign(Error(code),{status});};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
const square=value=>typeof value==='string'&&/^[A-H][1-8]$/.test(value);
const validMove=move=>keys(move,['from','to','promotion'])&&square(move.from)&&square(move.to)&&(move.promotion===undefined||['queen','rook','bishop','knight'].includes(move.promotion));
function validAction(action){
 if(!object(action))return false;
 if(action.kind==='move')return keys(action,['kind','move'])&&validMove(action.move);
 if(action.kind==='fruit')return keys(action,['kind','square','fruit'])&&square(action.square)&&typeof action.fruit==='string';
 if(action.kind==='claim_draw')return keys(action,['kind','reason','intendedMove'])&&['fifty-move','threefold-repetition'].includes(action.reason)&&(action.intendedMove===undefined||validMove(action.intendedMove));
 return action.kind==='resign'&&keys(action,['kind']);
}
let imports;
function modules(){return imports ||= Promise.all([import('../../src/rules.mjs'),import('../../src/online-state.mjs'),import('../../src/roster.mjs')]);}
class Rooms {
 constructor(env,request=fetch){this.env=env;this.request=request;}
 async sql(query,params){return neon(this.env,query,params,this.request);}
 async read(id){
  if(!ROOM_ID.test(id))fail('room_not_found',404);
  const result=await this.sql('SELECT document FROM epic_chess.rooms WHERE id=$1',[id]);
  if(!result.rows.length)fail('room_not_found',404);
  const document=typeof result.rows[0][0]==='string'?JSON.parse(result.rows[0][0]):result.rows[0][0];
  if(document.expiresAt<=Date.now())fail('room_expired',410);
  return document;
 }
 view(room,session){const identity=hash(session);return {id:room.id,revision:room.revision,crew:room.crew,seat:room.owner===identity?'pirate':room.guest===identity?'marine':null,ready:!!room.guest,expiresAt:room.expiresAt,result:room.result,state:room.state,lastAction:room.lastAction};}
 async create(session,body){
  const [{ChessGame},{packGame},{CREWS}]=await modules();
  if(!keys(body,['crew'])||(body.crew!==undefined&&(typeof body.crew!=='string'||!Object.hasOwn(CREWS,body.crew))))fail('invalid_request',400);
  const room={id:crypto.randomBytes(12).toString('hex'),owner:hash(session),guest:null,crew:body.crew||'mugiwara',revision:0,expiresAt:Date.now()+TTL,result:null,state:packGame(new ChessGame()),lastAction:null,receipts:[]};
  // Five unique owner/slot rows make the live-room limit atomic across instances.
  for(let slot=0;slot<5;slot++){
   const result=await this.sql(`INSERT INTO epic_chess.rooms(id,owner,slot,expires_at,document) VALUES($1,$2,$3,to_timestamp($4::double precision/1000),$5::jsonb) ON CONFLICT(owner,slot) DO UPDATE SET id=EXCLUDED.id,expires_at=EXCLUDED.expires_at,document=EXCLUDED.document WHERE epic_chess.rooms.expires_at<=clock_timestamp() RETURNING id`,[room.id,room.owner,slot,room.expiresAt,JSON.stringify(room)]);
   if(result.rows.length)return this.view(room,session);
  }
  fail('room_limit',429);
 }
 async save(room,revision){
  const result=await this.sql(`UPDATE epic_chess.rooms SET document=$3::jsonb WHERE id=$1 AND (document->>'revision')::integer=$2 AND expires_at>clock_timestamp() RETURNING id`,[room.id,revision,JSON.stringify(room)]);
  return !!result.rows.length;
 }
 async join(id,session){
  const identity=hash(session);
  for(let attempt=0;attempt<4;attempt++){
   const room=await this.read(id);
   if(room.owner===identity||room.guest===identity)return this.view(room,session);
   if(room.guest)fail('room_full');
   const revision=room.revision;room.guest=identity;room.revision++;
   if(await this.save(room,revision))return this.view(room,session);
  }
  fail('stale_revision');
 }
 async action(id,session,body){
  if(!keys(body,['revision','requestId','action'])||!Number.isSafeInteger(body.revision)||body.revision<0||typeof body.requestId!=='string'||! /^[a-zA-Z0-9_-]{8,80}$/.test(body.requestId)||!validAction(body.action))fail('invalid_request',400);
  const identity=hash(session),fingerprint=hash(JSON.stringify({revision:body.revision,action:body.action}));
  const checkReceipt=room=>{const receipt=room.receipts.find(item=>item.session===identity&&item.id===body.requestId);if(receipt&&receipt.fingerprint!==fingerprint)fail('request_id_conflict');return !!receipt;};
  const room=await this.read(id),seat=this.view(room,session).seat;
  if(!seat)fail('spectator',403);
  if(checkReceipt(room))return this.view(room,session);
  if(!room.guest)fail('waiting_for_opponent');
  if(room.revision!==body.revision)fail('stale_revision');
  if(room.result)fail('game_over');
  if(room.revision>=1000)fail('room_action_limit');
  const [{ChessGame},{restoreGame,packGame}]=await modules();
  const game=restoreGame(new ChessGame(),room.state);
  if(game.status().over)fail('game_over');
  if(body.action.kind!=='resign'&&game.turn!==seat)fail('wrong_turn');
  let record;
  try{
   switch(body.action.kind){
    case 'move':record=game.move(body.action.move);break;
    case 'fruit':record=game.useDevilFruit(body.action);break;
    case 'claim_draw':game.claimDraw(body.action.reason,body.action.intendedMove);record={kind:'claim_draw',reason:body.action.reason};break;
    case 'resign':room.result={reason:'resignation',winner:seat==='pirate'?'marine':'pirate'};record={kind:'resign',player:seat};break;
   }
  }catch{fail('illegal_action');}
  const status=game.status();
  if(status.over)room.result={reason:status.reason,winner:status.winner};
  room.state=packGame(game);room.lastAction=record;room.revision++;
  room.receipts.push({session:identity,id:body.requestId,fingerprint});room.receipts=room.receipts.slice(-64);
  if(await this.save(room,body.revision))return this.view(room,session);
  const latest=await this.read(id);
  if(checkReceipt(latest))return this.view(latest,session);
  fail('stale_revision');
 }
}
function roomRouter(env,request){
 const router=express.Router(),rooms=new Rooms(env,request);
 const route=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(error){res.status(error.status||503).json({error:error.status?error.message:'rooms_unavailable'});}};
 router.post('/',route(req=>rooms.create(req.session.id,req.body)));
 router.get('/:id',route(async req=>rooms.view(await rooms.read(req.params.id),req.session.id)));
 router.post('/:id/join',route(req=>rooms.join(req.params.id,req.session.id)));
 router.post('/:id/actions',route(req=>rooms.action(req.params.id,req.session.id,req.body)));
 return router;
}
module.exports={Rooms,roomRouter,ROOM_ID};
