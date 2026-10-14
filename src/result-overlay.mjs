const REASONS = Object.freeze({
 'checkmate': 'Jaque mate',
 'stalemate': 'Rey ahogado',
 'insufficient-material': 'Material insuficiente',
 'threefold-repetition': 'Triple repetición',
 'fivefold-repetition': 'Quíntuple repetición',
 'fifty-move': 'Regla de las 50 jugadas',
 'seventy-five-move': 'Regla de las 75 jugadas',
 'resignation': 'Rendición',
});

/** Resolve the outcome from the viewer's seat, including server-only resignations. */
export function getGameResult({status, room = null, localSide = 'pirate'} = {}) {
 const outcome = room?.result || (status?.over ? status : null);
 if (!outcome) return null;
 const winner = ['pirate', 'marine'].includes(outcome.winner) ? outcome.winner : null;
 const reasonLabel = REASONS[outcome.reason] || 'Partida terminada';
 if (!winner) return {kind:'draw', title:'Empate', subtitle:'El mar no elige vencedor. Esta batalla termina en tablas.', reasonLabel, winner};
 const side = room ? room.seat : localSide;
 if (!side) return {kind:'spectator', title:winner === 'pirate' ? 'Ganan los Piratas' : 'Gana la Marina', subtitle:'La batalla ha terminado. El tablero cuenta su historia.', reasonLabel, winner};
 const victory = winner === side;
 return {kind:victory ? 'victory' : 'defeat', title:victory ? '¡Victoria!' : 'Derrota', subtitle:victory ? 'La batalla es tuya. Tu tripulación conquista el tablero.' : 'Tu tripulación cae, pero la aventura continúa.', reasonLabel, winner};
}

/** One finite celebration per terminal state; polling never reopens a dismissed dialog. */
export function createResultOverlay({document = globalThis.document, onReplay = () => {}, onDismiss = () => {}, localSide = 'pirate'} = {}) {
 const dialog = document.createElement('dialog');
 dialog.id = 'result-overlay';
 dialog.className = 'result-overlay';
 dialog.setAttribute('aria-labelledby', 'result-overlay-title');
 dialog.setAttribute('aria-describedby', 'result-overlay-subtitle result-overlay-reason');
 dialog.innerHTML = `<div class="result-overlay__scene" aria-hidden="true"><div class="result-overlay__rays"></div><div class="result-overlay__particles"></div></div>
  <div class="result-overlay__card">
   <button type="button" class="result-overlay__close" aria-label="Cerrar resultado">×</button>
   <p class="result-overlay__eyebrow">ONE PIECE · FIN DE LA BATALLA</p>
   <div class="result-overlay__crest" aria-hidden="true"><span class="result-overlay__emblem"></span><span class="result-overlay__orbit"></span></div>
   <p id="result-overlay-reason" class="result-overlay__reason"></p>
   <h2 id="result-overlay-title"></h2>
   <p id="result-overlay-subtitle" class="result-overlay__subtitle"></p>
   <div class="result-overlay__actions"><button type="button" class="result-overlay__replay"></button><button type="button" class="result-overlay__dismiss">Ver tablero</button></div>
  </div>`;
 const particles = dialog.querySelector('.result-overlay__particles');
 for (let i = 0; i < 24; i++) {
  const particle = document.createElement('i');
  particle.style.setProperty('--x', `${(i * 43 + 9) % 100}%`);
  particle.style.setProperty('--delay', `${(i % 7) * 65}ms`);
  particle.style.setProperty('--drift', `${((i * 29) % 160) - 80}px`);
  particle.style.setProperty('--spin', `${i % 2 ? 220 : -180}deg`);
  particles.append(particle);
 }
 document.body.append(dialog);
 let activeKey = null, disposed = false;
 const shown = new Set();
 const title = dialog.querySelector('#result-overlay-title');
 const subtitle = dialog.querySelector('#result-overlay-subtitle');
 const reason = dialog.querySelector('#result-overlay-reason');
 const replay = dialog.querySelector('.result-overlay__replay');
 function close() { if (dialog.open) dialog.close(); }
 function dismiss() {
  if (!dialog.open || disposed) return;
  close();
  onDismiss();
 }
 function cancel(event) { event.preventDefault(); dismiss(); }
 function playAgain() { dismiss(); onReplay(); }
 const closeButton = dialog.querySelector('.result-overlay__close');
 const dismissButton = dialog.querySelector('.result-overlay__dismiss');
 closeButton.addEventListener('click', dismiss);
 dismissButton.addEventListener('click', dismiss);
 replay.addEventListener('click', playAgain);
 dialog.addEventListener('cancel', cancel);
 return {
  get element() { return dialog; },
  update({status, room = null, key, busy = false, localSide:side = localSide} = {}) {
   if (disposed) return null;
   const result = getGameResult({status, room, localSide:side});
   if (!result) { close(); activeKey = null; shown.clear(); return null; }
   const nextKey = key ?? `${room?.id || 'local'}:${room?.revision ?? ''}:${result.reasonLabel}:${result.winner}`;
   if (activeKey !== nextKey) close();
   activeKey = nextKey;
   if (busy || shown.has(nextKey)) return result;
   dialog.dataset.kind = result.kind;
   title.textContent = result.title;
   subtitle.textContent = result.subtitle;
   reason.textContent = result.reasonLabel;
   dialog.querySelector('.result-overlay__emblem').textContent = result.kind === 'defeat' ? '⚔' : result.kind === 'draw' ? '⚓' : '♛';
   replay.textContent = room ? 'Volver al juego local' : 'Nueva partida';
   dialog.showModal();
   replay.focus({preventScroll:true});
   shown.add(nextKey);
   return result;
  },
  dismiss,
  dispose() {
   if (disposed) return;
   close(); disposed = true;
   closeButton.removeEventListener('click', dismiss);
   dismissButton.removeEventListener('click', dismiss);
   replay.removeEventListener('click', playAgain);
   dialog.removeEventListener('cancel', cancel);
   dialog.remove(); shown.clear();
  },
 };
}
