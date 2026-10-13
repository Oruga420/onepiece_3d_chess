import test from 'node:test';
import assert from 'node:assert/strict';
import { ChessGame } from '../src/rules.mjs';
import { packGame, restoreGame, validateOnlineState } from '../src/online-state.mjs';

function roundtrip(game) {
 const packed = packGame(game);
 assert.equal(JSON.stringify(packed).includes('"before"'), false);
 const restored = new ChessGame();
 assert.equal(restoreGame(restored, JSON.parse(JSON.stringify(packed))), restored);
 assert.deepEqual(restored._snapshot(), game._snapshot());
 assert.deepEqual(restored.repetitions, game.repetitions);
 assert.equal(restored.version, game.version);
 assert.deepEqual(restored.status(), game.status());
 assert.deepEqual(restored.legalMoves(), game.legalMoves());
 assert.deepEqual(packGame(restored), packed);
 return restored;
}

test('online state preserves ids, clocks, castling rights and en passant through JSON', () => {
 const game = new ChessGame();
 game.move({ from: 'E2', to: 'E4' });
 const restored = roundtrip(game);
 assert.equal(restored.enPassant, 'E3');
 assert.equal(restored.board[3][4].id, 'P-1-4');
 restored.move({ from: 'D7', to: 'D5' });
 roundtrip(restored);
});

test('online state restores castling, en passant capture and all promotions', () => {
 const castle = new ChessGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
 castle.move({ from: 'E1', to: 'G1' });
 const restored = roundtrip(castle);
 assert.equal(restored.history[0].castle, 'king');
 restored.move({ from: 'E8', to: 'C8' });
 roundtrip(restored);
 const ep = new ChessGame('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 20');
 const epRestored = roundtrip(ep);
 epRestored.move({ from: 'E5', to: 'D6' });
 roundtrip(epRestored);
 assert.equal(epRestored.history[0].enPassant, true);
 assert.equal(epRestored.history[0].captured.type, 'pawn');
 for (const promotion of ['queen', 'rook', 'bishop', 'knight']) {
  const game = new ChessGame('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  game.move({ from: 'A7', to: 'A8', promotion });
  assert.equal(roundtrip(game).board[7][0].type, promotion);
 }
});

test('online state keeps used fruits and replenishes on the same ply after restore', () => {
 const game = new ChessGame();
 game.useDevilFruit({ square: 'A2', fruit: 'gomu-gomu' });
 let restored = roundtrip(game);
 assert.equal(restored.history[0].transformed.type, 'queen');
 assert.equal(restored.availableDevilFruits.includes('gomu-gomu'), false);
 for (const [from, to] of [['G1', 'F3'], ['G8', 'F6'], ['F3', 'G1'], ['F6', 'G8'], ['G1', 'F3'], ['G8', 'F6']]) {
  restored.move({ from, to });
  restored = roundtrip(restored);
 }
 assert.equal(restored.fruitPly, 6);
 assert.equal(restored.availableDevilFruits.length, 4);
});

test('online state keeps repetition and fifty-move claims including a claimed result', () => {
 let game = new ChessGame();
 for (let n = 0; n < 2; n++) for (const [from, to] of [['G1', 'F3'], ['G8', 'F6'], ['F3', 'G1'], ['F6', 'G8']]) {
  game.move({ from, to });
  game = roundtrip(game);
 }
 assert.ok(game.status().claimable.includes('threefold-repetition'));
 game.claimDraw('threefold-repetition');
 assert.equal(roundtrip(game).status().reason, 'threefold-repetition');
 game = roundtrip(new ChessGame('4k2r/8/8/8/8/8/8/R3K3 w - - 100 60'));
 game.claimDraw('fifty-move');
 assert.equal(roundtrip(game).status().reason, 'fifty-move');
});

test('online state deep copies in both directions and never silently truncates history', () => {
 const game = new ChessGame();
 game.move({ from: 'E2', to: 'E4' });
 const packed = packGame(game);
 packed.position.board[3][4].id = 'different';
 packed.history[0].piece.id = 'different-history';
 packed.repetitions[0][1] = 99;
 assert.equal(game.board[3][4].id, 'P-1-4');
 assert.equal(game.history[0].piece.id, 'P-1-4');
 assert.equal([...game.repetitions.values()][0], 1);
 const state = packGame(game);
 state.history = Array.from({ length: 1001 }, () => state.history[0]);
 const restored = restoreGame(new ChessGame(), state);
 assert.equal(restored.history.length, 1001);
 state.position.board[3][4].id = 'changed-after-restore';
 state.history[0].piece.id = 'changed-after-restore';
 assert.equal(restored.board[3][4].id, 'P-1-4');
 assert.equal(restored.history[0].piece.id, 'P-1-4');
 restored.history[0].piece.id = 'only-first';
 assert.equal(restored.history[1].piece.id, 'P-1-4');
});

test('online state rejects malformed and prototype-polluting data before changing game', () => {
 const destination = new ChessGame();
 const before = packGame(destination);
 const edits = [
  state => { state.position.turn = 'nobody'; },
  state => { state.position.board[0][0].player = 'nobody'; },
  state => { state.position.board[0][4] = null; },
  state => { state.position.board[0][0].id = state.position.board[0][1].id; },
  state => { state.position.board[0].length = 7; },
  state => { delete state.position.board[0][0]; },
  state => { state.position.halfmove = NaN; },
  state => { state.version = -1; },
  state => { state.repetitions[0][1] = '1'; },
  state => { state.repetitions.push(state.repetitions[0]); },
  state => { state.position.availableDevilFruits = ['gomu-gomu', 'gomu-gomu']; },
  state => { Object.defineProperty(state, '__proto__', { value: { polluted: true }, enumerable: true }); },
  state => { state.position = Object.assign(Object.create({ polluted: true }), state.position); },
  state => { Object.defineProperty(state, 'version', { get() { throw Error('must not run'); } }); },
 ];
 for (const edit of edits) {
  const state = packGame(destination);
  edit(state);
  assert.throws(() => restoreGame(destination, state), /Invalid online state:/);
  assert.deepEqual(packGame(destination), before);
 }
 assert.equal({}.polluted, undefined);
 assert.throws(() => validateOnlineState(null), /Invalid online state:/);
});
