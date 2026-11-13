// Caja negra: graba cada 200 ms el estado del juego y del piloto (sin enviar nada a ningún lado; queda en memoria hasta que la bajás).
// Guarda las últimas ~13 minutos. 'bajar()' arma un único archivo con todo lo que hace falta para entender qué hizo el piloto.
// No guarda chat, nombres de otros jugadores ni contenido de paquetes.
(() => {
  'use strict';
  // Recarga en caliente: los intervalos se registran para poder cortarlos al reinyectar el módulo sin recargar la página (ver background.js)
  const setInterval = (f, ms) => { const id = window.setInterval(f, ms); (window.__muIds = window.__muIds || []).push(id); return id; };
  const MAX = 12000, PERIODO = 200;   // 12000 muestras = ~40 min (antes 4000 = 13 min: se perdía lo anterior al último cambio de mapa)
  const COLUMNAS = ['t_ms', 'mapa', 'x', 'y', 'vida_pct', 'helper', 'piloto', 'apretado', 'bichos_vista', 'al_alcance', 'dist_mas_cercano', 'se_ve_en_pantalla', 'hechizos_tx', 'pasos_tx', 'muertes_rx', 'avisos_exp_rx', 'sesgo_x', 'sesgo_y', 'puntero_x', 'puntero_y', 'vector_mov', 'estado_ataque', 'estado_mov', 'mana_pct', 'sd_pct', 'pociones_vida', 'pociones_mana', 'pociones_sd', 'pickups_tx', 'joyas_banco', 'joyas_inv', 'ritmo_juntar_ms', 'shift', 'foco', 'visible', 'nivel', 'nivel_master', 'puntos_libres', 'str', 'agi', 'vit', 'ene', 'cmd', 'zen', 'msg_visible', 'msg_codigo', 'msg_tipo', 'msg_texto', 'exp_permil', 'ui_bloq', 'arbol_master', 'texto_activo', 'frame_ms'];
  const filas = [], fotos = [], t0 = Date.now(); let n = 0;
  const M = () => window.Module;
  const call = (k) => { try { const f = M()['_MuWeb' + k]; return typeof f === 'function' ? f() : null; } catch (e) { return null; } };


  // ---- Grabar MI juego manual: clics, movimientos del mouse (cada >=40 ms) y teclas de una lista corta. Solo mientras 'grabando' ----
  const entradas = [], fotosM = []; let grabando = false, tGrab = 0, ultMove = 0, nM = 0;
  const lienzo = () => document.getElementById('canvas');
  const reg = (e, tipo) => {
    if (!grabando) return;
    const c = lienzo(), r = c ? c.getBoundingClientRect() : { left: 0, top: 0 };
    entradas.push([Date.now() - t0, tipo, Math.round(e.clientX - r.left), Math.round(e.clientY - r.top), e.buttons | 0, e.button, e.isTrusted ? 1 : 0]);
    if (entradas.length > 25000) entradas.shift();
  };
  const AC = new AbortController();
  (window.__muLimpiar = window.__muLimpiar || []).push(() => { AC.abort(); });
  window.addEventListener('pointerdown', (e) => reg(e, 'pointerdown'), { capture: true, signal: AC.signal });
  window.addEventListener('pointerup', (e) => reg(e, 'pointerup'), { capture: true, signal: AC.signal });
  window.addEventListener('contextmenu', (e) => reg(e, 'contextmenu'), { capture: true, signal: AC.signal });
  window.addEventListener('pointermove', (e) => { const n = Date.now(); if (!grabando || n - ultMove < 40) return; ultMove = n; reg(e, 'pointermove'); }, { capture: true, signal: AC.signal });
  const TECLAS = /^(Space|Digit\d|Key[QWER]|F\d+|ShiftLeft|ShiftRight)$/;   // nunca letras en general: así no queda nada del chat
  ['keydown', 'keyup'].forEach((tp) => window.addEventListener(tp, (e) => { if (!grabando || !TECLAS.test(e.code)) return; entradas.push([Date.now() - t0, tp, 0, 0, 0, e.code, e.isTrusted ? 1 : 0]); }, { capture: true, signal: AC.signal }));
  function fotoManual() {
    const B = window.__bichos, S = window.__pantalla; if (!B) return;
    const hx = call('GetHeroX'), hy = call('GetHeroY'), out = [];
    for (const v of B.vista()) {
      const d = Math.max(Math.abs(v.x - hx), Math.abs(v.y - hy)); if (d > 10) continue;
      const q = S && S.cal && S.cal() ? S.pixelAtaque(v) : null;
      out.push([v.id, v.x - hx, v.y - hy, d, q ? Math.round(q.x) : null, q ? Math.round(q.y) : null]);
    }
    out.sort((a, b) => a[3] - b[3]); fotosM.push({ t_ms: Date.now() - t0, hx, hy, bichos_id_dx_dy_dist_px_py: out.slice(0, 10) });
    if (fotosM.length > 3000) fotosM.shift();
  }
  function empezarManual() { entradas.length = 0; fotosM.length = 0; grabando = true; tGrab = Date.now() - t0; nM = 0; return { ok: true }; }
  function pararManual() {
    grabando = false; const fin = Date.now() - t0;
    const c = lienzo(), r = c ? c.getBoundingClientRect() : null, S = window.__pantalla, Mv = window.__mover;
    const data = {
      caja_manual: '1', hora: new Date().toISOString(), version_extension: window.__muVersionHot || (window.__vigia && window.__vigia.version) || null, inicio_ms: tGrab, fin_ms: fin, duracion_s: Math.round((fin - tGrab) / 1000),
      canvas: r ? { ancho: Math.round(r.width), alto: Math.round(r.height) } : null,
      columnas_entradas: ['t_ms', 'tipo', 'x_en_canvas', 'y_en_canvas', 'botones', 'boton_o_tecla', 'es_real(1)_o_sintetico(0)'], entradas,
      columnas_muestras: COLUMNAS, muestras: filas.filter((f) => f[0] >= tGrab), fotos_bichos: fotosM,
      calibracion: { pantalla: S && S.cal ? S.cal() : null, sesgo: S && S.sesgo ? S.sesgo() : null, movimiento: Mv && Mv.tabla ? Mv.tabla() : null },
    };
    const txt = JSON.stringify(data), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = 'caja_manual.json'; a.click();
    return { entradas: entradas.length, muestras: data.muestras.length, fotos: fotosM.length, kb: Math.round(txt.length / 1024), seg: data.duracion_s };
  }

  const arg = (k, a) => { try { const f = M()['_MuWeb' + k]; return typeof f === 'function' ? f(a) : null; } catch (e) { return null; } };
  const pct = (a, b) => { const m = call(b); return m ? Math.round(100 * call(a) / m) : null; };
  // Datos para armar el ciclo de reset: nivel, stats, puntos libres, Zen y el cartel del juego (si hay). También anota en la bitácora cuando
  // el nivel cae de golpe (reset) o cambia el mapa, con los stats de antes y de después.
  let prevCiclo = null, prevMapa = null;
  const texto = (k) => { try { const f = M()['_MuWeb' + k], p = f() | 0; return p ? M().UTF8ToString(p) : ''; } catch (e) { return ''; } };
  function leerCiclo(pil) {
    const cz = { nivel: call('GetPlayerLevel'), master: call('GetMasterLevel'), libres: call('GetPlayerLevelUpPoints'), str: call('GetPlayerStrength'), agi: call('GetPlayerDexterity'), vit: call('GetPlayerVitality'),
      ene: call('GetPlayerEnergy'), cmd: call('GetPlayerCommand'), zen: call('GetPlayerZen'), mv: call('MsgVisible'), mc: call('MsgCode'), mt: call('MsgType'), mx: null };
    if (cz.mv === 1) cz.mx = texto('MsgTextUtf8').slice(0, 160);
    const mapa = call('GetMapIndex'), nota = pil && pil.nota ? pil.nota : null;
    if (nota && prevCiclo && prevCiclo.nivel != null && cz.nivel != null && cz.nivel < prevCiclo.nivel - 50) {
      nota('RESET', 'nivel ' + prevCiclo.nivel + ' -> ' + cz.nivel + ' | stats ANTES str ' + prevCiclo.str + ' agi ' + prevCiclo.agi + ' vit ' + prevCiclo.vit + ' ene ' + prevCiclo.ene + ' cmd ' + prevCiclo.cmd + ' libres ' + prevCiclo.libres +
        ' | AHORA str ' + cz.str + ' agi ' + cz.agi + ' vit ' + cz.vit + ' ene ' + cz.ene + ' cmd ' + cz.cmd + ' libres ' + cz.libres + ' | zen ' + cz.zen);
    }
    if (nota && prevMapa != null && mapa !== prevMapa) nota('MAPA', 'mapa ' + prevMapa + ' -> ' + mapa + ' en (' + call('GetHeroX') + ',' + call('GetHeroY') + ') nivel ' + cz.nivel);
    if (nota && prevCiclo && cz.mv === 1 && prevCiclo.mv !== 1) nota('CARTEL', 'cartel del juego: código ' + cz.mc + ' tipo ' + cz.mt + ' texto: ' + cz.mx);
    prevCiclo = cz; prevMapa = mapa;
    return cz;
  }
  function muestrear() {
    if (!M() || call('GetSceneFlag') !== 5) return;
    const P = window.__paquetes, pil = window.__piloto, S = window.__pantalla, Mv = window.__mover;
    const ciclo = leerCiclo(pil);
    const sn = pil && pil.snap ? pil.snap() : null, sg = S && S.sesgo ? S.sesgo() : [null, null];
    const lm = call('GetPlayerLifeMax');
    filas.push([Date.now() - t0, call('GetMapIndex'), call('GetHeroX'), call('GetHeroY'), lm ? Math.round(100 * call('GetPlayerLife') / lm) : null, call('HelperIsActive'),
      sn && sn.on ? 1 : 0, sn && sn.apretado ? 1 : 0, (window.__bichos && window.__bichos.vista ? window.__bichos.vista().length : (sn ? sn.sn.vista : null)), sn && sn.on ? sn.sn.alcance : null, sn ? sn.sn.dmin : null, sn ? (sn.sn.enpant === null ? null : sn.sn.enpant ? 1 : 0) : null,
      P ? P.cuenta('tx', 'C3:0x19') : null, P ? P.cuenta('tx', 'C1:0xd4') : null, P ? P.cuenta('rx', 'C1:0x17') : null, P ? P.cuenta('rx', 'C3:0x16') : null,
      sg[0] === null ? null : Math.round(sg[0]), sg[1] === null ? null : Math.round(sg[1]), sn ? sn.ptr[0] : null, sn ? sn.ptr[1] : null,
      Mv && Mv.ultimoVector ? Mv.ultimoVector().join(',') : null, sn ? sn.estadoA : null, sn ? sn.estadoM : null,
      pct('GetPlayerMana', 'GetPlayerManaMax'), pct('GetPlayerShield', 'GetPlayerShieldMax'), arg('GetHotkeyItemCount', 0), arg('GetHotkeyItemCount', 1), arg('GetHotkeyItemCount', 3), P ? P.cuenta('tx', 'C3:0x22') : null,
      (window.__joyas && window.__joyas.totales() ? window.__joyas.totales().banco : null), (window.__joyas && window.__joyas.totales() ? window.__joyas.totales().inv : null),
      pil && pil.ritmo ? (pil.ritmo() === Infinity ? -1 : pil.ritmo()) : null,
      sn ? (sn.shift ? 1 : 0) : null, document.hasFocus() ? 1 : 0, document.visibilityState === 'visible' ? 1 : 0,
      ciclo.nivel, ciclo.master, ciclo.libres, ciclo.str, ciclo.agi, ciclo.vit, ciclo.ene, ciclo.cmd, ciclo.zen, ciclo.mv, ciclo.mc, ciclo.mt, ciclo.mx, call('GetExperiencePermille'), call('GetBlockingUiOpen'), call('IsMasterSkillTreeOpen'), call('TextInputActive'), call('GetPerformanceFrameMs')]);
    if (filas.length > MAX) filas.shift();
    if (grabando && ++nM % 2 === 0) fotoManual();
    // cada ~2 s: los 5 bichos más cercanos con su píxel, para ver por qué se descartan
    if (++n % 10 === 0 && sn && sn.on && sn.sn.mons && sn.sn.mons.length) { fotos.push({ t_ms: Date.now() - t0, mons_dx_dy_dist_px_py_enpantalla: sn.sn.mons }); if (fotos.length > 400) fotos.shift(); }
  }
  setInterval(() => { try { muestrear(); } catch (e) { /* no frenar */ } }, PERIODO);

  function resumenTiempos() {
    // cuánto tiempo estuvo el piloto en cada estado (por muestra de 200 ms)
    const a = {}, m = {};
    for (const f of filas) { if (!f[6]) continue; a[f[21]] = (a[f[21]] || 0) + PERIODO / 1000; m[f[22]] = (m[f[22]] || 0) + PERIODO / 1000; }
    const r = (o) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => k + ': ' + v.toFixed(1) + ' s');
    return { ataque: r(a), movimiento: r(m) };
  }
  function armar() {
    const B = window.__bichos, P = window.__paquetes, pil = window.__piloto, S = window.__pantalla, Mv = window.__mover;
    const bit = pil && pil.bitacora ? pil.bitacora().map((e) => ({ t_ms: e.t - t0, canal: e.c, txt: e.txt })) : [];
    return {
      caja_negra: '1', version_extension: window.__muVersionHot || (window.__vigia && window.__vigia.version) || null, hora: new Date().toISOString(), duracion_s: Math.round((Date.now() - t0) / 1000),
      columnas: COLUMNAS, muestras_cada_ms: PERIODO, muestras: filas,
      bitacora_decisiones: bit, fotos_de_bichos: fotos, tiempo_por_estado: resumenTiempos(),
      calibracion: { pantalla: S && S.cal ? S.cal() : null, sesgo: S && S.sesgo ? S.sesgo() : null, movimiento: Mv && Mv.tabla ? Mv.tabla() : null },
      etapas_reset: window.__etapas ? window.__etapas.todo() : null,
      golpes: window.__golpes ? window.__golpes.datos() : null,
      telemetria: window.__telemetria ? window.__telemetria.datos() : null,
      ventanas_modo: window.__modo && window.__modo.ventanas ? window.__modo.ventanas() : null,
      pociones_modo: window.__modo && window.__modo.pociones ? window.__modo.pociones() : null,
      pociones_rapidas: window.__modo && window.__modo.potRapidoStats ? window.__modo.potRapidoStats() : null,
      paradas_modo: window.__modo && window.__modo.paradas ? window.__modo.paradas() : null,
      skills_juego: (() => { try { const m = M(), g = (k, ...a) => { const f = m['_MuWeb' + k]; return typeof f === 'function' ? f(...a) : null; }; const n = g('GetSkillListCount') | 0, out = []; for (let i = 0; i < Math.min(n, 30); i++) { const t = g('GetSkillListType', i); out.push({ i, tipo: t, cd_i: g('GetSkillCooldownMs', i), cdtot_i: g('GetSkillCooldownTotalMs', i), cd_t: g('GetSkillCooldownMs', t), cdtot_t: g('GetSkillCooldownTotalMs', t) }); } return out; } catch (e) { return null; } })(),
      exportes_juego: (() => { try { return Object.keys(M()).filter((k) => k.indexOf('_MuWeb') === 0).map((k) => k.slice(6)).sort(); } catch (e) { return null; } })(),
      spots_mapa_actual: window.__bichos && window.__bichos.spots ? window.__bichos.spots(call('GetMapIndex'), 12, 30) : null,
      respawns_vistos: window.__bichos && window.__bichos.respawnsVistos ? window.__bichos.respawnsVistos() : null,
      respawn_casillas_mapa_actual: window.__bichos && window.__bichos.respawnTiles ? window.__bichos.respawnTiles(call('GetMapIndex'), 80) : null,      // las 80 casillas con más respawns [x, y, cuántos]: para calcular a mano el mejor lugar para quedarse quieto
      mejor_lugar_ahora: window.__modo && window.__modo.mejorLugarAhora ? window.__modo.mejorLugarAhora() : null,
      ancla: window.__modo && window.__modo.ancla ? window.__modo.ancla() : null,
      joyas_log: window.__joyas && window.__joyas.bitacora ? window.__joyas.bitacora() : null,
      loot: window.__loot && window.__loot.stats ? window.__loot.stats() : null,
      tiendas_npc: window.__tiendas ? window.__tiendas.lista() : null,
      summon_chat: window.__grupo && window.__grupo.summonChat ? window.__grupo.summonChat.stats() : null,
      buff_critico: window.__grupo && window.__grupo.buff ? window.__grupo.buff.stats() : null,
      buff_vida: window.__grupo && window.__grupo.buffVida ? window.__grupo.buffVida.stats() : null,
      auto_clan: window.__grupo && window.__grupo.autoClan ? window.__grupo.autoClan.stats() : null,
      grupo_clan_crudo: window.__grupo && window.__grupo.crudo ? window.__grupo.crudo() : null,
      modo_final: window.__modo ? window.__modo.texto() : null,
      stats_log: window.__stats ? window.__stats.bitacora() : null,
      asignacion_stats: window.__stats && window.__stats.asignacion ? window.__stats.asignacion() : null,
      grupo_eventos: window.__grupo ? window.__grupo.eventos() : null,
      agresores: window.__agresor ? window.__agresor.datos() : null,
      caminos_grabados: window.__ciclo && window.__ciclo.rutas ? window.__ciclo.rutas() : null,
      mi_spot: window.__ciclo && window.__ciclo.miSpot ? window.__ciclo.miSpot.datos() : null,
      bichos_ahora: B && B.ahora ? B.ahora() : null,
      inventario_leido: window.__paquetes && window.__paquetes.inventario ? window.__paquetes.inventario() : null,
      recursos_pagina: (() => { try { return performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\.(js|json|wasm|data|bin|txt|dat|csv|xml|lang|pck|mjs)(\?|#|$)/i.test(n)).slice(0, 80); } catch (e) { return null; } })(),
      paquetes: P && P.informe ? (() => { const i = P.informe(); return { rareza_sniff: i.rareza_sniff || null, recientes_raros: i.recientes_raros || null, enviados_recientes: i.enviados_recientes || null, segundos: i.segundos, total: i.total, recibidos: i.recibidos.slice(0, 25), enviados: i.enviados.slice(0, 15), muestras: i.muestras, casts_tx: i.castsTx, enviados_por_10s: i.porVentanaDe10sEnviados, recibidos_por_10s: i.porVentanaDe10s }; })() : null,
    };
  }
  function bajar() {
    const txt = JSON.stringify(armar());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = 'caja_negra.json'; a.click();
    return { muestras: filas.length, bitacora: window.__piloto && window.__piloto.bitacora ? window.__piloto.bitacora().length : 0, kb: Math.round(txt.length / 1024) };
  }
  window.__caja = { empezarManual, pararManual, bajar, armar, filas: () => filas.length, marcar: (t) => { if (window.__piloto && window.__piloto.marcar) window.__piloto.marcar(t); } };
})();
