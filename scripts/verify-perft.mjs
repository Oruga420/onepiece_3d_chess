import assert from 'node:assert/strict';
import { ChessGame, perft } from '../src/rules.mjs';
// Published engine validation reference: https://www.chessprogramming.org/Perft_Results
const g=new ChessGame();for(const [depth,expected]of [[1,20],[2,400],[3,8902],[4,197281]]){const count=perft(g,depth);assert.equal(count,expected);console.log(`initial depth=${depth} nodes=${count}`);}
const fixture=new ChessGame('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');for(const [depth,expected]of [[1,14],[2,191],[3,2812],[4,43238]]){const count=perft(fixture,depth);assert.equal(count,expected);console.log(`position3 depth=${depth} nodes=${count}`);}const kiwipete=new ChessGame('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');for(const [depth,expected]of [[1,48],[2,2039],[3,97862]]){const count=perft(kiwipete,depth);assert.equal(count,expected);console.log(`kiwipete depth=${depth} nodes=${count}`);}
const promotion=new ChessGame('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');for(const [depth,expected]of [[1,6],[2,264],[3,9467]]){const count=perft(promotion,depth);assert.equal(count,expected);console.log(`promotion-fixture depth=${depth} nodes=${count}`);}
console.log('PERFT_OK initial=20,400,8902,197281 position3=14,191,2812,43238 kiwipete=48,2039,97862 promotion=6,264,9467');
