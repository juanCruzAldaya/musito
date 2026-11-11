// Bichos: lee (sin enviar nada) los avisos estándar del servidor sobre qué monstruos hay en tu vista:
//   C2 0x13 = aparecen (5 bytes de cabecera + 10 por monstruo: id, tipo, x, y, tx, ty, dir, estado)
//   C1 0x14 = desaparecen (cabecera 4 + 2 por id)   C1 0x17 = muere (id, hechizo, asesino)
//   C3 0x16 = experiencia ganada por una muerte (u32 little-endian en los bytes 4..7)
//   C2 0x20 = items que caen al piso (id con bit 0x80 = recién caído; item: byte0>>4 = grupo, byte1 = índice)
// Con eso mide, por zona (celdas de 10x10): bichos cerca, muertes/min, experiencia EXACTA/min y qué joyas caen. Guarda en localStorage.
(() => {
  'use strict';
  const KEY = 'muBichosV2'   /* V2: arranca limpio; V1 mezclaba tiempo viejo con experiencia nueva */, RADIO = 8, MIN_SEG = 180;
  let datos = {}; try { datos = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { datos = {}; }
  const vistos = new Map();       // id -> {tipo, x, y}
  const val = { c13: 0, c13raro: 0, c14: 0, c14raro: 0, c17: 0, c17cerca: 0, c16: 0, c16idOk: 0, c16idNo: 0, c20: 0, c20nuevos: 0, c20sinParsear: 0 };
  const suelo = new Map();        // id -> {x, y, item:'grupo:índice', t}: items que hay ahora en el piso (de C2 0x20 / 0x21)
  let expAcum = 0;                // experiencia total recibida (suma de todos los C3 0x16), sin importar el Helper
  const muertos = new Map();      // id -> {tipo, t}: para atribuir la experiencia a un tipo de bicho (a prueba)
  const JOYAS = { '14:13': 'Bless', '14:14': 'Soul', '12:15': 'Chaos', '14:16': 'Life', '14:22': 'Creation', '14:31': 'Guardian', '14:41': 'Gemstone', '14:42': 'Harmony', '14:43': 'Lower refine', '14:44': 'Higher refine' };
  let mapaAnt = null, sucio = false, ultGuardado = 0, cercaAhora = 0, ultTick = Date.now();
  const pend = [];                 // muertes cercanas esperando su tiempo real (se vuelcan en el tick)
  const M = () => window.Module;
  const g = (f) => { try { const h = M()['_MuWeb' + f]; return typeof h === 'function' ? h() : null; } catch (e) { return null; } };
  const celda = () => g('GetMapIndex') + '|' + Math.floor(g('GetHeroX') / 10) + '|' + Math.floor(g('GetHeroY') / 10);
  const farmeando = () => M() && g('GetSceneFlag') === 5 && g('GetPlayerLife') > 0 && g('HelperIsActive') === 1 && g('HelperIsSafeZone') !== 1;
  const zona = (k) => { const z = datos[k] || (datos[k] = { s: 0, d: 0, k: 0, t: {} }); if (z.e === undefined) { z.e = 0; z.ne = 0; z.te = {}; z.tn = {}; z.dr = {}; } return z; };

  function proc(u) {
    if (!u || u.length < 4) return;
    if (u[0] === 0xC2 && u.length >= 5 && u[3] === 0x13) {
      val.c13++; const c = u[4];
      if (5 + c * 10 !== u.length) val.c13raro++;
      for (let i = 0; i < c; i++) {
        const o = 5 + i * 10; if (o + 10 > u.length) break;
        vistos.set(((u[o] & 0x7F) << 8) | u[o + 1], { tipo: (u[o + 2] << 8) | u[o + 3], x: u[o + 6], y: u[o + 7], t: Date.now() });
      }
    } else if (u[0] === 0xC1 && u[2] === 0x14) {
      val.c14++; const c = u[3];
      if (4 + c * 2 !== u.length) val.c14raro++;
      for (let i = 0; i < c && 4 + i * 2 + 1 < u.length; i++) vistos.delete(((u[4 + i * 2] & 0x7F) << 8) | u[5 + i * 2]);
    } else if (u[0] === 0xC1 && u[2] === 0x17 && u.length >= 5) {
      val.c17++;
      const id = ((u[3] & 0x7F) << 8) | u[4], m = vistos.get(id);
      if (!m) return;                      // no era un monstruo que conociéramos (jugador, etc.)
      vistos.delete(id);
      muertos.set(id, { tipo: m.tipo, t: Date.now() });
      if (!farmeando()) return;
      if (Math.max(Math.abs(m.x - g('GetHeroX')), Math.abs(m.y - g('GetHeroY'))) <= RADIO) {
        val.c17cerca++;
        pend.push({ k: celda(), tipo: m.tipo });
      }
    } else if (u[0] === 0xC3 && u[2] === 0x16 && u.length >= 14) {
      val.c16++;
      const exp = (u[4] | (u[5] << 8) | (u[6] << 16) | (u[7] * 16777216)) >>> 0;
      expAcum += exp;
      const idLE = u[12] | (u[13] << 8);                      // hipótesis: id del monstruo (a verificar con 'muertos')
      const mm = muertos.get(idLE);
      if (mm && Date.now() - mm.t < 10000) val.c16idOk++; else val.c16idNo++;
      if (farmeando()) pend.push({ x: 1, k: celda(), exp, tipo: mm ? mm.tipo : null });
    } else if (u[0] === 0xC2 && u[3] === 0x21 && u.length >= 7) {
      for (let i = 0; i < u[4] && 5 + i * 2 + 1 < u.length; i++) suelo.delete(((u[5 + i * 2] & 0x7F) << 8) | u[6 + i * 2]);
    } else if (u[0] === 0xC2 && u[3] === 0x20 && u.length >= 5) {
      val.c20++;
      const n = u[4]; let L = 0;
      for (let l = 5; l <= 14 && !L; l++) if (5 + n * (4 + l) === u.length) L = l;   // largo del item si todos miden igual
      if (!L) { val.c20sinParsear++; return; }
      const hx = g('GetHeroX'), hy = g('GetHeroY'), en = farmeando();
      for (let i = 0; i < n; i++) {
        const o = 5 + i * (4 + L), item = (u[o + 4] >> 4) + ':' + u[o + 5];
        suelo.set(((u[o] & 0x7F) << 8) | u[o + 1], { x: u[o + 2], y: u[o + 3], item, t: Date.now() });
        if (!(u[o] & 0x80)) continue;                          // sin el bit 0x80 = ya estaba en el piso
        val.c20nuevos++;
        if (!en || Math.max(Math.abs(u[o + 2] - hx), Math.abs(u[o + 3] - hy)) > 15) continue;
        pend.push({ d: 1, k: celda(), item });
      }
    }
  }

  try {
    const WS = window.WebSocket;
    const P = function (url, prot) {
      const s = prot !== undefined ? new WS(url, prot) : new WS(url);
      s.addEventListener('message', (e) => {
        try {
          if (e.data instanceof ArrayBuffer) proc(new Uint8Array(e.data));
          else if (e.data instanceof Blob) e.data.arrayBuffer().then((b) => proc(new Uint8Array(b)));
        } catch (err) { /* nada */ }
      });
      return s;
    };
    P.prototype = WS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k) => (P[k] = WS[k]));
    window.WebSocket = P;
  } catch (e) { /* nada */ }

  setInterval(() => {
    try {
      const m = g('GetMapIndex');
      if (mapaAnt !== null && m !== mapaAnt) {   // el servidor manda la vista nueva enseguida: borrar solo lo que llegó ANTES del cambio
        const corte = Date.now() - 2500;
        vistos.forEach((v, id) => { if ((v.t || 0) < corte) vistos.delete(id); });
        suelo.forEach((v, id) => { if ((v.t || 0) < corte) suelo.delete(id); });
      }   // cambio de mapa: la vista se rearma sola
      mapaAnt = m;
      const ahora = Date.now(), dt = Math.min((ahora - ultTick) / 1000, 120); ultTick = ahora;   // tiempo REAL (si Chrome frena los ticks, dt crece)
      if (!farmeando()) { cercaAhora = 0; pend.length = 0; return; }
      const hx = g('GetHeroX'), hy = g('GetHeroY'); let c = 0;
      vistos.forEach((v) => { if (Math.max(Math.abs(v.x - hx), Math.abs(v.y - hy)) <= RADIO) c++; });
      cercaAhora = c;
      const z = zona(celda()); z.s += dt; z.d += c * dt; sucio = true;
      while (pend.length) {
        const e = pend.shift(), zk = zona(e.k);
        if (e.x) { zk.e += e.exp; zk.ne++; if (e.tipo != null) { zk.te[e.tipo] = (zk.te[e.tipo] || 0) + e.exp; zk.tn[e.tipo] = (zk.tn[e.tipo] || 0) + 1; } }
        else if (e.d) zk.dr[e.item] = (zk.dr[e.item] || 0) + 1;
        else { zk.k++; zk.t[e.tipo] = (zk.t[e.tipo] || 0) + 1; }
      }
      muertos.forEach((v, id) => { if (ahora - v.t > 15000) muertos.delete(id); });
      suelo.forEach((v, id) => { if (ahora - v.t > 180000) suelo.delete(id); });
      if (sucio && Date.now() - ultGuardado > 30000) { try { localStorage.setItem(KEY, JSON.stringify(datos)); } catch (e) { /* lleno */ } sucio = false; ultGuardado = Date.now(); }
    } catch (e) { /* no frenar */ }
  }, 1000);

  const mmss = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n)));
  const joyasDe = (z) => Object.entries(z.dr || {}).filter(([k]) => JOYAS[k]).reduce((a, [, n]) => a + n, 0);
  const fila = (k, z) => {
    const p = k.split('|'), min = z.s / 60;
    return {
      mapa: +p[0], zona: 'x ' + p[1] * 10 + '-' + (p[1] * 10 + 9) + ', y ' + p[2] * 10 + '-' + (p[2] * 10 + 9), min: +min.toFixed(1),
      expPorMin: min > 0 ? Math.round((z.e || 0) / min) : 0, muertesPorMin: min > 0 ? +(z.k / min).toFixed(1) : 0, bichosCercaPromedio: +(z.d / z.s).toFixed(1),
      joyasPorMin: min > 0 ? +(joyasDe(z) / min).toFixed(1) : 0,
      expPorBicho: Object.entries(z.tn || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => 'tipo ' + t + ': ' + mmss(z.te[t] / n) + ' (n=' + n + ')').join(', '),
      tipos: Object.entries(z.t).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => 'tipo ' + t + '×' + n).join(', '),
      drops: Object.entries(z.dr || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([i, n]) => (JOYAS[i] || i) + '×' + n).join(', '),
    };
  };
  window.__bichos = {
    datos: () => datos, validacion: () => ({ ...val, enVista: vistos.size }),
    ranking: (mapa) => Object.entries(datos).filter(([k, z]) => z.s >= MIN_SEG && (mapa == null || k.startsWith(mapa + '|'))).map(([k, z]) => fila(k, z)).sort((a, b) => b.expPorMin - a.expPorMin).slice(0, 5),
    texto: () => { const r = window.__bichos.ranking(g('GetMapIndex')); return r.length ? r.map((e, i) => (i + 1) + '. ' + e.zona + ': ' + mmss(e.expPorMin) + ' exp/min, ' + e.muertesPorMin + ' muertes/min, ' + e.joyasPorMin + ' joyas/min (' + e.min + ' min)').join(' | ') : 'Sin zonas con ' + MIN_SEG / 60 + '+ min medidos (válido: ' + JSON.stringify(val) + ')'; },
    racimoTexto: () => { const c = window.__bichos.racimo(); return c && c.total ? 'Racimo (r' + c.r + '): aquí ' + c.aqui + ' · mejor ' + c.mejor.n + ' en (' + c.mejor.x + ',' + c.mejor.y + ') a ' + c.dist + ' casillas' : ''; },
    zonaActual: () => { const z = datos[celda()]; return M() && z && z.s >= 60 ? 'Zona: ' + mmss((z.e || 0) / (z.s / 60)) + ' exp/min · ' + (z.k / (z.s / 60)).toFixed(0) + ' muertes/min · ' + (joyasDe(z) / (z.s / 60)).toFixed(1) + ' joyas/min · cerca ' + cercaAhora : ''; },
    // Solo CALCULA (no mueve): dónde conviene pararse para tener más bichos a menos de 'r' casillas,
    // buscando entre las posiciones de los bichos que hay a 'buscar' casillas o menos de vos.
    vista: () => Array.from(vistos, ([id, v]) => ({ id, ...v })),
    suelo: () => Array.from(suelo, ([id, v]) => ({ id, ...v })),
    ahora: () => { const hx = g('GetHeroX'), hy = g('GetHeroY'); return { heroe: [hx, hy], mapa: g('GetMapIndex'), validacion: { ...val, enVista: vistos.size }, cercanos: Array.from(vistos, ([id, v]) => ({ id, tipo: v.tipo, x: v.x, y: v.y, d: Math.max(Math.abs(v.x - hx), Math.abs(v.y - hy)), hace_s: Math.round((Date.now() - (v.t || 0)) / 1000) })).sort((a, b) => a.d - b.d).slice(0, 8) }; },
    expTotal: () => expAcum,
    racimo: (r = 3, buscar = 14) => {
      const hx = g('GetHeroX'), hy = g('GetHeroY'); if (hx == null) return null;
      const lista = Array.from(vistos.values()).filter((v) => Math.max(Math.abs(v.x - hx), Math.abs(v.y - hy)) <= buscar);
      const cuenta = (cx, cy) => { let n = 0; for (const v of lista) if (Math.max(Math.abs(v.x - cx), Math.abs(v.y - cy)) <= r) n++; return n; };
      const aqui = cuenta(hx, hy); let mejor = { x: hx, y: hy, n: aqui };
      for (const v of lista) { const n = cuenta(v.x, v.y); if (n > mejor.n || (n === mejor.n && Math.hypot(v.x - hx, v.y - hy) < Math.hypot(mejor.x - hx, mejor.y - hy))) mejor = { x: v.x, y: v.y, n }; }
      return { aqui, mejor, dist: Math.max(Math.abs(mejor.x - hx), Math.abs(mejor.y - hy)), r, total: lista.length };
    },
    _proc: proc,
  };
})();
