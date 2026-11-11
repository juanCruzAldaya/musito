// Piloto propio, MODO SPAM (apagado de fábrica; se prende/apaga con un botón del Laboratorio). Reemplaza al Helper del juego mientras está ON.
// Solo usa funciones del cliente: eventos pointer sobre la pantalla (clic derecho mantenido = lanzar el hechizo seleccionado),
// la tecla Espacio (recoger), el movimiento Lite (mover.js) y las posiciones de bichos/items que lee bichos.js. No envía paquetes propios.
//
//   BUCLE DE ATAQUE (cada 90 ms): el clic derecho NO se suelta nunca. Recorre los bichos al alcance pasando el puntero de uno a otro con
//   un pequeño temblor; cuando sale un hechizo se queda un instante y aprende hacia dónde corregir el apuntado.
//   BUCLE DE MOVIMIENTO (cada 150 ms, aparte): se queda quieto mientras haya bichos alrededor; solo va al núcleo de bichos si donde está hay pocos.
//   No junta ni va a buscar joyas: pasar por encima de ellas ya las levanta. Sin soltar el ataque.
(() => {
  'use strict';
  // Recarga en caliente: los intervalos se registran para poder cortarlos al reinyectar el módulo sin recargar la página (ver background.js)
  const setInterval = (f, ms) => { const id = window.setInterval(f, ms); (window.__muIds = window.__muIds || []).push(id); return id; };
  const CERCA = 2;   // el barrido del puntero cubre ~2 casillas alrededor del personaje: hay que dejar los bichos a esa distancia
  // Medido: el clic derecho mantenido = IR hasta el bicho y atacar (37-44 pasos/s, el piloto derivó 34 casillas); el Helper lanza desde el lugar
  // (3 pasos/s). Para no caminar solo se apunta a bichos cercanos (<= 4 casillas, dentro del alcance real del hechizo).
  const ATQ = 4, VISTA = 16, LOOT_MAX = 10, HP_MIN = 0.60, HP_CORTE = 0.30, MP_MIN = 0.45, SD_MIN = 0.40;
  const JOYAS = new Set(['14:13', '14:14', '12:15', '14:16', '14:22', '14:31', '14:41', '14:42', '14:43', '14:44']);
  const ESPACIO = { key: ' ', code: 'Space', keyCode: 32 };
  const M = () => window.Module;
  const call = (n, ...a) => { try { const f = M()['_MuWeb' + n]; return typeof f === 'function' ? f(...a) : null; } catch (e) { return null; } };
  // Con la pestaña oculta/tapada Chrome frena setTimeout a 1 por segundo; un worker no se frena. Si no se puede crear, se usa setTimeout.
  const dormirNormal = (ms) => new Promise((r) => setTimeout(r, ms));
  let relojWorker = null; const esperas = [];
  function iniciarReloj() {
    if (relojWorker) return;
    try {
      relojWorker = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(1)},20)'], { type: 'text/javascript' })));
      relojWorker.onmessage = () => { const n = Date.now(); for (let i = esperas.length - 1; i >= 0; i--) if (esperas[i].t <= n) esperas.splice(i, 1)[0].r(); };
    } catch (e) { relojWorker = null; }
  }
  function pararReloj() { try { if (relojWorker) relojWorker.terminate(); } catch (e) { /* nada */ } relojWorker = null; while (esperas.length) esperas.pop().r(); }
  const dormir = (ms) => ((relojWorker && typeof document !== 'undefined' && document.hidden) ? new Promise((r) => esperas.push({ t: Date.now() + ms, r })) : dormirNormal(ms));
  const enviar = (clave, texto, grave) => window.postMessage({ __muvigia: true, clave, texto, grave: !!grave }, '*');
  let on = false, helperEstaba = false, t0 = 0, c0 = null, motivo = '', estadoA = 'inactivo', estadoM = 'inactivo', info = '', ultPocion = 0;
  let sn = { vista: 0, alcance: 0, dmin: null, enpant: null, mons: [] }, home = null, sinBichosDesde = 0, ultLogA = '', ultLogM = '';
  const bitacora = [];
  const logear = (canal, txt) => { const prev = canal === 'A' ? ultLogA : ultLogM; if (txt === prev) return; if (canal === 'A') ultLogA = txt; else ultLogM = txt; bitacora.push({ t: Date.now(), c: canal, txt }); if (bitacora.length > 1500) bitacora.shift(); };
  let apretado = false, ultQ = { x: 0, y: 0 }, idx = 0, ultCast = 0, pegado = 0, ultJit = [0, 0], aciertos = 0, ciclos = 0;
  const ignorar = new Map(), intentos = new Map();
  // MODO MANO (medido en la grabación del juego manual del usuario): clic derecho apretado casi todo el tiempo y el puntero barriendo
  // suavemente alrededor del personaje (mediana a ~180 px del centro, saltos de ~11 px cada ~40 ms). El juego elige solo el bicho.
  const MODO_MANO = true;
  let ultLlegada = 0, shiftApretado = false, ultSinFoco = false;
  let punteroX = null, punteroY = null, ultD4n = 0, ultD4t = 0, ultRepress = 0, repress = 0, candDesde = 0, cambioBlancoT = 0, repSeguidos = 0;   // puntero suave y re-apretado si el juego suelta el ataque
  let cedido = false, sinFocoDesde = 0, conFocoDesde = 0;   // 'cedido' = el Helper del juego tiene el control mientras el navegador no tiene el foco
  const cfg = { shift: false, persistir: true, moverse: false, barrido: 1, fijar: false };   // moverse: false = no camina a 'núcleos' ni patrulla (como el Helper); barrido: 1 = normal, 0.5 = el puntero oscila la mitad   // persistir: quedarse en el MISMO bicho hasta que muera (para bichos duros)
  let focoId = null, matados = 0, sumaCasts = 0, castsBlanco = 0; const ign2 = new Map();   // Shift mantenido: en MU, Shift + clic ataca SIN moverse (a probar)
  const SHIFT = { key: 'Shift', code: 'ShiftLeft', keyCode: 16 };
  function shiftSet(v) { if (v === shiftApretado) return; const d = window.muDispatchKey; if (typeof d !== 'function') return; d(v ? 'keydown' : 'keyup', SHIFT); shiftApretado = v; }
  let ventanaDesde = 0, avisoVentana = false, focoIdx = 0, focoDesde = 0, ultCastFoco = 0, ultEspacio = 0;
  const ign = new Map();   // bichos que descarté un rato (ningún punto sobre ellos sacó hechizo)
  let objetivo = null, offIdx = 0, ultCastT = 0, cambios = 0, fallos = 0;
  // Fijado del blanco: el motor del juego tiene "blanco fijado" (PinSelectedTarget fija el bicho que está justo bajo el puntero; la placa
  // GetTargetPlateUtf8 da nombre, vida, distancia*10 y estado). Si el puntero cae justo sobre un bicho se fija y el puntero se QUEDA ahí en vez de barrer.
  const pin = { intentos: 0, aciertos: 0, fijado: false, x: 0, y: 0, desde: 0, ultLog: 0, ultCast: 0, soltados: 0 };
  const placa = () => { try { const p = M()._MuWebGetTargetPlateUtf8() | 0; return p ? M().UTF8ToString(p) : ''; } catch (e) { return ''; } };
  const OFF = [[0, 0], [0, -30], [40, 0], [-40, 0], [0, 30], [60, -30], [-60, -30]];

  const P = () => window.__paquetes, S = () => window.__pantalla, B = () => window.__bichos, Mv = () => window.__mover;
  const cont = () => (P() && B() ? { exp: B().expTotal(), cast: P().cuenta('tx', 'C3:0x19'), muer: P().cuenta('rx', 'C1:0x17'), junt: P().cuenta('tx', 'C3:0x22'), t: Date.now() } : null);

  async function tocarEspacio() {
    const d = window.muDispatchKey;
    if (typeof d === 'function') { d('keydown', ESPACIO); await dormir(40); d('keyup', ESPACIO); return; }
    const c = document.getElementById('canvas'); if (!c) return;
    const ev = (t) => c.dispatchEvent(new KeyboardEvent(t, { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true, cancelable: true }));
    ev('keydown'); await dormir(40); ev('keyup');
  }
  // Pociones: el juego las toma con TECLAS de acceso rápido (Q = vida, W = maná, R = SD) y cuenta cuántas quedan en cada una.
  // La toma automática del juego solo corre en la versión móvil y la del Helper solo mientras el Helper está prendido, así que con el
  // piloto prendido NADIE tomaba pociones: el maná se agotaba y el piloto seguía apuntando sin poder lanzar nada.
  const POCIONES = {
    hp: { nombre: 'vida', slot: 0, key: { key: 'q', code: 'KeyQ', keyCode: 81 } },
    mp: { nombre: 'maná', slot: 1, key: { key: 'w', code: 'KeyW', keyCode: 87 } },
    sd: { nombre: 'SD', slot: 3, key: { key: 'r', code: 'KeyR', keyCode: 82 } },
  };
  const avisoPoc = {};
  function teclaRapida(spec) {
    const d = window.muDispatchKey;
    if (typeof d === 'function') { d('keydown', spec); setTimeout(() => d('keyup', spec), 90); return; }
    const c = document.getElementById('canvas'); if (!c) return;
    const ev = (t) => c.dispatchEvent(new KeyboardEvent(t, { key: spec.key, code: spec.code, keyCode: spec.keyCode, which: spec.keyCode, bubbles: true, cancelable: true }));
    ev('keydown'); setTimeout(() => ev('keyup'), 90);
  }
  function pocion() {
    const ahora = Date.now(); if (ahora - ultPocion < 600) return;
    const v = call('GetPlayerLife') / call('GetPlayerLifeMax'), sd = call('GetPlayerShield') / (call('GetPlayerShieldMax') || 1), mp = call('GetPlayerMana') / call('GetPlayerManaMax');
    for (const [tipo, falta] of [['sd', sd < SD_MIN], ['hp', v < HP_MIN], ['mp', mp < MP_MIN]]) {   // mismo orden que el juego: SD, vida, maná
      if (!falta) continue;
      const p = POCIONES[tipo], n = call('GetHotkeyItemCount', p.slot) | 0;
      if (n <= 0) {
        if (!avisoPoc[tipo] || ahora - avisoPoc[tipo] > 60000) { avisoPoc[tipo] = ahora; enviar('piloto_pociones', 'Sin pociones de ' + p.nombre + ' en la tecla rápida (' + p.key.key.toUpperCase() + ').', true); }
        continue;
      }
      const sh = shiftApretado; if (sh) shiftSet(false);
      teclaRapida(p.key); ultPocion = ahora;
      if (sh) setTimeout(() => { if (on && cfg.shift) shiftSet(true); }, 200);
      return;
    }
  }
  // ¿se puede actuar ahora? (devuelve null si sí, o el motivo de la espera)
  function espera() {
    if (call('GetSceneFlag') !== 5 || !(call('GetPlayerLife') > 0)) return 'esperando (muerto o fuera del juego)';
    if (call('HelperIsSafeZone') === 1) return 'parado: zona segura';
    if (call('GetBlockingUiOpen') === 1) {
      if (!ventanaDesde) ventanaDesde = Date.now();
      const seg = Math.round((Date.now() - ventanaDesde) / 1000);
      const det = 'mensaje=' + call('MsgVisible') + ' código=' + call('MsgCode') + ' tipo=' + call('MsgType') + ' · árbol máster=' + call('IsMasterSkillTreeOpen') + ' · tienda=' + call('ShopWindowOpen') + ' · precio=' + call('ShopPriceDialogOpen') + ' · texto=' + call('TextInputActive') + ' · itemEnMano=' + call('InventoryHasPickedItem') + ' · lista /move=' + call('GetMoveListVisible') + ' · crear pj=' + call('CharMakeActive') + ' · tap=' + call('TapDebug');
      if (seg >= 15 && !avisoVentana) { avisoVentana = true; enviar('piloto_ventana', 'El piloto está parado hace ' + seg + ' s porque hay una ventana abierta en el juego (' + det + ').', true); }
      return 'parado: hay una ventana abierta hace ' + seg + ' s (' + det + ')';
    }
    ventanaDesde = 0; avisoVentana = false;
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
    const ahora = Date.now(); let item = null, di = 99;
    for (const it of B().suelo()) {
      if ((ignorar.get(it.id) || 0) > ahora) continue;
      const d = cheb(it, hx, hy); if (d > LOOT_MAX) continue;
      if (!JOYAS.has(it.item)) continue;            // SOLO joyas: ni armas +9 ni nada que no sea joya
      if (d < di) { di = d; item = it; }
    }
    return { bicho, db, item, di };
  }
  const soltar = () => { if (apretado) { S().derecho.soltar(ultQ.x, ultQ.y); apretado = false; } };

  // ---------------- BUCLE DE ATAQUE ----------------
  async function bucleAtaque() {
    while (on) {
      try {
        // Medido: sin foco del navegador SDL ignora todos los eventos de puntero (0 hechizos en 11 s) y reengancharlos no sirve. El Helper del
        // juego no depende del mouse, así que se le cede el control mientras no hay foco y se lo recupera al volver.
        { const ahoraF = Date.now(), sinF = (typeof document !== 'undefined') && (!document.hasFocus() || document.visibilityState !== 'visible');
          if (sinF) { conFocoDesde = 0; if (!sinFocoDesde) sinFocoDesde = ahoraF; } else { sinFocoDesde = 0; if (!conFocoDesde) conFocoDesde = ahoraF; }
          if (sinF !== ultSinFoco) { ultSinFoco = sinF; bitacora.push({ t: ahoraF, c: 'FOCO', txt: sinF ? 'el navegador PERDIÓ el foco' : 'el navegador recuperó el foco' }); }
          if (!cedido && sinFocoDesde && ahoraF - sinFocoDesde > 1500) {
            soltar(); Mv() && Mv().parar(); call('HelperSetRunning', 1); cedido = true;
            bitacora.push({ t: ahoraF, c: '*', txt: 'sin foco: cedo el control al Helper del juego' }); estadoA = 'cedido al Helper (el navegador no tiene el foco)'; continue;
          }
          if (cedido) {
            if (!sinF && conFocoDesde && ahoraF - conFocoDesde > 1200) {
              call('HelperSetRunning', 0); await dormir(1500); cedido = false; sinFocoDesde = 0;
              bitacora.push({ t: Date.now(), c: '*', txt: 'volvió el foco: recupero el control del Helper' }); continue;
            }
            estadoA = 'cedido al Helper (el navegador no tiene el foco)'; await dormir(300); continue;
          }
        }
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
            mons: ciclos % 57 === 0 ? todos.map((v) => ({ v, d: cheb(v, hx, hy) })).sort((x, y) => x.d - y.d).slice(0, 5).map((o) => { const qq = S().pixelAtaque(o.v); return [o.v.x - hx, o.v.y - hy, o.d, qq ? Math.round(qq.x) : null, qq ? Math.round(qq.y) : null, qq ? !!S().enPantalla(qq) : null]; }) : sn.mons }; }
        info = 'bichos en vista ' + B().vista().length + ' · al alcance ' + cand.length + ' · aciertos ' + aciertos + ' · maná ' + Math.round(100 * call('GetPlayerMana') / call('GetPlayerManaMax')) + '% (pociones ' + (call('GetHotkeyItemCount', 1) | 0) + ') · blanco ' + (cfg.persistir ? 'HASTA QUE MUERA' : 'rotando') + (repress ? ' · re-apretados ' + repress : '') + (matados ? ' · matados ' + matados + ' (' + (sumaCasts / matados).toFixed(1) + ' hechizos c/u)' : '');
        if (MODO_MANO) {
          const hay = B().vista().some((v) => cheb(v, hx, hy) <= ATQ);
          const cc = S().centro(), k = (S().alto() || 911) / 911, t = Date.now() / 1000, ahoraMs = Date.now();
          const hubo = castN > ultCast;                      // salió un hechizo desde el ciclo anterior
          if (hubo) { aciertos++; ultCastFoco = ahoraMs; }
          let x, y, foco = null;
          if (cand.length) {
            // Medido en la grabación del usuario: el hechizo sale cuando el puntero está a ~70-100 px del bicho. Se barre en un círculo chico
            // ALREDEDOR de un bicho (posición viva por los D4). Medido en el piloto: bichos en la MISMA casilla del personaje casi no dan hechizos
            // (el puntero cae sobre el propio personaje), así que van al final. Se cambia de bicho cada 1,3 s o antes si no sale hechizo.
            const todos = cand.slice().sort((p1, p2) => ((p1.d === 0) - (p2.d === 0)) || (p1.d - p2.d)), orden = todos.slice(0, 3);
            if (hubo) castsBlanco++;
            if (cfg.persistir) {
              // Bichos duros: se tira hechizo al MISMO bicho hasta que muera. Si pasan 3 s sin que salga un hechizo (inalcanzable o mal apuntado)
              // se lo descarta 4 s y se prueba con otro. Cuando el blanco desaparece de la lista es que murió (o salió del alcance).
              let obj = focoId != null ? todos.find((c) => c.v.id === focoId) : null;
              if (obj && ahoraMs - Math.max(focoDesde, ultCastFoco) > 1100) { ign2.set(focoId, ahoraMs + 6000); obj = null; focoId = null; castsBlanco = 0; }
              else if (focoId != null && !obj) { if (castsBlanco > 0) { matados++; sumaCasts += castsBlanco; } focoId = null; castsBlanco = 0; cambioBlancoT = ahoraMs; }   // murió
              if (!obj) {
                const libres = todos.filter((c) => (ign2.get(c.v.id) || 0) < ahoraMs);
                obj = libres[0] || todos[0]; focoId = obj.v.id; focoDesde = ahoraMs; ultCastFoco = ahoraMs; castsBlanco = 0; if (!cambioBlancoT || ahoraMs - cambioBlancoT > 50) cambioBlancoT = ahoraMs;
              }
              foco = obj;
            } else {
              if (ahoraMs - focoDesde > 1300 || ahoraMs - Math.max(focoDesde, ultCastFoco) > 650) { focoIdx = (focoIdx + 1) % orden.length; focoDesde = ahoraMs; }
              foco = orden[focoIdx % orden.length];
            }
            x = foco.q.x + (36 * Math.sin(t * 2.3) + 14 * Math.sin(t * 6.1)) * k * cfg.barrido + (Math.random() - 0.5) * 3;
            y = foco.q.y + (30 * Math.sin(t * 1.9 + 0.7) + 12 * Math.sin(t * 5.2)) * k * cfg.barrido + (Math.random() - 0.5) * 3;
          } else {
            x = cc.x - 36 * k + (110 * Math.sin(t * 2.1) + 40 * Math.sin(t * 5.3 + 1)) * k + (Math.random() - 0.5) * 4;
            y = cc.y - 58 * k + (70 * Math.sin(t * 1.7 + 0.8) + 25 * Math.sin(t * 4.1)) * k + (Math.random() - 0.5) * 4;
          }
          if (!apretado) { punteroX = null; ultQ = { x, y }; S().derecho.iniciar(x, y); apretado = true; await dormir(120); ultD4t = Date.now(); }
          // Una mano no salta 180 px de golpe: el puntero avanza como mucho 70 px por ciclo hacia donde quiere ir
          if (punteroX === null) { punteroX = x; punteroY = y; }
          { const ddx = x - punteroX, ddy = y - punteroY, dd = Math.hypot(ddx, ddy); if (dd > 70) { x = punteroX + ddx / dd * 70; y = punteroY + ddy / dd * 70; } punteroX = x; punteroY = y; }
          // Medido: en los frenos los pasos enviados (D4, el ataque sostenido) se detienen del todo = el juego soltó el clic derecho aunque el
          // piloto crea que sigue apretado. Si hay bichos al alcance y pasa >1 s sin D4, se suelta y se vuelve a apretar.
          { const d4n = P().cuenta('tx', 'C1:0xd4'); if (d4n !== ultD4n) { ultD4n = d4n; ultD4t = ahoraMs; repSeguidos = 0; }   // volvieron los pasos: el re-apretado sirvió
            if (cand.length) { if (!candDesde) candDesde = ahoraMs; } else candDesde = 0;   // el freno se cuenta desde que HAY bichos al alcance
            const umbral = 800;   // medido: las pausas sanas de los pasos duran ~0,2 s (p90 0,6 s); con 0,25 s se interrumpía el 24 % de las sanas y los hechizos bajaban
            if (cand.length && ahoraMs - Math.max(ultD4t, candDesde, cambioBlancoT) > umbral && ahoraMs - ultRepress > (repSeguidos < 2 ? 1500 : 3000)) {   // si 2 re-apretados seguidos no sirven, esperar más
              ultRepress = ahoraMs; repress++; repSeguidos++; S().derecho.soltar(x, y); await dormir(80); S().derecho.iniciar(x, y); ultD4t = ahoraMs; candDesde = ahoraMs;
              bitacora.push({ t: ahoraMs, c: 'REPRESS', txt: 'sin pasos (D4) hace >' + umbral + ' ms con ' + cand.length + ' bichos al alcance: suelto y vuelvo a apretar el clic derecho (#' + repress + ')' });
            } }
          if (cfg.fijar) {
            const tieneFijado = call('HasPinnedTarget', 0) === 1;
            if (tieneFijado && pin.fijado) {
              // ya hay blanco fijado: el puntero se queda quieto sobre él; si pasan 1,5 s sin hechizo, se suelta el fijado y se vuelve a barrer
              x = pin.x; y = pin.y; punteroX = x; punteroY = y;
              if (hubo) pin.ultCast = ahoraMs;
              if (ahoraMs - Math.max(pin.desde, pin.ultCast) > 1500) { call('ClearPinnedTarget'); pin.fijado = false; pin.soltados++; bitacora.push({ t: ahoraMs, c: 'PIN', txt: 'suelto el blanco fijado: 1,5 s sin hechizo (placa: ' + placa().replace(/	/g, ' | ') + ')' }); }
            } else {
              if (pin.fijado) { pin.fijado = false; bitacora.push({ t: ahoraMs, c: 'PIN', txt: 'el blanco fijado se perdió (murió o salió de alcance): vuelvo a barrer' }); }
              pin.intentos++;
              const r = call('PinSelectedTarget');
              if (r === 1 || call('HasPinnedTarget', 0) === 1) {
                pin.aciertos++; pin.fijado = true; pin.x = x; pin.y = y; pin.desde = ahoraMs; pin.ultCast = ahoraMs;
                bitacora.push({ t: ahoraMs, c: 'PIN', txt: 'FIJADO en pixel (' + Math.round(x) + ',' + Math.round(y) + ') bicho esperado #' + (foco ? foco.v.id + ' a ' + foco.d + ' casillas' : '-') + ' · placa: ' + placa().replace(/	/g, ' | ') + ' · idx ' + call('GetPinnedTargetIndex') });
              } else if (ahoraMs - pin.ultLog > 4000) { pin.ultLog = ahoraMs; bitacora.push({ t: ahoraMs, c: 'PIN', txt: 'sin blanco bajo el puntero (' + pin.aciertos + ' fijados de ' + pin.intentos + ' intentos)' }); }
            }
          }
          ultCast = castN; ultQ = { x, y };
          S().derecho.mover(x, y);
          estadoA = foco ? 'MODO MANO' + (cfg.persistir ? ' (hasta que muera)' : '') + ': barrido sobre el bicho #' + foco.v.id + ' (a ' + foco.d + ', ' + cand.length + ' al alcance)' : (hay ? 'MODO MANO: hay bichos pero ninguno visible en pantalla' : 'MODO MANO: sin bichos al alcance');
          logear('A', estadoA);
          await dormir(40);
          continue;
        }
        if (cand.length) {
          const ahora = Date.now();
          if (!apretado) { ultQ = cand[0].q; S().derecho.iniciar(ultQ.x, ultQ.y); apretado = true; await dormir(120); }
          // MISMO BICHO hasta que muera: un hechizo tarda ~0,5 s y si el blanco cambia en el medio parece que se cancela
          const lista = cand.filter((c) => (ign.get(c.v.id) || 0) < ahora), usable = lista.length ? lista : cand;
          let obj = objetivo && usable.find((c) => c.v.id === objetivo.id);
          if (!obj) { obj = usable[0]; objetivo = { id: obj.v.id }; offIdx = 0; ultCastT = ahora; cambios++; }
          if (castN > ultCast) { aciertos++; if (offIdx > 0) S().ajustarSesgo(OFF[offIdx][0] * 0.35, OFF[offIdx][1] * 0.35); offIdx = 0; ultCastT = ahora; }   // salió un hechizo: este punto sirve
          ultCast = castN;
          // sin hechizo hace un rato sobre este bicho: probar otro punto sobre él; si ninguno sirve, cambiar de bicho
          if (ahora - ultCastT > (offIdx === 0 ? 650 : 450)) {
            offIdx++; ultCastT = ahora;
            if (offIdx >= OFF.length) { ign.set(objetivo.id, ahora + 3000); objetivo = null; offIdx = 0; fallos++; }
          }
          const o = OFF[offIdx] || OFF[0];
          ultQ = { x: obj.q.x + o[0], y: obj.q.y + o[1] };
          S().derecho.mover(ultQ.x + (Math.random() - 0.5) * 3, ultQ.y + (Math.random() - 0.5) * 3);   // como una mano: se actualiza seguido y con un temblor mínimo
          estadoA = 'SPAM: bicho #' + (objetivo ? objetivo.id : '-') + ' a ' + obj.d + ' (punto ' + offIdx + ', ' + cand.length + ' al alcance)';
        } else {
          ultCast = castN; estadoA = 'sin bichos al alcance (clic derecho apretado)';
        }
        logear('A', estadoA);
        await dormir(35);
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
  // Regla del usuario: pasar por encima de una joya ya la levanta, así que NO se va a buscar items ni se toca Espacio (cortaba el ataque).
  // La idea es pegar la mayor cantidad de tiempo posible: atacar, y moverse lo MENOS posible, solo hasta el núcleo de bichos.
  //   - si hay >= 3 bichos a <= 3 casillas, o el núcleo no es claramente mejor que donde estoy: QUIETO (sigue atacando)
  //   - si donde estoy hay pocos y el núcleo tiene >= 3 bichos más: ir al núcleo; al llegar, quedarse >= 3 s
  //   - si no hay ningún bicho a la vista hace 1,5 s: patrullar hacia la mejor zona conocida o volver al punto de partida
  async function bucleMovimiento() {
    while (on) {
      try {
        if (cedido) { Mv() && Mv().parar(); estadoM = 'quieto: el Helper tiene el control (sin foco)'; await dormir(300); continue; }
        const w = espera();
        if (w) { estadoM = 'quieto: ' + w; Mv() && Mv().parar(); logear('M', estadoM); await dormir(300); continue; }
        if (!Mv() || !Mv().tabla()) { estadoM = 'quieto: falta calibrar el movimiento'; logear('M', estadoM); await dormir(500); continue; }
        const hx = call('GetHeroX'), hy = call('GetHeroY'), ahora = Date.now();
        if (!cfg.moverse) {
          // Como el Helper: no sale a buscar bichos. El juego a veces corre al personaje al mantener el clic derecho; si se corrió >= 4 casillas
          // del punto de partida, vuelve (solo cuando no hay un hechizo reciente, para no cortar el ataque).
          const dH = home ? Math.max(Math.abs(hx - home.x), Math.abs(hy - home.y)) : 0;
          if (home && dH >= 4 && ahora - ultCastFoco > 800) { const rr = Mv().paso(home.x, home.y, 1); estadoM = 'volviendo al punto de partida (corrido ' + dH + ' casillas) (' + rr + ')'; }
          else { Mv().parar(); estadoM = 'quieto (como el Helper)' + (dH ? ' · corrido ' + dH + ' casillas' : ''); }
          logear('M', estadoM); await dormir(150); continue;
        }
        const r = B().racimo(3, 14);                       // { aqui, mejor:{x,y,n}, dist, total }
        const dHome = home ? Math.max(Math.abs(hx - home.x), Math.abs(hy - home.y)) : 0;
        if (!r || !r.total) {
          if (!sinBichosDesde) sinBichosDesde = ahora;
          if (ahora - sinBichosDesde > 1500) {
            const z = mejorZona(hx, hy) || home;
            if (z) { const rr = Mv().paso(z.x, z.y, 3); estadoM = 'patrullando hacia (' + z.x + ',' + z.y + ') (' + rr + ')'; if (rr === 'llegó') sinBichosDesde = ahora + 4000; }
            else { Mv().parar(); estadoM = 'quieto: sin bichos y sin zona conocida'; }
          } else { Mv().parar(); estadoM = 'quieto: sin bichos a la vista (esperando 1,5 s)'; }
        } else {
          sinBichosDesde = 0;
          // Medido: caminar a un núcleo a ~10 casillas cuesta ~1 s de ataque por viaje (0,11 hechizos/s moviéndose contra 1,20 quieto) y fue
          // alejando al personaje hasta 16 casillas del punto de partida. Solo se va a núcleos CERCANOS (<= 5 casillas) que valgan la pena
          // (>= 4 bichos más) y que no se salgan de la correa de 8 casillas; si ya está lejos del punto de partida y acá hay pocos, vuelve.
          const destinoLejos = home ? Math.max(Math.abs(r.mejor.x - home.x), Math.abs(r.mejor.y - home.y)) > 8 : false;
          const quedarse = r.aqui >= 3 || (r.aqui >= 1 && r.mejor.n - r.aqui < 4) || r.dist < 2 || r.dist > 5 || destinoLejos || ahora - ultLlegada < 3000;
          if (quedarse) {
            if (dHome > 8 && r.aqui < 2 && home) { const rr = Mv().paso(home.x, home.y, 2); estadoM = 'volviendo al punto de partida (a ' + dHome + ' casillas, aquí ' + r.aqui + ' bichos) (' + rr + ')'; }
            else { Mv().parar(); estadoM = 'quieto en el núcleo: ' + r.aqui + ' bichos a <=3 (el mejor núcleo cercano tiene ' + r.mejor.n + ')'; }
          } else {
            const rr = Mv().paso(r.mejor.x, r.mejor.y, 1);
            estadoM = 'yendo al núcleo (' + r.mejor.n + ' bichos, a ' + r.dist + ' casillas; aquí ' + r.aqui + ') (' + rr + ')';
            if (rr === 'llegó') ultLlegada = ahora;
          }
        }
        logear('M', estadoM);
        await dormir(150);
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
    on = true; iniciarReloj(); t0 = Date.now(); c0 = cont(); if (cfg.shift) shiftSet(true); motivo = ''; aciertos = 0; ciclos = 0; pegado = 0; ultCast = P() ? P().cuenta('tx', 'C3:0x19') : 0;
    objetivo = null; offIdx = 0; cambios = 0; fallos = 0; ign.clear(); ultLlegada = 0; focoId = null; matados = 0; sumaCasts = 0; castsBlanco = 0; ign2.clear(); repress = 0; ultD4n = 0; ultD4t = Date.now(); punteroX = null; candDesde = 0; cambioBlancoT = 0; repSeguidos = 0; cedido = false; sinFocoDesde = 0; conFocoDesde = 0;
    home = { x: call('GetHeroX'), y: call('GetHeroY') }; sinBichosDesde = 0; bitacora.push({ t: Date.now(), c: '*', txt: 'PILOTO ON en (' + home.x + ',' + home.y + ') mapa ' + call('GetMapIndex') });
    setTimeout(() => { if (on) { bucleAtaque(); bucleMovimiento(); } }, helperEstaba ? 1500 : 0);
    return { ok: true };
  }
  function detener(porque = 'manual') {
    if (!on) return;
    on = false; pararReloj(); shiftSet(false); motivo = porque;
    if (cedido) { cedido = false; if (!helperEstaba) call('HelperSetRunning', 0); } bitacora.push({ t: Date.now(), c: '*', txt: 'PILOTO OFF: ' + porque }); soltar(); Mv() && Mv().parar();
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

  (window.__muLimpiar = window.__muLimpiar || []).push(() => { try { detener('manual'); } catch (e) { /* nada */ } });
  window.__piloto = {
    cedido: () => cedido,
    setFijar: (v) => { cfg.fijar = !!v; if (!v) { call('ClearPinnedTarget'); pin.fijado = false; } bitacora.push({ t: Date.now(), c: '*', txt: 'fijar=' + cfg.fijar }); },
    pinStats: () => ({ intentos: pin.intentos, aciertos: pin.aciertos, soltados: pin.soltados, fijado: pin.fijado }),
    setMoverse: (v) => { cfg.moverse = !!v; bitacora.push({ t: Date.now(), c: '*', txt: 'moverse=' + cfg.moverse }); },
    setBarrido: (f) => { cfg.barrido = Math.max(0.2, Math.min(1.5, +f || 1)); bitacora.push({ t: Date.now(), c: '*', txt: 'barrido=' + cfg.barrido }); },
    opciones: () => ({ moverse: cfg.moverse, barrido: cfg.barrido, fijar: cfg.fijar }),
    arrancar, detener, medir, activo: () => on, bitacora: () => bitacora,
    setPersistir: (v) => { cfg.persistir = !!v; focoId = null; return cfg.persistir; }, persistir: () => cfg.persistir,
    nota: (canal, txt) => { bitacora.push({ t: Date.now(), c: canal, txt }); if (bitacora.length > 1500) bitacora.shift(); },
    setShift: (v) => { cfg.shift = !!v; if (on) shiftSet(!!v); return cfg.shift; },
    marcar: (txt) => bitacora.push({ t: Date.now(), c: 'MARCA', txt: txt || 'marca del usuario' }),
    snap: () => ({ on, shift: shiftApretado, apretado, estadoA, estadoM, sn, ptr: [Math.round(ultQ.x), Math.round(ultQ.y)], aciertos }),
    resumen: () => (on ? 'Piloto SPAM ON [Shift ' + (shiftApretado ? 'SÍ' : 'no') + '] · A: ' + estadoA + ' · M: ' + estadoM + ' · ' + info + ' · ' + texto(tasas(c0, cont()) || null, '').trim() : (motivo ? 'Piloto OFF (' + motivo + ')' : '')),
  };
})();
