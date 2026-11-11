// Sonda de paquetes: de todos los paquetes anota solo metadatos (cabecera, código y largo).
// Únicamente de unos pocos tipos (experiencia, drops, juntar, daño, vida y movimiento de objetos; ver MUESTREAR) guarda hasta 6 ejemplos en
// hexadecimal para descubrir su formato. Nunca guarda chat ni nada personal, y no modifica ni envía nada.
(() => {
  'use strict';
  const rx = {}, tx = {};   // "C1:13" -> {n, min, max, suma}
  const ult = [];            // últimos 40 recibidos: [t_ms, cabecera, código, largo]
  const t0 = Date.now();
  const MUESTREAR = new Set(['C3:0x16', 'C2:0x20', 'C2:0x21', 'C2:0x31', 'C1:0x00', 'C3:0x22', 'C1:0x11', 'C1:0x26', 'C1:0xd4', 'C1:0x18', 'C1:0x15', 'C3:0x19', 'C1:0x07']);
  const muestras = {};   // paquete -> lista (máx. 6, con largos distintos) de bytes en hexadecimal
  function guardarMuestra(m, u8) {
    if (!MUESTREAR.has(m.k)) return;
    const l = muestras[m.k] || (muestras[m.k] = []);
    if (l.length >= 6 || l.some((x) => x.largo === u8.length && l.length >= 3)) return;
    l.push({ largo: u8.length, hex: Array.from(u8.slice(0, 96), (b) => b.toString(16).padStart(2, '0')).join(' ') });
  }
  let total = { rx: 0, tx: 0 }, ventanas = {}, ventanasTx = {};

  function meta(u8) {
    if (!u8 || u8.length < 3) return null;
    const h = u8[0];
    const cod = (h === 0xC1 || h === 0xC3) ? u8[2] : (h === 0xC2 || h === 0xC4) ? u8[3] : u8[1];
    const nombre = { 0xC1: 'C1', 0xC2: 'C2', 0xC3: 'C3', 0xC4: 'C4' }[h] || ('0x' + h.toString(16));
    return { k: nombre + ':' + (cod === undefined ? '?' : '0x' + cod.toString(16).padStart(2, '0')), h: nombre, cod, len: u8.length };
  }
  const escRx = [], escTx = [];   // oyentes de paquetes (solo lectura): window.__paquetes.alRecibir(fn) / alEnviar(fn)
  function anotar(tabla, m, dir, u8) {
    if (!m) return;
    if (dir === 'rx' && u8) for (const f of escRx) { try { f(u8); } catch (e) { /* nada */ } }
    if (dir === 'rx' && u8) guardarMuestra(m, u8);
    const c = tabla[m.k] || (tabla[m.k] = { n: 0, min: 1e9, max: 0, suma: 0 });
    c.n++; c.min = Math.min(c.min, m.len); c.max = Math.max(c.max, m.len); c.suma += m.len;
    total[dir]++;
    if (dir === 'tx') { const w = Math.floor((Date.now() - t0) / 10000); const v = ventanasTx[w] || (ventanasTx[w] = {}); v[m.k] = (v[m.k] || 0) + 1; }
    if (dir === 'rx') {
      ult.push([Date.now() - t0, m.h, m.cod, m.len]); if (ult.length > 40) ult.shift();
      const w = Math.floor((Date.now() - t0) / 10000); // por ventanas de 10 s, para ver qué paquetes son periódicos
      const v = ventanas[w] || (ventanas[w] = {}); v[m.k] = (v[m.k] || 0) + 1;
    }
  }
  const aU8 = (d) => (d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : null);

  // Cada hechizo enviado (C3 0x19: hechizo(2) + blanco(2)): qué bicho eligió y a qué distancia estaba. Sirve para ver cómo ataca el Helper.
  const castsTx = [];
  function logTx(u) {
    if (!u || u.length < 7 || u[0] !== 0xC3 || u[2] !== 0x19) return;
    const skill = (u[3] << 8) | u[4], tid = ((u[5] & 0x7F) << 8) | u[6];
    let mon = null, hx = null, hy = null;
    try { const M = window.Module; hx = M._MuWebGetHeroX(); hy = M._MuWebGetHeroY(); const B = window.__bichos; if (B && B.vista) mon = B.vista().find((v) => v.id === tid) || null; } catch (e) { /* nada */ }
    castsTx.push({ t_ms: Date.now() - t0, hex: Array.from(u, (b) => b.toString(16).padStart(2, '0')).join(' '), skill, tid, conocido: !!mon,
      d: mon ? Math.max(Math.abs(mon.x - hx), Math.abs(mon.y - hy)) : null, mx: mon ? mon.x : null, my: mon ? mon.y : null, hx, hy });
    if (castsTx.length > 800) castsTx.shift();
  }

  try {
    const WS = window.WebSocket;
    const P = function (url, prot) {
      const s = prot !== undefined ? new WS(url, prot) : new WS(url);
      s.addEventListener('message', (e) => {
        try {
          if (e.data instanceof Blob) e.data.arrayBuffer().then((b) => (() => { const u = new Uint8Array(b); anotar(rx, meta(u), 'rx', u); })());
          else { const u = aU8(e.data); anotar(rx, meta(u), 'rx', u); }
        } catch (err) { /* nada */ }
      });
      const send = s.send.bind(s);
      s.send = (d) => { try { const u = aU8(d); anotar(tx, meta(u), 'tx'); logTx(u); for (const f of escTx) { try { f(u); } catch (e2) { /* nada */ } } } catch (err) { /* nada */ } return send(d); };
      return s;
    };
    P.prototype = WS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k) => (P[k] = WS[k]));
    window.WebSocket = P;
  } catch (e) { /* nada */ }

  const resumen = (t) => Object.entries(t).sort((a, b) => b[1].n - a[1].n).map(([k, c]) => ({ paquete: k, cuantos: c.n, largoMin: c.min, largoMax: c.max, largoMedio: Math.round(c.suma / c.n) }));
  window.__paquetes = {
    alRecibir: (f) => escRx.push(f), alEnviar: (f) => escTx.push(f),
    cuenta: (dir, k) => ((dir === 'tx' ? tx : rx)[k] || { n: 0 }).n,
    informe: () => ({ hora: new Date().toISOString(), segundos: Math.round((Date.now() - t0) / 1000), total, recibidos: resumen(rx), enviados: resumen(tx), ultimosRecibidos: ult, muestras, castsTx, porVentanaDe10s: ventanas, porVentanaDe10sEnviados: ventanasTx }),
  };
})();
