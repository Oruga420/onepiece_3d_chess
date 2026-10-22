import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';

const argument = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name)+1] : undefined;
const base = argument('--base-url') || process.env.BASE_URL || 'http://localhost:3043';
const out = path.resolve('docs/reports/browser', new URL(base).hostname.replaceAll('.', '-'));
fs.mkdirSync(out, {recursive:true});
const report = {base, startedAt:new Date().toISOString(), checks:[], errors:[], passed:false};
let server, browser;
const save = () => fs.writeFileSync(path.join(out, 'online.json'), JSON.stringify(report, null, 2));
const mark = text => { report.checks.push(text); console.log(text); };

async function pageFor(label) {
  const context = await browser.newContext({viewport:{width:1440,height:1050}, reducedMotion:'reduce'});
  const page = await context.newPage();
  page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(30000);
  page.on('pageerror', error => report.errors.push({label, message:error.message}));
  return page;
}
async function login(page, url = base + '/') {
  await page.goto(url, {waitUntil:'domcontentloaded'});
  if (new URL(page.url()).pathname === '/login') {
    await page.fill('#password', process.env.APP_PASSWORD || '12345');
    await Promise.all([page.waitForURL(url => url.pathname === '/', {waitUntil:'domcontentloaded'}), page.click('button')]);
  }
  await loaded(page);
}
async function loaded(page) {
  await page.waitForFunction(() => Boolean(window.chessApp), null, {timeout:30000});
  await page.evaluate(() => window.chessApp.whenReady);
  await settled(page);
}
async function settled(page) {
  await page.waitForFunction(() => !window.chessApp.busy && !window.chessApp.online.pending);
}
async function square(page, value) {
  await page.locator('#board-canvas').scrollIntoViewIfNeeded();
  const point = await page.evaluate(value => window.chessApp.view.squareToScreen(value), value);
  await page.mouse.click(point.x, point.y);
}
async function snapshot(page) {
  return page.evaluate(() => ({fen:window.chessApp.game.fen(), history:window.chessApp.game.history.length,
    revision:window.chessApp.online.room?.revision, seat:window.chessApp.online.seat,
    turn:window.chessApp.game.turn, room:window.chessApp.online.room?.id,
    result:window.chessApp.online.room?.result}));
}
async function together(host, guest, history) {
  for (const page of [host, guest]) {
    await page.waitForFunction(history => window.chessApp.game.history.length === history && !window.chessApp.busy && !window.chessApp.online.pending, history);
  }
  const left = await snapshot(host), right = await snapshot(guest);
  assert.equal(left.fen, right.fen, 'both player boards agree');
  assert.equal(left.revision, right.revision, 'both player revisions agree');
  const authoritative = await host.evaluate(async id => {
    const response = await fetch('/api/rooms/'+id, {signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw Error('Room read failed '+response.status);
    return response.json();
  }, left.room);
  const room = authoritative.room || authoritative;
  assert.equal(room.revision, left.revision);
  assert.equal(room.state.history.length, history);
  report.latest = {host:left, guest:right, serverRevision:room.revision};
  return left;
}
async function post(page, endpoint, body) {
  return page.evaluate(async ({endpoint, body}) => {
    const session = await fetch('/api/session', {signal:AbortSignal.timeout(15000)}).then(response => response.json());
    const response = await fetch(endpoint, {method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},
      body:JSON.stringify(body), signal:AbortSignal.timeout(15000)});
    return {status:response.status, data:await response.json()};
  }, {endpoint, body});
}

try {
  server = await chromium.launchServer({headless:true, channel:argument('--browser-channel') || process.env.BROWSER_CHANNEL});
  browser = await chromium.connect(server.wsEndpoint());
  const host = await pageFor('host'), guest = await pageFor('guest');
  await login(host);
  await host.click('#online-create');
  await host.waitForFunction(() => window.chessApp.online.seat === 'pirate' && !window.chessApp.online.pending);
  const invite = await host.inputValue('#online-link'); report.invite = invite;
  assert.match(invite, /\?room=[a-f0-9]{24}$/);
  await login(guest, invite);
  await guest.waitForFunction(() => window.chessApp.online.seat === 'marine' && window.chessApp.online.room.ready);
  await host.waitForFunction(() => window.chessApp.online.room.ready);
  await together(host, guest, 0);
  mark('Independent sessions create/invite/login-preservation/automatic Marine join pass');

  await square(host, 'E2'); await square(host, 'E4');
  const afterHost = await together(host, guest, 1);
  assert.equal(afterHost.turn, 'marine');
  const wrongTurn = await post(host, `/api/rooms/${afterHost.room}/actions`, {
    revision:afterHost.revision, requestId:crypto.randomUUID(), action:{kind:'move',move:{from:'D2',to:'D4'}}
  });
  assert(wrongTurn.status >= 400 && wrongTurn.status < 500, 'server rejects wrong player turn');
  await together(host, guest, 1);
  report.wrongTurn = wrongTurn;
  await square(guest, 'E7'); await square(guest, 'E5');
  await together(host, guest, 2);
  mark('Real mouse moves E2–E4 and E7–E5 synchronize; server rejects wrong-turn POST');

  const third = await pageFor('third'); await login(third);
  const beforeThird = await snapshot(host);
  const full = await post(third, `/api/rooms/${beforeThird.room}/join`, {});
  assert.equal(full.status, 409);
  const spectator = await third.evaluate(async id => fetch('/api/rooms/'+id, {signal:AbortSignal.timeout(15000)}).then(response => response.json()), beforeThird.room);
  assert.equal((spectator.room || spectator).seat, null);
  assert.equal((spectator.room || spectator).revision, beforeThird.revision);
  const spectatorWrite = await post(third, `/api/rooms/${beforeThird.room}/actions`, {
    revision:beforeThird.revision, requestId:crypto.randomUUID(), action:{kind:'resign'}
  });
  assert(spectatorWrite.status >= 400 && spectatorWrite.status < 500);
  report.thirdPlayer = {join:full, write:spectatorWrite};
  await third.goto(invite, {waitUntil:'domcontentloaded'}); await loaded(third);
  await third.waitForFunction(() => Boolean(window.chessApp.online.room) && !window.chessApp.online.pending);
  assert.equal(await third.evaluate(() => window.chessApp.online.seat), null);
  assert.equal(await third.locator('#online-seat').innerText(), 'Espectador');
  for (const id of ['undo-button','reset-button','crew-select','online-resign']) {
    assert.equal(await third.locator('#'+id).isDisabled(), true, 'spectator '+id+' stays locked');
  }
  assert.equal((await snapshot(third)).fen, beforeThird.fen);
  report.thirdPlayer.inviteUI = {seat:null, localControlsLocked:true, boardMatches:true};
  await third.context().close();
  mark('A third session stays a spectator through invite UI and cannot replace seats or resign');

  await square(host, 'A2'); await host.click('[data-fruit="gomu-gomu"]');
  await together(host, guest, 3);
  for (const page of [host, guest]) {
    const fruit = await page.evaluate(() => ({type:window.chessApp.game.board[1][0]?.type,
      rendered:window.chessApp.view.pieces.get('A2')?.userData.piece.type,
      kind:window.chessApp.game.history.at(-1)?.kind}));
    assert.deepEqual(fruit, {type:'queen',rendered:'queen',kind:'devil_fruit'});
  }
  mark('Devil fruit A2 transforms and synchronizes real queen models and history');

  for (const page of [host, guest]) { await page.reload({waitUntil:'domcontentloaded'}); await loaded(page); }
  await together(host, guest, 3);
  assert.equal((await snapshot(host)).seat, 'pirate'); assert.equal((await snapshot(guest)).seat, 'marine');
  for (const page of [host, guest]) for (const id of ['undo-button','reset-button','crew-select','ai-toggle']) {
    assert.equal(await page.locator('#'+id).isDisabled(), true, id+' disabled in online game');
  }
  mark('Reload preserves both seats and history; local reset/undo/crew/AI controls disabled');

  const denied = await guest.evaluate(() => window.chessApp.commands.runTool('propose_move', {from:'G8',to:'F6'}, {source:'voice'}));
  assert.equal(denied.ok, false);
  const voice = await host.evaluate(() => {
    const before = window.chessApp.game.fen();
    const result = window.chessApp.commands.runTool('propose_move', {from:'G1',to:'F3'}, {source:'voice'});
    return {before, after:window.chessApp.game.fen(), result};
  });
  assert.equal(voice.result.ok, true); assert.equal(voice.result.queued, true);
  assert.equal(voice.after, voice.before, 'voice command never makes an optimistic board move');
  await together(host, guest, 4); report.voiceCommand = voice;
  mark('Shared voice command transport waits for server ACK; wrong-role command rejected (no paid voice call)');

  for (const [page, name] of [[host, 'online-host.png'], [guest, 'online-guest.png']]) {
    await page.evaluate(() => { window.scrollTo(0,0); return new Promise(requestAnimationFrame); });
    await page.screenshot({path:path.join(out,name),fullPage:true});
  }
  await guest.setViewportSize({width:390,height:844});
  await guest.evaluate(() => window.scrollTo(0,0));
  const mobile = await guest.evaluate(() => ({viewport:innerWidth,width:document.documentElement.scrollWidth}));
  assert(mobile.width <= mobile.viewport, 'mobile layout does not overflow horizontally');
  await guest.screenshot({path:path.join(out,'online-mobile.png'),fullPage:true});report.mobile = mobile;

  await guest.click('#online-resign');
  for (const page of [host, guest]) await page.waitForFunction(() => window.chessApp.online.room?.result?.reason === 'resignation');
  await together(host, guest, 4);
  assert.equal((await snapshot(host)).result.winner, 'pirate');
  assert.equal((await snapshot(guest)).result.winner, 'pirate');
  mark('Resignation is persisted and ends both boards with the same winner');
  await host.click('#online-leave');
  await host.waitForFunction(() => !window.chessApp.online.room && !window.chessApp.busy);
  assert.equal(await host.evaluate(() => window.chessApp.game.history.length), 0);
  assert.equal(new URL(host.url()).searchParams.has('room'), false);
  assert.equal(await host.locator('#online-create').isVisible(), true);
  mark('Leaving restores a fresh local game and removes the invitation query');
  assert.deepEqual(report.errors, []);
  report.passed = true; report.completedAt = new Date().toISOString();save();
  console.log('ONLINE_OK independentPlayers=2 invite=1 serverAuthority=1 mouse=2 fruit=1 reload=2 voiceTransport=1 resignation=1 mobile=1');
} catch (error) {
  report.error = error.stack;save();console.error(error.stack);process.exitCode=1;
} finally {
  let timer;
  try { await Promise.race([server?.close() || browser?.close(), new Promise(resolve => {timer=setTimeout(() => {void server?.kill();resolve();},5000);})]); }
  finally { clearTimeout(timer); }
}
