const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Rooms}=require('../api/lib/rooms.cjs');
const {createApp}=require('../api/app.js');
const {issue,verify}=require('../api/lib/auth.cjs');
const env={APP_PASSWORD:'12345',SESSION_SECRET:'s'.repeat(48),APP_ORIGIN:'http://localhost',CHESS_QUOTA_DATABASE_URL:'postgresql://unit-test:only@unit.neon.tech/db'};
function database(){
 const documents=new Map();let writes=0;
 const request=async(url,options)=>{
  const {query,params:p}=JSON.parse(options.body);let rows=[];
  if(query.startsWith('SELECT document')){const row=documents.get(p[0]);if(row)rows=[[JSON.stringify(row.doc)]];}
  else if(query.startsWith('INSERT INTO epic_chess.rooms')){
   const old=[...documents.values()].find(row=>row.owner===p[1]&&row.slot===p[2]);
   if(!old||old.doc.expiresAt<=Date.now()){if(old)documents.delete(old.doc.id);const doc=JSON.parse(p[4]);documents.set(p[0],{owner:p[1],slot:p[2],doc});rows=[[p[0]]];writes++;}
  }else if(query.startsWith('UPDATE epic_chess.rooms')){
   const row=documents.get(p[0]);if(row&&row.doc.revision===p[1]&&row.doc.expiresAt>Date.now()){row.doc=JSON.parse(p[2]);rows=[[p[0]]];writes++;}
  }else if(!query.startsWith('SELECT session FROM epic_chess.revocations'))throw Error('Unexpected SQL: '+query);
  return {ok:true,json:async()=>({rows})};
 };
 return {request,documents,get writes(){return writes;}};
}
const command=(revision,requestId='request-0001',move={from:'E2',to:'E4'})=>({revision,requestId,action:{kind:'move',move}});
test('atomic join gives exactly one marine; rejoin and spectator reads do not write',async()=>{
 const db=database(),rooms=new Rooms(env,db.request),room=await rooms.create('owner',{crew:'mugiwara'});
 assert.match(room.id,/^[a-f0-9]{24}$/);assert.equal(room.seat,'pirate');assert.equal(room.ready,false);
 const joined=await Promise.allSettled([rooms.join(room.id,'guest-a'),rooms.join(room.id,'guest-b')]);
 assert.equal(joined.filter(r=>r.status==='fulfilled').length,1);assert.equal(joined.find(r=>r.status==='rejected').reason.message,'room_full');
 const winner=joined[0].status==='fulfilled'?'guest-a':'guest-b',writes=db.writes;
 assert.equal((await rooms.join(room.id,winner)).seat,'marine');assert.equal((await rooms.join(room.id,'owner')).seat,'pirate');
 const spectator=rooms.view(await rooms.read(room.id),'stranger');assert.equal(spectator.seat,null);assert.equal(spectator.ready,true);assert.equal(db.writes,writes);
 assert.deepEqual(Object.keys(spectator).sort(),['id','revision','crew','seat','ready','expiresAt','result','state','lastAction'].sort());
 assert(!JSON.stringify(spectator).includes('guest-a'));assert(!Object.hasOwn(spectator,'receipts'));
});
test('server rejects spectators, prejoin, wrong turn, illegal actions and forged state',async()=>{
 const db=database(),rooms=new Rooms(env,db.request),room=await rooms.create('p',{});
 await assert.rejects(rooms.action(room.id,'p',command(0)),/waiting_for_opponent/);
 const joined=await rooms.join(room.id,'m');
 await assert.rejects(rooms.action(room.id,'spectator',command(joined.revision)),/spectator/);
 await assert.rejects(rooms.action(room.id,'m',command(joined.revision)),/wrong_turn/);
 await assert.rejects(rooms.action(room.id,'p',command(joined.revision,'illegal-1',{from:'E2',to:'E5'})),/illegal_action/);
 await assert.rejects(rooms.action(room.id,'p',{...command(joined.revision),state:{turn:'pirate'}}),/invalid_request/);
 await assert.rejects(rooms.action(room.id,'p',{revision:joined.revision,requestId:'request-123',action:{kind:'claim_draw',reason:'fifty-move'}}),/illegal_action/);
 assert.equal((await rooms.read(room.id)).revision,joined.revision);
});
test('concurrent actions commit once and exact retries never move twice',async()=>{
 const db=database(),rooms=new Rooms(env,db.request),room=await rooms.create('p',{}),joined=await rooms.join(room.id,'m');
 const a=command(joined.revision),b=command(joined.revision,'request-0002',{from:'D2',to:'D4'});
 const results=await Promise.allSettled([rooms.action(room.id,'p',a),rooms.action(room.id,'p',b)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.message,'stale_revision');
 const winner=results[0].status==='fulfilled'?a:b,latest=await rooms.read(room.id),writes=db.writes;
 assert.equal(latest.revision,joined.revision+1);assert.equal(latest.state.history.length,1);
 assert.equal((await rooms.action(room.id,'p',winner)).revision,latest.revision);assert.equal(db.writes,writes);
 await assert.rejects(rooms.action(room.id,'p',{...winner,action:{kind:'resign'}}),/request_id_conflict/);
 const black=await rooms.action(room.id,'m',command(latest.revision,'marine-001',{from:'E7',to:'E5'}));
 assert.equal(black.state.history.length,2);assert.equal(black.state.position.turn,'pirate');
});
test('concurrent identical request returns the canonical state to both callers',async()=>{
 const db=database(),rooms=new Rooms(env,db.request),room=await rooms.create('p',{}),joined=await rooms.join(room.id,'m'),body=command(joined.revision);
 const results=await Promise.all([rooms.action(room.id,'p',body),rooms.action(room.id,'p',body)]);
 assert.deepEqual(results[0],results[1]);assert.equal(results[0].state.history.length,1);
});
test('fruit state persists, consumed fruit fails, resignation ends both clients',async()=>{
 const db=database(),rooms=new Rooms(env,db.request),room=await rooms.create('p',{}),joined=await rooms.join(room.id,'m');
 const transformed=await rooms.action(room.id,'p',{revision:joined.revision,requestId:'fruit-0001',action:{kind:'fruit',square:'E2',fruit:'gomu-gomu'}});
 assert.equal(transformed.state.position.board[1][4].type,'queen');assert.equal(transformed.state.position.turn,'pirate');
 await assert.rejects(rooms.action(room.id,'p',{revision:transformed.revision,requestId:'fruit-0002',action:{kind:'fruit',square:'D2',fruit:'gomu-gomu'}}),/illegal_action/);
 const resigned=await rooms.action(room.id,'m',{revision:transformed.revision,requestId:'resign-001',action:{kind:'resign'}});
 assert.deepEqual(resigned.result,{reason:'resignation',winner:'pirate'});
 await assert.rejects(rooms.action(room.id,'p',command(resigned.revision)),/game_over/);
 assert.deepEqual(rooms.view(await rooms.read(room.id),'p').result,resigned.result);
});
test('room limit is atomic and expired slots can be reused without touching live rooms',async()=>{
 const db=database(),rooms=new Rooms(env,db.request);
 for(const crew of ['',0,null,{},'not-a-crew'])await assert.rejects(rooms.create('p',{crew}),/invalid_request/);
 const created=await Promise.allSettled(Array.from({length:8},()=>rooms.create('p',{})));
 assert.equal(created.filter(r=>r.status==='fulfilled').length,5);assert(created.filter(r=>r.status==='rejected').every(r=>r.reason.message==='room_limit'));
 const expired=[...db.documents.values()][0];expired.doc.expiresAt=Date.now()-1;
 await assert.rejects(rooms.read(expired.doc.id),/room_expired/);
 const replacement=await rooms.create('p',{});assert.notEqual(replacement.id,expired.doc.id);assert.equal(db.documents.size,5);
 await assert.rejects(rooms.read('../../.env'),/room_not_found/);
});
test('room HTTP routes require authentication and CSRF and return safe errors',async()=>{
 const db=database(),server=createApp(env,db.request).listen(0);await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`,token=issue(env.SESSION_SECRET),session=verify(token,env.SESSION_SECRET),headers={'Content-Type':'application/json',Origin:env.APP_ORIGIN,Cookie:`chess_session=${token}`,'X-CSRF-Token':session.csrf};
 try{
  assert.equal((await fetch(base+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(base+'/api/rooms',{method:'POST',headers:{...headers,'X-CSRF-Token':'bad'},body:'{}'})).status,403);
  const response=await fetch(base+'/api/rooms',{method:'POST',headers,body:'{}'});assert.equal(response.status,200);const room=await response.json();
  const get=await fetch(base+'/api/rooms/'+room.id,{headers});assert.equal(get.status,200);assert.equal(get.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(base+'/api/rooms/not-a-room',{headers})).status,404);
 }finally{server.close();}
});
test('login preserves only an exact room invite, including a failed-password retry',async()=>{
 const server=createApp({...env,CHESS_QUOTA_DATABASE_URL:undefined}).listen(0);await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`,room='abcdef0123456789abcdef01';
 try{
  assert.equal((await fetch(base+'/?room='+room,{redirect:'manual'})).headers.get('location'),'/login?room='+room);
  assert.match(await(await fetch(base+'/login?room='+room)).text(),new RegExp('name="room" value="'+room+'"'));
  const post=password=>fetch(base+'/api/login',{method:'POST',redirect:'manual',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password,room})});
  assert.match(await(await post('wrong')).text(),/name="room"/);assert.equal((await post('12345')).headers.get('location'),'/?room='+room);
  assert.equal((await fetch(base+'/?room=https://evil.test',{redirect:'manual'})).headers.get('location'),'/login');
 }finally{server.close();}
});

