import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {getGameResult, createResultOverlay} from '../src/result-overlay.mjs';

const win = {over:true,winner:'pirate',reason:'checkmate'};
test('result mapping respects local perspective and every draw reason', () => {
 assert.equal(getGameResult({status:{over:false}}), null);
 assert.equal(getGameResult({status:win}).kind, 'victory');
 assert.equal(getGameResult({status:win,localSide:'marine'}).kind, 'defeat');
 assert.equal(getGameResult({status:win}).reasonLabel, 'Jaque mate');
 for (const reason of ['stalemate','insufficient-material','threefold-repetition','fivefold-repetition','fifty-move','seventy-five-move']) {
  const result = getGameResult({status:{over:true,winner:null,reason}});
  assert.equal(result.kind, 'draw'); assert.notEqual(result.reasonLabel, 'Partida terminada');
 }
});
test('server resignation overrides engine and spectators never lose', () => {
 const room = {seat:'marine',result:{reason:'resignation',winner:'marine'}};
 assert.equal(getGameResult({status:win,room}).kind, 'victory');
 assert.equal(getGameResult({status:{over:false},room}).reasonLabel, 'Rendición');
 assert.equal(getGameResult({status:win,room:{...room,seat:'pirate'}}).kind, 'defeat');
 const observer = getGameResult({status:win,room:{...room,seat:null}});
 assert.equal(observer.kind,'spectator'); assert.equal(observer.title,'Gana la Marina');
 assert.equal(getGameResult({status:win,room:{seat:null}}).title,'Ganan los Piratas');
});
function fixture(t) {
 const dom = new JSDOM('<!doctype html><button id="prior">Board</button>');
 const document = dom.window.document;
 let opens = 0, replays = 0, dismissals = 0;
 dom.window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open',''); opens++; };
 dom.window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); };
 const overlay = createResultOverlay({document,onReplay:()=>replays++,onDismiss:()=>dismissals++});
 t.after(()=>{overlay.dispose();dom.window.close();});
 return {dom,document,overlay,get opens(){return opens;},get replays(){return replays;},get dismissals(){return dismissals;}};
}
test('overlay waits for combat, deduplicates polling and stays dismissed until reset', t => {
 const f=fixture(t), update={status:win,key:'match:7'};
 f.overlay.update({...update,busy:true}); assert.equal(f.opens,0);
 f.overlay.update(update); assert.equal(f.opens,1); assert.equal(f.overlay.element.open,true);
 f.overlay.update(update); assert.equal(f.opens,1);
 f.overlay.dismiss(); assert.equal(f.dismissals,1); assert.equal(f.overlay.element.open,false);
 f.overlay.update(update); assert.equal(f.opens,1);
 f.overlay.update({status:{over:false},key:'match:8'});
 f.overlay.update(update); assert.equal(f.opens,2);
 f.overlay.update({status:{over:false}}); assert.equal(f.overlay.element.open,false);
});
test('dialog labels, focus, keyboard dismissal and replay are accessible', t => {
 const f=fixture(t);
 f.overlay.update({status:win,key:'local:1'});
 const dialog=f.overlay.element;
 assert.equal(dialog.getAttribute('aria-labelledby'),'result-overlay-title');
 assert.equal(dialog.querySelector('h2').textContent,'¡Victoria!');
 assert.equal(dialog.querySelectorAll('.result-overlay__particles i').length,24);
 assert.equal(f.document.activeElement.textContent,'Nueva partida');
 dialog.dispatchEvent(new f.dom.window.Event('cancel',{cancelable:true}));
 assert.equal(dialog.open,false); assert.equal(f.dismissals,1);
 f.overlay.update({status:{over:false}});
 f.overlay.update({status:win,key:'online:1',room:{id:'room',seat:'marine'}});
 assert.equal(dialog.dataset.kind,'defeat');
 assert.equal(dialog.querySelector('.result-overlay__replay').textContent,'Volver al juego local');
 dialog.querySelector('.result-overlay__replay').click();
 assert.equal(f.replays,1); assert.equal(dialog.open,false);
 f.overlay.dispose(); assert.equal(f.document.getElementById('result-overlay'),null);
 assert.equal(f.overlay.update({status:win}),null);
});
