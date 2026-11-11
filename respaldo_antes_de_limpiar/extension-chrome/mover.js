// Movimiento propio: usa SOLO la función del cliente SetLiteMoveVector(dx,dy) con dx,dy ∈ {-1,0,1}
// (las mismas 8 direcciones que las flechas del teclado, relativas a la pantalla). Nada de paquetes propios.
// calibrar(): mide a qué casillas lleva cada dirección. ir(x,y): elige la dirección que más acerca al destino.
(() => {
  'use strict';
  const KEY = 'muMoverV1';
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const M = () => window.Module;
  const call = (n, ...a) => { try { const f = M()['_MuWeb' + n]; return typeof f === 'function' ? f(...a) : null; } catch (e) { return null; } };
  const pos = () => ({ x: call('GetHeroX'), y: call('GetHeroY') });
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  let ultVec = [0, 0];
  const vec = (d) => { ultVec = [d[0], d[1]]; return call('SetLiteMoveVector', d[0], d[1]); };
  const parar = () => { ultVec = [0, 0]; return call('SetLiteMoveVector', 0, 0); };
  let tabla = null; try { tabla = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { tabla = null; }
  let ocupado = false, cancelar = false;

  function puede() {
    if (!M()) return 'sin juego';
    if (call('GetSceneFlag') !== 5 || !(call('GetPlayerLife') > 0)) return 'no estás en el juego o estás muerto';
    if (call('HelperIsActive') === 1) return 'el Helper está activo';
    if (call('GetBlockingUiOpen') === 1) return 'hay una ventana abierta';
    return null;
  }

  // Mide, para cada una de las 8 direcciones, cuántas casillas avanza por segundo, y vuelve por donde fue.
  async function calibrar(ms = 1200) {
    const motivo = puede(); if (motivo) return { ok: false, motivo };
    if (ocupado) return { ok: false, motivo: 'ocupado' };
    ocupado = true; cancelar = false;
    const res = [];
    try {
      for (const d of DIRS) {
        if (cancelar) break;
        const a = pos(); vec(d); await dormir(ms); parar(); await dormir(500);
        const b = pos(); const seg = (ms + 300) / 1000;
        res.push({ d, dx: (b.x - a.x) / seg, dy: (b.y - a.y) / seg, casillas: Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) });
        vec([-d[0], -d[1]]); await dormir(ms); parar(); await dormir(400);   // volver
      }
    } finally { parar(); ocupado = false; }
    const util = res.filter((r) => r.casillas >= 1);
    if (util.length >= 4) { tabla = res; try { localStorage.setItem(KEY, JSON.stringify(tabla)); } catch (e) { /* nada */ } }
    return { ok: util.length >= 4, tabla: res };
  }

  // Va hacia la casilla (x,y): cada 150 ms elige la dirección calibrada con mayor producto escalar hacia el destino.
  async function ir(x, y, { tol = 1, maxMs = 15000 } = {}) {
    const motivo = puede(); if (motivo) return { ok: false, motivo };
    if (!tabla) return { ok: false, motivo: 'falta calibrar' };
    if (ocupado) return { ok: false, motivo: 'ocupado' };
    ocupado = true; cancelar = false;
    const t0 = Date.now(); let ultPos = pos(), ultCambio = Date.now(), motivoFin = 'timeout';
    try {
      while (Date.now() - t0 < maxMs) {
        if (cancelar) { motivoFin = 'cancelado'; break; }
        if (puede()) { motivoFin = 'condición: ' + puede(); break; }
        const p = pos(), tx = x - p.x, ty = y - p.y;
        if (Math.max(Math.abs(tx), Math.abs(ty)) <= tol) { motivoFin = 'llegó'; break; }
        if (p.x !== ultPos.x || p.y !== ultPos.y) { ultPos = p; ultCambio = Date.now(); }
        else if (Date.now() - ultCambio > 1500) { motivoFin = 'bloqueado'; break; }
        const n = Math.hypot(tx, ty);
        let mejor = null, mejorDot = 0;
        for (const r of tabla) {
          const m = Math.hypot(r.dx, r.dy); if (m < 0.3) continue;      // dirección que no se movió al calibrar
          const dot = (r.dx * tx + r.dy * ty) / (m * n);
          if (dot > mejorDot) { mejorDot = dot; mejor = r.d; }
        }
        if (!mejor) { motivoFin = 'sin dirección útil'; break; }
        vec(mejor); await dormir(150);
      }
    } finally { parar(); ocupado = false; }
    const f = pos();
    return { ok: motivoFin === 'llegó', motivo: motivoFin, final: f, falta: Math.max(Math.abs(x - f.x), Math.abs(y - f.y)), ms: Date.now() - t0 };
  }

  // Un paso no bloqueante: fija el vector de movimiento hacia (x,y) y devuelve enseguida. Se llama seguido desde otro bucle.
  function dirHacia(tx, ty) {
    const n = Math.hypot(tx, ty); let mejor = null, mejorDot = 0;
    for (const r of tabla) { const mm = Math.hypot(r.dx, r.dy); if (mm < 0.3) continue; const dot = (r.dx * tx + r.dy * ty) / (mm * n); if (dot > mejorDot) { mejorDot = dot; mejor = r.d; } }
    return mejor;
  }
  function paso(x, y, tol = 1) {
    if (!tabla) return 'sin calibrar';
    const p = pos(), tx = x - p.x, ty = y - p.y;
    if (Math.max(Math.abs(tx), Math.abs(ty)) <= tol) { parar(); return 'llegó'; }
    const d = dirHacia(tx, ty); if (!d) { parar(); return 'sin dirección'; }
    vec(d); return 'yendo';
  }
  window.__mover = {  paso, ultimoVector: () => ultVec, calibrar, ir, parar, cancelar: () => { cancelar = true; parar(); }, tabla: () => tabla, pos, puede };
})();
