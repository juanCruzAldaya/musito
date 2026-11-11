// Auto-stats: cuando tenés puntos libres, los reparte solo con los comandos del juego (/str /agi /sta /ene) y con el botón "+" manteniendo tus proporciones.
// Proporción por defecto = la de tu pantalla de personaje (STR 3813 · AGI 1142 · STA 373 · ENG 503). Command no se toca.
// Apagado de fábrica; se prende con un botón del Laboratorio y se acuerda (localStorage). Se frena solo mientras el ciclo de reset está andando
// (el ciclo reparte sus propios puntos). Usa solo funciones del propio juego (el chat y el botón "+" de la ventana de stats), igual que hacerlo a mano.
// v2: no se apaga solo ante un fallo (reintenta con espera), no manda comandos de 1-3 puntos (los suma al stat más grande) y deja un log
// que baja con la caja negra (stats_log).
// v3 (0.70.0): reparto CONTINUO. Antes salía en lotes cada 25-45 s; con la subida rápida del reset quedaban cientos de puntos parados (ver abajo).
(() => {
  'use strict';
  // Recarga en caliente: los intervalos se registran para poder cortarlos al reinyectar el módulo sin recargar la página (ver background.js)
  const setInterval = (f, ms) => { const id = window.setInterval(f, ms); (window.__muIds = window.__muIds || []).push(id); return id; };
  const M = () => window.Module;
  const call = (n, ...a) => { try { const f = M()['_MuWeb' + n]; return typeof f === 'function' ? f(...a) : null; } catch (e) { return null; } };
  const KEY = 'muStatsV1', CLAVES = ['str', 'agi', 'vit', 'ene'];
  const COMANDO = { str: '/str', agi: '/agi', vit: '/sta', ene: '/ene', cmd: '/cmd' };
  const LEER = { str: 'GetPlayerStrength', agi: 'GetPlayerDexterity', vit: 'GetPlayerVitality', ene: 'GetPlayerEnergy', cmd: 'GetPlayerCommand' };
  const IDX = { str: 0, agi: 1, vit: 2, ene: 3 };           // índice de RequestAddStat / RequestRemoveStat (botones "+" y "-" de la ventana de stats)
  const BASE = { str: 26, agi: 20, vit: 20, ene: 15 };      // valor base del Dark Lord: no se puede bajar de ahí
  const MINIMO_POR_COMANDO = 4;      // un comando de menos puntos que esto se suma al stat de mayor peso
  // v4 (hojas de personaje nivel 397 y 398): Skill Damage = 200 % + ENE/20 (306,45 vs 306 y 341,4 vs 341) y ataque promedio = 0,2274 x STR + 0,1137 x ENE + ~251, o sea que hoy un punto de ENE
  // rinde ~1,8 veces el daño de uno de STR. Proporción a nivel 400: STR 33 % · AGI 21 % · STA 7,5 % · ENE 39 % (STR 4250 · AGI 2650 · STA 960 · ENE 5000 = +16 % de daño contra STR 6411 · ENE 2828).
  const PESOS_V2 = { str: 4250, agi: 2650, vit: 960, ene: 5000 };
  const cfg = { on: false, pesos: { ...PESOS_V2 }, minimo: 7, v: 4, cmdPuntos: 500 };      // minimo: con cuántos libres arranca un reparto (7 = un nivel); antes 30
  try {
    const g = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (g) { cfg.on = !!g.on; if (typeof g.cmdPuntos === 'number') cfg.cmdPuntos = g.cmdPuntos; if (g.pesos && g.v === 4) cfg.pesos = g.pesos;   // las proporciones viejas (v3 o menos) se reemplazan por las nuevas una sola vez
       if (g.minimoManual && g.minimo) { cfg.minimo = g.minimo; cfg.minimoManual = true; } }
  } catch (e) { /* nada */ }
  const guardar = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* nada */ } };
  const enviar = (clave, texto, grave) => window.postMessage({ __muvigia: true, clave, texto: String(texto).slice(0, 280), grave: !!grave }, '*');
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  let estado = 'apagado', ocupado = false, ultLote = 0, total = 0, fallas = 0, pausaHasta = 0;
  const bitacora = [];
  const L = (t) => { bitacora.push({ t: Date.now(), txt: t }); if (bitacora.length > 300) bitacora.shift(); };

  // Pura: devuelve {str,agi,vit,ene} con cuántos puntos poner en cada uno para acercar los stats actuales a la proporción de 'pesos'.
  // Los repartos menores a 'minCmd' puntos se suman al stat de mayor peso (evita comandos de 1-3 puntos).
  const TOPES = { agi: 2650 };   // AGI más allá de ~2650 no sube más el ritmo (intervalo mínimo del servidor 60 ms con velocidad 325)
  function plan(actual, libres, pesos, minCmd = 0, topes = TOPES) {
    const lleno = (k) => topes[k] != null && (actual[k] || 0) >= topes[k];
    const ks = CLAVES.filter((k) => (pesos[k] || 0) > 0 && !lleno(k)), sw = ks.reduce((s, k) => s + pesos[k], 0), out = { str: 0, agi: 0, vit: 0, ene: 0 };
    if (!ks.length || libres <= 0) return out;
    const tot = ks.reduce((s, k) => s + (actual[k] || 0), 0) + libres;
    const falta = {}; let sf = 0;
    ks.forEach((k) => { falta[k] = Math.max(0, tot * pesos[k] / sw - (actual[k] || 0)); sf += falta[k]; });
    const cuota = {};
    if (sf >= libres) ks.forEach((k) => { cuota[k] = libres * falta[k] / sf; });
    else ks.forEach((k) => { cuota[k] = falta[k] + (libres - sf) * pesos[k] / sw; });
    let dado = 0; ks.forEach((k) => { out[k] = Math.floor(cuota[k]); dado += out[k]; });
    const orden = ks.slice().sort((a, b) => (cuota[b] - Math.floor(cuota[b])) - (cuota[a] - Math.floor(cuota[a])));
    for (let i = 0; dado < libres; i++, dado++) out[orden[i % orden.length]]++;
    // si algún stat se pasa de su tope, se recorta y el sobrante se reparte entre los demás
    for (const k of ks) {
      const techo = topes[k] != null ? Math.max(0, topes[k] - (actual[k] || 0)) : Infinity;
      if (out[k] > techo) { const sobra = out[k] - techo; out[k] = techo; const resto = plan({ ...actual, [k]: topes[k] }, sobra, pesos, 0, topes); CLAVES.forEach((q) => { out[q] += resto[q]; }); }
    }
    if (minCmd > 0) {
      const mayor = ks.slice().sort((a, b) => pesos[b] - pesos[a])[0];
      ks.forEach((k) => { if (k !== mayor && out[k] > 0 && out[k] < minCmd) { out[mayor] += out[k]; out[k] = 0; } });
    }
    return out;
  }
  const leer = () => ({ str: call('GetPlayerStrength'), agi: call('GetPlayerDexterity'), vit: call('GetPlayerVitality'), ene: call('GetPlayerEnergy') });
  let ESC = 1;       // para pruebas: multiplica todas las esperas de la asignación
  const dormirE = (ms) => new Promise((r) => setTimeout(r, Math.max(1, ms * ESC)));
  const CHAT_GAP = 1500;      // ms mínimos entre dos mensajes del chat (cajas 9-11: con 1,5 s entre comandos salieron decenas seguidos; el límite se comparte con ciclo.js)
  async function chat(texto) {      // el límite entre mensajes se comparte con ciclo.js (window.__muUltChat): dos comandos pegados los rechaza el chat
    // si estás escribiendo en el chat del juego no se manda nada (pisaría tu texto): se espera hasta 3 s a que termines
    for (let i = 0; i < 30 && call('TextInputActive') === 1; i++) await dormir(100);
    if (call('TextInputActive') === 1) return false;
    const esp = CHAT_GAP * ESC - (Date.now() - (window.__muUltChat || 0)); if (esp > 0) await dormir(esp);
    window.__muUltChat = Date.now(); let ptr = 0;
    try { ptr = window.muAllocateUtf8(texto); return M()._MuWebSubmitChatUtf8(ptr, 0, 0) === 1; } catch (e) { return false; }
    finally { try { if (ptr) M()._free(ptr); } catch (e) { /* nada */ } }
  }
  // Manda un comando y espera a que baje el número de puntos libres (hasta 10 s). Reintenta hasta 3 veces. (Solo lo usa mover().)
  async function aplicar(k, n) {
    for (let intento = 1; intento <= 3; intento++) {
      const antes = call('GetPlayerLevelUpPoints') | 0; if (antes <= 0) return true;
      const cmd = COMANDO[k] + ' ' + Math.min(n, antes), aceptado = await chat(cmd);
      if (!aceptado) L('el chat no aceptó "' + cmd + '" (intento ' + intento + ')');
      let ok = false; for (let t = 0; t < 33 && !ok; t++) { await dormir(300); ok = (call('GetPlayerLevelUpPoints') | 0) < antes; }
      if (ok) { L('ok "' + cmd + '" (libres ' + antes + ' -> ' + (call('GetPlayerLevelUpPoints') | 0) + ')'); await dormir(1200); return true; }
      L('"' + cmd + '" no bajó los puntos libres (intento ' + intento + ', libres ' + antes + ', msg ' + call('MsgVisible') + ')'); await dormir(3000);
    }
    return false;
  }

  // ---------------- asignación continua y robusta ----------------
  // Caja 8 (después del reset): "/agi 2186" fue rechazado 3 veces seguidas por el chat (cada intento esperaba 10 s en vano) y todo se frenó 2 minutos con 7113 puntos sin repartir;
  // el chat rechaza de vez en cuando incluso el primer comando. Desde la 0.69.7 cada stat sube por una escalera de métodos y la cadena NUNCA se frena (en la caja 11 los 3 rechazos
  // se resolvieron en el 2º intento, ~2 s después).
  // Cajas 10 y 11: aun así el reparto salía en LOTES cada 25-45 s (tick de 4 s + 20 s de espera entre lotes + mínimo de 30 puntos). Con la subida rápida del reset (VIP +200 % de EXP:
  // del 1 al 315 en 108 s, hasta 3 niveles por segundo = ~21 puntos por segundo) quedaban 500 a 940 puntos parados casi 2 minutos, y entre el 350 y el 399 siempre había ~35 esperando.
  // Ahora es CONTINUO: un tick cada 0,3 s arranca apenas hay 7 puntos (un nivel) y las rondas se encadenan sin pausa (solo manda el límite de 1,5 s entre mensajes del chat).
  //  - pocos libres (los que el botón "+" alcanza a gastar en ~3 s: unos 50, más si el servidor lo toma rápido): todo con el botón "+" (RequestAddStat: sin límite de chat, ~0,06 s por punto),
  //    o sea que cada nivel se gasta en menos de 1 s;
  //  - muchos libres: por chat, un comando por stat, el de mayor cuota primero (después del reset: 4 comandos en unos 6 s);
  //  - si el chat rechaza se reintenta cada ~2 s y mientras tanto el botón "+" sigue gastando de a ~28 puntos; si el botón no funciona (se prueba solo, NO está probado en el juego real)
  //    se lo da por muerto 90 s (después 3, 6 y 12 min) y todo sigue por chat.
  const ORDEN = { str: 0, ene: 1, agi: 2, vit: 3, cmd: 4 };         // desempate cuando dos stats tienen la misma cuota
  const ASIG = { chatIntentos: 0, chatOk: 0, chatRechazos: 0, chatFallosSeguidos: 0, addPedidos: 0, addPuntos: 0, addMalDesde: 0, addFallos: 0, addMs: 60, rondas: 0 };
  const rondasLog = [];
  const anotarRonda = (r) => { rondasLog.push({ t: Date.now(), ...r }); if (rondasLog.length > 80) rondasLog.shift(); };
  const statAhora = (k) => call(LEER[k]) | 0, libresAhora = () => call('GetPlayerLevelUpPoints') | 0;
  const botonVivo = () => !(ASIG.addMalDesde && Date.now() - ASIG.addMalDesde < Math.min(720000, 90000 * 2 ** Math.max(0, ASIG.addFallos - 1)) * ESC);
  const botonMuerto = () => { ASIG.addMalDesde = Date.now(); ASIG.addFallos++; };
  // 1) por el chat: éxito = el stat SUBIÓ (hasta ~3 s para que el servidor lo confirme). Si el chat lo rechaza vuelve enseguida.
  async function sumarChat(k, n) {
    const antes = statAhora(k), l0 = libresAhora(); ASIG.chatIntentos++;
    if (!(await chat(COMANDO[k] + ' ' + n))) { ASIG.chatRechazos++; ASIG.chatFallosSeguidos++; return 0; }
    for (let t = 0; t < 15; t++) {
      await dormirE(200); const d = statAhora(k) - antes;
      if (d > 0) { ASIG.chatOk++; ASIG.chatFallosSeguidos = 0; return d; }
      if (t >= 2 && libresAhora() < l0) { ASIG.chatOk++; ASIG.chatFallosSeguidos = 0; return Math.max(1, l0 - libresAhora()); }      // el stat tarda en reflejarse pero los libres bajaron
    }
    ASIG.chatFallosSeguidos++; return 0;
  }
  // 2) el botón "+" de la ventana de stats (RequestAddStat, un punto por pedido). Gasta varios stats seguidos y controla UNA sola vez al final. Empieza a un pedido cada 60 ms (lo que hace
  //    el botón del juego mantenido apretado) y se acelera de a poco hasta 25 ms si el servidor toma casi todos (o se afloja si pierde). Si en 8 pedidos ningún stat sube, se lo da por muerto un rato.
  async function sumarConBoton(cmds, maxMs, activo) {
    if (!botonVivo() || !cmds.length) return 0;
    const ks = cmds.map((c) => c.k), antes = {}; ks.forEach((k) => { antes[k] = statAhora(k); });
    const ganados = () => ks.reduce((s, k) => s + Math.max(0, statAhora(k) - antes[k]), 0);
    const t0 = Date.now(), ms = ASIG.addMs; let pedidos = 0, probado = false;
    for (const c of cmds) {
      for (let i = 0; i < c.n; i++) {
        if (!activo() || Date.now() - t0 >= maxMs * ESC || libresAhora() <= 0) break;
        if (IDX[c.k] === undefined) break;      // Comando no tiene botón + verificado: solo por chat
        call('RequestAddStat', IDX[c.k]); pedidos++; ASIG.addPedidos++; await dormirE(ms);
        if (pedidos === 8 && !probado) { probado = true; if (ganados() === 0) { await dormirE(700); if (ganados() === 0) { botonMuerto(); return 0; } } }
      }
    }
    if (!pedidos) return 0;
    await dormirE(250); let d = ganados();
    if (d === 0) { await dormirE(700); d = ganados(); if (d === 0) { botonMuerto(); return 0; } }
    ASIG.addPuntos += d; ASIG.addFallos = 0; ASIG.addMalDesde = 0;
    if (pedidos >= 16) { if (d >= pedidos - 1) ASIG.addMs = Math.max(25, ASIG.addMs - 10); else if (d < pedidos * 0.8) ASIG.addMs = Math.min(120, ASIG.addMs + 20); }
    return d;
  }
  // Un turno de chat para un stat: manda el comando; si el chat no lo toma, el botón "+" gasta unos 28 puntos de ese stat mientras el chat se recupera (el chat se vuelve a probar en la ronda
  // siguiente, ~2 s después: en la caja 11 los 3 rechazos salieron en el 2º intento). Devuelve los puntos puestos (0 = nada funcionó).
  async function sumar(k, n, activo = () => true, log = L) {
    n = Math.min(n | 0, libresAhora()); if (n <= 0) return 0;
    const d = await sumarChat(k, n);
    if (d > 0) return d;
    if (ASIG.chatFallosSeguidos <= 3 || ASIG.chatFallosSeguidos % 10 === 0) log('el chat no sumó ' + COMANDO[k] + ' ' + n + (ASIG.chatFallosSeguidos > 1 ? ' (' + ASIG.chatFallosSeguidos + ' fallos seguidos)' : ''));      // con el chat caído no se llena el log
    if (k !== 'cmd' && botonVivo() && activo()) { const d2 = await sumarConBoton([{ k, n: Math.min(n, 28) }], 1800, activo); if (d2 > 0) { log('ok ' + COMANDO[k] + ' +' + d2 + ' con el botón + (el chat no salía)'); return d2; } }
    return 0;
  }
  // Reparte hasta que no queden puntos (o se apague 'activo' o pase maxMs). planFn(libres, minCmd) -> [{k, n}]. Cada ronda recalcula el plan con los stats de ese momento y las rondas se encadenan
  // sin pausa mientras queden >= minSiguientes (los +7 por nivel que entran durante la ronda se gastan en la siguiente).
  //  - pocos libres (los que el botón + alcanza a gastar en ~3 s: unos 50, hasta 120 si el servidor lo toma rápido): todo con el botón +, cada nivel se gasta en menos de 1 s;
  //  - muchos libres: por chat, un comando por stat con el de mayor cuota primero (cada comando lleva TODOS los puntos de ese stat, así que ninguna subida rápida lo desborda); si el chat
  //    rechaza uno, el botón + gasta unos 28 puntos de ese stat y la ronda sigue con el siguiente.
  async function repartirRobusto(planFn, ctl = {}) {
    const activo = ctl.activo || (() => true), log = ctl.log || L, maxMs = (ctl.maxMs || 600000) * ESC, minSig = ctl.minSiguientes == null ? 7 : ctl.minSiguientes, t0 = Date.now();
    let puestos = 0, rondas = 0, sinProgreso = 0;
    while (activo() && Date.now() - t0 < maxMs) {
      const libres = libresAhora(); if (libres <= 0) break;
      if (rondas > 0 && libres < minSig) break;
      rondas++; ASIG.rondas++;
      const chico = botonVivo() && libres <= Math.min(150, 3000 / ASIG.addMs);
      const cmds = (planFn(libres, chico ? 0 : MINIMO_POR_COMANDO) || []).filter((c) => c.n > 0).sort((a, b) => b.n - a.n || ORDEN[a.k] - ORDEN[b.k]); if (!cmds.length) break;
      let prog = 0; const tR = Date.now();
      if (chico) {
        prog = await sumarConBoton(cmds, 6000, activo);
        if (prog === 0 && !botonVivo()) { anotarRonda({ libres, puestos: 0, ms: Date.now() - tR, via: 'boton muerto' }); continue; }      // el botón no anda: sigue por chat enseguida
      } else {
        for (const c of cmds) { if (!activo()) break; prog += await sumar(c.k, c.n, activo, log); }
      }
      puestos += prog;
      anotarRonda({ libres, puestos: prog, ms: Date.now() - tR, via: chico ? 'boton' : 'chat', cmds: cmds.map((c) => c.k + c.n).join(' ') });
      if (prog > 0) sinProgreso = 0;
      else { sinProgreso++; const esp = Math.min(10000, 1500 * 2 ** Math.min(sinProgreso - 1, 3)); if (sinProgreso <= 3 || sinProgreso % 10 === 0) log('ronda ' + rondas + ' sin progreso (' + sinProgreso + ' seguidas): espero ' + (esp / 1000) + ' s y vuelvo a intentar'); await dormirE(esp); }
    }
    return { puestos, rondas, libres: libresAhora() };
  }
  const umbral = () => (botonVivo() ? cfg.minimo : Math.max(cfg.minimo, 14));      // sin el botón "+" cada comando de chat cuesta 1,5 s: no se gasta de a un nivel
  // v0.78.0/0.78.1: COMANDO en el reset (pedido: "agregue 500 a comando en el reset, para tirar algunos skills"). Caja 24: NO se agregó porque el reparto del reset lo hizo una ronda que ya estaba corriendo
  // desde el +7 del nivel 400 (repartirRobusto sigue y recalcula el plan en cada ronda): el chequeo estaba solo al arrancar repartir(), cuando todavía había 7 libres. Ahora el Comando va DENTRO de cada ronda
  // (cmdsDe): si hay puntos de sobra (libres >= lo que falta + 100) se apartan y se agrega un comando '/cmd N' (solo por chat: el índice de Comando del botón + no está verificado) y el resto se reparte con lo que queda.
  // Dark Lord vuelve a Comando 25 con cada reset, así que se repite. Fire Scream pide 70 de Comando. Lab > Puntos > Comando.
  const CMD_BASE = 25;
  let cmdApartadoT = 0;      // cuándo se apartó por última vez: durante 60 s se sigue reintentando aunque queden justo los puntos apartados (el chat puede rechazar el primer intento)
  const faltaCmd = (libres) => { const meta = cfg.cmdPuntos | 0; if (meta <= 0 || !cfg.on) return 0; const falta = Math.max(0, meta - Math.max(0, statAhora('cmd') - CMD_BASE)); if (falta <= 0) return 0; const reciente = Date.now() - cmdApartadoT < 60000 * ESC; return libres >= falta + (reciente ? 0 : 100) ? falta : 0; };
  async function repartir() {
    const libres0 = libresAhora(), p0 = plan(leer(), libres0, cfg.pesos, MINIMO_POR_COMANDO);
    const cmds = CLAVES.filter((k) => p0[k] > 0); if (!cmds.length) return;
    const grande = libres0 > 100;
    if (grande) L('repartiendo ' + libres0 + ': ' + cmds.map((k) => COMANDO[k] + ' ' + p0[k]).join(' · '));
    const cmdsDe = (lb, minCmd = MINIMO_POR_COMANDO) => { const fc = faltaCmd(lb), p = plan(leer(), lb - fc, cfg.pesos, minCmd), out = CLAVES.filter((k) => p[k] > 0).map((k) => ({ k, n: p[k] })); if (fc > 0) { cmdApartadoT = Date.now(); out.push({ k: 'cmd', n: fc }); L('Comando: aparto ' + fc + ' puntos para /cmd'); } return out; };
    const tIni = Date.now();
    const r = await repartirRobusto(cmdsDe, { activo: () => cfg.on, maxMs: 240000, log: L, minSiguientes: umbral() });
    total += r.puestos; const s = leer();
    if (r.puestos > 0) {
      fallas = 0; estado = 'ok · STR ' + s.str + ' AGI ' + s.agi + ' STA ' + s.vit + ' ENG ' + s.ene + (r.libres ? ' (quedan ' + r.libres + ' libres)' : '');
      if (grande) { L('listo en ' + Math.round((Date.now() - tIni) / 100) / 10 + ' s: ' + estado); enviar('stats_auto', 'Auto-stats: repartí ' + r.puestos + ' de ' + libres0 + ' puntos en ' + Math.round((Date.now() - tIni) / 1000) + ' s. ' + estado, false); }
    } else if (cfg.on) {
      fallas++; pausaHasta = Date.now() + 4000; estado = 'sin progreso (' + fallas + ' vez/veces): reintento en 4 s'; L(estado);
      if (fallas === 1 || fallas === 6) enviar('stats_auto', 'Auto-stats: no pude sumar puntos (ni por chat ni con el botón +), falla ' + fallas + '. Reintento solo.', fallas >= 6);
    }
  }
  async function tick() {
    if (!cfg.on || ocupado) return;
    if (window.__ciclo && window.__ciclo.activo()) { estado = 'pausado (ciclo de reset andando)'; return; }
    if (call('GetSceneFlag') !== 5 || !(call('GetPlayerLife') > 0) || call('MsgVisible') === 1) return;
    if (Date.now() < pausaHasta) return;
    const libres = libresAhora(), u = umbral();
    estado = 'prendido · ' + libres + ' libres (reparte desde ' + u + ')';
    if (libres < u) return;
    ocupado = true; ultLote = Date.now();
    try { await repartir(); } finally { ocupado = false; }
  }
  setInterval(tick, 300);
  function activar(v) { cfg.on = !!v; fallas = 0; pausaHasta = 0; guardar(); estado = cfg.on ? 'prendido' : 'apagado'; L(cfg.on ? 'ON' : 'OFF'); return cfg.on; }
  function setPesos(str, agi, vit, ene) { cfg.pesos = { str, agi, vit, ene }; guardar(); L('proporción: ' + str + '/' + agi + '/' + vit + '/' + ene); }
  // Mover puntos de un stat a otro con las funciones del propio juego: RequestRemoveStat (el botón "-" de la ventana de puntos, un punto por pedido;
  // el cliente solo deja bajar si el stat está por encima del valor base de la clase) y después /str /agi /sta /ene. Si el servidor se niega (límite de
  // "Decrease" o costo) se frena y los puntos quitados quedan como puntos libres: nunca se pierden. Un pedido cada ~0,3 s.
  async function mover(de, a, n) {
    if (!(de in IDX) || !(a in IDX) || de === a) return { ok: false, motivo: 'stats inválidos (str, agi, vit, ene)' };
    n = n | 0; if (n < 1 || n > 1000) return { ok: false, motivo: 'cantidad inválida (1 a 1000)' };
    if (ocupado) return { ok: false, motivo: 'estoy repartiendo, esperá un momento' };
    ocupado = true; let quitados = 0, motivo = '';
    try {
      // v0.79.2 (pedido: "saca los puntos muy lentos, no se puede acelerar la extracción?"): antes eran tandas de 10 pedidos a 60 ms y se esperaba hasta que el servidor devolviera TODA la tanda (sondeo cada 100 ms,
      // hasta 3 s): ~10 puntos por segundo. Ahora: tandas de hasta 30 pedidos a `remMs` ms (arranca en 35 y se adapta: si el servidor devuelve toda la tanda baja de a 5 ms hasta 20; si devuelve solo una parte sube 20 ms y
      // reintenta lo que falta SIN abortar; si no devuelve nada en 1,2 s es el límite de "Decrease" (113) o el costo y se frena). El sondeo es cada 40 ms. Los puntos quitados quedan libres hasta aplicar(): nunca se pierden.
      let ms = ASIG.remMs || 35, parciales = 0;
      while (quitados < n) {
        const disponible = (call(LEER[de]) | 0) - BASE[de];
        if (disponible <= 0 || !(call('CanRemoveStat', IDX[de]) > 0)) { motivo = de.toUpperCase() + ' ya está en su valor base'; break; }
        const tanda = Math.min(30, n - quitados, disponible), antes = call('GetPlayerLevelUpPoints') | 0;
        for (let i = 0; i < tanda; i++) { call('RequestRemoveStat', IDX[de]); await dormirE(ms); }
        let ganados = 0, ult = -1, tSin = Date.now();
        for (;;) {
          ganados = (call('GetPlayerLevelUpPoints') | 0) - antes; if (ganados >= tanda) break;
          if (ganados !== ult) { ult = ganados; tSin = Date.now(); } else if (Date.now() - tSin > 1200 * ESC) break;
          await dormirE(40);
        }
        quitados += Math.max(0, ganados);
        if (ganados >= tanda) { parciales = 0; ms = Math.max(20, ms - 5); }
        else if (ganados > 0 && ++parciales <= 4) { ms = Math.min(120, ms + 20); await dormirE(400); continue; }      // el servidor tiró algunos pedidos por ir muy rápido: más despacio y sigo con lo que falta
        else { motivo = ganados > 0 ? 'el servidor devuelve de a poco aun despacio (' + ganados + ' de ' + tanda + ')' : 'el servidor no devolvió nada (límite de "Decrease" o costo)'; break; }
      }
      ASIG.remMs = ms;
      let puestos = 0;
      if (quitados > 0) { const antesLibres = call('GetPlayerLevelUpPoints') | 0; if (await aplicar(a, quitados)) puestos = antesLibres - (call('GetPlayerLevelUpPoints') | 0); else motivo += ' · no pude reasignar: quedaron puntos libres'; }
      L('mover ' + de + ' -> ' + a + ': quitados ' + quitados + ', puestos ' + puestos + (motivo ? ' · ' + motivo : ''));
      return { ok: quitados > 0, quitados, puestos, libres: call('GetPlayerLevelUpPoints') | 0, motivo };
    } finally { ocupado = false; }
  }
  // Daño por hechizo estimado (fórmulas de OpenMU): promedio(min,max) x multiplicador de habilidad. W = lo que aporta el equipo (~457 medido en tu pantalla).
  const danoEstimado = (st = leer()) => Math.round((st.str * 0.2274 + st.ene * 0.1137 + 251) * (2 + st.ene / 2000));     // ajustado con las hojas de personaje del 397 y 398 (daño relativo, no el número de la pantalla)
  window.__stats = {
    danoEstimado,
    setCmd: (n) => { cfg.cmdPuntos = Math.max(0, Math.min(5000, n | 0)); guardar(); return cfg.cmdPuntos; }, cmdPuntos: () => cfg.cmdPuntos,
    mover, repartirRobusto, sumar, asignacion: () => ({ ...ASIG, cmd_meta: cfg.cmdPuntos, cmd_actual: statAhora('cmd'), cmd_falta_ahora: faltaCmd(libresAhora()), boton_vivo: botonVivo(), ultimas_rondas: rondasLog.slice(-40) }), setEscala: (x) => { ESC = +x > 0 ? +x : 1; },
    plan, cfg, TOPES, proporcionRecomendada: () => { setPesos(PESOS_V2.str, PESOS_V2.agi, PESOS_V2.vit, PESOS_V2.ene); return cfg.pesos; }, activar, setPesos, bitacora: () => bitacora, tick,
    setMinimo: (n) => { cfg.minimo = Math.max(1, n | 0); cfg.minimoManual = true; guardar(); },
    resumen: () => (cfg.on ? 'Auto-stats ' + estado : ''),
    texto: () => 'Auto-stats ' + (cfg.on ? 'ON' : 'OFF') + ' · proporción STR ' + cfg.pesos.str + ' AGI ' + cfg.pesos.agi + ' STA ' + cfg.pesos.vit + ' ENG ' + cfg.pesos.ene + ' · reparte desde ' + umbral() + ' libres · puestos en esta sesión: ' + total + ' · daño por hechizo estimado ≈ ' + danoEstimado() + ' · ' + estado,
  };
})();
