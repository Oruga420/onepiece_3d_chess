import test from 'node:test';
import assert from 'node:assert/strict';
import { ChessGame } from '../src/rules.mjs';
import { chooseMove } from '../src/ai.mjs';
test('AI returns legal bounded move without mutating source',()=>{const g=new ChessGame();const fen=g.fen(),v=g.version;const m=chooseMove(g,{depth:4,maxNodes:20});assert.ok(g.legalMoves().some(x=>JSON.stringify(x)===JSON.stringify(m)));assert.equal(g.fen(),fen);assert.equal(g.version,v);assert.equal(g.history.length,0);});
test('AI finds free queen and returns null for terminal game',()=>{const g=new ChessGame('4k3/8/8/8/8/8/q7/R3K3 w - - 0 1');assert.equal(chooseMove(g,{depth:2}).to,'A2');const mate=new ChessGame('7k/6Q1/5K2/8/8/8/8/8 b - - 0 1');assert.equal(chooseMove(mate),null);});
