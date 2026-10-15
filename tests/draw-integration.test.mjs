import test from 'node:test';
import assert from 'node:assert/strict';
import { ChessGame } from '../src/rules.mjs';
import { createCommandController } from '../src/commands.mjs';
import { TOOL_REGISTRY,validateTool } from '../src/voice-registry.mjs';
const fifty=()=>new ChessGame('4k3/8/8/8/8/8/8/R3K3 w - - 99 1');
const wait=()=>new Promise(resolve=>setTimeout(resolve,25));
const action={action:'claim_draw',reason:'fifty-move',intendedMove:{from:'A1',to:'A2'}};
function repetition(){const game=new ChessGame();for(const [from,to] of [['G1','F3'],['G8','F6'],['F3','G1'],['F6','G8'],['G1','F3'],['G8','F6'],['F3','G1']])game.move({from,to});return game;}
test('claim tool exposes strict nested intended-move schema',()=>{
 const schema=TOOL_REGISTRY.find(tool=>tool.name==='propose_game_action').inputSchema.properties.intendedMove;
 assert.equal(schema.type,'object');assert.deepEqual(schema.required,['from','to']);assert.equal(schema.additionalProperties,false);
 assert.doesNotThrow(()=>validateTool('propose_game_action',action));
 for(const intendedMove of [null,[],{from:'A1'},{from:'A1',to:'A9'},{from:'A1',to:'A2',extra:true},{from:'A1',to:'A2',promotion:'king'}])assert.throws(()=>validateTool('propose_game_action',{...action,intendedMove}));
});
for(const source of ['mouse','text','webmcp','voice'])test(`${source} claim names intended move without executing it`,async()=>{
 const game=fifty(),controller=createCommandController(game,{countdownMs:5});const before=game.fen(),version=game.version;
 const response=source==='text'?controller.text('tablas con A1 a A2'):controller.runTool('propose_game_action',structuredClone(action),{source});
 assert.equal(response.ok,true,response.speak);
 if(source==='text'||source==='webmcp'){
  assert.ok(response.proposal);assert.equal(response.proposal.turn,'pirate');assert.equal(response.proposal.version,version);
  assert.deepEqual(response.proposal.action.intendedMove,{from:'A1',to:'A2'});assert.equal(game.status().over,false);
  assert.equal(controller.runTool('confirm_action',{id:response.proposal.id,words:'confirmo'},{source}).ok,true);
  await wait();
 }
 if(source==='voice'){assert.equal(controller.pending,null);assert.equal(response.action.kind,'claim_draw');}
 assert.equal(game.status().reason,'fifty-move');assert.equal(game.fen(),before);assert.equal(game.turn,'pirate');assert.equal(game.history.length,0);assert.ok(game.version>version);controller.stop();
});
test('intended threefold claim belongs to original side and does not play the move',()=>{
 const game=repetition(),controller=createCommandController(game);const before=game.fen(),history=game.history.length;
 assert.equal(game.turn,'marine');assert.ok(!game.status().claimable.includes('threefold-repetition'));
 const response=controller.runTool('propose_game_action',{action:'claim_draw',reason:'threefold-repetition',intendedMove:{from:'F6',to:'G8'}},{source:'mouse'});
 assert.equal(response.ok,true,response.speak);assert.equal(game.status().reason,'threefold-repetition');assert.equal(game.fen(),before);assert.equal(game.turn,'marine');assert.equal(game.history.length,history);
});
test('wrong-side and illegal intended claims fail closed',()=>{
 for(const intendedMove of [{from:'E8',to:'D8'},{from:'A1',to:'B2'}]){const game=fifty(),controller=createCommandController(game),before=game.fen(),version=game.version;
  assert.equal(controller.runTool('propose_game_action',{...action,intendedMove},{source:'mouse'}).ok,false);assert.equal(game.status().over,false);assert.equal(game.fen(),before);assert.equal(game.version,version);
 }
});
test('intended claim proposal cannot survive a board-version change',async()=>{
 const game=fifty(),controller=createCommandController(game,{countdownMs:5});const response=controller.runTool('propose_game_action',structuredClone(action),{source:'webmcp'});
 assert.ok(response.proposal);game.move({from:'A1',to:'A2'});const before=game.fen();
 assert.equal(controller.runTool('confirm_action',{id:response.proposal.id,words:'confirmo'},{source:'webmcp'}).ok,false);await wait();assert.equal(game.fen(),before);assert.equal(game.status().over,false);controller.stop();
});
test('Spanish intended repetition claim keeps the original marine turn',async()=>{
 const game=repetition(),controller=createCommandController(game,{countdownMs:5}),before=game.fen();
 const response=controller.text('tablas por repetición con F6 a G8');assert.equal(response.ok,true,response.speak);assert.equal(response.proposal.action.reason,'threefold-repetition');assert.equal(response.proposal.turn,'marine');
 controller.runTool('confirm_action',{id:response.proposal.id,words:'sí'},{source:'text'});await wait();assert.equal(game.status().reason,'threefold-repetition');assert.equal(game.turn,'marine');assert.equal(game.fen(),before);controller.stop();
});
