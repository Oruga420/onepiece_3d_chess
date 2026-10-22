import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineSession} from '../src/online.mjs';

const room = (revision = 0, extra = {}) => ({id:'room-123', revision, crew:'strawhat', seat:'pirate', ready:false, state:{}, ...extra});
const response = (data, status = 200) => ({ok:status >= 200 && status < 300, status, json:async () => data});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve=yes; reject=no; }); return {promise, resolve, reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, handler, extra = {}) {
  const calls = [], rooms = [], errors = [], statuses = [];
  const client = createOnlineSession({
    fetch:async (url, init) => { calls.push({url, ...init}); return handler(url, init); },
    onRoom:value => rooms.push(value), onError:error => errors.push(error), onStatus:value => statuses.push(value),
    randomUUID:() => 'stable-request-id', pollMs:60000, hiddenPollMs:60000, ...extra
  });
  t.after(() => client.leave());
  return {client, calls, rooms, errors, statuses};
}

test('create and join use authenticated POSTs and resume never takes an unclaimed seat', async t => {
  const f = fixture(t, async url => response(url === '/api/session' ? {csrfToken:'csrf'} : {room:room()}));
  await f.client.create({crew:'strawhat'});
  assert.equal(f.client.connected, true); assert.equal(f.client.seat, 'pirate');
  assert.equal(f.calls[1].url, '/api/rooms');
  assert.equal(f.calls[1].headers['X-CSRF-Token'], 'csrf');
  assert.deepEqual(JSON.parse(f.calls[1].body), {crew:'strawhat'});
  await f.client.join('room-123');
  assert.equal(f.calls.at(-1).url, '/api/rooms/room-123/join');
  await f.client.resume('room-123');
  assert.equal(f.calls.at(-1).method, 'GET');
  assert.equal(f.calls.at(-1).url, '/api/rooms/room-123');
});

test('actions wait for the server and unknown acknowledgements retry the same request exactly once', async t => {
  const ack = deferred(); let posts = 0;
  const f = fixture(t, async (url, init) => {
    if (url === '/api/session') return response({csrfToken:'csrf'});
    if (url.endsWith('/actions')) { posts++; if (posts === 1) throw TypeError('Failed to fetch'); return ack.promise; }
    return response(room());
  });
  await f.client.resume('room-123');
  const acting = f.client.act({type:'move', from:'E2', to:'E4'});
  await tick();
  assert.equal(f.client.pending, true); assert.equal(f.client.room.revision, 0);
  await assert.rejects(f.client.act({type:'move', from:'D2', to:'D4'}), /anterior/);
  ack.resolve(response(room(1, {ready:true})));
  await acting;
  const actions = f.calls.filter(call => call.url.endsWith('/actions'));
  assert.equal(actions.length, 2); assert.equal(actions[0].body, actions[1].body);
  assert.equal(JSON.parse(actions[0].body).requestId, 'stable-request-id');
  assert.equal(f.client.room.revision, 1); assert.equal(f.client.pending, false);
});

test('conflict reloads authoritative room without replaying a rejected move', async t => {
  let reads = 0;
  const f = fixture(t, async url => {
    if (url === '/api/session') return response({csrfToken:'csrf'});
    if (url.endsWith('/actions')) return response({error:'Partida actualizada', room:room(4)}, 409);
    reads++; return response(room());
  });
  await f.client.resume('room-123');
  await assert.rejects(f.client.act({type:'move'}), error => error.status === 409);
  assert.equal(f.client.room.revision, 4); assert.equal(reads, 1);
  assert.equal(f.calls.filter(call => call.url.endsWith('/actions')).length, 1);
});

test('a stale lower revision cannot roll back the displayed board', async t => {
  let reads = 0;
  const f = fixture(t, async () => response(room(++reads === 1 ? 5 : 3)));
  await f.client.resume('room-123'); await f.client.refresh();
  assert.equal(f.client.room.revision, 5); assert.equal(f.rooms.length, 1);
});

test('leave cancels even fetch implementations ignoring AbortSignal and fences late room updates', async t => {
  const late = deferred();
  const f = fixture(t, () => late.promise);
  const loading = f.client.resume('room-123');
  await tick(); f.client.leave();
  await assert.rejects(loading, error => error.name === 'AbortError');
  late.resolve(response(room())); await tick();
  assert.equal(f.client.room, null); assert.equal(f.client.connected, false);
  assert.equal(f.rooms.length, 0); assert.equal(f.errors.length, 0);
});

