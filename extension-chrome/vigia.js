// Vigía MuMagdalenas — corre dentro de la página (MAIN world).
// Lee el estado con las funciones que el propio cliente expone (Module._MuWeb*), muestra un panel,
// avisa por Discord (vía puente.js/background.js; el webhook NUNCA llega a este archivo) y,
// si el usuario lo prende en el popup, vuelve a prender el Helper nativo cuando se apaga solo.
(() => {
  'use strict';
  const VERSION = '0.95.0';
  const cfg = { vigia: false, avisos: true };

  // ---- utilidades -------------------------------------------------------------------------
  const mod = () => window.Module;
  const num = (n) => {
    try {
      const M = mod(); if (!M) return null;
      const f = M['_MuWeb' + n] || M['_MuWebGet' + n]; // los getters del juego se llaman MuWebGet…
      return typeof f === 'function' ? f() : null;
    } catch (e) { return null; }
  };
  const hora = (t) => new Date(t).toLocaleTimeString('es-AR', { hour12: false });
  const dur = (ms) => { const s = Math.round(ms / 1000); return Math.floor(s / 3600) ? Math.floor(s / 3600) + 'h ' + String(Math.floor(s / 60) % 60).padStart(2, '0') + 'm' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's'; };
  const pct = (a, b) => (b > 0 ? Math.round((a * 100) / b) : 0);
  const log = [];
  function enviar(clave, texto, grave) {
    log.unshift(hora(Date.now()) + ' ' + texto); log.length = Math.min(log.length, 8);
    window.postMessage({ __muvigia: true, clave, texto: String(texto).slice(0, 300), grave: !!grave }, '*');
  }

  // ---- seguimiento de la conexión (solo cuenta aperturas/cierres, no lee paquetes) -------
  const red = { vivos: 0, cierre: 0, avisado: false };
  try {
    const WS = window.WebSocket;
    const P = function (url, prot) {
      const s = prot !== undefined ? new WS(url, prot) : new WS(url);
      red.vivos++;
      s.addEventListener('close', () => { red.vivos = Math.max(0, red.vivos - 1); red.cierre = Date.now(); });
      return s;
    };
    P.prototype = WS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k) => (P[k] = WS[k]));
    window.WebSocket = P;
  } catch (e) { /* nada */ }

  // ---- estado -----------------------------------------------------------------------------
  const E = {
    enJuego: false, salioDesde: 0, muerto: false, vidaBajaDesde: 0,
    muestras: [],            // {t, xp}
    nivelAnt: null, inicioReset: Date.now(), resetsSesion: 0,
    xpUltimoCambio: Date.now(), xpAnt: null,
    helperOffDesde: 0, intentos: [], ultimoIntento: 0, pausaHasta: 0,
    avisadoResetListo: false,
  };

  function resetListoEnPantalla() {
    const b = document.getElementById('mu-mobile-ready-reset-btn');
    return !!b && !b.classList.contains('is-unavailable');
  }

  function prenderHelper() {
    const ahora = Date.now();
    E.intentos = E.intentos.filter((t) => ahora - t < 10 * 60000);
    if (E.intentos.length >= 3) {
      E.pausaHasta = ahora + 10 * 60000; E.intentos = [];
      enviar('helper_falla', 'El Helper se apaga y no logro prenderlo (3 intentos). Revisalo a mano.', true);
      return;
    }
    E.intentos.push(ahora); E.ultimoIntento = ahora;
    let via = 'export';
    try { mod()._MuWebHelperSetRunning(1); } catch (e) { via = 'error'; }
    setTimeout(() => {
      if (num('HelperIsActive') === 1) { enviar('helper_on', 'Helper reactivado (' + via + ').', false); return; }
      const b = document.getElementById('mu-mobile-helper-hud-btn');
      if (b) { b.click(); via = 'boton'; }
      setTimeout(() => enviar(num('HelperIsActive') === 1 ? 'helper_on' : 'helper_falla2',
        num('HelperIsActive') === 1 ? 'Helper reactivado (' + via + ').' : 'Intenté prender el Helper y sigue apagado.', num('HelperIsActive') !== 1), 1500);
    }, 1500);
  }

  // ---- ciclo de 1 segundo -----------------------------------------------------------------
  function tick() {
    const ahora = Date.now();
    const vidaMax = num('PlayerLifeMax');
    const escena = num('SceneFlag');
    const enJuego = !!mod() && escena === 5 && vidaMax > 0;

    // desconexión / salida del juego
    if (E.enJuego && !enJuego) E.salioDesde = ahora;
    if (!E.enJuego && enJuego) { E.salioDesde = 0; red.avisado = false; }
    E.enJuego = enJuego;
    if (!enJuego) {
      if (E.salioDesde && ahora - E.salioDesde > 15000 && !red.avisado) {
        red.avisado = true;
        enviar('desconexion', red.vivos === 0 ? 'Se cortó la conexión con el servidor.' : 'El personaje salió del juego (pantalla ' + escena + ').', true);
      }
      return;
    }

    const vida = num('PlayerLife'), sd = num('PlayerShield'), sdMax = num('PlayerShieldMax');
    const nivel = num('PlayerLevel'), permil = num('ExperiencePermille');
    const mapa = num('MapIndex'), x = num('HeroX'), y = num('HeroY');
    const helper = num('HelperIsActive') === 1, zonaSegura = num('HelperIsSafeZone') === 1;
    const bloqueada = num('BlockingUiOpen') === 1;

    // muerte
    if (vida === 0 && !E.muerto) { E.muerto = true; enviar('muerte', 'Murió en el mapa ' + mapa + ' (' + x + ',' + y + ').', true); }
    if (vida > 0) E.muerto = false;

    // vida baja sostenida
    if (vida > 0 && vidaMax > 0 && vida / vidaMax < 0.3) {
      if (!E.vidaBajaDesde) E.vidaBajaDesde = ahora;
      if (ahora - E.vidaBajaDesde > 10000) { enviar('vida_baja', 'Vida baja hace más de 10 s: ' + pct(vida, vidaMax) + '%.', true); E.vidaBajaDesde = ahora + 110000; }
    } else E.vidaBajaDesde = 0;

    // experiencia, resets y velocidad
    const xp = nivel * 1000 + permil;
    if (E.nivelAnt !== null && nivel < E.nivelAnt - 50) {
      E.resetsSesion++;
      enviar('reset', 'Reset hecho. Tardó ' + dur(ahora - E.inicioReset) + ' (de sesión: ' + E.resetsSesion + ').', false);
      E.inicioReset = ahora; E.muestras = []; E.avisadoResetListo = false;
    }
    E.nivelAnt = nivel;
    E.muestras.push({ t: ahora, xp });
    while (E.muestras.length && ahora - E.muestras[0].t > 10 * 60000) E.muestras.shift();
    if (xp !== E.xpAnt) { E.xpAnt = xp; E.xpUltimoCambio = ahora; }

    // reset listo (botón nativo)
    if (resetListoEnPantalla() && !E.avisadoResetListo) { E.avisadoResetListo = true; enviar('reset_listo', 'Ya podés hacer reset (nivel ' + nivel + ').', false); }

    // trabado: Helper activo, sin ganar experiencia 5 min
    if (helper && !zonaSegura && nivel < 400 && ahora - E.xpUltimoCambio > 5 * 60000) {
      enviar('trabado', 'Hace 5 min que no gana experiencia con el Helper activo (mapa ' + mapa + ' ' + x + ',' + y + ').', true);
      E.xpUltimoCambio = ahora;
    }

    // Vigía del Helper
    if (!helper) { if (!E.helperOffDesde) E.helperOffDesde = ahora; } else E.helperOffDesde = 0;
    if (cfg.vigia && !window.__pausaVigia && !helper && vida > 0 && !zonaSegura && !bloqueada && ahora > E.pausaHasta &&
        ahora - E.helperOffDesde > 8000 && ahora - E.ultimoIntento > 20000) prenderHelper();

    pintar({ vida, vidaMax, sd, sdMax, nivel, permil, mapa, x, y, helper, zonaSegura });
  }

  // ---- panel ------------------------------------------------------------------------------
  let caja = null;
  function asegurarCaja() {
    if (caja && caja.isConnected) return caja;
    caja = document.createElement('div');
    caja.id = 'vigia-panel';
    caja.style.cssText = 'position:fixed;right:8px;bottom:60px;z-index:2147483647;font:11px/1.35 sans-serif;background:#000c;color:#fff;padding:5px 8px;border-radius:6px;min-width:190px;pointer-events:auto';
    caja.title = 'Click para achicar/agrandar';
    caja.onclick = () => { caja.dataset.min = caja.dataset.min === '1' ? '0' : '1'; };
    (document.body || document.documentElement).appendChild(caja);
    return caja;
  }
  function pintar(d) {
    asegurarCaja();
    const v = E.muestras.length > 1 ? E.muestras[E.muestras.length - 1].xp - E.muestras[0].xp : 0;
    const dt = E.muestras.length > 1 ? E.muestras[E.muestras.length - 1].t - E.muestras[0].t : 0;
    const porHora = dt > 60000 ? ((v / 10) * 3600000) / dt : null; // % de nivel por hora
    // Panel corto: lo que cambia y importa. El nivel y el % van en el encabezado del Laboratorio (y acá también si el Lab no cargó).
    const avisoHelper = window.__modo && window.__modo.deseado() === 'helper' && !d.helper && !d.zonaSegura ? ' · <b style="color:#f66">Helper APAGADO</b>' : '';
    const l1 = 'Vida ' + pct(d.vida, d.vidaMax) + '% · SD ' + pct(d.sd, d.sdMax) + '% · Mapa ' + d.mapa + ' (' + d.x + ',' + d.y + ')' + (d.zonaSegura ? ' · zona segura' : '') + avisoHelper + (cfg.vigia ? '' : ' · vigía off');
    if (caja.dataset.min === '1') { caja.innerHTML = l1; return; }
    const sinLab = !document.getElementById('lab-panel') ? 'Nv ' + d.nivel + ' (' + (d.permil / 10).toFixed(1) + '%)' + (porHora !== null ? ' · ' + porHora.toFixed(1) + '% nivel/h' : '') + '<br>' : '';
    const hz = window.__hechizo ? window.__hechizo.resumen() : '';
    caja.innerHTML = sinLab + l1 +
      (window.__bichos && window.__bichos.zonaActual() ? '<br>' + window.__bichos.zonaActual() : '') +
      (window.__bichos && window.__bichos.racimoTexto() ? '<br>' + window.__bichos.racimoTexto() : '') +
      (window.__modo ? '<br>' + window.__modo.resumen() : '') +
      (window.__stats && window.__stats.resumen() ? '<br>' + window.__stats.resumen().replace(/prendido · /, '').replace(/ \(reparte desde \d+\)/, '') : '') +
      (window.__ciclo && window.__ciclo.resumen() ? '<br>' + window.__ciclo.resumen() : '') +
      (window.__agresor && window.__agresor.resumen() ? '<br>' + window.__agresor.resumen() : '') +
      (window.__piloto && window.__piloto.resumen() ? '<br>' + window.__piloto.resumen() : '') +
      (hz && /NO es|MAL/.test(hz) ? '<br>' + hz : '') +
      (window.__joyas ? '<br>' + window.__joyas.resumen().replace(/ \(a:listo\)/, '').replace('inventario', 'inv.') : '') +
      (log.length ? '<br><span style="opacity:.75">' + log[0] + '</span>' : '');
  }

  // ---- config que llega del popup (vía puente.js) ----------------------------------------
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !e.data.__muvigiaCfg) return;
    cfg.vigia = !!e.data.cfg.vigia; cfg.avisos = e.data.cfg.avisos !== false;
    if (window.__joyas) window.__joyas.setAuto(!!e.data.cfg.joyas);
    if (window.__hechizo) window.__hechizo.setActivo(e.data.cfg.hechizo !== false);
  });
  const pedir = () => window.postMessage({ __muvigiaPide: true }, '*');

  window.__vigia = { version: VERSION, cfg, E, log, tick };
  const iniciar = () => {
    pedir(); setTimeout(pedir, 3000);
    asegurarCaja().innerHTML = 'Vigía ' + VERSION + ' · esperando al personaje…';
    setInterval(() => {
      try { tick(); } catch (e) { asegurarCaja().innerHTML = 'Vigía ' + VERSION + ' · error: ' + String(e && e.message || e).slice(0, 120); }
      if (!E.enJuego && caja && !caja.dataset.err) {
        caja.innerHTML = 'Vigía ' + VERSION + ' · esperando al personaje… (escena ' + num('SceneFlag') + ', vida máx ' + num('PlayerLifeMax') + ')';
      }
    }, 1000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
