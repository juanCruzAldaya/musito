// Sonda de paquetes: de todos los paquetes anota solo metadatos (cabecera, código y largo).
// Únicamente de unos pocos tipos (experiencia, drops, juntar, daño, vida y movimiento de objetos; ver MUESTREAR) guarda hasta 6 ejemplos en
// hexadecimal para descubrir su formato. Nunca guarda chat ni nada personal, y no modifica ni envía nada.
(() => {
  'use strict';
  const rx = {}, tx = {};   // "C1:13" -> {n, min, max, suma}
  const ult = [];            // últimos 40 recibidos: [t_ms, cabecera, código, largo]
  const t0 = Date.now();
  const MUESTREAR = new Set(['C3:0x16', 'C2:0x20', 'C2:0x21', 'C2:0x31', 'C1:0x00', 'C3:0x22', 'C1:0x11', 'C1:0x26', 'C1:0xd4', 'C1:0x18', 'C1:0x15', 'C3:0x19', 'C1:0x07', 'C1:0xe7', 'C2:0xe7', 'C1:0xe8', 'C1:0x2f', 'C1:0x44', 'C2:0x65', 'C2:0x12', 'C1:0xf3', 'C2:0xf3', 'C4:0xf3', 'C2:0xe8']);      // v0.96.2: canales raros del servidor (0xE7/0xE8/0xF3/0x2F/0x44/0x65): se guardan ejemplos
  const muestras = {};   // paquete -> lista (máx. 6, con largos distintos) de bytes en hexadecimal
  function guardarMuestra(m, u8) {
    if (!MUESTREAR.has(m.k)) return;
    const l = muestras[m.k] || (muestras[m.k] = []);
    if (l.length >= 6 || l.some((x) => x.largo === u8.length && l.length >= 3)) return;
    l.push({ largo: u8.length, hex: Array.from(u8.slice(0, /^C[24]:0x(e7|f3|e8)$/.test(m.k) ? 256 : 96), (b) => b.toString(16).padStart(2, '0')).join(' ') });
  }
  let total = { rx: 0, tx: 0 }, ventanas = {}, ventanasTx = {};

  function meta(u8) {
    if (!u8 || u8.length < 3) return null;
    const h = u8[0];
    const cod = (h === 0xC1 || h === 0xC3) ? u8[2] : (h === 0xC2 || h === 0xC4) ? u8[3] : u8[1];
    const nombre = { 0xC1: 'C1', 0xC2: 'C2', 0xC3: 'C3', 0xC4: 'C4' }[h] || ('0x' + h.toString(16));
    return { k: nombre + ':' + (cod === undefined ? '?' : '0x' + cod.toString(16).padStart(2, '0')), h: nombre, cod, len: u8.length };
  }
  // ---- RAREZA DE LOS ITEMS (v0.96.0): ¿por qué canal le llega al cliente el texto "Rareza: Épico", "[Raro] Contraataque: 9,3 %..."? ----
  // Solo lectura: de los paquetes recibidos que NO son los frecuentes del combate ni el chat, busca esas palabras (UTF-8 y UTF-16) y guarda hasta 40 aciertos (código, largo, texto cercano y los primeros bytes).
  // Si salen, el texto viaja en un paquete y se puede ver su formato; si no salen, el cliente lo arma con una tabla propia a partir de los bytes del item.
  const FRECUENTES = new Set(['C1:0x48', 'C3:0x1e', 'C1:0x17', 'C2:0x13', 'C3:0x19', 'C1:0x14', 'C3:0x16', 'C1:0x26', 'C1:0x11', 'C1:0xd4', 'C3:0x22', 'C1:0x18', 'C2:0x21', 'C1:0x00', 'C1:0x02', 'C1:0x0d', 'C1:0x07', 'C1:0x15']);
  const PALABRAS = ['Rareza', 'Contraataque', 'Templanza', 'Soplo de', 'Bloqueo', 'Rarity', 'Epic', 'Raro]', 'pico]'];
  const rareza = { hits: [], paquetesRevisados: 0, porCodigo: {} };
  function sniffRareza(m, u8) {
    if (!u8 || u8.length < 24 || FRECUENTES.has(m.k)) return;
    rareza.paquetesRevisados++;
    let s8 = '', s16 = '';
    for (let i = 0; i < u8.length; i++) s8 += String.fromCharCode(u8[i]);
    for (let i = 0; i + 1 < u8.length; i += 2) s16 += String.fromCharCode(u8[i] | (u8[i + 1] << 8));
    let s16b = ''; for (let i = 1; i + 1 < u8.length; i += 2) s16b += String.fromCharCode(u8[i] | (u8[i + 1] << 8));
    for (const w of PALABRAS) {
      const enc = s8.indexOf(w) >= 0 ? 'utf8' : (s16.indexOf(w) >= 0 || s16b.indexOf(w) >= 0) ? 'utf16' : null;
      if (!enc) continue;
      rareza.porCodigo[m.k] = (rareza.porCodigo[m.k] || 0) + 1;
      if (rareza.hits.length < 40) {
        const base = enc === 'utf8' ? s8 : (s16.indexOf(w) >= 0 ? s16 : s16b), i = base.indexOf(w);
        let txt = ''; try { txt = enc === 'utf8' ? decodeURIComponent(escape(base.slice(i, i + 120))) : base.slice(Math.max(0, i - 10), i + 120); } catch (e) { txt = base.slice(i, i + 120); }
        rareza.hits.push({ t_s: Math.round((Date.now() - t0) / 1000), paquete: m.k, largo: u8.length, palabra: w, codificacion: enc, texto: txt.replace(/[^\x20-\x7E\u00A0-\u024F]/g, '·'), hex: Array.from(u8.slice(0, 160), (b) => b.toString(16).padStart(2, '0')).join(' ') });
      }
      return;
    }
  }
  const escRx = [], escTx = [];   // oyentes de paquetes (solo lectura): window.__paquetes.alRecibir(fn) / alEnviar(fn)
  function anotar(tabla, m, dir, u8) {
    if (!m) return;
    if (dir === 'rx' && u8) for (const f of escRx) { try { f(u8); } catch (e) { /* nada */ } }
    if (dir === 'rx' && u8) guardarMuestra(m, u8);
    if (dir === 'rx' && u8) { try { sniffRareza(m, u8); } catch (e) { /* nada */ } }
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
    rareza: () => rareza,
    informe: () => ({ rareza_sniff: rareza, hora: new Date().toISOString(), segundos: Math.round((Date.now() - t0) / 1000), total, recibidos: resumen(rx), enviados: resumen(tx), ultimosRecibidos: ult, muestras, castsTx, porVentanaDe10s: ventanas, porVentanaDe10sEnviados: ventanasTx }),
  };
})();
