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
  const val = { c13: 0, c13raro: 0, c14: 0, c14raro: 0, c17: 0, c17cerca: 0, c16: 0, c16idOk: 0, c16idNo: 0, c20: 0, c20nuevos: 0, c20sinParsear: 0, d4: 0 };
  const d4s = { n: 0, origen: 0, destino: 0 };   // distancia media al héroe de cada par de coordenadas de los D4 (sirve para saber cuál es el destino)
  const VEL = 3.5;                // casillas/seg: velocidad con la que se interpola un bicho entre el origen y el destino de un paso
  const suelo = new Map();        // id -> {x, y, item:'grupo:índice', t}: items que hay ahora en el piso (de C2 0x20 / 0x21)
  let expAcum = 0;                // experiencia total recibida (suma de todos los C3 0x16), sin importar el Helper
  const muertos = new Map();      // id -> {tipo, t}: para atribuir la experiencia a un tipo de bicho (a prueba)
  const JOYAS = { '14:13': 'Bless', '14:14': 'Soul', '12:15': 'Chaos', '14:16': 'Life', '14:22': 'Creation', '14:31': 'Guardian', '14:41': 'Gemstone', '14:42': 'Harmony', '14:43': 'Lower refine', '14:44': 'Higher refine' };
  // Densidad: celdas de 6x6. Por cada segundo se suma, para cada celda que está a <= 12 casillas de vos, el tiempo que estuvo "a la vista" (o) y los
  // bichos que había adentro por segundo (m, y por tipo en t). densidad = m / o = cuántos bichos hay en promedio en esa celda cuando se la mira.
  const KEY_DENS = 'muDensV1', CELDA = 6, VISTA = 12;
  let dens = {}; try { dens = JSON.parse(localStorage.getItem(KEY_DENS) || '{}'); } catch (e) { dens = {}; }
  let densSucio = false, densGuardado = 0, respawnsVistos = 0;
  // RESPAWNS POR CASILLA (v0.70.5). El aviso de aparición con el bit 0x80 trae la casilla exacta (x,y) donde reapareció el bicho: se cuentan por mapa y casilla (guardado en el navegador) para
  // calcular en qué casilla conviene quedarse QUIETO: la que alcanza con el tiro (bien hasta ~4,5 casillas, a medias hasta ~7,5: en las cajas 3 a 14 los hechizos responden hasta 7 casillas y
  // el motor nunca eligió blancos a más de 7) la mayor cantidad de respawns de las cercanías. Caja 14: el ancla vieja (123,116) alcanzaba el 13 % de los bichos; (130,110) el 98 %.
  const KEY_RT = 'muRespTV1', MAX_TILES = 6000, R0 = 4.5, R1 = 7.5;
  let respT = {}; try { respT = JSON.parse(localStorage.getItem(KEY_RT) || '{}'); } catch (e) { respT = {}; }
  let respSucio = false, respGuardado = 0, respNuevos = 0;
  const pisable = {};      // mapa -> Set('x,y'): casillas donde se vio caminar a un bicho o parado al héroe (para no elegir una pared); solo en memoria
  const marcarPisable = (mp, x, y) => { const s = pisable[mp] || (pisable[mp] = new Set()); if (s.size < 40000) s.add(x + ',' + y); };
  function guardarRT(ahora) {
    if (!respSucio || ahora - respGuardado < 30000) return;
    try { localStorage.setItem(KEY_RT, JSON.stringify(respT)); } catch (e) { /* lleno */ }
    respSucio = false; respGuardado = ahora;
  }
  function anotarRespawn(mp, x, y) {
    const mt = respT[mp] || (respT[mp] = {}), k = x + ',' + y; mt[k] = (mt[k] || 0) + 1; respSucio = true; marcarPisable(mp, x, y);
    if (++respNuevos % 500 === 0) { const ks = Object.keys(mt); if (ks.length > MAX_TILES) ks.forEach((q) => { if (mt[q] <= 1) delete mt[q]; }); }
  }
  const pesoDist = (d) => (d <= R0 ? 1 : d >= R1 ? 0 : (R1 - d) / (R1 - R0));
  const cubre = (c, pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i]; s += p.n * pesoDist(Math.hypot(p.x - c.x, p.y - c.y)); } return s; };
  const nA = (c, pts, r) => { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (Math.hypot(p.x - c.x, p.y - c.y) <= r) s += p.n; } return s; };
  const pctA = (c, pts, total, r) => (total ? Math.round(100 * nA(c, pts, r) / total) : 0);
  const resumenCasilla = (c, pts, total) => ({ x: c.x, y: c.y, cubre_pct: total ? Math.round(100 * cubre(c, pts) / total) : 0, a4_pct: pctA(c, pts, total, 4.5), a6_pct: pctA(c, pts, total, 6.5), n4: nA(c, pts, 4.5), n6: nA(c, pts, 6.5) });      // n4/n6: respawns (cantidad absoluta) a <= 4,5 / 6,5 casillas
  // Puntos de respawn cerca de (cx,cy): por casilla si hay datos (>= minResp respawns); si no, por celdas de 6x6 de la densidad (cada celda puesta en su centro).
  function puntosRespawn(mapa, cx, cy, radio, minResp) {
    let pts = [], total = 0, fuente = 'casillas';
    const mt = respT[mapa] || {};
    for (const k in mt) { const i = k.indexOf(','), x = +k.slice(0, i), y = +k.slice(i + 1); if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= radio) { pts.push({ x, y, n: mt[k] }); total += mt[k]; } }
    if (total < minResp) {
      pts = []; total = 0; fuente = 'celdas';
      Object.keys(dens).forEach((k) => { const p = k.split('|'); if (+p[0] !== +mapa) return; const d = dens[k]; if (!d || !d.s) return; const x = +p[1] * CELDA + CELDA / 2, y = +p[2] * CELDA + CELDA / 2; if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= radio + CELDA) { pts.push({ x, y, n: d.s }); total += d.s; } });
    }
    return { pts, total, fuente };
  }
  // La mejor casilla para quedarse dentro de 'radio' casillas de (cx,cy) (por defecto del héroe): máxima cobertura de respawns; compara con donde está el héroe (o 'desde').
  function mejorLugar(o = {}) {
    const mapa = o.mapa != null ? o.mapa : g('GetMapIndex'), hx = g('GetHeroX'), hy = g('GetHeroY');
    let cx = o.cx != null ? o.cx : hx, cy = o.cy != null ? o.cy : hy;
    const radio = o.radio || 10, minResp = o.minResp != null ? o.minResp : 30;
    if (cx == null || cy == null) return { ok: false, motivo: 'sin posición' };
    // re-centrado: si el héroe quedó corrido del spot (ancla vieja a 8 casillas), la ventana de 'radio' alrededor suyo le corta packs: se centra en el centro de masa de los respawns cercanos (2 vueltas)
    for (let it = 0; it < 2; it++) {
      const a = puntosRespawn(mapa, cx, cy, radio + 4, minResp); if (a.total < minResp) break;
      let sx = 0, sy = 0; a.pts.forEach((p) => { sx += p.x * p.n; sy += p.y * p.n; }); cx = Math.round(sx / a.total); cy = Math.round(sy / a.total);
    }
    const { pts, total, fuente } = puntosRespawn(mapa, cx, cy, radio, minResp);
    if (total < minResp) return { ok: false, motivo: 'pocos respawns medidos cerca (' + total + ' de ' + minResp + ')', total };
    const cand = new Map(), add = (x, y) => { if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= radio) cand.set(x + ',' + y, { x, y }); };
    pts.forEach((p) => add(Math.round(p.x), Math.round(p.y)));
    const ps = pisable[mapa]; if (ps) ps.forEach((k) => { const i = k.indexOf(','); add(+k.slice(0, i), +k.slice(i + 1)); });
    const desde = o.desde || { x: hx, y: hy }; if (desde.x != null) add(desde.x, desde.y);
    let mejor = null, mejorS = -1;
    cand.forEach((c) => { const s = cubre(c, pts) - 1e-4 * total * Math.hypot(c.x - desde.x, c.y - desde.y); if (s > mejorS) { mejorS = s; mejor = c; } });   // desempate: la más cercana
    const aqui = resumenCasilla(desde, pts, total), mj = resumenCasilla(mejor, pts, total);
    return { ok: true, fuente, mapa, total, puntos: pts.length, candidatas: cand.size, aqui, mejor: mj, mejora: aqui.cubre_pct > 0 ? +(mj.cubre_pct / aqui.cubre_pct).toFixed(2) : 99, distancia: Math.max(Math.abs(mj.x - desde.x), Math.abs(mj.y - desde.y)) };
  }
  const cobertura = (x, y, o = {}) => {
    const mapa = o.mapa != null ? o.mapa : g('GetMapIndex'), radio = o.radio || 10, { pts, total, fuente } = puntosRespawn(mapa, x, y, radio, o.minResp != null ? o.minResp : 30);
    return total ? { ...resumenCasilla({ x, y }, pts, total), fuente, total } : null;
  };
  const respawnTiles = (mapa, n = 60) => { const mt = respT[mapa] || {}, ks = Object.keys(mt); return { casillas: ks.length, respawns: ks.reduce((a, k) => a + mt[k], 0), top: ks.sort((a, b) => mt[b] - mt[a]).slice(0, n).map((k) => { const i = k.indexOf(','); return [+k.slice(0, i), +k.slice(i + 1), mt[k]]; }) }; };
  let mapaAnt = null, sucio = false, ultGuardado = 0, cercaAhora = 0, ultTick = Date.now();
  const pend = [];                 // muertes cercanas esperando su tiempo real (se vuelcan en el tick)
  const M = () => window.Module;
  const g = (f) => { try { const h = M()['_MuWeb' + f]; return typeof h === 'function' ? h() : null; } catch (e) { return null; } };
  const celda = () => g('GetMapIndex') + '|' + Math.floor(g('GetHeroX') / 10) + '|' + Math.floor(g('GetHeroY') / 10);
  const farmeando = () => M() && g('GetSceneFlag') === 5 && g('GetPlayerLife') > 0 && g('HelperIsSafeZone') !== 1 &&
    (g('HelperIsActive') === 1 || (window.__modo && ['sostener', 'pulsos', 'auto', 'piloto'].includes(window.__modo.deseado())));
  function posAhora(v) {
    if (!v.tp) return { x: v.x, y: v.y };
    const dist = Math.max(Math.abs(v.dx - v.ox), Math.abs(v.dy - v.oy)), el = (Date.now() - v.tp) / 1000;
    const f = dist ? Math.min(1, VEL * el / dist) : 1;
    return { x: Math.round(v.ox + (v.dx - v.ox) * f), y: Math.round(v.oy + (v.dy - v.oy) * f) };
  }
  // ¿Se está moviendo? Cada paso (D4) trae origen y destino y a VEL casillas/s el bicho tarda dist/VEL en llegar; pasado eso (+ NEG ms) está quieto en el destino.
  // Sirve para saber si el blanco de un hechizo estaba quieto o en movimiento (telemetría y "esperar quieto" de modo.js). null = el bicho no está en la vista.
  const NEG = 120;
  function movInfo(id) {
    const v = vistos.get(id); if (!v) return null;
    const ahora = Date.now(), hx = g('GetHeroX'), hy = g('GetHeroY'), p = posAhora(v);
    const dist = hx == null ? null : Math.max(Math.abs(p.x - hx), Math.abs(p.y - hy));
    if (!v.tp) return { moviendose: false, quieto_ms: ahora - (v.t || ahora), dist };
    const pasos = Math.max(Math.abs(v.dx - v.ox), Math.abs(v.dy - v.oy)), dur = pasos / VEL * 1000, desde = ahora - v.tp;
    return { moviendose: desde < dur + NEG, quieto_ms: Math.max(0, Math.round(desde - dur)), dist };
  }
  const zona = (k) => { const z = datos[k] || (datos[k] = { s: 0, d: 0, k: 0, t: {} }); if (z.e === undefined) { z.e = 0; z.ne = 0; z.te = {}; z.tn = {}; z.dr = {}; } return z; };

  function proc(u) {
    if (!u || u.length < 4) return;
    if (u[0] === 0xC2 && u.length >= 5 && u[3] === 0x13) {
      val.c13++; const c = u[4];
      if (5 + c * 10 !== u.length) val.c13raro++;
      for (let i = 0; i < c; i++) {
        const o = 5 + i * 10; if (o + 10 > u.length) break;
        vistos.set(((u[o] & 0x7F) << 8) | u[o + 1], { tipo: (u[o + 2] << 8) | u[o + 3], x: u[o + 6], y: u[o + 7], t: Date.now() });
        if (u[o] & 0x80) {   // OpenMU: NewNpcsInScope(isSpawned) agrega 0x8000 al id => el bicho ACABA de reaparecer (con efecto de aparición)
          try {
            const mp = g('GetMapIndex'), tp = (u[o + 2] << 8) | u[o + 3], kk = mp + '|' + Math.floor(u[o + 6] / CELDA) + '|' + Math.floor(u[o + 7] / CELDA);
            const dd = dens[kk] || (dens[kk] = { o: 0, m: 0, t: {} }); dd.s = (dd.s || 0) + 1; (dd.st || (dd.st = {}))[tp] = (dd.st[tp] || 0) + 1; densSucio = true; respawnsVistos++; anotarRespawn(mp, u[o + 6], u[o + 7]);
          } catch (e) { /* nada */ }
        }
      }
    } else if (u[0] === 0xC1 && u[2] === 0x14) {
      val.c14++; const c = u[3];
      if (4 + c * 2 !== u.length) val.c14raro++;
      for (let i = 0; i < c && 4 + i * 2 + 1 < u.length; i++) vistos.delete(((u[4 + i * 2] & 0x7F) << 8) | u[5 + i * 2]);
    } else if (u[0] === 0xC1 && u[2] === 0xD4 && u.length >= 10) {
      val.d4++;
      const id = ((u[3] & 0x7F) << 8) | u[4], m = vistos.get(id);
      if (!m) return;
      m.ox = u[5]; m.oy = u[6]; m.dx = u[7]; m.dy = u[8]; m.tp = Date.now(); m.x = u[7]; m.y = u[8]; marcarPisable(g('GetMapIndex'), u[7], u[8]);
      const hx = g('GetHeroX'), hy = g('GetHeroY');
      if (hx != null && Math.max(Math.abs(u[7] - hx), Math.abs(u[8] - hy)) <= 12) {
        d4s.n++; d4s.origen += Math.max(Math.abs(u[5] - hx), Math.abs(u[6] - hy)); d4s.destino += Math.max(Math.abs(u[7] - hx), Math.abs(u[8] - hy));
      }
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
        suelo.set(((u[o] & 0x7F) << 8) | u[o + 1], { x: u[o + 2], y: u[o + 3], item, g: u[o + 4] >> 4, i: u[o + 5], lv: u[o + 6], t: Date.now() });
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
      if (g('GetSceneFlag') === 5 && g('GetPlayerLife') > 0 && g('HelperIsSafeZone') !== 1) {
        const px = g('GetHeroX'), py = g('GetHeroY');
        if (px != null && py != null && !(px === 0 && py === 0)) {
          marcarPisable(m, px, py); guardarRT(ahora);
          for (let cx = Math.floor((px - VISTA) / CELDA); cx <= Math.floor((px + VISTA) / CELDA); cx++) {
            for (let cy = Math.floor((py - VISTA) / CELDA); cy <= Math.floor((py + VISTA) / CELDA); cy++) { const k = m + '|' + cx + '|' + cy; (dens[k] || (dens[k] = { o: 0, m: 0, t: {} })).o += dt; }
          }
          vistos.forEach((v) => {
            const p = posAhora(v); if (Math.abs(p.x - px) > VISTA || Math.abs(p.y - py) > VISTA) return;
            const d = dens[m + '|' + Math.floor(p.x / CELDA) + '|' + Math.floor(p.y / CELDA)]; if (!d) return;
            d.m += dt; d.t[v.tipo] = (d.t[v.tipo] || 0) + dt;
          });
          densSucio = true;
          if (densSucio && ahora - densGuardado > 30000) { try { localStorage.setItem(KEY_DENS, JSON.stringify(dens)); } catch (e) { /* lleno */ } densSucio = false; densGuardado = ahora; }
        }
      }
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
  // Experiencia promedio por bicho de cada tipo (de todas las zonas donde mataste): sirve para pesar la densidad por lo que rinde cada bicho
  const expPorTipo = () => { const a = {}; Object.values(datos).forEach((z) => Object.entries(z.te || {}).forEach(([t, e]) => { const q = a[t] || (a[t] = { e: 0, n: 0 }); q.e += e; q.n += (z.tn || {})[t] || 0; })); const r = {}; Object.entries(a).forEach(([t, q]) => { if (q.n >= 3) r[t] = q.e / q.n; }); return r; };
  const spots = (mapa, n = 5, minObs = 40) => {
    const ept = expPorTipo(), out = [];
    Object.entries(dens).forEach(([k, d]) => {
      const p = k.split('|'); if (mapa != null && +p[0] !== +mapa) return; if (d.o < minObs) return;
      const cx = +p[1], cy = +p[2], min = d.o / 60, rp = (d.s || 0) / min; if (rp <= 0 && !d.m) return;
      let pot = 0; Object.entries(d.st || {}).forEach(([t, nn]) => { if (ept[t]) pot += (nn / min) * ept[t]; });
      out.push({ mapa: +p[0], zona: 'x ' + cx * CELDA + '-' + (cx * CELDA + CELDA - 1) + ', y ' + cy * CELDA + '-' + (cy * CELDA + CELDA - 1), centro: { x: cx * CELDA + CELDA / 2, y: cy * CELDA + CELDA / 2 },
        respawnsPorMin: +rp.toFixed(2), respawns: d.s || 0, expPotencialPorMin: Math.round(pot), bichosPromedio: +(d.m / d.o).toFixed(2), observadoSeg: Math.round(d.o),
        tipos: Object.entries(d.st || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, nn]) => 'tipo ' + t + '×' + nn).join(', ') });
    });
    return out.sort((a, b) => (b.respawnsPorMin - a.respawnsPorMin) || (b.bichosPromedio - a.bichosPromedio)).slice(0, n);
  };
  window.__bichos = {
    mejorLugar, cobertura, respawnTiles, spots, densidad: () => dens, respawnsVistos: () => respawnsVistos, mov: movInfo,
    datos: () => datos, validacion: () => ({ ...val, enVista: vistos.size, d4_muestras: d4s.n, d4_dist_prom_par1_origen: d4s.n ? +(d4s.origen / d4s.n).toFixed(2) : null, d4_dist_prom_par2_destino: d4s.n ? +(d4s.destino / d4s.n).toFixed(2) : null }),
    ranking: (mapa) => Object.entries(datos).filter(([k, z]) => z.s >= MIN_SEG && (mapa == null || k.startsWith(mapa + '|'))).map(([k, z]) => fila(k, z)).sort((a, b) => b.expPorMin - a.expPorMin).slice(0, 5),
    texto: () => { const r = window.__bichos.ranking(g('GetMapIndex')); return r.length ? r.map((e, i) => (i + 1) + '. ' + e.zona + ': ' + mmss(e.expPorMin) + ' exp/min, ' + e.muertesPorMin + ' muertes/min, ' + e.joyasPorMin + ' joyas/min (' + e.min + ' min)').join(' | ') : 'Sin zonas con ' + MIN_SEG / 60 + '+ min medidos (válido: ' + JSON.stringify(val) + ')'; },
    racimoTexto: () => { const c = window.__bichos.racimo(); return c && c.total ? 'Racimo (r' + c.r + '): aquí ' + c.aqui + ' · mejor ' + c.mejor.n + ' en (' + c.mejor.x + ',' + c.mejor.y + ') a ' + c.dist + ' casillas' : ''; },
    zonaActual: () => { const z = datos[celda()]; return M() && z && z.s >= 60 ? 'Zona: ' + mmss((z.e || 0) / (z.s / 60)) + ' exp/min · ' + (z.k / (z.s / 60)).toFixed(0) + ' muertes/min · ' + (joyasDe(z) / (z.s / 60)).toFixed(1) + ' joyas/min · cerca ' + cercaAhora : ''; },
    // Solo CALCULA (no mueve): dónde conviene pararse para tener más bichos a menos de 'r' casillas,
    // buscando entre las posiciones de los bichos que hay a 'buscar' casillas o menos de vos.
    vista: () => Array.from(vistos, ([id, v]) => ({ id, ...v, ...posAhora(v) })),
    suelo: () => Array.from(suelo, ([id, v]) => ({ id, ...v })),
    ahora: () => { const hx = g('GetHeroX'), hy = g('GetHeroY'); return { heroe: [hx, hy], mapa: g('GetMapIndex'), validacion: window.__bichos.validacion(), cercanos: window.__bichos.vista().map((v) => ({ id: v.id, tipo: v.tipo, x: v.x, y: v.y, d: Math.max(Math.abs(v.x - hx), Math.abs(v.y - hy)), hace_s: Math.round((Date.now() - (v.tp || v.t || 0)) / 1000) })).sort((a, b) => a.d - b.d).slice(0, 8) }; },
    expTotal: () => expAcum,
    racimo: (r = 3, buscar = 14) => {
      const hx = g('GetHeroX'), hy = g('GetHeroY'); if (hx == null) return null;
      const lista = window.__bichos.vista().filter((v) => Math.max(Math.abs(v.x - hx), Math.abs(v.y - hy)) <= buscar);
      const cuenta = (cx, cy) => { let n = 0; for (const v of lista) if (Math.max(Math.abs(v.x - cx), Math.abs(v.y - cy)) <= r) n++; return n; };
      const aqui = cuenta(hx, hy); let mejor = { x: hx, y: hy, n: aqui };
      for (const v of lista) { const n = cuenta(v.x, v.y); if (n > mejor.n || (n === mejor.n && Math.hypot(v.x - hx, v.y - hy) < Math.hypot(mejor.x - hx, mejor.y - hy))) mejor = { x: v.x, y: v.y, n }; }
      return { aqui, mejor, dist: Math.max(Math.abs(mejor.x - hx), Math.abs(mejor.y - hy)), r, total: lista.length };
    },
    _proc: proc,
  };
})();
