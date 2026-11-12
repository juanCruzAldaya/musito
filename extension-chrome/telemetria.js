// Telemetría de ataques (solo lectura de los avisos del servidor; no manda nada).
// Para CADA hechizo enviado (C3 0x19: hechizo + blanco) anota la hora exacta, el tiempo desde el hechizo anterior y el pulso que estaba usando el motor;
// para cada golpe recibido (C1 0x11: blanco, daño, tipo) lo empareja con el hechizo pendiente más viejo a ese mismo blanco (FIFO, hasta 1,2 s después).
// Con eso se mide si el servidor RESPONDE a cada hechizo según lo pegados que salen, qué tan seguido acepta hechizos (mínimo entre aceptados) y cuánto
// tardan los bichos duros en morir (primer golpe -> muerte, golpes, daño, hechizos gastados), por tipo de bicho.
// Un hechizo "sin respuesta" a un blanco que seguía vivo y que recibía golpes de otros hechizos = el servidor lo ignoró; si el blanco NUNCA recibió un golpe
// era un blanco inválido (el motor del juego apuntó mal). Jugando en party los golpes de los compañeros se pueden confundir: se separa "solo" de "party".
// Prueba de ritmos: alterna el pulso (ej. 100 / 62 / 100 / 62 ms) 60 s cada uno en el mismo lugar y compara cuántos hechizos tienen respuesta.
(() => {
  'use strict';
  // Recarga en caliente: los intervalos se registran para poder cortarlos al reinyectar el módulo sin recargar la página (ver background.js)
  const setInterval = (f, ms) => { const id = window.setInterval(f, ms); (window.__muIds = window.__muIds || []).push(id); return id; };
  const M = () => window.Module;
  const call = (n, ...a) => { try { const f = M()['_MuWeb' + n]; return typeof f === 'function' ? f(...a) : null; } catch (e) { return null; } };
  const str = (n, ...a) => { try { const f = M()['_MuWeb' + n]; const p = f(...a) | 0; return p ? M().UTF8ToString(p) : ''; } catch (e) { return ''; } };
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const ahora = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const t0 = ahora();
  const MAXC = 4000, MAXM = 1500;
  let vivo = true; (window.__muLimpiar = window.__muLimpiar || []).push(() => { vivo = false; });
  const casts = [], muertes = [], pruebas = [], kills = [];     // kills: cada bicho muerto con su fase de prueba, tipo, ms hasta morir, golpes, daño y hechizos
  const pend = new Map();       // blanco -> hechizos sin respuesta todavía (FIFO)
  const golpeado = new Set();   // blancos que recibieron al menos un golpe
  const vida = new Map();       // blanco -> { t1, n, dmg, tipo } desde el primer golpe
  const ttk = {};               // tipo -> { n, ms:[], golpes:[], dmg:[], casts:[] }
  const entreGolpes = [];       // separación entre golpes consecutivos al MISMO blanco (medida directa de cada cuánto responde el servidor, sin emparejar)
  const ultGolpe = new Map();   // blanco -> hora del último golpe
  const entreTodos = [];        // lo mismo pero con TODOS los golpes al blanco (incluye los de compañeros de party)
  const ultPropio = new Map();  // blanco -> hora del último golpe emparejado con un hechizo MÍO
  const propios = [], ajenos = [];   // daño de los golpes emparejados con un hechizo MÍO / de los demás (compañeros u otros jugadores): sirve para medir TU daño por golpe aunque haya party
  const deltas = [];            // diferencias golpe - hechizo de todos los pares plausibles: mis golpes se repiten a la misma distancia (la latencia), los de los compañeros caen al azar
  const TOL = 40;               // en party solo cuentan como míos los golpes que caen a latencia típica +- 40 ms
  let latEst = 100, nDelta = 0, golpesAjenos = 0;
  function moda(a) {
    const h = {}; a.forEach((x) => { const k = Math.floor(x / 10); h[k] = (h[k] || 0) + 1; });
    let mk = 0, mv = -1; Object.keys(h).forEach((k) => { const v = (h[k] || 0) + (h[+k - 1] || 0) * 0.5 + (h[+k + 1] || 0) * 0.5; if (v > mv) { mv = v; mk = +k; } });
    const cerca = a.filter((x) => Math.abs(x - (mk * 10 + 5)) <= 15).sort((x, y) => x - y); return cerca.length ? cerca[Math.floor(cerca.length / 2)] : mk * 10 + 5;
  }
  let escuchando = false, enParty = false, faseActual = null, golpesTotal = 0;
  const pulsoAhora = () => { try { return window.__modo && window.__modo.huecoPulso ? window.__modo.huecoPulso() : null; } catch (e) { return null; } };

  function onTx(u) {
    if (!vivo || !u || u.length < 7 || u[0] !== 0xC3 || u[2] !== 0x19) return;
    const t = ahora(), tid = ((u[5] & 0x7F) << 8) | u[6], prev = casts.length ? casts[casts.length - 1] : null;
    let p = null; try { p = window.__modo && window.__modo.huecoPulso ? window.__modo.huecoPulso() : null; } catch (e) { /* nada */ }
    const c = { t, dt: prev ? t - prev.t : null, tid, ok: false, lat: null, f: faseActual, p, party: enParty, mu: null };
    try { const B = window.__bichos, m = B && B.mov ? B.mov(tid) : null; if (m) { c.mv = m.moviendose ? 1 : 0; c.dist = m.dist; c.q = m.quieto_ms; } } catch (e) { /* nada */ }      // ¿el blanco estaba en movimiento y a cuántas casillas?
    casts.push(c); if (casts.length > MAXC) casts.shift();
    let l = pend.get(tid); if (!l) { l = []; pend.set(tid, l); } l.push(c); if (l.length > 40) l.shift();
  }
  function tipoDe(id) { try { const B = window.__bichos; const v = B && B.vista ? B.vista().find((x) => x.id === id) : null; return v ? v.tipo : null; } catch (e) { return null; } }
  function onRx(u) {
    if (!vivo || !u || u[0] !== 0xC1) return;
    const t = ahora();
    if (u[2] === 0x11 && (u.length === 10 || u.length === 16)) {
      let id, dmg;
      if (u.length === 16) { id = (u[4] | (u[5] << 8)) & 0x7FFF; dmg = (u[8] | (u[9] << 8) | (u[10] << 16) | (u[11] * 16777216)) >>> 0; }
      else { id = ((u[3] & 0x7F) << 8) | u[4]; dmg = (u[5] << 8) | u[6]; }
      golpesTotal++; golpeado.add(id);
      const ph = ultGolpe.get(id); if (ph != null && t - ph < 1000) { entreTodos.push({ s: t - ph, f: faseActual, p: pulsoAhora() }); if (entreTodos.length > 6000) entreTodos.shift(); } ultGolpe.set(id, t);
      const l = pend.get(id); let propio = false;
      if (l) {
        while (l.length && t - l[0].t > 1500) l.shift();
        for (const c of l) { const dl = t - c.t; if (dl >= 0 && dl <= 450) deltas.push(dl); }
        if (deltas.length > 900) deltas.splice(0, deltas.length - 900);
        if (++nDelta % 25 === 0 && deltas.length >= 60) latEst = moda(deltas);
        // el golpe corresponde al hechizo pendiente cuya antigüedad más se parece a la latencia típica (con FIFO puro, un hechizo descartado corría todo un lugar)
        let mejor = -1, mejorE = 1e9; for (let i = 0; i < l.length; i++) { const dl = t - l[i].t, e = Math.abs(dl - latEst); if (dl >= 0 && e < mejorE) { mejorE = e; mejor = i; } }
        if (mejor >= 0 && (!enParty || mejorE <= TOL)) { const c = l.splice(mejor, 1)[0]; c.ok = true; c.lat = t - c.t; propio = true; }
      }
      if (propio) { const pp = ultPropio.get(id); if (pp != null && t - pp < 1000) { entreGolpes.push({ s: t - pp, f: faseActual, p: pulsoAhora() }); if (entreGolpes.length > 6000) entreGolpes.shift(); } ultPropio.set(id, t); } else golpesAjenos++;
      { const kind = u.length === 16 ? u[3] : u[7]; (propio ? propios : ajenos).push({ t, d: dmg, k: kind, tipo: tipoDe(id) }); if (propios.length > 4000) propios.shift(); if (ajenos.length > 4000) ajenos.shift(); }
      let v = vida.get(id); if (!v) { v = { t1: t, n: 0, dmg: 0, tipo: tipoDe(id) }; vida.set(id, v); } v.n++; v.dmg += dmg;
    } else if (u[2] === 0x17 && u.length >= 5) {
      const id = ((u[3] & 0x7F) << 8) | u[4];
      muertes.push(t); if (muertes.length > MAXM) muertes.shift();
      const l = pend.get(id); if (l) { l.forEach((c) => { c.mu = t; }); pend.delete(id); }
      const v = vida.get(id);
      if (v && v.n > 0 && v.tipo != null) {
        let nc = 0; for (let i = casts.length - 1; i >= 0 && casts[i].t >= v.t1 - 1000; i--) if (casts[i].tid === id) nc++;
        const q = ttk[v.tipo] || (ttk[v.tipo] = { n: 0, ms: [], golpes: [], dmg: [], casts: [] });
        kills.push({ f: faseActual, tipo: v.tipo, ms: t - v.t1, n: v.n, dmg: v.dmg, nc }); if (kills.length > 3000) kills.shift();
        q.n++; q.ms.push(Math.round(t - v.t1)); q.golpes.push(v.n); q.dmg.push(v.dmg); q.casts.push(nc);
        if (q.ms.length > 300) { q.ms.shift(); q.golpes.shift(); q.dmg.shift(); q.casts.shift(); }
      }
      vida.delete(id); golpeado.delete(id);
    }
  }
  setInterval(() => {
    try {
      const Pq = window.__paquetes; if (!escuchando && Pq && Pq.alRecibir && Pq.alEnviar) { escuchando = true; Pq.alEnviar(onTx); Pq.alRecibir(onRx); }
      enParty = str('GetPartyMembersUtf8').length > 0;
      const t = ahora(); vida.forEach((v, k) => { if (t - v.t1 > 90000) vida.delete(k); });
      pend.forEach((l, k) => { while (l.length && t - l[0].t > 3000) l.shift(); if (!l.length) pend.delete(k); });
    } catch (e) { /* nada */ }
  }, 1000);

  // ---------- análisis ----------
  const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const pct = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  function estadEntre(a) {
    const v = a.map((x) => x.s), h = {}; v.forEach((x) => { const k = x < 150 ? Math.floor(x / 10) * 10 : x < 400 ? Math.floor(x / 50) * 50 : 400; h[k] = (h[k] || 0) + 1; });
    return { n: v.length, min: v.length ? Math.round(Math.min(...v)) : null, p1: r1(pct(v, 0.01)), p5: r1(pct(v, 0.05)), p25: r1(pct(v, 0.25)), mediana: r1(med(v)), histograma_10ms: h };
  }
  const BORDES = [0, 30, 50, 62, 75, 90, 98, 110, 130, 160, 250, 400, 1e9];
  const etiqueta = (i) => (BORDES[i + 1] >= 1e9 ? '>=' + BORDES[i] : BORDES[i] + '-' + BORDES[i + 1]) + ' ms';
  // lista: hechizos con respuesta posible (más viejos de 1,5 s); válidos = el blanco NO murió justo después sin respuesta
  function analizar(lista, opc = {}) {
    const lim = ahora() - 1500, L = lista.filter((c) => c.t < lim && c.dt != null);
    const val = L.filter((c) => !(c.mu != null && c.mu - c.t < 700 && !c.ok));          // un hechizo contra un bicho que ya estaba muriendo no cuenta
    const nuncaGolpeado = val.filter((c) => !c.ok && !golpeado.has(c.tid)).length;
    const bins = BORDES.slice(0, -1).map(() => ({ n: 0, ok: 0, lat: [] }));
    val.forEach((c) => { let i = 0; while (i < bins.length - 1 && c.dt >= BORDES[i + 1]) i++; const b = bins[i]; b.n++; if (c.ok) { b.ok++; b.lat.push(c.lat); } });
    const por_espaciado = bins.map((b, i) => ({ espaciado: etiqueta(i), hechizos: b.n, con_respuesta_pct: b.n ? Math.round(100 * b.ok / b.n) : null, latencia_med_ms: b.lat.length ? Math.round(med(b.lat)) : null })).filter((x) => x.hechizos >= 5);
    const ac = val.filter((c) => c.ok), entre = []; for (let i = 1; i < ac.length; i++) entre.push(ac[i].t - ac[i - 1].t);
    const hist = {}; entre.forEach((x) => { const k = x < 150 ? Math.floor(x / 10) * 10 : x < 400 ? Math.floor(x / 50) * 50 : 400; hist[k] = (hist[k] || 0) + 1; });
    // rachas de hechizos sin respuesta sobre blancos válidos y que sí recibieron golpes en otros momentos
    let racha = 0, maxR = 0, nR8 = 0; const ej = [];
    val.forEach((c) => { if (!c.ok && golpeado.has(c.tid)) racha++; else { if (racha >= 8) { nR8++; if (ej.length < 8) ej.push({ t_s: Math.round((c.t - t0) / 1000), hechizos_seguidos: racha }); } maxR = Math.max(maxR, racha); racha = 0; } });
    if (racha >= 8) { nR8++; maxR = Math.max(maxR, racha); }
    const dur = val.length > 1 ? (val[val.length - 1].t - val[0].t) / 1000 : 0;
    return { hechizos: val.length, segundos: Math.round(dur), enviados_por_seg: dur ? r1(val.length / dur) : null, con_respuesta_pct: val.length ? Math.round(100 * ac.length / val.length) : null, latencia_med_ms: ac.length ? Math.round(med(ac.map((c) => c.lat))) : null, latencia_p90_ms: ac.length ? Math.round(pct(ac.map((c) => c.lat), 0.9)) : null,
      sin_respuesta_a_blanco_nunca_golpeado: nuncaGolpeado, por_espaciado,
      entre_aceptados_ms: { n: entre.length, min: entre.length ? Math.round(Math.min(...entre)) : null, p1: r1(pct(entre, 0.01)), p5: r1(pct(entre, 0.05)), p25: r1(pct(entre, 0.25)), mediana: r1(med(entre)), histograma_10ms: hist },
      rachas_sin_respuesta: { maxima: maxR, cantidad_de_8_o_mas: nR8, ejemplos: ej },
      entre_golpes_mismo_blanco_ms: estadEntre(opc.fase ? entreGolpes.filter((x) => x.f === opc.fase) : entreGolpes),
      entre_golpes_todos_ms: estadEntre(opc.fase ? entreTodos.filter((x) => x.f === opc.fase) : entreTodos) };
  }
  function porTipo() {
    return Object.entries(ttk).filter(([k, q]) => q.n >= 3).map(([k, q]) => ({ tipo: +k, muertes: q.n, ttk_med_ms: Math.round(med(q.ms)), ttk_p90_ms: Math.round(pct(q.ms, 0.9)), golpes_med: med(q.golpes), dano_total_med: Math.round(med(q.dmg)), hechizos_med: med(q.casts), golpes_por_hechizo: r1(q.golpes.reduce((a, b) => a + b, 0) / Math.max(1, q.casts.reduce((a, b) => a + b, 0))) })).sort((a, b) => b.muertes - a.muertes);
  }
  function ventanas() {
    const out = {}, lim = ahora() - 1500;
    casts.forEach((c) => { if (c.t >= lim) return; const k = Math.floor((c.t - t0) / 10000); const w = out[k] || (out[k] = { casts: 0, ok: 0, muertes: 0 }); w.casts++; if (c.ok) w.ok++; });
    muertes.forEach((t) => { const k = Math.floor((t - t0) / 10000); if (out[k]) out[k].muertes++; });
    return Object.entries(out).map(([k, w]) => ({ t_s: k * 10, hechizos_por_seg: r1(w.casts / 10), con_respuesta_pct: w.casts ? Math.round(100 * w.ok / w.casts) : null, muertes: w.muertes })).slice(-60);
  }
  function porPulso(lista) {
    const g = {}; lista.filter((c) => c.t < ahora() - 1500 && c.dt != null && c.p != null).forEach((c) => { (g[c.p] || (g[c.p] = [])).push(c); });
    return Object.entries(g).filter(([k, v]) => v.length >= 30).map(([k, v]) => { const a = analizar(v); const eg = estadEntre(entreGolpes.filter((x) => x.p === +k)); return { pulso_ms: +k, hechizos: a.hechizos, enviados_por_seg: a.enviados_por_seg, con_respuesta_pct: a.con_respuesta_pct, entre_golpes_n: eg.n, entre_golpes_min_ms: eg.min, entre_golpes_p5_ms: eg.p5, entre_golpes_mediana_ms: eg.mediana }; });
  }
  const mediaDe = (v) => (v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null);
  function resumenDano(a) {
    const con = a.filter((x) => x.d > 0); if (!con.length) return { n: 0 };
    const v = con.map((x) => x.d), norm = con.filter((x) => x.k === 0).map((x) => x.d), crit = con.filter((x) => x.k === 3).map((x) => x.d), tipos = {};
    con.forEach((x) => { if (x.tipo != null) (tipos[x.tipo] || (tipos[x.tipo] = [])).push(x); });
    const porTipo = {}; Object.keys(tipos).filter((k) => tipos[k].length >= 20).forEach((k) => { porTipo[k] = { n: tipos[k].length, medio: mediaDe(tipos[k].map((x) => x.d)), medio_normales: mediaDe(tipos[k].filter((x) => x.k === 0).map((x) => x.d)) }; });
    return { n: con.length, medio: mediaDe(v), mediana: med(v), p90: pct(v, 0.9), max: Math.max(...v), pct_critico: Math.round(100 * crit.length / con.length), medio_normales: mediaDe(norm), medio_criticos: mediaDe(crit), por_tipo: porTipo };
  }
  function danoPorMin(a) {     // evolución minuto a minuto del daño propio (para ver el efecto de equiparse algo en medio de la sesión)
    const g = {}; a.filter((x) => x.d > 0).forEach((x) => { const m = Math.floor((x.t - t0) / 60000); (g[m] || (g[m] = [])).push(x); });
    return Object.keys(g).map(Number).sort((x, y) => x - y).slice(-40).map((m) => ({ min: m, n: g[m].length, medio: mediaDe(g[m].map((x) => x.d)), medio_normales: mediaDe(g[m].filter((x) => x.k === 0).map((x) => x.d)) }));
  }
  // ¿el blanco estaba en movimiento cuando salió el hechizo? (bichos.js mov: pasos D4 recientes). Compara el % con respuesta de quieto contra en movimiento, en total y por distancia al personaje.
  function porMovimiento(lista) {
    const lim = ahora() - 1500, L = lista.filter((c) => c.t < lim && c.mv != null && c.dist != null && !(c.mu != null && c.mu - c.t < 700 && !c.ok));
    const g = (a) => ({ hechizos: a.length, con_respuesta_pct: a.length ? Math.round(100 * a.filter((c) => c.ok).length / a.length) : null });
    const tr = [[0, 1], [2, 3], [4, 5], [6, 7], [8, 99]];
    return { hechizos_medidos: L.length, pct_a_blancos_en_movimiento: L.length ? Math.round(100 * L.filter((c) => c.mv === 1).length / L.length) : null, quieto: g(L.filter((c) => c.mv === 0)), moviendose: g(L.filter((c) => c.mv === 1)),
      por_distancia: tr.map(([a, b]) => ({ casillas: a + '-' + (b === 99 ? '+' : b), quieto: g(L.filter((c) => c.mv === 0 && c.dist >= a && c.dist <= b)), moviendose: g(L.filter((c) => c.mv === 1 && c.dist >= a && c.dist <= b)) })) };
  }
  // v0.71.1: % con respuesta según cuánto hace que el blanco está QUIETO (caja 18: en movimiento 10 %, quieto 42 %): sirve para saber cuánto hay que esperar a que un bicho frene para que el golpe entre
  function porQuietoMs(lista) {
    const lim = ahora() - 1500, L = lista.filter((c) => c.t < lim && c.mv != null && !(c.mu != null && c.mu - c.t < 700 && !c.ok));
    const g = (a) => ({ hechizos: a.length, con_respuesta_pct: a.length ? Math.round(100 * a.filter((c) => c.ok).length / a.length) : null });
    const tr = [['quieto 0-150 ms', 0, 150], ['quieto 150-300 ms', 150, 300], ['quieto 300-600 ms', 300, 600], ['quieto 600-1200 ms', 600, 1200], ['quieto 1,2 s o más', 1200, 1e9]];
    return [{ estado: 'en movimiento', ...g(L.filter((c) => c.mv === 1)) }].concat(tr.map(([n, a, b]) => ({ estado: n, ...g(L.filter((c) => c.mv === 0 && (c.q || 0) >= a && (c.q || 0) < b)) })));
  }
  const datos = () => {
    const solos = casts.filter((c) => !c.party);
    return { segundos_de_sesion: Math.round((ahora() - t0) / 1000), hechizos_en_memoria: casts.length, golpes_recibidos_total: golpesTotal, golpes_de_otros_aprox: golpesAjenos, latencia_tipica_ms: Math.round(latEst), en_party_ahora: enParty,
      todos: analizar(casts), solo: analizar(solos), por_pulso_solo: porPulso(solos), por_tipo_de_bicho: porTipo(), ventanas_10s: ventanas(), pruebas_de_ritmo: pruebas.slice(-6), dano_propio: resumenDano(propios), dano_de_otros: resumenDano(ajenos), dano_propio_por_min: danoPorMin(propios), por_movimiento: porMovimiento(casts), por_movimiento_solo: porMovimiento(solos), por_quieto_ms: porQuietoMs(casts), quietos: window.__modo && window.__modo.quietosStats ? window.__modo.quietosStats() : null, saltar: window.__modo && window.__modo.saltarStats ? window.__modo.saltarStats() : null, estrategico: window.__modo && window.__modo.estrategicoStats ? window.__modo.estrategicoStats() : null,
      ultimos_hechizos: { columnas: ['t_s', 'dt_ms', 'blanco', 'respuesta', 'latencia_ms', 'pulso_ms', 'party', 'se_movia', 'quieto_ms', 'dist'], filas: casts.slice(-400).map((c) => [r1((c.t - t0) / 1000), c.dt == null ? null : Math.round(c.dt), c.tid, c.ok ? 1 : 0, c.lat == null ? null : Math.round(c.lat), c.p, c.party ? 1 : 0, c.mv == null ? null : c.mv, c.q == null ? null : Math.round(c.q), c.dist == null ? null : c.dist]) } };
  };
  function resumen() {
    const a = analizar(casts.filter((c) => !c.party)), t = analizar(casts);
    if (!t.hechizos) return 'Telemetría: todavía sin hechizos con respuesta medible (hace falta atacar unos segundos).';
    const x = a.hechizos >= 30 ? a : t, etq = a.hechizos >= 30 ? 'solo' : 'con party (poco fiable)';
    const e = x.entre_aceptados_ms, esp = x.por_espaciado.filter((b) => b.con_respuesta_pct != null).map((b) => b.espaciado.replace(' ms', '') + ': ' + b.con_respuesta_pct + '%').join(' · ');
    return 'Telemetría (' + etq + ', latencia típica ' + Math.round(latEst) + ' ms): ' + x.hechizos + ' hechizos, ' + x.enviados_por_seg + '/s · con respuesta ' + x.con_respuesta_pct + ' % · latencia ' + x.latencia_med_ms + ' ms · entre golpes al mismo blanco: mín ' + x.entre_golpes_mismo_blanco_ms.min + ' ms, 5 % bajo ' + x.entre_golpes_mismo_blanco_ms.p5 + ' ms · rachas sin respuesta: máx ' + x.rachas_sin_respuesta.maxima + ' · por espaciado → ' + esp;
  }

  // ---------- prueba de ritmos ----------
  let probando = false;
  async function probar(fases = [100, 62, 100, 62], seg = 60, avisar = () => {}) {
    const Mo = window.__modo;
    if (probando) return { ok: false, motivo: 'ya hay una prueba andando' };
    if (!Mo || !Mo.setPrueba) return { ok: false, motivo: 'modo.js no tiene la prueba de ritmos (recargá la extensión)' };
    if (Mo.deseado() !== 'sostener') return { ok: false, motivo: 'prendé Sostenida y esperá a que ataque (F8)' };
    const qAntes = Mo.quietosOn ? Mo.quietosOn() : null, sAntes = Mo.saltarOn ? Mo.saltarOn() : null;
    probando = true; const out = { hora: new Date().toISOString(), seg_por_fase: seg, mapa: call('GetMapIndex'), x: call('GetHeroX'), y: call('GetHeroY'), party: enParty, party_texto: String(str('GetPartyMembersUtf8') || '').slice(0, 80), fases: [], corte: null };
    try {
      for (let i = 0; i < fases.length; i++) {
        const f0 = fases[i], esS = typeof f0 === 'string' && /^s[01]$/.test(f0), esQ = (typeof f0 === 'string' && /^q[01]$/.test(f0)) || esS, ms = esQ ? null : f0, etq = esS ? 'saltar blanco trabado ' + (f0 === 's1' ? 'ON' : 'OFF') : esQ ? 'esperar quieto ' + (f0 === 'q1' ? 'ON' : 'OFF') : 'pulso ' + ms + ' ms', id = 'F' + (pruebas.length + 1) + '.' + (i + 1); faseActual = id;
        if (esS) { if (Mo.setSaltar) Mo.setSaltar(f0 === 's1', true); Mo.setPrueba(null); } else if (esQ) { if (Mo.setQuietos) Mo.setQuietos(f0 === 'q1', true); Mo.setPrueba(null); } else Mo.setPrueba(ms);
        const ss0 = Mo.saltarStats ? Mo.saltarStats() : null, qs0 = Mo.quietosStats ? Mo.quietosStats() : null; avisar('Prueba ' + (i + 1) + '/' + fases.length + ': ' + etq + ' durante ' + seg + ' s…');
        let vidaMinFase = 100;
        const cuentaExp = () => { try { return window.__paquetes.cuenta('rx', 'C3:0x16'); } catch (e) { return null; } };
        const ini = Date.now(), m0 = muertes.length, e0 = cuentaExp(); let corte = null;
        while (Date.now() - ini < seg * 1000) {
          await dormir(500);
          const vp = (call('GetPlayerLife') || 0) / (call('GetPlayerLifeMax') || 1); if (vp * 100 < vidaMinFase) vidaMinFase = Math.round(vp * 100);
          if (call('GetSceneFlag') !== 5) corte = 'salí de la escena de juego'; else if (!(vp > 0)) corte = 'morí'; else if (vp < 0.35) corte = 'vida baja'; else if (call('GetBlockingUiOpen') === 1) corte = 'ventana abierta'; else if (Mo.deseado() !== 'sostener') corte = 'cambió el modo'; else if (call('GetMapIndex') !== out.mapa) corte = 'cambió el mapa';
          if (corte) break;
        }
        const e1 = cuentaExp(), segReal = Math.max(1, (Date.now() - ini) / 1000), expPorSeg = e0 != null && e1 != null ? Math.round(100 * (e1 - e0) / segReal) / 100 : null;
        const a = analizar(casts.filter((c) => c.f === id), { fase: id }), eg = a.entre_golpes_mismo_blanco_ms;
        const kd = kills.filter((k) => k.f === id && k.n >= 5);                    // "duros": 5 golpes o más para morir
        const duros = { n: kd.length, ttk_med_ms: kd.length ? Math.round(med(kd.map((k) => k.ms))) : null, golpes_med: kd.length ? med(kd.map((k) => k.n)) : null, hechizos_med: kd.length ? med(kd.map((k) => k.nc)) : null, dps_med: kd.length ? Math.round(med(kd.map((k) => k.dmg / Math.max(0.05, k.ms / 1000)))) : null, gps_med: kd.length ? Math.round(10 * med(kd.map((k) => k.n / Math.max(0.05, k.ms / 1000)))) / 10 : null };
        const ss1 = Mo.saltarStats ? Mo.saltarStats() : null, qs1 = Mo.quietosStats ? Mo.quietosStats() : null, pm = porMovimiento(casts.filter((c) => c.f === id));
        out.fases.push({ duros, exp_avisos_por_seg: expPorSeg, vida_min_pct: vidaMinFase, pulso_ms: esQ ? etq : ms, saltar: esS && ss0 && ss1 ? { disparos: ss1.disparos - ss0.disparos, cambiaron: ss1.cambiaron - ss0.cambiaron, sin_alternativa: ss1.sin_alternativa - ss0.sin_alternativa, hechizos_en_trabados: ss1.hechizos_en_trabados - ss0.hechizos_en_trabados } : null, quietos: !esS && esQ && qs0 && qs1 ? { esperas: qs1.esperas - qs0.esperas, ms_esperando: qs1.ms_esperando - qs0.ms_esperando, cortadas: qs1.cortadas_por_tope - qs0.cortadas_por_tope } : null, pct_a_blancos_en_movimiento: pm.pct_a_blancos_en_movimiento, hechizos: a.hechizos, enviados_por_seg: a.enviados_por_seg, con_respuesta_pct: a.con_respuesta_pct, latencia_med_ms: a.latencia_med_ms, entre_golpes_min_ms: eg.min, entre_golpes_p5_ms: eg.p5, entre_golpes_mediana_ms: eg.mediana, racha_max: a.rachas_sin_respuesta.maxima, sin_respuesta_blanco_nunca_golpeado: a.sin_respuesta_a_blanco_nunca_golpeado, muertes: muertes.length - m0 });
        if (corte) { out.corte = corte + ' (fase ' + (i + 1) + ')'; break; }
        await dormir(2500);       // deja drenar las respuestas pendientes antes de la fase siguiente
      }
    } finally { faseActual = null; try { Mo.setPrueba(null); if (qAntes != null && Mo.setQuietos) Mo.setQuietos(qAntes, true); if (sAntes != null && Mo.setSaltar) Mo.setSaltar(sAntes, true); } catch (e) { /* nada */ } probando = false; }
    pruebas.push(out); return { ok: true, ...out };
  }
  // ---------- prueba de HABILIDADES (v0.80.0): ¿rinde más Fire Scream (78) que Fire Burst (508) como habilidad de la Sostenida? ----------
  // Alterna fases de `seg` segundos con cada habilidad (A B A B) parado atacando en el mismo lugar. Mide lo que importa (muertes y avisos de exp = lo que te da el servidor) y los paquetes de ataque
  // de cada tipo (C3 0x19 = hechizo a un blanco; C3 0x1E = ataque de área) + golpes recibidos (C1 0x11) por segundo, porque Fire Scream es de área y la telemetría vieja (que cuenta solo C3 0x19) no la ve.
  const NOMBRE_HAB = { 508: 'Fire Burst', 78: 'Fire Scream', 238: 'Chaotic Diseier' };
  async function probarHab(ids = [508, 78, 508, 78], seg = 60, avisar = () => {}) {
    const Mo = window.__modo, P = window.__paquetes;
    if (probando) return { ok: false, motivo: 'ya hay una prueba andando' };
    if (!Mo || !Mo.setHabilidad || !P) return { ok: false, motivo: 'modo.js no tiene la prueba de habilidades (recargá la extensión)' };
    if (Mo.deseado() !== 'sostener') return { ok: false, motivo: 'prendé Sostenida y esperá a que ataque (F8)' };
    const antes = Mo.habilidad(); probando = true;
    const out = { hora: new Date().toISOString(), tipo: 'habilidades', seg_por_fase: seg, mapa: call('GetMapIndex'), x: call('GetHeroX'), y: call('GetHeroY'), habilidad_antes: antes, fases: [], corte: null };
    const cu = (d, k) => { try { return P.cuenta(d, k); } catch (e) { return null; } };
    try {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i], nom = NOMBRE_HAB[id] || ('habilidad ' + id);
        const ok = Mo.setHabilidad(id, true);
        avisar('Prueba ' + (i + 1) + '/' + ids.length + ': ' + nom + ' durante ' + seg + ' s' + (ok ? '' : ' (OJO: el juego no la dejó elegir)') + '…');
        await dormir(1500);       // que se acomode el cambio
        let vidaMin = 100, corte = null;
        const t0 = Date.now(), a0 = { t19: cu('tx', 'C3:0x19'), t1e: cu('tx', 'C3:0x1e'), hit: cu('rx', 'C1:0x11'), mue: cu('rx', 'C1:0x17'), exp: cu('rx', 'C3:0x16') };
        while (Date.now() - t0 < seg * 1000) {
          await dormir(500);
          const vp = (call('GetPlayerLife') || 0) / (call('GetPlayerLifeMax') || 1); if (vp * 100 < vidaMin) vidaMin = Math.round(vp * 100);
          if (call('GetSceneFlag') !== 5) corte = 'salí de la escena de juego'; else if (!(vp > 0)) corte = 'morí'; else if (vp < 0.35) corte = 'vida baja'; else if (call('GetBlockingUiOpen') === 1) corte = 'ventana abierta'; else if (Mo.deseado() !== 'sostener') corte = 'cambió el modo'; else if (call('GetMapIndex') !== out.mapa) corte = 'cambió el mapa';
          if (corte) break;
        }
        const s = Math.max(1, (Date.now() - t0) / 1000), a1 = { t19: cu('tx', 'C3:0x19'), t1e: cu('tx', 'C3:0x1e'), hit: cu('rx', 'C1:0x11'), mue: cu('rx', 'C1:0x17'), exp: cu('rx', 'C3:0x16') };
        const por = (k) => (a0[k] != null && a1[k] != null ? Math.round(100 * (a1[k] - a0[k]) / s) / 100 : null);
        out.fases.push({ habilidad: nom, id, segundos: Math.round(s), ataques_19_por_seg: por('t19'), ataques_area_1E_por_seg: por('t1e'), golpes_por_seg: por('hit'), muertes_por_min: por('mue') != null ? Math.round(60 * por('mue') * 10) / 10 : null, exp_avisos_por_seg: por('exp'), vida_min_pct: vidaMin, eligio_ok: ok });
        if (corte) { out.corte = corte + ' (fase ' + (i + 1) + ')'; break; }
        await dormir(2500);
      }
    } finally { try { Mo.setHabilidad(antes, true); } catch (e) { /* nada */ } probando = false; }
    pruebas.push(out); return { ok: true, ...out };
  }
  const textoPruebaHab = (r) => (r.ok ? 'Prueba de habilidades' + (r.corte ? ' (cortada: ' + r.corte + ')' : '') + ': ' + r.fases.map((f) => f.habilidad + ' → ' + f.muertes_por_min + ' muertes/min, ' + f.exp_avisos_por_seg + ' avisos de exp/s, golpes ' + f.golpes_por_seg + '/s, ataques 0x19 ' + f.ataques_19_por_seg + '/s, de área 0x1E ' + f.ataques_area_1E_por_seg + '/s' + (f.eligio_ok ? '' : ' [no la dejó elegir]')).join(' || ') : 'No se pudo: ' + r.motivo);
  const textoPrueba = (r) => (r.ok ? 'Prueba de ritmos' + (r.corte ? ' (cortada: ' + r.corte + ')' : '') + ': ' + r.fases.map((f) => (typeof f.pulso_ms === 'number' ? f.pulso_ms + ' ms' : f.pulso_ms) + ' → ' + f.enviados_por_seg + '/s, ' + (f.pct_a_blancos_en_movimiento != null ? f.pct_a_blancos_en_movimiento + ' % a blancos en movimiento, ' : '')  + f.con_respuesta_pct + ' % con respuesta, ' + (f.saltar ? 'saltó ' + f.saltar.disparos + ' veces (cambió de blanco ' + f.saltar.cambiaron + '), ' : '') + f.muertes + ' muertes, exp ' + f.exp_avisos_por_seg + '/s, vida mín ' + f.vida_min_pct + ' %, duros: ' + (f.duros.n ? 'mueren en ' + f.duros.ttk_med_ms + ' ms (' + f.duros.n + ' bichos, ' + f.duros.gps_med + ' golpes/s, ' + f.duros.dps_med + ' de daño/s)' : 'sin datos')).join(' | ') : 'No hice la prueba: ' + r.motivo);

  window.__telemetria = { latencia: () => latEst, datos, resumen, probar, probarHab, textoPruebaHab, textoPrueba, probando: () => probando, reiniciar: () => { casts.length = 0; entreGolpes.length = 0; entreTodos.length = 0; ultGolpe.clear(); ultPropio.clear(); deltas.length = 0; golpesAjenos = 0; latEst = 100; muertes.length = 0; pend.clear(); golpeado.clear(); vida.clear(); Object.keys(ttk).forEach((k) => delete ttk[k]); pruebas.length = 0; kills.length = 0; propios.length = 0; ajenos.length = 0; } };
})();