test('checking fruit transfers online authority to the defender',async()=>{
 const {ChessGame}=await import('../src/rules.mjs'),{packGame}=await import('../src/online-state.mjs');
 const db=database(),rooms=new Rooms(env,db.request),room=await rooms.create('p',{}),joined=await rooms.join(room.id,'m');
 db.documents.get(room.id).doc.state=packGame(new ChessGame('7k/8/7P/8/8/8/8/K7 w - - 0 1'));
 const checked=await rooms.action(room.id,'p',{revision:joined.revision,requestId:'fruit-check-1',action:{kind:'fruit',square:'H6',fruit:'gomu-gomu'}});
 assert.equal(checked.state.position.turn,'marine');assert.equal(checked.result,null);
 await assert.rejects(rooms.action(room.id,'p',command(checked.revision,'fruit-double',{from:'H6',to:'H7'})),/wrong_turn/);
 const replied=await rooms.action(room.id,'m',command(checked.revision,'fruit-reply1',{from:'H8',to:'G8'}));
 assert.equal(replied.state.position.turn,'pirate');
});

test('fruit checkmate stores an online winner and rejects later moves',async()=>{
 const {ChessGame}=await import('../src/rules.mjs'),{packGame}=await import('../src/online-state.mjs');
 const db=database(),rooms=new Rooms(env,db.request),room=await rooms.create('p',{}),joined=await rooms.join(room.id,'m');
 db.documents.get(room.id).doc.state=packGame(new ChessGame('7k/5K2/7P/8/8/8/8/8 w - - 0 1'));
 const ended=await rooms.action(room.id,'p',{revision:joined.revision,requestId:'fruit-mate-1',action:{kind:'fruit',square:'H6',fruit:'gomu-gomu'}});
 assert.deepEqual(ended.result,{reason:'checkmate',winner:'pirate'});
 await assert.rejects(rooms.action(room.id,'m',command(ended.revision,'fruit-after1',{from:'H8',to:'G8'})),/game_over/);
});
