import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../src/game-state.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('capture animation excludes input and stale finish after reset',()=>{const s=new GameState();const rec=s.move({from:'E2',to:'E4'});const t=s.beginAnimation(rec);assert.throws(()=>s.move({from:'E7',to:'E5'}));s.reset();assert.equal(s.finishAnimation(t),false);assert.equal(s.game.history.length,0);});
for(const action of ['reset','undo','crew','disable'])test(`queued AI invalidated by ${action}`,async()=>{const s=new GameState();s.setAI(true);s.move({from:'E2',to:'E4'});const d=deferred();const queued=s.queueAI(()=>d.promise);if(action==='crew')s.setCrew('heart');else if(action==='disable')s.setAI(false);else s[action]();const before=s.game.fen();d.resolve({from:'E7',to:'E5'});assert.equal(await queued,null);assert.equal(s.game.fen(),before);assert.equal(s.pendingAI,null);});
test('latest AI request exclusively owns result',async()=>{const s=new GameState();s.setAI(true);const a=deferred(),b=deferred();const first=s.queueAI(()=>a.promise),second=s.queueAI(()=>b.promise);a.resolve({from:'E2',to:'E4'});assert.equal(await first,null);b.resolve({from:'D2',to:'D4'});assert.equal((await second).to,'D4');});
test('animation completion needs exact current token',()=>{const s=new GameState();const t=s.beginAnimation(s.move({from:'E2',to:'E4'}));assert.equal(s.finishAnimation({...t}),false);assert.equal(s.finishAnimation(t),true);assert.equal(s.finishAnimation(t),false);});
test('undo restores complete position for ordinary capture castle en-passant promotion',()=>{for(const [fen,moves]of [
 [null,[['E2','E4'],['D7','D5'],['E4','D5']]],
 ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',[['E1','G1']]],
 ['4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1',[['D7','D5'],['E5','D6']]],
 ['7k/P7/8/8/8/8/8/7K w - - 0 1',[['A7','A8','knight']]]
 ]){const s=new GameState();if(fen)s.game.loadFEN(fen);const positions=[];for(const [from,to,promotion]of moves){positions.push(s.game.fen());s.move({from,to,promotion});}for(const expected of positions.reverse()){s.undo();assert.equal(s.game.fen(),expected);}}});
test('duplicate move cannot apply twice and malformed inputs leave state unchanged',()=>{const s=new GameState();s.move({from:'E2',to:'E4'});const before=s.game.fen(),version=s.version;for(const request of [{from:'E2',to:'E4'},{from:undefined,to:42},null,{},'E2E4'])assert.throws(()=>s.move(request));assert.equal(s.game.fen(),before);assert.equal(s.version,version);});
test('capture completion invalidated on undo crew AIoff',()=>{for(const action of ['undo','crew','disable']){const s=new GameState();s.setAI(true);s.move({from:'E2',to:'E4'});s.move({from:'D7',to:'D5'});const token=s.beginAnimation(s.move({from:'E4',to:'D5'}));if(action==='crew')s.setCrew('heart');else if(action==='disable')s.setAI(false);else s.undo();const fen=s.game.fen();assert.equal(s.finishAnimation(token),false);assert.equal(s.game.fen(),fen);}});
