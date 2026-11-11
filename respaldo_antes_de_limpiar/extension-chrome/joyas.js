// Banco de joyas: usa EXACTAMENTE el mismo comando de chat que la ventana del juego (/jbank s|a|w ...).
// 's' = ver estado (solo lectura), 'a' = depositar todo el inventario. Nunca retira. Depósito automático (cada 20 s): apagado de fábrica.
(() => {
  'use strict';
  const NOMBRES = ['Bless', 'Soul', 'Chaos', 'Life', 'Creation', 'Guardian', 'Gemstone', 'Harmony', 'Lower refine', 'Higher refine', 'Socket', 'Rare'];
  const INTERVALO_MS = 20000;   // depósito automático: cada 20 s (el comando 'a' ya devuelve el estado de las 12 joyas)
  let est = null, pend = null, ultimaLectura = 0, ultimoDeposito = 0, ultimoResultado = '', auto = false;
  const M = () => window.Module;
  const suma = (k) => (est ? est.filas.reduce((a, f) => a + (f ? f[k] : 0), 0) : 0);

  function mandar(accion) {
    if (pend && Date.now() - pend.t < 12000) return false;
    const nonce = crypto.randomUUID().replace(/-/g, '');
    let ptr = 0;
    try {
      ptr = window.muAllocateUtf8(`/jbank ${accion} 0 1 0 v1 ${nonce}`);
      if (M()._MuWebSubmitChatUtf8(ptr, 0, 0) !== 1) return false;
    } catch (e) { return false; } finally { try { if (ptr) M()._free(ptr); } catch (e) { /* nada */ } }
    pend = { nonce, t: Date.now(), accion, filas: [] };
    return true;
  }

  function observar(m) {
    const p = m.trim().split(' ');
    if (!pend || p[0] !== '_JB' || p[1] !== pend.nonce) return;
    if (p[2] === 'row') {
      const [k, bank, have, free] = p.slice(3).map(Number);
      if (k >= 0 && k < 12) pend.filas[k] = { bank, have, free };
    } else if (p[2] === 'done') {
      ultimoResultado = pend.accion + ':' + p[3];
      if (pend.filas.filter(Boolean).length === 12) est = { t: Date.now(), filas: pend.filas };
      if (pend.accion === 'a') ultimaLectura = 0; // releer enseguida
      pend = null;
    }
  }

  // El juego define muJewelBankNotice al cargar bank.js: lo envolvemos sin cambiar su comportamiento.
  setInterval(() => {
    const f = window.muJewelBankNotice;
    if (typeof f !== 'function' || f.__joyas) return;
    const w = function (m) { try { observar(String(m)); } catch (e) { /* nada */ } return f.apply(this, arguments); };
    w.__joyas = true; window.muJewelBankNotice = w;
  }, 1000);

  function libre() {
    const M_ = M();
    if (!M_ || M_._MuWebGetSceneFlag() !== 5 || M_._MuWebGetPlayerLife() <= 0) return false;
    if (M_._MuWebGetBlockingUiOpen() === 1 || M_._MuWebShopWindowOpen() === 1) return false;
    return !document.querySelector('dialog[open]'); // no pisar la ventana del banco si la tenés abierta
  }

  setInterval(() => {
    try {
      if (!auto || !libre() || pend) return;
      const ahora = Date.now();
      if (ahora - ultimoDeposito >= INTERVALO_MS && mandar('a')) ultimoDeposito = ahora;
    } catch (e) { /* no frenar */ }
  }, 2000);

  window.__joyas = {
    mandar, setAuto: (v) => { auto = !!v; },
    estado: () => est && { hace_s: Math.round((Date.now() - est.t) / 1000), tipos: est.filas.map((f, i) => ({ joya: NOMBRES[i], banco: f.bank, inventario: f.have, libres: f.free })) },
    resumen: () => (est ? 'Joyas: inventario ' + suma('have') + ' · banco ' + suma('bank') : 'Joyas: sin datos') + (ultimoResultado ? ' (' + ultimoResultado + ')' : ''),
  };
})();
