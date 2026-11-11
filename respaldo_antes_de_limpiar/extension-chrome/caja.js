// Caja negra: graba cada 200 ms el estado del juego y del piloto (sin enviar nada a ningún lado; queda en memoria hasta que la bajás).
// Guarda las últimas ~13 minutos. 'bajar()' arma un único archivo con todo lo que hace falta para entender qué hizo el piloto.
// No guarda chat, nombres de otros jugadores ni contenido de paquetes.
(() => {
  'use strict';
  const MAX = 4000, PERIODO = 200;
  const COLUMNAS = ['t_ms', 'mapa', 'x', 'y', 'vida_pct', 'helper', 'piloto', 'apretado', 'bichos_vista', 'al_alcance', 'dist_mas_cercano', 'se_ve_en_pantalla', 'hechizos_tx', 'pasos_tx', 'muertes_rx', 'avisos_exp_rx', 'sesgo_x', 'sesgo_y', 'puntero_x', 'puntero_y', 'vector_mov', 'estado_ataque', 'estado_mov'];
  const filas = [], fotos = [], t0 = Date.now(); let n = 0;
  const M = () => window.Module;
  const call = (k) => { try { const f = M()['_MuWeb' + k]; return typeof f === 'function' ? f() : null; } catch (e) { return null; } };

  function muestrear() {
    if (!M() || call('GetSceneFlag') !== 5) return;
    const P = window.__paquetes, pil = window.__piloto, S = window.__pantalla, Mv = window.__mover;
    const sn = pil && pil.snap ? pil.snap() : null, sg = S && S.sesgo ? S.sesgo() : [null, null];
    const lm = call('GetPlayerLifeMax');
    filas.push([Date.now() - t0, call('GetMapIndex'), call('GetHeroX'), call('GetHeroY'), lm ? Math.round(100 * call('GetPlayerLife') / lm) : null, call('HelperIsActive'),
      sn && sn.on ? 1 : 0, sn && sn.apretado ? 1 : 0, sn ? sn.sn.vista : null, sn ? sn.sn.alcance : null, sn ? sn.sn.dmin : null, sn ? (sn.sn.enpant === null ? null : sn.sn.enpant ? 1 : 0) : null,
      P ? P.cuenta('tx', 'C3:0x19') : null, P ? P.cuenta('tx', 'C1:0xd4') : null, P ? P.cuenta('rx', 'C1:0x17') : null, P ? P.cuenta('rx', 'C3:0x16') : null,
      sg[0] === null ? null : Math.round(sg[0]), sg[1] === null ? null : Math.round(sg[1]), sn ? sn.ptr[0] : null, sn ? sn.ptr[1] : null,
      Mv && Mv.ultimoVector ? Mv.ultimoVector().join(',') : null, sn ? sn.estadoA : null, sn ? sn.estadoM : null]);
    if (filas.length > MAX) filas.shift();
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
      caja_negra: '1', version_extension: (window.__vigia && window.__vigia.version) || null, hora: new Date().toISOString(), duracion_s: Math.round((Date.now() - t0) / 1000),
      columnas: COLUMNAS, muestras_cada_ms: PERIODO, muestras: filas,
      bitacora_decisiones: bit, fotos_de_bichos: fotos, tiempo_por_estado: resumenTiempos(),
      calibracion: { pantalla: S && S.cal ? S.cal() : null, sesgo: S && S.sesgo ? S.sesgo() : null, movimiento: Mv && Mv.tabla ? Mv.tabla() : null },
      bichos_ahora: B && B.ahora ? B.ahora() : null,
      paquetes: P && P.informe ? (() => { const i = P.informe(); return { segundos: i.segundos, total: i.total, recibidos: i.recibidos.slice(0, 25), enviados: i.enviados.slice(0, 15), muestras: i.muestras, enviados_por_10s: i.porVentanaDe10sEnviados, recibidos_por_10s: i.porVentanaDe10s }; })() : null,
    };
  }
  function bajar() {
    const txt = JSON.stringify(armar());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = 'caja_negra.json'; a.click();
    return { muestras: filas.length, bitacora: window.__piloto && window.__piloto.bitacora ? window.__piloto.bitacora().length : 0, kb: Math.round(txt.length / 1024) };
  }
  window.__caja = { bajar, armar, filas: () => filas.length, marcar: (t) => { if (window.__piloto && window.__piloto.marcar) window.__piloto.marcar(t); } };
})();