test('replacing a room fences results and errors from the previous generation', async t => {
  const late = deferred(); let reads = 0;
  const f = fixture(t, () => ++reads === 1 ? late.promise : response(room(0, {id:'new-room'})));
  const old = f.client.resume('room-123'); await tick();
  const replacement = f.client.resume('new-room');
  await assert.rejects(old, error => error.name === 'AbortError'); await replacement;
  late.resolve(response(room(9))); await tick();
  assert.equal(f.client.room.id, 'new-room'); assert.equal(f.rooms.length, 1);
});

test('poll requests coalesce and actions serialize behind an active poll', async t => {
  const pendingRead = deferred(); let reads = 0, inFlight = 0, maxFlight = 0;
  const f = fixture(t, async url => {
    inFlight++; maxFlight = Math.max(maxFlight, inFlight);
    try {
      if (url === '/api/session') return response({csrfToken:'csrf'});
      if (url.endsWith('/actions')) return response(room(1));
      return ++reads === 2 ? await pendingRead.promise : response(room());
    } finally { inFlight--; }
  });
  await f.client.resume('room-123');
  const first = f.client.refresh(), second = f.client.refresh();
  assert.equal(first, second);
  const action = f.client.act({type:'move'}); await tick();
  assert.equal(f.calls.filter(call => call.url.endsWith('/actions')).length, 0);
  pendingRead.resolve(response(room())); await first; await action;
  assert.equal(maxFlight, 1);
});

test('expired authentication stops polling rather than flooding the server', async t => {
  let reads = 0;
  const f = fixture(t, () => response(++reads === 1 ? room() : {error:'Unauthorized'}, reads === 1 ? 200 : 401));
  await f.client.resume('room-123');
  await assert.rejects(f.client.refresh(), /sesión caducó/);
  await f.client.refresh(); await f.client.refresh();
  assert.equal(f.calls.length, 2); assert.equal(f.client.connected, false);
  assert.equal(f.errors.length, 1);
});

test('requests and response bodies time out and clear pending without board mutation', async t => {
  const f = fixture(t, url => url === '/api/session' ? response({csrfToken:'csrf'}) : new Promise(() => {}), {requestTimeoutMs:5});
  await assert.rejects(f.client.create({crew:'strawhat'}), /tiempo/);
  assert.equal(f.client.pending, false); assert.equal(f.client.room, null);
  assert.equal(f.calls.at(-1).signal.aborted, true);
});

test('read-only visitors cannot send game actions', async t => {
  const f = fixture(t, () => response(room(0, {seat:null})));
  await f.client.resume('room-123');
  await assert.rejects(f.client.act({type:'move'}), /Únete/);
  assert.equal(f.calls.length, 1);
});

test('poll cadence follows document visibility and schedules after the completed read', async t => {
  const scheduled = new Map(); let id = 0;
  const document = {hidden:false};
  const f = fixture(t, () => response(room()), {
    document, pollMs:1500, hiddenPollMs:5000,
    setTimeout:(callback, ms) => { const key=++id; scheduled.set(key,{callback,ms}); return key; },
    clearTimeout:key => scheduled.delete(key)
  });
  await f.client.resume('room-123');
  assert.deepEqual([...scheduled.values()].map(item => item.ms), [1500]);
  document.hidden = true; await f.client.refresh();
  assert.deepEqual([...scheduled.values()].map(item => item.ms), [5000]);
  f.client.leave(); assert.equal(scheduled.size, 0);
});

test('a terminal room stops scheduled and stale polling without losing its connected result', async t => {
  const scheduled = new Map(); let id = 0, reads = 0;
  const result = {reason:'resignation', winner:'pirate'};
  const f = fixture(t, () => response(++reads === 1 ? room(1, {ready:true}) : room(2, {ready:true,result})), {
    pollMs:1500,
    setTimeout:(callback, ms) => { const key=++id; scheduled.set(key,{callback,ms}); return key; },
    clearTimeout:key => scheduled.delete(key)
  });
  await f.client.resume('room-123');
  const [timer, poll] = [...scheduled.entries()][0];
  assert.equal(poll.ms, 1500);
  scheduled.delete(timer); poll.callback(); await tick();
  assert.equal(reads, 2);
  assert.equal(scheduled.size, 0, 'completed games schedule no further database reads');
  assert.equal(f.client.connected, true);
  assert.deepEqual(f.client.room.result, result);
  poll.callback(); await f.client.refresh(); await tick();
  assert.equal(reads, 2, 'a stale callback or manual refresh cannot restart completed-game polling');
  assert.equal(f.client.room.revision, 2);
});
