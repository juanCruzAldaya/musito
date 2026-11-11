// Piloto propio, MODO SPAM (apagado de fábrica; se prende/apaga con un botón del Laboratorio). Reemplaza al Helper del juego mientras está ON.
// Solo usa funciones del cliente: eventos pointer sobre la pantalla (clic derecho mantenido = lanzar el hechizo seleccionado),
// la tecla Espacio (recoger), el movimiento Lite (mover.js) y las posiciones de bichos/items que lee bichos.js. No envía paquetes propios.
//
//   BUCLE DE ATAQUE (cada 90 ms): el clic derecho NO se suelta nunca. Recorre los bichos al alcance pasando el puntero de uno a otro con
//   un pequeño temblor; cuando sale un hechizo se queda un instante y aprende hacia dónde corregir el apuntado.
//   BUCLE DE MOVIMIENTO (cada 180 ms, aparte): con bichos al alcance se queda quieto; sin bichos va a juntar o se acerca. Sin soltar el ataque.
(() => {
  'use strict';
  const ATQ = 7, VISTA = 16, LOOT_MAX = 10, HP_MIN = 0.35, HP_CORTE = 0.30, MP_MIN = 0.2, SD_MIN = 0.25;
  const JOYAS = new Set(['14:13', '14:14', '12:15', '14:16', '14:22', '14:31', '14:41', '14:42', '14:43', '14:44']);
  const ESPACIO = { key: ' ', code: 'Space', keyCode: 32 };
  const M = () => window.Module;
  const call = (n, ...a) => { try { const f = M()['_MuWeb' + n]; return typeof f === 'function' ? f(...a) : null; } catch (e) { return null; } };
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const enviar = (clave, texto, grave) => window.postMessage({ __muvigia: true, clave, texto, grave: !!grave }, '*');
  let on = false, helperEstaba = false, t0 = 0, c0 = null, motivo = '', estadoA = 'inactivo', estadoM = 'inactivo', info = '', ultPocion = 0;
  let sn = { vista: 0, alcance: 0, dmin: null, enpant: null, mons: [] }, home = null, sinBichosDesde = 0, ultLogA = '', ultLogM = '';
  const bitacora = [];
  const logear = (canal, txt) => { const prev = canal === 'A' ? ultLogA : ultLogM; if (txt === prev) return; if (canal === 'A') ultLogA = txt; else ultLogM = txt; bitacora.push({ t: Date.now(), c: canal, txt }); if (bitacora.length > 1500) bitacora.shift(); };
  let apretado = false, ultQ = { x: 0, y: 0 }, idx = 0, ultCast = 0, pegado = 0, ultJit = [0, 0], aciertos = 0, ciclos = 0;
  const ignorar = new Map(), intentos = new Map();

  const P = () => window.__paquetes, S = () => window.__pantalla, B = () => window.__bichos, Mv = () => window.__mover;
  const cont = () => (P() && B() ? { exp: B().expTotal(), cast: P().cuenta('tx', 'C3:0x19'), muer: P().cuenta('rx', 'C1:0x17'), junt: P().cuenta('tx', 'C3:0x22'), t: Date.now() } : null);

  async function tocarEspacio() {
    const d = window.muDispatchKey;
    if (typeof d === 'function') { d('keydown', ESPACIO); await dormir(40); d('keyup', ESPACIO); return; }
    const c = document.getElementById('canvas'); if (!c) return;
    const ev = (t) => c.dispatchEvent(new KeyboardEvent(t, { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true, cancelable: true }));
    ev('keydown'); await dormir(40); ev('keyup');
  }
  function pocion() {   // botones de poción del propio juego; con enfriamiento
    if (Date.now() - ultPocion < 1200) return;
    const vida = call('GetPlayerLife') / call('GetPlayerLifeMax'), sd = call('GetPlayerShield') / (call('GetPlayerShieldMax') || 1), mana = call('GetPlayerMana') / call('GetPlayerManaMax');
    const id = vida < HP_MIN ? 'mu-mobile-health-btn' : mana < MP_MIN ? 'mu-mobile-mana-btn' : sd < SD_MIN ? 'mu-mobile-sd-btn' : null;
    const b = id && document.getElementById(id); if (b) { b.click(); ultPocion = Date.now(); }
  }
  // ¿se puede actuar ahora? (devuelve null si sí, o el motivo de la espera)
  function espera() {
    if (call('GetSceneFlag') !== 5 || !(call('GetPlayerLife') > 0)) return 'esperando (muerto o fuera del juego)';
    if (call('HelperIsSafeZone') === 1) return 'parado: zona segura';
    if (call('GetBlockingUiOpen') === 1) return 'parado: hay una ventana abierta';
    return null;
  }
  const cheb = (o, hx, hy) => Math.max(Math.abs(o.x - hx), Math.abs(o.y - hy));
  // bichos al alcance QUE SE VEN en pantalla, del más cercano al más lejano
  function candidatos(hx, hy) {
    const out = [];
    for (const v of B().vista()) { const d = cheb(v, hx, hy); if (d > ATQ) continue; const q = S().pixelAtaque(v); if (S().enPantalla(q)) out.push({ v, q, d }); }
    return out.sort((a, b) => a.d - b.d).slice(0, 7);
  }
  function elegir(hx, hy) {
    let bicho = null, db = 99;
    for (const v of B().vista()) { const d = cheb(v, hx, hy); if (d < db) { db = d; bicho = v; } }
    const ahora = Date.now(); let item = null, pi = 9, di = 99;
    for (const it of B().suelo()) {
      if ((ignorar.get(it.id) || 0) > ahora) continue;
      const d = cheb(it, hx, hy); if (d > LOOT_MAX) continue;
      const p = JOYAS.has(it.item) ? 0 : 1;
      if (p < pi || (p === pi && d < di)) { pi = p; di = d; item = it; }
    }
    return { bicho, db, item, di };
  }
  const soltar = () => { if (apretado) { S().derecho.soltar(ultQ.x, ultQ.y); apretado = false; } };

  // ---------------- BUCLE DE ATAQUE ----------------
  async function bucleAtaque() {
    while (on) {
      try {
        const w = espera(); if (w) { estadoA = w; soltar(); await dormir(400); continue; }
        if (call('HelperIsActive') === 1) { detener('el Helper del juego se prendió'); break; }
        const hp = call('GetPlayerLife') / call('GetPlayerLifeMax');
        if (hp < HP_MIN || call('GetPlayerMana') / call('GetPlayerManaMax') < MP_MIN || call('GetPlayerShield') / (call('GetPlayerShieldMax') || 1) < SD_MIN) pocion();
        if (hp < HP_CORTE) { call('HelperSetRunning', 1); detener('vida baja (' + Math.round(hp * 100) + '%): vuelvo al Helper del juego'); break; }
        const hx = call('GetHeroX'), hy = call('GetHeroY'), cand = candidatos(hx, hy), castN = P().cuenta('tx', 'C3:0x19');
        ciclos++;
        { const todos = B().vista(); let dm = 99, nb = null; for (const v of todos) { const d = cheb(v, hx, hy); if (d < dm) { dm = d; nb = v; } }
          const q = nb ? S().pixelAtaque(nb) : null;
          sn = { vista: todos.length, alcance: cand.length, dmin: nb ? dm : null, enpant: nb ? !!S().enPantalla(q) : null,
            mons: ciclos % 10 === 0 ? todos.map((v) => ({ v, d: cheb(v, hx, hy) })).sort((x, y) => x.d - y.d).slice(0, 5).map((o) => { const qq = S().pixelAtaque(o.v); return [o.v.x - hx, o.v.y - hy, o.d, qq ? Math.round(qq.x) : null, qq ? Math.round(qq.y) : null, qq ? !!S().enPantalla(qq) : null]; }) : sn.mons }; }
        info = 'bichos en vista ' + B().vista().length + ' · al alcance ' + cand.length + ' · aciertos ' + aciertos;
        if (cand.length) {
          if (!apretado) { ultQ = cand[0].q; S().derecho.iniciar(ultQ.x, ultQ.y); apretado = true; await dormir(120); }
          if (castN > ultCast) { aciertos++; S().ajustarSesgo(ultJit[0] * 0.25, ultJit[1] * 0.25); pegado = 2; }   // salió un hechizo: el último temblor funcionó
          ultCast = castN;
          if (pegado > 0) { pegado--; S().derecho.mover(ultQ.x, ultQ.y); }                                    // dejar terminar el lanzamiento
          else {
            idx = (idx + 1) % cand.length; const c = cand[idx];
            ultJit = [(Math.random() - 0.5) * 44, (Math.random() - 0.5) * 34];
            ultQ = { x: c.q.x + ultJit[0], y: c.q.y + ultJit[1] };
            S().derecho.mover(ultQ.x, ultQ.y);
          }
          estadoA = 'SPAM sobre ' + cand.length + ' bichos';
        } else {
          ultCast = castN; estadoA = 'sin bichos al alcance (clic derecho apretado)';
        }
        logear('A', estadoA);
        await dormir(90);
      } catch (err) { estadoA = 'error: ' + String(err && err.message || err).slice(0, 60); await dormir(300); }
    }
    soltar();
  }

  // ---------------- BUCLE DE MOVIMIENTO ----------------
  // zona con más muertes registradas en este mapa (de bichos.js), para patrullar cuando no hay ningún bicho a la vista
  function mejorZona(hx, hy) {
    try {
      const mapa = call('GetMapIndex'); let mejor = null, mk = 0;
      for (const [k, z] of Object.entries(B().datos())) {
        const p = k.split('|'); if (+p[0] !== mapa || z.s < 30) continue;
        const cx = +p[1] * 10 + 5, cy = +p[2] * 10 + 5; if (Math.max(Math.abs(cx - hx), Math.abs(cy - hy)) > 60) continue;
        const tasa = z.k / z.s; if (tasa > mk) { mk = tasa; mejor = { x: cx, y: cy }; }
      }
      return mejor;
    } catch (e) { return null; }
  }
  async function bucleMovimiento() {
    while (on) {
      try {
        const w = espera();
        if (w) { estadoM = 'quieto: ' + w; Mv() && Mv().parar(); logear('M', estadoM); await dormir(300); continue; }
        if (!Mv() || !Mv().tabla()) { estadoM = 'quieto: falta calibrar el movimiento'; logear('M', estadoM); await dormir(500); continue; }
        const hx = call('GetHeroX'), hy = call('GetHeroY'), e = elegir(hx, hy);
        if (call('HasNearbyManualPickup')) await tocarEspacio();
        if (e.bicho && e.db <= ATQ) { Mv().parar(); sinBichosDesde = 0; estadoM = 'quieto: hay bicho al alcance (a ' + e.db + ')'; }
        else if (e.item && !call('HasNearbyManualPickup')) {
          sinBichosDesde = 0;
          const n = (intentos.get(e.item.id) || 0) + 1; intentos.set(e.item.id, n);
          if (n > 40) { ignorar.set(e.item.id, Date.now() + 60000); intentos.delete(e.item.id); Mv().parar(); estadoM = 'item ignorado (no llego)'; }
          else { const r = Mv().paso(e.item.x, e.item.y, 1); estadoM = 'yendo a item ' + e.item.item + ' (a ' + e.di + ', ' + r + ')'; }
        } else if (e.item) { Mv().parar(); estadoM = 'quieto: juntando item'; }
        else if (e.bicho && e.db <= VISTA) { sinBichosDesde = 0; const r = Mv().paso(e.bicho.x, e.bicho.y, ATQ - 2); estadoM = 'acercándome a bicho (a ' + e.db + ', ' + r + ')'; }
        else {
          if (!sinBichosDesde) sinBichosDesde = Date.now();
          if (Date.now() - sinBichosDesde > 1500) {      // nada a la vista hace 1,5 s: patrullar
            const z = mejorZona(hx, hy) || home;
            if (z) { const r = Mv().paso(z.x, z.y, 3); estadoM = 'patrullando hacia (' + z.x + ',' + z.y + ') (' + r + ')'; if (r === 'llegó') sinBichosDesde = Date.now() + 4000; }
            else { Mv().parar(); estadoM = 'quieto: sin bichos y sin zona conocida'; }
          } else { Mv().parar(); estadoM = 'quieto: sin bichos a la vista (esperando 1,5 s)'; }
        }
        logear('M', estadoM);
        await dormir(180);
      } catch (err) { estadoM = 'error: ' + String(err && err.message || err).slice(0, 60); logear('M', estadoM); await dormir(300); }
    }
    Mv() && Mv().parar();
  }

  function arrancar() {
    if (on) return { ok: false, motivo: 'ya está prendido' };
    if (!M() || call('GetSceneFlag') !== 5) return { ok: false, motivo: 'no estás en el juego' };
    if (!B() || !Mv() || !Mv().tabla()) return { ok: false, motivo: 'falta calibrar el movimiento (Mover: calibrar)' };
    if (!S() || !S().cal()) return { ok: false, motivo: 'falta calibrar la pantalla (Pantalla: calibrar, en un pueblo)' };
    if (call('GetPlayerLife') / call('GetPlayerLifeMax') < 0.7) return { ok: false, motivo: 'vida por debajo de 70 %, recuperate antes' };
    helperEstaba = call('HelperIsActive') === 1;
    window.__pausaVigia = true;
    if (helperEstaba) call('HelperSetRunning', 0);
    on = true; t0 = Date.now(); c0 = cont(); motivo = ''; aciertos = 0; ciclos = 0; pegado = 0; ultCast = P() ? P().cuenta('tx', 'C3:0x19') : 0;
    home = { x: call('GetHeroX'), y: call('GetHeroY') }; sinBichosDesde = 0; bitacora.push({ t: Date.now(), c: '*', txt: 'PILOTO ON en (' + home.x + ',' + home.y + ') mapa ' + call('GetMapIndex') });
    setTimeout(() => { if (on) { bucleAtaque(); bucleMovimiento(); } }, helperEstaba ? 1500 : 0);
    return { ok: true };
  }
  function detener(porque = 'manual') {
    if (!on) return;
    on = false; motivo = porque; bitacora.push({ t: Date.now(), c: '*', txt: 'PILOTO OFF: ' + porque }); soltar(); Mv() && Mv().parar();
    if (helperEstaba && call('HelperIsActive') !== 1) call('HelperSetRunning', 1);   // devolver el Helper como estaba
    window.__pausaVigia = false;
    enviar('piloto_fin', 'Piloto detenido: ' + porque, porque !== 'manual');
  }
  function tasas(a, b) {
    const dt = (b.t - a.t) / 1000; if (dt < 5) return null;
    return { seg: Math.round(dt), expMin: Math.round((b.exp - a.exp) / dt * 60), cast: +((b.cast - a.cast) / dt).toFixed(2), muer: +((b.muer - a.muer) / dt).toFixed(2), juntMin: Math.round((b.junt - a.junt) / dt * 60) };
  }
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
  const texto = (r, nombre) => r ? nombre + ' ' + r.seg + 's: ' + fmt(r.expMin) + ' exp/min · hechizos/s ' + r.cast + ' · muertes/s ' + r.muer + ' · juntar/min ' + r.juntMin : nombre + ': muy poco tiempo';

  // Mide 'minutos' con el Helper del juego o con el piloto propio y devuelve las tasas (para comparar de forma pareja).
  async function medir(modo, minutos, avisar) {
    if (modo === 'helper') { if (call('HelperIsActive') !== 1) return 'Prendé el Helper primero'; }
    else { const r = arrancar(); if (!r.ok) return 'No arrancó: ' + r.motivo; }
    const a = cont();
    for (let i = 0; i < minutos * 2; i++) {
      await dormir(30000);
      if (modo === 'piloto' && !on) break;
      if (avisar) avisar(texto(tasas(a, cont()), modo + ' parcial'));
    }
    const r = tasas(a, cont());
    if (modo === 'piloto') detener('medición terminada');
    return texto(r, modo.toUpperCase());
  }

  window.__piloto = {
    arrancar, detener, medir, activo: () => on, bitacora: () => bitacora,
    marcar: (txt) => bitacora.push({ t: Date.now(), c: 'MARCA', txt: txt || 'marca del usuario' }),
    snap: () => ({ on, apretado, estadoA, estadoM, sn, ptr: [Math.round(ultQ.x), Math.round(ultQ.y)], aciertos }),
    resumen: () => (on ? 'Piloto SPAM ON · A: ' + estadoA + ' · M: ' + estadoM + ' · ' + info + ' · ' + texto(tasas(c0, cont()) || null, '').trim() : (motivo ? 'Piloto OFF (' + motivo + ')' : '')),
  };
})();
