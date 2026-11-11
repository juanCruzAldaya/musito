// Golpes: registra (solo lectura) el aviso del servidor por cada golpe que das (C1 0x11 ObjectHit: bicho, daño de vida, tipo de daño) y por cada muerte (C1 0x17).
// Con eso mide por tipo de bicho y mapa: cuántos golpes hacen falta para matarlo, daño por golpe (medio y máximo), % de críticos / excelentes / ignora defensa,
// y una estimación de la vida del bicho (daño total hasta que muere, incluye el sobrante del último golpe). Comparando el daño medio entre tipos
// se nota cuál tiene más defensa (daño = (ataque - defensa) x multiplicador). No envía nada.
(() => {
  'use strict';
  // Recarga en caliente: los intervalos se registran para poder cortarlos al reinyectar el módulo sin recargar la página (ver background.js)
  const setInterval = (f, ms) => { const id = window.setInterval(f, ms); (window.__muIds = window.__muIds || []).push(id); return id; };
  const KEY = 'muGolpesV1', NOMBRE_KIND = ['normal', 'ignora defensa', 'excelente', 'crítico', 'reflejado', 'veneno', 'otro', 'otro'];
  let vivo = true;
  (window.__muLimpiar = window.__muLimpiar || []).push(() => { vivo = false; try { localStorage.setItem(KEY, JSON.stringify(datos)); } catch (e) { /* nada */ } });
  let datos = {}; try { datos = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { datos = {}; }
  // Por combinación de stats (STR/AGI/ENE) en el momento del golpe: sirve para comparar tandas de puntos sin mezclarlas
  let porStats = {}; try { porStats = JSON.parse(localStorage.getItem(KEY + 'S') || '{}'); } catch (e) { porStats = {}; }
  const stat = (n) => { try { return M()['_MuWeb' + n]() | 0; } catch (e) { return 0; } };
  // Firma del árbol master: suma de los niveles de todos los nodos. Cada punto master que gastás cambia la firma y abre un grupo nuevo en por_stats,
  // así la caja muestra el daño real por golpe ANTES y DESPUÉS de cada punto (los tooltips del juego no dicen en qué unidades están los números).
  let mfT = 0, mfV = 0;
  const masterFirma = () => {
    const ahora = Date.now(); if (ahora - mfT < 5000) return mfV; mfT = ahora;
    try { const n = M()._MuWebGetMasterTreeSkillCount() | 0; let s = 0; for (let i = 0; i < Math.min(n, 300); i++) s += M()._MuWebGetMasterTreeSkillLevel(i) | 0; mfV = s; } catch (e) { /* nada */ }
    return mfV;
  };
  const masterNodos = () => { const out = []; try { const n = M()._MuWebGetMasterTreeSkillCount() | 0; for (let i = 0; i < Math.min(n, 300); i++) { const lv = M()._MuWebGetMasterTreeSkillLevel(i) | 0; if (lv > 0) { const p = M()._MuWebGetMasterTreeSkillNameUtf8(i) | 0; out.push({ i, nombre: p ? M().UTF8ToString(p) : '', nivel: lv, maximo: M()._MuWebGetMasterTreeSkillMaxLevel(i) | 0 }); } } } catch (e) { /* nada */ } return out; };
  // Daño por golpe por (puntos master gastados | mapa | tipo de bicho): compara el MISMO bicho antes y después de cada punto (el por_stats mezclaba bichos
  // de mapas distintos). danoNormalMedio = solo golpes normales (kind 0); danoMax = el mayor (el crítico pega el máximo).
  const KEYMT = 'muGolpesV1M'; let porMT = {}; try { porMT = JSON.parse(localStorage.getItem(KEYMT) || '{}'); } catch (e) { porMT = {}; }
  const inst = new Map();            // id del bicho -> { tipo, mapa, h, d, t }
  const recientes = [];              // últimos golpes: [t_ms, mapa, tipo, daño, kind]
  const t0 = Date.now();
  let sucio = false, escuchando = false;
  const M = () => window.Module;
  const mapa = () => { try { return M()._MuWebGetMapIndex(); } catch (e) { return -1; } };
  const fila = (mp, tp) => { const k = mp + '|' + tp; return datos[k] || (datos[k] = { mapa: mp, tipo: tp, golpes: 0, dano: 0, max: 0, min: 1e9, kinds: {}, kills: 0, golpesAlMatar: 0, danoAlMatar: 0, minAlMatar: 1e9, maxAlMatar: 0 }); };

  function golpe(u) {
    // Dos formatos: corto (largo 10: id BE, daño 16 bits) y EXTENDIDO (largo 16: tipo en byte 3, id LE en 4-5, vida restante en 1/250 en el byte 6, daño 32 bits en 8-11)
    let id, dano, kind, hpEst = null;
    if (u.length === 16) { id = (u[4] | (u[5] << 8)) & 0x7FFF; kind = u[3] & 0x0F; dano = (u[8] | (u[9] << 8) | (u[10] << 16) | (u[11] * 16777216)) >>> 0; hpEst = u[6]; }
    else { id = ((u[3] & 0x7F) << 8) | u[4]; dano = (u[5] << 8) | u[6]; kind = u[7] & 0x0F; }
    const B = window.__bichos; if (!B || !B.vista) return;
    let m = inst.get(id);
    if (!m) {
      const v = B.vista().find((x) => x.id === id);
      if (!v) return;                                   // no es un bicho que conozcamos (probablemente un golpe que recibiste vos)
      m = { tipo: v.tipo, mapa: mapa(), h: 0, d: 0, t: Date.now() }; inst.set(id, m);
    }
    { const mk = masterFirma() + '|' + m.mapa + '|' + m.tipo, t = porMT[mk] || (porMT[mk] = { n: 0, nn: 0, sn: 0, max: 0 }); if (dano > 0) { t.n++; if (kind === 0) { t.nn++; t.sn += dano; } if (dano > t.max) t.max = dano; } }
    const ps = stat('GetPlayerStrength') + '/' + stat('GetPlayerDexterity') + '/' + stat('GetPlayerEnergy') + '/M' + masterFirma(), q = porStats[ps] || (porStats[ps] = { n: 0, dano: 0, max: 0, crit: 0, ceros: 0, kills: 0, desde: Date.now() });
    q.n++; q.dano += dano; q.max = Math.max(q.max, dano); if (kind === 3) q.crit++; if (dano === 0) q.ceros++; q.hasta = Date.now();
    m.ps = ps;
    const f = fila(m.mapa, m.tipo);
    f.golpes++; f.dano += dano; f.max = Math.max(f.max, dano); if (dano > 0) f.min = Math.min(f.min, dano); f.kinds[kind] = (f.kinds[kind] || 0) + 1;
    m.h++; m.d += dano; sucio = true;
    // vida máxima estimada: con la vida restante (en 1/250) y el daño acumulado: max = daño acumulado / (1 - restante/250)
    if (hpEst != null && hpEst > 0 && hpEst < 250 && m.d > 0) { const mx = m.d / (1 - hpEst / 250); (f.hp || (f.hp = [])).push(Math.round(mx)); if (f.hp.length > 80) f.hp.shift(); }
    recientes.push([Date.now() - t0, m.mapa, m.tipo, dano, kind]); if (recientes.length > 400) recientes.shift();
  }
  function muerte(u) {
    const id = ((u[3] & 0x7F) << 8) | u[4], m = inst.get(id); if (!m) return;
    inst.delete(id); if (m.ps && porStats[m.ps]) porStats[m.ps].kills++; const f = fila(m.mapa, m.tipo);
    f.kills++; f.golpesAlMatar += m.h; f.danoAlMatar += m.d; f.minAlMatar = Math.min(f.minAlMatar, m.d); f.maxAlMatar = Math.max(f.maxAlMatar, m.d); sucio = true;
  }
  function onRx(u) {
    if (!vivo || !u || u[0] !== 0xC1) return;
    if (u[2] === 0x11 && (u.length === 10 || u.length === 16)) golpe(u);
    else if (u[2] === 0x17 && u.length >= 5) muerte(u);
  }
  setInterval(() => {
    try {
      const P = window.__paquetes;
      if (!escuchando && P && P.alRecibir) { escuchando = true; P.alRecibir(onRx); }
      const ahora = Date.now(); inst.forEach((m, id) => { if (ahora - m.t > 60000) inst.delete(id); });   // bichos que se perdieron de vista
      if (sucio) { localStorage.setItem(KEY, JSON.stringify(datos)); localStorage.setItem(KEY + 'S', JSON.stringify(porStats)); localStorage.setItem(KEYMT, JSON.stringify(porMT)); sucio = false; }
    } catch (e) { /* nada */ }
  }, 2000);

  const filas = (mp) => Object.values(datos).filter((f) => mp == null || f.mapa === mp).map((f) => ({
    mapa: f.mapa, tipo: f.tipo, golpes: f.golpes, kills: f.kills,
    danoMedio: f.golpes ? Math.round(f.dano / f.golpes) : 0, danoMax: f.max, danoMin: f.min === 1e9 ? 0 : f.min,
    golpesPorBicho: f.kills ? +(f.golpesAlMatar / f.kills).toFixed(2) : null,
    vidaEstimada: f.kills ? Math.round(f.danoAlMatar / f.kills) : null,
    vidaMaxEstimada: f.hp && f.hp.length >= 3 ? f.hp.slice().sort((a, b) => a - b)[Math.floor(f.hp.length / 2)] : null,
    pctCritico: f.golpes ? Math.round(100 * (f.kinds[3] || 0) / f.golpes) : 0, pctExcelente: f.golpes ? Math.round(100 * (f.kinds[2] || 0) / f.golpes) : 0, pctIgnoraDef: f.golpes ? Math.round(100 * (f.kinds[1] || 0) / f.golpes) : 0,
  })).sort((a, b) => b.golpes - a.golpes);
  window.__golpes = {
    filas, recientes: () => recientes.slice(),
    porStats: () => Object.entries(porStats).map(([k, q]) => ({ str_agi_ene: k, golpes: q.n, danoMedio: q.n ? Math.round(q.dano / q.n) : 0, danoMax: q.max, pctCritico: q.n ? Math.round(100 * q.crit / q.n) : 0, golpesConDano0: q.ceros, kills: q.kills, golpesPorBicho: q.kills ? +(q.n / q.kills).toFixed(2) : null, desde: new Date(q.desde).toLocaleTimeString('es-AR', { hour12: false }) })).sort((a, b) => a.desde < b.desde ? -1 : 1),
    datos: () => ({ hora: new Date().toISOString(), por_master_tipo: Object.entries(porMT).filter(([k, t]) => t.n >= 20).map(([k, t]) => { const q = k.split('|'); return { puntos_master: +q[0], mapa: +q[1], tipo: +q[2], golpes: t.n, danoNormalMedio: t.nn ? Math.round(t.sn / t.nn) : 0, danoMax: t.max }; }).sort((a, b) => a.mapa - b.mapa || a.tipo - b.tipo || a.puntos_master - b.puntos_master), master: { nivel_master: stat('GetMasterLevel'), puntos_libres: stat('GetMasterSkillPoints'), puntos_gastados: masterFirma(), nodos_con_puntos: masterNodos() }, por_stats: window.__golpes.porStats(), por_tipo: filas(), ultimos_golpes: recientes.slice(-120), formato_ultimos: ['t_ms', 'mapa', 'tipo', 'daño', 'kind'], kinds: NOMBRE_KIND }),
    reiniciar: () => { Object.keys(porStats).forEach((k) => delete porStats[k]); Object.keys(datos).forEach((k) => delete datos[k]); inst.clear(); recientes.length = 0; sucio = true; },
    resumen: () => { const f = filas(mapa()).slice(0, 4); return f.length ? 'Golpes (mapa ' + mapa() + '): ' + f.map((x) => 'tipo ' + x.tipo + ': ' + x.golpes + ' golpes, medio ' + x.danoMedio + ' (máx ' + x.danoMax + '), ' + (x.golpesPorBicho != null ? x.golpesPorBicho + ' por bicho, vida ~' + x.vidaEstimada : 'sin muertes') + ', crit ' + x.pctCritico + '%').join(' | ') : 'Golpes: sin datos todavía'; },
  };
})();
