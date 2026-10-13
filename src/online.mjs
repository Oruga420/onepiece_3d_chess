const cancelled = () => Object.assign(Error('Conexión cancelada.'), {name:'AbortError'});

/** Server-authoritative room transport. Board changes only arrive through onRoom. */
export function createOnlineSession(options = {}) {
  const fetcher = options.fetch || globalThis.fetch;
  const doc = options.document ?? globalThis.document;
  const timerSet = options.setTimeout || globalThis.setTimeout;
  const timerClear = options.clearTimeout || globalThis.clearTimeout;
  const timeoutMs = options.requestTimeoutMs ?? 12000;
  const uuid = options.randomUUID || (() => globalThis.crypto.randomUUID());
  let current = null, snapshot = null, connected = false;
  const active = context => current === context && !context.stopped;
  const notify = (name, value) => options[name]?.(value);

  function accept(context, data) {
    if (!active(context)) throw cancelled();
    const room = data?.room || data;
    if (!room || typeof room.id !== 'string' || !Number.isInteger(room.revision)) {
      throw Error('El servidor devolvió una sala inválida.');
    }
    if (context.id && context.id !== room.id) throw Error('La respuesta pertenece a otra sala.');
    context.id = room.id;
    connected = true;
    if (snapshot && room.revision < snapshot.revision) return snapshot;
    const changed = JSON.stringify(snapshot) !== JSON.stringify(room);
    snapshot = room;
    if (changed) notify('onRoom', snapshot);
    if (active(context)) notify('onStatus', room.ready ? 'Partida conectada' : 'Esperando al otro jugador');
    return snapshot;
  }

  async function request(context, url, {method = 'GET', body} = {}) {
    if (!active(context)) throw cancelled();
    const aborter = new AbortController();
    let timer, abort;
    const interrupted = new Promise((_, reject) => {
      abort = () => { aborter.abort(); reject(cancelled()); };
      context.aborter.signal.addEventListener('abort', abort, {once:true});
      timer = timerSet(() => {
        aborter.abort();
        reject(Object.assign(Error('La sala no respondió a tiempo.'), {network:true}));
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(async () => {
          const response = await fetcher(url, {
            method, credentials:'same-origin', cache:'no-store', signal:aborter.signal,
            headers:body === undefined ? {} : {'Content-Type':'application/json', 'X-CSRF-Token':context.csrf},
            ...(body === undefined ? {} : {body:JSON.stringify(body)})
          });
          const data = await response.json().catch(() => ({}));
          return {response, data};
        }), interrupted
      ]);
      if (!active(context)) throw cancelled();
      if (!result.response.ok) {
        const status = result.response.status;
        const message = status === 401 ? 'La sesión caducó. Recarga e introduce la contraseña.'
          : result.data.message || result.data.error || 'No se pudo actualizar la partida.';
        throw Object.assign(Error(typeof message === 'string' ? message : 'Error de la sala.'), {
          status, code:result.data.code, data:result.data
        });
      }
      return result.data;
    } catch (error) {
      if (!active(context)) throw cancelled();
      if (!error.status && error.name !== 'AbortError') error.network = true;
      throw error;
    } finally {
      timerClear(timer);
      context.aborter.signal.removeEventListener('abort', abort);
    }
  }

  async function csrf(context) {
    if (!context.csrf) {
      const auth = await request(context, '/api/session');
      if (!auth.csrfToken) throw Error('No se pudo verificar la sesión. Recarga la página.');
      context.csrf = auth.csrfToken;
    }
  }

  function report(context, error) {
    if (!active(context) || error.name === 'AbortError') return;
    if (error.status === 401 || error.status === 404 || error.status === 410) context.pollStopped = true;
    connected = false;
    notify('onStatus', error.status === 401 ? 'Sesión caducada' : 'Conexión interrumpida');
    notify('onError', error);
  }

  function schedule(context) {
    timerClear(context.timer);
    if (!active(context) || !context.id || context.pollStopped || snapshot?.result) return;
    const delay = doc?.hidden ? (options.hiddenPollMs ?? 5000) : (options.pollMs ?? 1500);
    context.timer = timerSet(() => { refresh().catch(() => {}); }, delay);
  }

  // One queue covers polling, CSRF reads and mutations; requests never overlap.
  function enqueue(context, task) {
    timerClear(context.timer);
    const result = context.queue.then(() => {
      if (!active(context)) throw cancelled();
      return task();
    });
    context.queue = result.catch(() => {});
    return result.catch(error => { report(context, error); throw error; }).finally(() => schedule(context));
  }

  function leave() {
    if (current) {
      timerClear(current.timer);
      current.stopped = true;
      current.aborter.abort();
    }
    current = null; snapshot = null; connected = false;
  }

  function begin(id = null) {
    leave();
    current = {id, csrf:null, stopped:false, pollStopped:false, pending:false,
      aborter:new AbortController(), queue:Promise.resolve(), refreshing:null, timer:null};
    return current;
  }

  const roomPath = context => `/api/rooms/${encodeURIComponent(context.id)}`;
  function enter(id, method, body) {
    const context = begin(id);
    context.pending = method === 'POST';
    notify('onStatus', 'Conectando a la sala…');
    return enqueue(context, async () => {
      if (method === 'POST') await csrf(context);
      const path = id ? roomPath(context) + (method === 'POST' ? '/join' : '') : '/api/rooms';
      return accept(context, await request(context, path, {method, body}));
    }).finally(() => { context.pending = false; });
  }

  function refresh() {
    const context = current;
    if (!context?.id || context.pollStopped || snapshot?.result) return Promise.resolve(snapshot);
    if (context.refreshing) return context.refreshing;
    context.refreshing = enqueue(context, async () => accept(context, await request(context, roomPath(context))))
      .finally(() => { context.refreshing = null; });
    return context.refreshing;
  }

  function act(action) {
    const context = current;
    if (!context || !snapshot || context.pollStopped) return Promise.reject(Error('Conéctate a una sala primero.'));
    if (context.pending) return Promise.reject(Error('Espera a que termine la jugada anterior.'));
    if (!snapshot.seat) return Promise.reject(Error('Únete a la sala para jugar.'));
    // Capture the displayed revision before queued polling can alter it.
    const body = {revision:snapshot.revision, requestId:uuid(), action:JSON.parse(JSON.stringify(action))};
    context.pending = true;
    return enqueue(context, async () => {
      if (context.pollStopped) throw Error('La sesión de la sala terminó. Vuelve a conectar.');
      await csrf(context);
      try {
        let data;
        try { data = await request(context, `${roomPath(context)}/actions`, {method:'POST', body}); }
        catch (error) {
          if (!error.network) throw error;
          // Retry a lost acknowledgement once with the SAME id and revision.
          data = await request(context, `${roomPath(context)}/actions`, {method:'POST', body});
        }
        return accept(context, data);
      } catch (error) {
        if (error.status === 409 || error.network) {
          try {
            const state = error.data?.room || await request(context, roomPath(context));
            accept(context, state);
          } catch (reconcileError) {
            if (reconcileError.status === 401) throw reconcileError;
          }
        }
        throw error;
      }
    }).finally(() => { context.pending = false; });
  }

  return {
    create:({crew} = {}) => enter(null, 'POST', {crew}),
    join:id => enter(id, 'POST', {}), resume:id => enter(id, 'GET'), refresh, act, leave,
    get room() { return snapshot; }, get seat() { return snapshot?.seat ?? null; },
    get pending() { return Boolean(current?.pending); }, get connected() { return connected; }
  };
}
