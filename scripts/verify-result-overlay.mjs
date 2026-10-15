import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {ChessGame, START_FEN} from '../src/rules.mjs';
import {packGame} from '../src/online-state.mjs';

const argument = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const base = argument('--base-url') || process.env.BASE_URL || 'http://localhost:3043';
const out = path.resolve('docs/reports/browser', new URL(base).hostname.replaceAll('.', '-'));
fs.mkdirSync(out, {recursive:true});
const report = {base, startedAt:new Date().toISOString(), checks:[], screenshots:[], errors:[], passed:false};
const mark = text => { report.checks.push(text); console.log(text); };
const victory = '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1';
const defeatGame = new ChessGame();
for (const [from,to] of [['F2','F3'],['E7','E5'],['G2','G4'],['D8','H4']]) defeatGame.move({from,to});
const fixtures = [
 {kind:'victory', title:'¡Victoria!', fen:victory},
 {kind:'defeat', title:'Derrota', fen:defeatGame.fen()},
 {kind:'draw', title:'Empate', fen:'7k/5K2/6Q1/8/8/8/8/8 b - - 0 1'},
];
let browser;
async function loaded(page) {
 await page.waitForFunction(() => Boolean(window.chessApp));
 await page.evaluate(() => window.chessApp.whenReady);
 await page.waitForFunction(() => !window.chessApp.busy);
}
async function login(page) {
 await page.goto(base, {waitUntil:'domcontentloaded'});
 if (new URL(page.url()).pathname === '/login') {
  await page.fill('#password', process.env.APP_PASSWORD || '12345');
  await Promise.all([page.waitForURL(url => url.pathname === '/', {waitUntil:'domcontentloaded'}), page.click('button')]);
 }
 await loaded(page);
}
async function expectResult(page, kind, title) {
 await page.waitForFunction(kind => {
  const dialog = document.querySelector('#result-overlay');
  return dialog?.open && dialog.dataset.kind === kind && !window.chessApp.busy;
 }, kind);
 assert.equal(await page.locator('#result-overlay-title').innerText(), title);
 assert.equal(await page.evaluate(() => document.activeElement.matches('.result-overlay__replay')), true, 'keyboard focus enters result');
}
async function screenshot(page, name) {
 await page.evaluate(async () => {
  const animations = document.querySelector('#result-overlay').getAnimations({subtree:true});
  await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
 });
 const file = path.join(out, name + '.png');
 await page.screenshot({path:file});
 report.screenshots.push(file);
}
async function state(page) {
 return page.evaluate(() => ({fen:window.chessApp.game.fen(), version:window.chessApp.game.version,
  history:window.chessApp.game.history.length, open:document.querySelector('#result-overlay').open}));
}
try {
 browser = await chromium.launch({headless:true, channel:argument('--browser-channel') || process.env.BROWSER_CHANNEL});
 const context = await browser.newContext({viewport:{width:1440,height:1050}, reducedMotion:'no-preference'});
 const page = await context.newPage();
 page.setDefaultTimeout(30000);
 page.on('pageerror', error => report.errors.push(error.message));
 await login(page);
 await page.evaluate(() => window.chessApp.setAI(false));
 for (const fixture of fixtures) {
  assert.equal(new ChessGame(fixture.fen).status().over, true, fixture.kind + ' is engine-terminal');
  await page.evaluate(fen => window.chessApp.loadFEN(fen), fixture.fen);
  await expectResult(page, fixture.kind, fixture.title);
  const animationCount = await page.evaluate(() => document.querySelector('#result-overlay').getAnimations({subtree:true}).length);
  assert(animationCount > 0, fixture.kind + ' has actual CSS animation');
  await screenshot(page, 'result-' + fixture.kind);
  const before = await state(page);
  await page.click('.result-overlay__dismiss');
  const after = await state(page);
  assert.deepEqual({...after,open:true}, before, 'Ver tablero preserves completed position');
  await page.evaluate(async () => { window.chessApp.setAI(false); await new Promise(requestAnimationFrame); });
  assert.equal((await state(page)).open, false, 'same terminal state is not reopened by UI refresh');
  mark(fixture.kind + ': correct title, finite animation, focus, screenshot, dismiss and no-reopen pass');
 }

 // Exercise the real move/animation/app lifecycle, not a standalone dialog fixture.
 await page.evaluate(() => window.chessApp.loadFEN('7k/8/5KQ1/8/8/8/8/8 w - - 0 1'));
 const immediate = await page.evaluate(() => {
  const result = window.chessApp.commands.move({from:'G6',to:'G7'}, {source:'mouse'});
  return {ok:result.ok, busy:window.chessApp.busy, over:window.chessApp.game.status().over, open:document.querySelector('#result-overlay').open};
 });
 assert.deepEqual(immediate, {ok:true,busy:true,over:true,open:false});
 await expectResult(page, 'victory', '¡Victoria!');
 await page.keyboard.press('Escape');
 assert.equal((await state(page)).open, false);
 await page.evaluate(fen => window.chessApp.loadFEN(fen), victory);
 await expectResult(page, 'victory', '¡Victoria!');
 await page.click('.result-overlay__replay');
 await page.waitForFunction(() => !window.chessApp.game.status().over && !document.querySelector('#result-overlay').open && !window.chessApp.busy);
 assert.equal((await state(page)).fen, START_FEN);
 mark('Final mating move waits for animation completion; Escape dismisses; Nueva partida resets local game');

 await page.emulateMedia({reducedMotion:'reduce'});
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(fen => window.chessApp.loadFEN(fen), victory);
 await expectResult(page, 'victory', '¡Victoria!');
 const mobile = await page.evaluate(() => {
  const dialog = document.querySelector('#result-overlay'), box = dialog.getBoundingClientRect();
  return {animations:dialog.getAnimations({subtree:true}).length, left:box.left,right:box.right,top:box.top,bottom:box.bottom,
   viewportWidth:innerWidth,viewportHeight:innerHeight, contentWidth:dialog.scrollWidth,clientWidth:dialog.clientWidth,
   pageOverflow:document.documentElement.scrollWidth > innerWidth};
 });
 assert.equal(mobile.animations, 0, 'reduced motion disables all result animations');
 assert(mobile.left >= 0 && mobile.right <= 390 && mobile.top >= 0 && mobile.bottom <= 844, 'mobile dialog stays in viewport');
 assert(mobile.contentWidth <= mobile.clientWidth, 'dialog does not overflow horizontally');
 assert.equal(mobile.pageOverflow, false, 'page does not overflow horizontally');
 report.mobile = mobile;
 await screenshot(page, 'result-mobile');
 mark('390px mobile layout fits, controls remain visible, reduced motion has zero result animations');
 await page.click('.result-overlay__dismiss');
 await page.setViewportSize({width:1440,height:1050});

 // Route only room GETs. No room creations, DB writes, microphone or paid voice calls.
 let room;
 await page.route('**/api/rooms/**', async route => {
  assert.equal(route.request().method(), 'GET', 'overlay verification must never mutate a room');
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({room})});
 });
 const onlineFixtures = [
  {seat:'pirate',winner:'pirate',kind:'victory',title:'¡Victoria!'},
  {seat:'marine',winner:'pirate',kind:'defeat',title:'Derrota'},
  {seat:'marine',winner:'marine',kind:'victory',title:'¡Victoria!'},
  {seat:'pirate',winner:null,kind:'draw',title:'Empate'},
  {seat:null,winner:'marine',kind:'spectator',title:'Gana la Marina'},
 ];
 for (const [index,fixture] of onlineFixtures.entries()) {
  room = {id:(index + 1).toString(16).padStart(24,'0'),revision:1,crew:'mugiwara',ready:true,seat:fixture.seat,
   state:packGame(new ChessGame()),lastAction:null,result:{winner:fixture.winner,reason:fixture.winner ? 'resignation' : 'stalemate'}};
  await page.evaluate(id => window.chessApp.online.resume(id), room.id);
  await expectResult(page, fixture.kind, fixture.title);
  assert.equal(await page.evaluate(() => window.chessApp.game.status().over), false, 'authoritative result overrides ongoing engine board');
  assert.equal(await page.locator('.result-overlay__replay').innerText(), 'Volver al juego local');
  if (fixture.winner) assert.equal(await page.locator('#result-overlay-reason').innerText(), 'Rendición');
  await page.click('.result-overlay__dismiss');
  await page.evaluate(async () => { await window.chessApp.online.refresh(); window.chessApp.setAI(false); await new Promise(requestAnimationFrame); });
  assert.equal((await state(page)).open, false);
  mark('Online ' + (fixture.seat || 'spectator') + ' sees ' + fixture.kind + ', server result has priority and cannot poll-reopen');
 }
 room = {...room,id:'a'.repeat(24),revision:2};
 await page.evaluate(id => window.chessApp.online.resume(id), room.id);
 await expectResult(page, 'spectator', 'Gana la Marina');
 await page.click('.result-overlay__replay');
 await page.waitForFunction(() => !window.chessApp.online.room && !window.chessApp.busy && !document.querySelector('#result-overlay').open);
 assert.equal((await state(page)).fen, START_FEN);
 assert.equal(new URL(page.url()).searchParams.has('room'), false);
 mark('Online result action returns to local game without resetting the shared room');
 assert.deepEqual(report.errors, []);
 report.passed = true;
 console.log('RESULT_OVERLAY_BROWSER_OK');
} catch (error) {
 report.failure = error.stack || String(error);
 throw error;
} finally {
 report.completedAt = new Date().toISOString();
 fs.writeFileSync(path.join(out,'result-overlay.json'),JSON.stringify(report,null,2));
 await browser?.close();
}
