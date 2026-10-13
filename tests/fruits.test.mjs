import test from 'node:test';
import assert from 'node:assert/strict';
import { ChessGame } from '../src/rules.mjs';
import { chooseMove } from '../src/ai.mjs';

const fruits=['gomu-gomu','mera-mera','ope-ope','gora-gora'];
const pieces=['queen','knight','rook','bishop'];

test('each fruit transforms an own pawn in place without spending the turn',()=>{
 for(let i=0;i<fruits.length;i++){
  const g=new ChessGame(),id=g.board[1][0].id,version=g.version;
  const record=g.useDevilFruit({square:'A2',fruit:fruits[i]});
  assert.equal(g.board[1][0].type,pieces[i]);assert.equal(g.board[1][0].id,id);
  assert.equal(g.turn,'pirate');assert.equal(g.fullmove,1);assert.equal(g.halfmove,0);
  assert.equal(g.version,version+1);assert.equal(g.fruitPly,0);
  assert.deepEqual(g.availableDevilFruits,fruits.filter(f=>f!==fruits[i]));
  assert.equal(record.kind,'devil_fruit');assert.equal(record.from,'A2');assert.equal(record.to,'A2');
  assert.equal(record.piece.type,'pawn');assert.equal(record.transformed.type,pieces[i]);
 }
});

test('invalid fruit actions reject atomically including exhausted fruit and check',()=>{
 const g=new ChessGame();
 for(const request of [{square:'A7',fruit:fruits[0]},{square:'A1',fruit:fruits[0]},{square:'A3',fruit:fruits[0]},{square:'A0',fruit:fruits[0]},{square:'A2',fruit:'unknown'},null]){
  const before=JSON.stringify(g._snapshot()),version=g.version;
  assert.throws(()=>g.useDevilFruit(request));assert.equal(JSON.stringify(g._snapshot()),before);assert.equal(g.version,version);
 }
 g.useDevilFruit({square:'A2',fruit:fruits[0]});assert.throws(()=>g.useDevilFruit({square:'B2',fruit:fruits[0]}));
 const checked=new ChessGame('4r1k1/8/8/8/8/8/P7/4K3 w - - 0 1');
 const before=checked.fen();assert.throws(()=>checked.useDevilFruit({square:'A2',fruit:fruits[0]}));assert.equal(checked.fen(),before);assert.equal(checked.history.length,0);assert.deepEqual(checked.availableDevilFruits,fruits);
 const over=new ChessGame('7k/6Q1/5K2/8/8/8/p7/8 b - - 0 1');
 assert.equal(over.status().over,true);assert.throws(()=>over.useDevilFruit({square:'A2',fruit:fruits[0]}));
});

test('fruit history and inventory undo independently of actual move count',()=>{
 const g=new ChessGame(),start=g.fen(),key=g._key();
 g.useDevilFruit({square:'A2',fruit:fruits[0]});const transformed=g.fen();
 g.move({from:'B2',to:'B3'});assert.equal(g.fruitPly,1);
 g.undo();assert.equal(g.fen(),transformed);assert.equal(g.fruitPly,0);assert.equal(g.availableDevilFruits.length,3);
 const version=g.version;const record=g.undo();assert.equal(record.kind,'devil_fruit');assert.equal(g.fen(),start);
 assert.equal(g._key(),key);assert.equal(g.repetitions.get(key),1);assert.deepEqual(g.availableDevilFruits,fruits);assert.equal(g.version,version+1);
});

test('fruits refill after six actual plies then every seven; refill undo is exact',()=>{
 const g=new ChessGame();g.useDevilFruit({square:'A2',fruit:fruits[0]});
 const moves=[['B2','B3'],['B7','B6'],['C2','C3'],['C7','C6'],['D2','D3'],['D7','D6'],['E2','E3'],['E7','E6'],['F2','F3'],['F7','F6'],['G2','G3'],['G7','G6'],['H2','H3'],['H7','H6'],['B3','B4'],['B6','B5'],['C3','C4'],['C6','C5'],['D3','D4'],['D6','D5']];
 for(let i=0;i<moves.length;i++){
  if(i===6)g.useDevilFruit({square:'H2',fruit:'mera-mera'});
  if(i===13){g.useDevilFruit({square:'A7',fruit:'gora-gora'});assert.equal(g.turn,'marine');assert.equal(g.board[6][0].type,'bishop');}
  const [from,to]=moves[i];
  // H2 became a knight; use its legal jump for the thirteenth ply.
  g.move(i===12?{from:'H2',to:'G4'}:{from,to});
  assert.equal(g.fruitPly,i+1);assert.equal(g.availableDevilFruits.length,[5,12,19].includes(i)?4:3);
  if(i===5){g.undo();assert.equal(g.fruitPly,5);assert.equal(g.availableDevilFruits.length,3);g.move({from,to});}
 }
});

test('load/reset restore inventory and AI preserves transformed board without mutation',()=>{
 const g=new ChessGame();g.useDevilFruit({square:'A2',fruit:fruits[0]});g.move({from:'B2',to:'B3'});
 const before=JSON.stringify(g._snapshot()),history=g.history.length;
 assert.ok(chooseMove(g,{depth:1,maxNodes:40}));assert.equal(JSON.stringify(g._snapshot()),before);assert.equal(g.history.length,history);
 const fen=g.fen();g.loadFEN(fen);assert.equal(g.board[1][0].type,'queen');assert.deepEqual(g.availableDevilFruits,fruits);assert.equal(g.fruitPly,0);
 g.reset();assert.equal(g.board[1][0].type,'pawn');assert.deepEqual(g.availableDevilFruits,fruits);
});

test('inventory participates in repetition identity and fruit does not consume en passant window',()=>{
 const g=new ChessGame('4k3/8/8/3pP3/8/8/P7/4K3 w - d6 14 8');
 g.useDevilFruit({square:'A2',fruit:'gomu-gomu'});
 assert.equal(g.enPassant,'D6');assert.equal(g.halfmove,14);assert.equal(g.fullmove,8);assert.ok(g.legalMoves('E5').some(m=>m.enPassant));
 const sameBoard=new ChessGame(g.fen());assert.notEqual(g._key(),sameBoard._key());
});
