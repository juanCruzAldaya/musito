// Ciclo de reset (APAGADO de fábrica; se prende con un botón del Laboratorio y se corta con otro).
// La ETAPA se decide por el nivel (sin estado guardado), así aguanta morir, recargar la página o una falla a medio camino:
//   nivel < 15            -> ARAÑAS (Lorencia, caminando al spot guardado)      farmea el Helper del juego
//   15 .. hasta que el /move permita Aida (nivel 100; si Aida no está en el /move, hasta TorrePerdida7 a nivel 46) -> DEVIAS 3
//   ese nivel .. 399      -> LOST TOWER 7                                         farmea el PILOTO
//   400                   -> RESET (/reset, sin cartel) y después REPARTIR PUNTOS
// Solo usa lo que ya usamos: el /move del juego (RequestWarp), comandos de chat (/reset, /str /agi /sta /ene), el Helper y el piloto.
// Modo "paso a paso" (por defecto): antes de cada acción importante espera que toques "Confirmar paso".
(() => {
  'use strict';
  // Recarga en caliente: los intervalos se registran para poder cortarlos al reinyectar el módulo sin recargar la página (ver background.js)
  const setInterval = (f, ms) => { const id = window.setInterval(f, ms); (window.__muIds = window.__muIds || []).push(id); return id; };
  const M = () => window.Module;
  const call = (n, ...a) => { try { const f = M()['_MuWeb' + n]; return typeof f === 'function' ? f(...a) : null; } catch (e) { return null; } };
  const str = (n, ...a) => { try { const f = M()['_MuWeb' + n], p = f(...a) | 0; return p ? M().UTF8ToString(p) : ''; } catch (e) { return ''; } };
  const cfg = {
    escala: 1,                 // para pruebas: multiplica todas las esperas
    tope: 1,                   // cuántos resets hacer antes de parar solo
    auto: false,               // false = paso a paso (pide confirmar cada acción importante)
    // Modo de farmeo por etapa: 'helper' (Helper del juego) · 'sostener' (habilidad mantenida del juego: medido 2,5 hechizos/s sin moverse) · 'auto' · 'piloto'
    usarAida: true,            // etapa "Lost Tower 7" (nivel 46-399): si el /move deja ir a Aida y hay spot (por defecto el de la caja 41), farmea ahí en vez de Lost Tower 7
    modoFarmeo: { aranas: 'sostener', devias3: 'sostener', lt7: 'sostener' },
    nivelReset: 400, nivelAranas: 15,
    quedarseEn: 210,           // si después del reset seguís en este mapa (caja 10: el reset hecho en el 210 no teletransportó y se llegó del 1 al 287 en 66 s) NO se viaja ni se camina: se reparte y se farmea ahí mismo (0 = como antes)
    sim: false, simKills: 3, limiteSim: 240000,   // simulación: cada etapa termina al matar 'simKills' bichos (o a los 4 min)
    // Reparto después del reset: en este orden hasta llegar al total; lo que sobra va todo a STR
    objetivos: [['agi', 2650], ['ene', 3600], ['vit', 700], ['str', 0]],   // después del reset: AGI 2650, ENE 3600, VIT 700 y el resto a STR (~3100); los ~2800 puntos de subir de nivel siguen la proporción del Auto-stats y dejan ~STR 4250 · ENE 5000 · STA 960 a nivel 400
  };
  const COMANDO = { str: '/str', agi: '/agi', vit: '/sta', ene: '/ene', cmd: '/cmd' };
  const LEER = { str: 'GetPlayerStrength', agi: 'GetPlayerDexterity', vit: 'GetPlayerVitality', ene: 'GetPlayerEnergy', cmd: 'GetPlayerCommand' };
  const dormir = (ms) => new Promise((r) => setTimeout(r, Math.max(5, ms * cfg.escala)));
  const enviar = (clave, texto, grave) => window.postMessage({ __muvigia: true, clave, texto: String(texto).slice(0, 280), grave: !!grave }, '*');
  const L = (t) => { bitacora.push({ t: Date.now(), txt: t }); if (bitacora.length > 300) bitacora.shift(); if (window.__piloto && window.__piloto.nota) window.__piloto.nota('CICLO', t); };
  const bitacora = [];
  let repartiendoBG = false, on = false, etapa = '-', pendiente = null, confirmado = false, resetsHechos = 0, estado = 'apagado', ultChat = 0, ultWarp = 0, fallasWarp = 0, ultPuntos = 0, ultPiloto = 0, entroEtapa = 0, ocupado = false, simEtapa = 'inicio', simBase = null, inicial = null, reaparecio = false;

  // ---------------- funciones puras (se prueban solas) ----------------
  // actual: {str,agi,vit,ene}, libres: puntos sin repartir, objetivos: [[stat,total],...]. Devuelve los comandos a mandar, en orden.
  function planPuntos(actual, libres, objetivos) {
    const cmds = []; let resto = libres;
    for (const [k, total] of objetivos) {
      const falta = Math.max(0, total - (actual[k] || 0)), n = Math.min(falta, resto);
      if (n > 0) { cmds.push({ k, n }); resto -= n; }
    }
    if (resto > 0) cmds.push({ k: 'str', n: resto, resto: true });
    return cmds;
  }
  // Puntos de subir de nivel (pocos): se reparten con la proporción del Auto-stats (stats.js), no todo a STR. Después del reset (muchos) se usan los objetivos.
  function planNivel(actual, libres, minCmd = 4) {
    const S = window.__stats; if (!S || !S.plan) return planPuntos(actual, libres, cfg.objetivos);
    const p = S.plan(actual, libres, S.cfg.pesos, minCmd);
    return ['str', 'agi', 'vit', 'ene'].filter((k) => p[k] > 0).map((k) => ({ k, n: p[k] }));
  }
  function etapaPara(nivel, ltPuede, actual) {
    if (nivel >= cfg.nivelReset) return 'reset';
    if (nivel < cfg.nivelAranas) return 'aranas';
    if (!ltPuede && actual !== 'lt7') return 'devias3';
    return 'lt7';
  }

  // ---------------- utilidades del juego ----------------
  const leerStats = () => ({ str: call('GetPlayerStrength'), agi: call('GetPlayerDexterity'), vit: call('GetPlayerVitality'), ene: call('GetPlayerEnergy'), cmd: call('GetPlayerCommand') });
  async function esperar(cond, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms * cfg.escala) { if (!on) return false; if (cond()) return true; await dormir(150); } return cond(); }
  async function chat(texto) {
    const esp = 1300 * cfg.escala - (Date.now() - Math.max(ultChat, window.__muUltChat || 0)); if (esp > 0) await new Promise((r) => setTimeout(r, esp));      // el límite entre mensajes se comparte con stats.js
    ultChat = window.__muUltChat = Date.now(); let ptr = 0;
    try { ptr = window.muAllocateUtf8(texto); return M()._MuWebSubmitChatUtf8(ptr, 0, 0) === 1; } catch (e) { return false; }
    finally { try { if (ptr) M()._free(ptr); } catch (e) { /* nada */ } }
  }
  function listaMove() {
    const n = call('GetMoveListCount') | 0, out = [];
    for (let i = 0; i < n; i++) out.push({ i, nombre: str('GetMoveListNameUtf8', i), nivel: call('GetMoveListReqLevel', i), zen: call('GetMoveListReqZen', i), puede: call('GetMoveListCanMove', i) === 1 });
    return out;
  }
  const buscarWarp = (nombre) => {
    const n = nombre.toLowerCase(), l = listaMove(), base = (w) => w.nombre.split(' - ')[0].trim().toLowerCase();
    return l.find((w) => base(w) === n) || l.find((w) => base(w).startsWith(n)) || l.find((w) => w.nombre.toLowerCase().includes(n));
  };
  // Spot de farmeo de Aida (mapa 33): zona (201-216, 31-36) medida en la caja negra; se puede reemplazar guardando el spot parado en el lugar
  const SPOTS_POR_DEFECTO = { aida: { mapa: 33, x: 209, y: 32 } };
  const spots = () => ({ ...SPOTS_POR_DEFECTO, ...(window.__etapas ? window.__etapas.todo() : {}) });

  // En modo paso a paso espera el botón "Confirmar paso"; en automático sigue de largo.
  async function confirmar(texto) {
    L('PRÓXIMO: ' + texto + (cfg.auto ? ' (automático)' : ' — esperando tu confirmación'));
    if (cfg.auto) return true;
    pendiente = texto; confirmado = false;
    while (on && !confirmado) await dormir(200);
    const ok = confirmado; pendiente = null; confirmado = false; return ok && on;
  }

  // ---------------- acciones ----------------
  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const aquí = () => ({ x: call('GetHeroX'), y: call('GetHeroY') });
  const DESTINO = { aranas: ['Lorencia', 'arana'], devias3: ['Devias3', 'devias3'], lt7: ['TorrePerdida7', 'lt7'] };
  async function viajar(nombre, mapaEsperado) {
    const w = buscarWarp(nombre);
    if (!w) { enviar('ciclo_falla', 'Ciclo: no encuentro "' + nombre + '" en el /move.', true); return false; }
    if (!w.puede) { L('no puedo viajar a ' + nombre + ' (nivel pedido ' + w.nivel + ', Zen ' + w.zen + ')'); return false; }
    if (Date.now() - ultWarp < 20000 * cfg.escala) return false;   // enfriamiento entre viajes
    if (!(await confirmar('viajar a ' + nombre))) return false;
    const mapaAntes = call('GetMapIndex'), posAntes = aquí();
    if (window.__modo) window.__modo.fijar('manual', 'ciclo: viajando');
    ultWarp = Date.now(); call('RequestWarp', w.i); if (window.__muUltWarp) window.__muUltWarp.propio = true;      // un /move del script no enseña nada (solo los del usuario)
    // si ya estoy en el mapa de destino (ej. Lost Tower 1 -> 7 es el mismo mapa) espero a que cambie la posición
    const ok = await esperar(() => call('GetMapIndex') === mapaEsperado && (mapaAntes !== mapaEsperado || dist(aquí(), posAntes) > 3), 12000);
    if (ok) { fallasWarp = 0; await dormir(2000); } else if (++fallasWarp >= 3) { enviar('ciclo_falla', 'Ciclo: 3 viajes seguidos a ' + nombre + ' sin llegar. Lo detengo.', true); detener('viajes fallidos'); }
    return ok;
  }
  // ---- caminos grabados (los recorridos no son rectos: se camina una vez a mano y después se imita) ----
  const KEY_RUTAS = 'muRutasV1', NOM_RUTA = { arana: 'arañas', devias3: 'Devias 3', lt7: 'Lost Tower 7', aida: 'Aida', mispot: 'Mi spot' };
  const leerRutas = () => { try { return JSON.parse(localStorage.getItem(KEY_RUTAS) || '{}'); } catch (e) { return {}; } };
  let grab = null;
  function grabarRuta(clave) {
    if (grab) return { ok: false, motivo: 'ya estoy grabando ' + grab.clave };
    const p = aquí(), mapa = call('GetMapIndex');
    grab = { clave, mapa, pts: [p], timer: null };
    grab.timer = setInterval(() => {
      if (call('GetMapIndex') !== grab.mapa) return;
      const q = aquí(); if (dist(q, grab.pts[grab.pts.length - 1]) >= 2) grab.pts.push(q);
    }, 200);
    return { ok: true, mapa, x: p.x, y: p.y };
  }
  function pararRuta() {
    if (!grab) return { ok: false, motivo: 'no estaba grabando' };
    clearInterval(grab.timer); const q = aquí();
    if (dist(q, grab.pts[grab.pts.length - 1]) >= 1) grab.pts.push(q);
    const r = leerRutas(); r[grab.clave] = { mapa: grab.mapa, pts: grab.pts, hora: new Date().toISOString() };
    try { localStorage.setItem(KEY_RUTAS, JSON.stringify(r)); } catch (e) { /* nada */ }
    const o = { ok: true, clave: grab.clave, puntos: grab.pts.length, inicio: grab.pts[0], fin: grab.pts[grab.pts.length - 1] }; grab = null; return o;
  }
  const textoRutas = () => Object.entries(NOM_RUTA).map(([k, n]) => { const r = leerRutas()[k]; return n + ': ' + (r ? r.pts.length + ' puntos (mapa ' + r.mapa + ')' : 'sin camino'); }).join(' · ');

  // Sigue el camino grabado punto por punto. Si arranca lejos del inicio, engancha en el punto más cercano. Sin camino: línea recta (con aviso).
  async function caminarA(sp, clave) {
    const Mv = window.__mover; if (!Mv || !Mv.tabla()) { L('falta calibrar el movimiento: no puedo caminar'); return false; }
    const ruta = (leerRutas()[clave] || {}), pts = ruta.mapa === call('GetMapIndex') && ruta.pts && ruta.pts.length > 1 ? ruta.pts : null;
    // con camino grabado, llegar al último punto cuenta como llegar (tu camino terminó a veces a 5 casillas del spot guardado)
    const tol = pts ? Math.max(3, dist(pts[pts.length - 1], sp)) : 3, lejos = () => dist(aquí(), sp) > tol;
    if (!lejos()) return true;
    if (!pts) L('no hay camino grabado de ' + (NOM_RUTA[clave] || clave) + ' para este mapa: voy en línea recta (puede chocar)');
    if (!(await confirmar('caminar a ' + (NOM_RUTA[clave] || 'el spot') + ' (' + sp.x + ',' + sp.y + ')' + (pts ? ' por el camino grabado (' + pts.length + ' puntos)' : ' en línea recta')))) return false;
    if (window.__modo) window.__modo.fijar('manual', 'ciclo: caminando');
    let idx = 0;
    if (pts) { const p = aquí(); if (dist(p, pts[0]) > 6) { let mj = 1e9; pts.forEach((q, j) => { const d = dist(p, q); if (d < mj) { mj = d; idx = j; } }); } }
    const t0 = Date.now(); let ultPos = aquí(), ultMov = Date.now(), saltos = 0, rodeo = 0;
    while (on && lejos() && Date.now() - t0 < 120000 * cfg.escala) {
      const p = aquí(), objetivo = pts ? pts[Math.min(idx, pts.length - 1)] : sp;
      if (pts && dist(p, objetivo) <= 1 && idx < pts.length - 1) { idx++; continue; }
      if (pts && idx >= pts.length - 1 && dist(p, objetivo) <= 1) break;   // terminó el camino
      Mv.paso(objetivo.x, objetivo.y, 1); await dormir(200);
      const q = aquí();
      if (q.x !== ultPos.x || q.y !== ultPos.y) { ultPos = q; ultMov = Date.now(); rodeo = 0; }
      else {
        const parado = Date.now() - ultMov;
        if (parado > 6000 * cfg.escala) {
          if (pts && idx < pts.length - 1 && saltos < 3) { saltos++; idx++; ultMov = Date.now(); L('trabado en ' + q.x + ',' + q.y + ': salto al punto ' + idx + ' del camino'); continue; }
          Mv.parar(); enviar('ciclo_falla', 'Ciclo: me trabé caminando en ' + q.x + ',' + q.y + '. Sigo donde estoy.', true); return false;
        } else if (parado > 1200 * cfg.escala && Mv.pasoAlt) {
          // contra una pared (pasa cuando el reset te deja detrás del primer punto del camino): probar las direcciones vecinas y retomar
          if (!rodeo) L('trabado en ' + q.x + ',' + q.y + ': pruebo rodear');
          Mv.pasoAlt(objetivo.x, objetivo.y, 1 + (rodeo++ % 2)); await dormir(600);
          const q2 = aquí(); if (q2.x !== ultPos.x || q2.y !== ultPos.y) { ultPos = q2; ultMov = Date.now(); rodeo = 0; }
        }
      }
    }
    Mv.parar(); return !lejos();
  }
  // Todo el control del Helper/piloto pasa por el árbitro (modo.js)
  function farmear(et) {
    const Mo = window.__modo; if (!Mo) return;
    if (Mo.deseado() === 'pelea') return;      // contraataque a un jugador en curso (agresor.js): no le saca el control
    const quiere = cfg.modoFarmeo[et] || 'helper';
    if (quiere === 'helper') { if (Mo.deseado() !== 'helper' || (!Mo.helperOn() && call('HelperIsSafeZone') !== 1)) Mo.fijar('helper', 'ciclo: ' + et); return; }
    if (Mo.deseado() === quiere) return;                       // ya está en el modo pedido
    if (Mo.bloqueado()) { if (Mo.deseado() === 'manual') Mo.fijar('helper', 'ciclo: motor bloqueado'); return; }   // vida baja hace poco: sigue el Helper
    if (Date.now() - ultPiloto < 15000 * cfg.escala) { if (Mo.deseado() === 'manual') Mo.fijar('helper', 'ciclo: espera'); return; }
    ultPiloto = Date.now(); const r = Mo.fijar(quiere, 'ciclo: ' + et); if (!r.ok) L('el modo ' + quiere + ' no arrancó: ' + r.motivo + ' (sigue el Helper)');
  }
  async function repartir() {
    let libres = call('GetPlayerLevelUpPoints') | 0; if (libres <= 0) return true;
    const grande = libres > 100;      // después del reset: objetivos; subiendo de nivel: proporción del Auto-stats
    // Cada reset da +625 puntos más que el anterior (10.625 -> 11.250 en las cajas 8 y 10): con objetivos fijos todo el crecimiento iba a STR, así que también los puntos grandes siguen la proporción del Auto-stats (STR 33 · AGI 21 · STA 7,5 · ENE 39 %, AGI con tope 2650)
    const plan = (lb, minCmd) => planNivel(leerStats(), lb, minCmd);
    const cmds0 = plan(libres); if (!cmds0.length) return true;
    const resumen = cmds0.map((c) => COMANDO[c.k] + ' ' + c.n).join(' · ');
    // los repartos chicos (+7 por nivel) salen continuos y no piden confirmación ni mandan aviso: solo el grande del reset
    if (grande && !(await confirmar('repartir ' + libres + ' puntos: ' + resumen))) return false;
    // Asignación continua y robusta (stats.js): hasta 48 puntos con el botón +, más por chat (un comando por stat); si el chat rechaza el botón + sigue; nunca se frena en un eslabón.
    if (window.__stats && window.__stats.repartirRobusto) {
      const S = window.__stats; if (S.setEscala) S.setEscala(cfg.escala);
      const tIni = Date.now(), r = await S.repartirRobusto(plan, { activo: () => on, maxMs: 240000, log: L, minSiguientes: 7 });
      const s = leerStats(), quedan = call('GetPlayerLevelUpPoints') | 0;
      if (grande) {
        L('puntos repartidos en ' + Math.round((Date.now() - tIni) / 100) / 10 + ' s: str ' + s.str + ' agi ' + s.agi + ' vit ' + s.vit + ' ene ' + s.ene + (quedan ? ' (sobraron ' + quedan + ')' : '') + ' · rondas ' + r.rondas);
        enviar('ciclo_puntos', 'Ciclo: puntos repartidos. Stats: STR ' + s.str + ' AGI ' + s.agi + ' VIT ' + s.vit + ' ENE ' + s.ene + (quedan ? '. Sobraron ' + quedan + ' libres.' : '.'), false);
      }
      return true;
    }
    // Éxito = el stat SUBIÓ (o bajaron los puntos libres). Mirar solo los libres fallaba al subir de nivel: entran +7 puntos justo mientras se gastan
    // los otros y el número no baja. Un fallo NO apaga el ciclo (en la caja 51 lo apagó en las arañas a nivel 16 sin llegar a viajar): se posterga el
    // reparto 1 minuto y el ciclo sigue. Tampoco puede tragarse más de 45 s seguidos: el viaje de etapa no espera.
    const tIni = Date.now(); let fallos = 0, cortado = false;
    for (let ronda = 0; ronda < 15 && on; ronda++) {
      if (Date.now() - tIni > 45000 * cfg.escala) { L('el reparto lleva más de 45 s: sigo con el ciclo y lo retomo después'); cortado = true; break; }
      libres = call('GetPlayerLevelUpPoints') | 0; if (libres <= 0) break;
      if (ronda > 0 && libres < 28) break;      // los puntos que siguen entrando por subir de nivel quedan para el próximo lote (si no, se persigue el +7 sin fin)
      const cmds = plan(libres); if (!cmds.length) break;
      const c = cmds[0], antes = libres, statAntes = call(LEER[c.k]) | 0;
      const aceptado = await chat(COMANDO[c.k] + ' ' + c.n);
      const ok = await esperar(() => (call(LEER[c.k]) | 0) > statAntes || (call('GetPlayerLevelUpPoints') | 0) < antes, aceptado ? 8000 : 2500);
      if (!ok) {
        L('el comando ' + COMANDO[c.k] + ' ' + c.n + (aceptado ? ' no cambió nada' : ' no lo aceptó el chat') + ' (fallo ' + (fallos + 1) + ' de 3)');
        if (++fallos >= 3) {
          ultPuntos = Date.now() + 30000 * cfg.escala;      // vuelve a intentar en ~1 minuto
          enviar('ciclo_falla', 'Ciclo: no pude repartir puntos (' + COMANDO[c.k] + ' ' + c.n + ', libres ' + antes + '). Sigo con el ciclo y reintento en 1 min.', true);
          return true;
        }
        await dormir(aceptado ? 1500 : 2500); continue;
      }
      fallos = 0; await dormir(2500);   // dejar que terminen de llegar las actualizaciones
    }
    if (cortado) ultPuntos = Date.now() - 20000 * cfg.escala;   // retoma en unos 10 s
    const s = leerStats(), quedan = call('GetPlayerLevelUpPoints') | 0;
    L('puntos repartidos: str ' + s.str + ' agi ' + s.agi + ' vit ' + s.vit + ' ene ' + s.ene + (quedan ? ' (sobraron ' + quedan + ')' : ''));
    enviar('ciclo_puntos', 'Ciclo: puntos repartidos. Stats: STR ' + s.str + ' AGI ' + s.agi + ' VIT ' + s.vit + ' ENE ' + s.ene + (quedan ? '. Sobraron ' + quedan + ' libres.' : '.'), false);
    return true;
  }
  async function hacerReset() {
    if (window.__modo) window.__modo.fijar('manual', 'ciclo: reset');
    await dormir(2000);
    const antes = { nivel: call('GetPlayerLevel'), s: leerStats() };
    if (!(await confirmar('resetear (/reset) a nivel ' + antes.nivel))) return false;
    for (let intento = 1; intento <= 2; intento++) {
      await chat('/reset');
      if (await esperar(() => call('GetPlayerLevel') < 50, 12000)) {
        resetsHechos++; entroEtapa = Date.now();
        const s = leerStats();
        L('RESET #' + resetsHechos + ': nivel ' + antes.nivel + ' -> ' + call('GetPlayerLevel') + ' · mapa ' + call('GetMapIndex') + ' · puntos libres ' + call('GetPlayerLevelUpPoints') + ' · stats ahora str ' + s.str + ' agi ' + s.agi + ' vit ' + s.vit + ' ene ' + s.ene);
        enviar('ciclo_reset', 'Ciclo: reset #' + resetsHechos + ' hecho (nivel ' + antes.nivel + ' -> ' + call('GetPlayerLevel') + '). Puntos libres: ' + call('GetPlayerLevelUpPoints') + '.', false);
        await dormir(2500);
        return true;
      }
      L('el /reset no bajó el nivel (intento ' + intento + ')');
    }
    enviar('ciclo_falla', 'Ciclo: el /reset no funcionó (nivel ' + call('GetPlayerLevel') + '). Detengo el ciclo.', true); detener('el reset no funcionó');
    return false;
  }


  // ---------------- SIMULACIÓN (sin resetear de verdad) ----------------
  // 1) el "reset" se simula viajando a Lorencia con el /move del juego (a nivel 1 es adonde caés)
  // 2) cada etapa termina al matar 3 bichos (arañas, Devias 3) en vez de subir de nivel
  // 3) vuelve al punto de Lost Tower 7 y deja el Helper y el piloto como estaban al arrancar. NO manda comandos de puntos.
  function muertes() {
    const P = window.__paquetes, B = window.__bichos;
    return { exp: P ? P.cuenta('rx', 'C3:0x16') : 0, cerca: B && B.validacion ? (B.validacion().c17cerca || 0) : 0 };
  }
  const matadas = () => { const a = muertes(), b = simBase || a; return Math.max(a.exp - b.exp, a.cerca - b.cerca); };
  const entrarSim = (nueva) => { L('SIMULACIÓN: etapa ' + simEtapa + ' -> ' + nueva); enviar('ciclo_etapa', 'Simulación: etapa ' + nueva + '.', false); simEtapa = nueva; simBase = muertes(); entroEtapa = Date.now(); };
  async function pasoSim() {
    const sp = spots(), mapa = call('GetMapIndex');
    estado = 'SIMULACIÓN · ' + simEtapa + (simEtapa === 'aranas' || simEtapa === 'devias3' ? ' (' + matadas() + '/' + cfg.simKills + ' matados)' : '');
    if (simEtapa === 'inicio') {
      if (window.__modo) window.__modo.fijar('manual', 'ciclo: simulación');
      const s = leerStats(), libres = call('GetPlayerLevelUpPoints') | 0, cmds = planPuntos(s, libres, cfg.objetivos);
      L('SIMULACIÓN del reparto (no se manda nada): ' + (cmds.length ? cmds.map((x) => COMANDO[x.k] + ' ' + x.n).join(' · ') : 'no haría falta repartir (stats ya en el objetivo, ' + libres + ' libres)'));
      if (mapa === 0 || await viajar('Lorencia', 0)) entrarSim('aranas');
      return;
    }
    if (simEtapa === 'aranas') {
      if (mapa !== 0) { await viajar('Lorencia', 0); return; }
      if (!simBase.camino) { simBase.camino = true; await caminarA(sp.arana, 'arana'); }
      farmear('aranas');
      if (matadas() >= cfg.simKills) entrarSim('devias3');
      else if (Date.now() - entroEtapa > cfg.limiteSim * cfg.escala) { enviar('ciclo_falla', 'Simulación: no llegué a ' + cfg.simKills + ' muertes en las arañas (' + matadas() + '). Sigo con Devias 3.', true); entrarSim('devias3'); }
      return;
    }
    if (simEtapa === 'devias3') {
      if (mapa !== sp.devias3.mapa) { await viajar('Devias3', sp.devias3.mapa); return; }
      if (!simBase.camino) { simBase.camino = true; await caminarA(sp.devias3, 'devias3'); }
      farmear('devias3');
      if (matadas() >= cfg.simKills) entrarSim('lt7');
      else if (Date.now() - entroEtapa > cfg.limiteSim * cfg.escala) { enviar('ciclo_falla', 'Simulación: no llegué a ' + cfg.simKills + ' muertes en Devias 3 (' + matadas() + '). Sigo con Lost Tower 7.', true); entrarSim('lt7'); }
      return;
    }
    if (simEtapa === 'lt7') {
      if (mapa !== sp.lt7.mapa) { await viajar('TorrePerdida7', sp.lt7.mapa); return; }
      await caminarA(sp.lt7, 'lt7');
      const hecho = Math.max(Math.abs(call('GetHeroX') - sp.lt7.x), Math.abs(call('GetHeroY') - sp.lt7.y)) <= 3;
      L('SIMULACIÓN terminada: ' + (hecho ? 'estoy en el punto de Lost Tower 7 (' + call('GetHeroX') + ',' + call('GetHeroY') + ')' : 'llegué al mapa de Lost Tower 7 pero a ' + call('GetHeroX') + ',' + call('GetHeroY') + ', lejos del spot'));
      const ini = inicial; detener('simulación terminada');
      if (ini && window.__modo) { await dormir(1500); window.__modo.fijar(ini.piloto ? 'piloto' : ini.helper ? 'helper' : 'manual', 'fin de simulación'); }
      return;
    }
  }



  // Dónde se farmea en cada etapa: en "lt7" (nivel 46-399) es Aida si cfg.usarAida y el /move la permite; si no, Lost Tower 7
  // Si hay un camino grabado de Aida, el destino es el FINAL del camino (aunque el spot guardado esté mal puesto, ej. donde caés con el /move)
  function spotDe(clave) {
    const r = leerRutas()[clave];
    if (clave === 'aida' && r && r.pts && r.pts.length > 1) { const u = r.pts[r.pts.length - 1]; return { mapa: r.mapa, x: u.x, y: u.y }; }
    return spots()[clave];
  }
  function destino(et) {
    if (et === 'lt7' && cfg.usarAida) { const w = buscarWarp('Aida'), sp = spotDe('aida'); if (w && w.puede && sp) return { clave: 'aida', warp: 'Aida', sp, nombre: 'Aida' }; }
    const clave = { aranas: 'arana', devias3: 'devias3', lt7: 'lt7' }[et];
    return { clave, warp: (DESTINO[et] || [])[0], sp: spots()[clave], nombre: NOM_RUTA[clave] || clave };
  }
  let ultAnclaMapa = -1;

  // ---------------- IR AL SPOT ----------------
  // /move al mapa del spot -> camina (camino grabado si lo hay) hasta el punto -> deja el ancla ahí -> prende Sostenida. Se corta con "OFF" del ciclo, Nada o Helper.
  const NOMBRE_WARP = { aida: 'Aida' };
  async function irAlSpot(clave = 'aida', avisarFn = null) {
    if (on) return { ok: false, motivo: 'el ciclo ya está andando: apagalo primero (botón OFF del ciclo)' };
    const sp = spotDe(clave); if (!sp) return { ok: false, motivo: 'no hay spot guardado para ' + clave };
    const aviso = (t) => { L('IR AL SPOT: ' + t); if (avisarFn) avisarFn(t); };
    if (!window.__mover || !window.__mover.tabla || !window.__mover.tabla()) return { ok: false, motivo: 'falta calibrar el movimiento (Mover: calibrar)' };
    const autoAntes = cfg.auto, simAntes = cfg.sim;
    on = true; cfg.auto = true; cfg.sim = false; ultWarp = 0; fallasWarp = 0; estado = 'yendo al spot ' + (NOM_RUTA[clave] || clave);
    try {
      if (window.__modo) window.__modo.fijar('manual', 'ir al spot');
      if (call('GetMapIndex') !== sp.mapa) {
        const w = buscarWarp(NOMBRE_WARP[clave] || clave);
        if (!w) return { ok: false, motivo: 'no encuentro "' + (NOMBRE_WARP[clave] || clave) + '" en la lista del /move' };
        aviso('viajo a ' + w.nombre + ' (/move)');
        let ok = false;
        for (let i = 0; i < 3 && on && !ok; i++) { ok = await viajar(NOMBRE_WARP[clave] || clave, sp.mapa); if (!ok && on) await dormir(6000); ultWarp = 0; }
        if (!ok) return { ok: false, motivo: 'no pude viajar (¿Zen, nivel o el cartel del /move?)' };
      }
      aviso('camino al spot (' + sp.x + ',' + sp.y + ')' + (leerRutas()[clave] ? ' por el camino grabado' : ' en línea recta (grabá el camino en el Laboratorio para que no choque)'));
      const llego = await caminarA(sp, clave);
      if (!on) return { ok: false, motivo: 'cortado por vos' };
      if (!llego) return { ok: false, motivo: 'no llegué al punto (' + call('GetHeroX') + ',' + call('GetHeroY') + '): grabá el camino de ese spot' };
      if (window.__modo) window.__modo.fijar('sostener', 'botón (ir al spot)');   // el ancla la elige modo.js con los datos de respawn
      aviso('listo: en el spot con Sostenida y ancla');
      enviar('ciclo_etapa', 'Llegué al spot ' + (NOM_RUTA[clave] || clave) + ' (' + call('GetHeroX') + ',' + call('GetHeroY') + ') y prendí Sostenida.', false);
      return { ok: true, x: call('GetHeroX'), y: call('GetHeroY') };
    } finally { on = false; cfg.auto = autoAntes; cfg.sim = simAntes; if (window.__mover) window.__mover.parar(); estado = 'apagado'; }
  }

  // ---------------- MI SPOT (v0.75.0) ----------------
  // Pedido: "que vuelva al spot que estoy ahora". Guarda mapa + casilla donde estás parado (+ el nombre del /move de ese mapa si lo encuentra). Al morir (y revivir) vuelve solo: si el mapa es otro hace el /move,
  // camina hasta el spot (por el camino que grabes, o en línea recta con rodeo de paredes), deja el ancla ahí y vuelve a prender el modo que tenías (Sostenida por defecto). En las cajas 20 y 22 el servidor
  // te revive DENTRO del mismo mapa (210 y 37) cerca de (20,218): para no chocar contra paredes conviene grabar el camino una vez (Lab > Mi spot > Grabar camino: desde donde reaparecés hasta el spot).
  const KEY_MISPOT = 'muMiSpotV1', mi = { sp: null, on: true, ocupado: false, estado: '', vueltas: 0, fallas: 0, modo: 'sostener', muertes: [] };
  try { const g = JSON.parse(localStorage.getItem(KEY_MISPOT) || 'null'); if (g) { if (g.sp && g.sp.mapa != null) mi.sp = g.sp; if (typeof g.on === 'boolean') mi.on = g.on; } } catch (e) { /* nada */ }
  const guardarMi = () => { try { localStorage.setItem(KEY_MISPOT, JSON.stringify({ sp: mi.sp, on: mi.on })); } catch (e) { /* nada */ } };
  function nombreMapaActual() { return (str('GetMapNameUtf8', call('GetMapIndex')) || str('GetMapNameUtf8') || '').trim(); }
  // Caja 23: el nombre del mapa 37 es "Kanturu" y el /move que lo matcheaba primero era RuinasKanturu1 (llega a (19,218)), pero el usuario entra por otro /move (RuinasKanturu3: llega a (73,186)).
  // El mismo número de mapa tiene varios /move con puertas distintas: por eso (1) se aprende cuál /move usó el usuario (se mira RequestWarp y el cambio de mapa que sigue) y (2) si hay varios candidatos el Lab pregunta.
  const KEY_WARPMAPA = 'muWarpMapaV1';
  const leerWarpMapa = () => { try { return JSON.parse(localStorage.getItem(KEY_WARPMAPA) || '{}'); } catch (e) { return {}; } };
  try {
    const m0 = M();
    if (m0 && typeof m0._MuWebRequestWarp === 'function' && !m0._MuWebRequestWarp.__mu) {
      const orig = m0._MuWebRequestWarp, w = function (i) { try { window.__muUltWarp = { i, nombre: str('GetMoveListNameUtf8', i), t: Date.now(), mapa: call('GetMapIndex') }; } catch (e) { /* nada */ } return orig.apply(this, arguments); };
      w.__mu = true; m0._MuWebRequestWarp = w;
    }
  } catch (e) { /* nada */ }
  let mapaVisto = -1;
  setInterval(() => {      // si el mapa cambió poco después de un /move (hecho a mano o por el script), se aprende qué /move lleva a ese mapa y dónde se aparece
    const mp = call('GetSceneFlag') === 5 ? call('GetMapIndex') : -1; if (mp < 0) return;
    if (mapaVisto >= 0 && mp !== mapaVisto && window.__muUltWarp && !window.__muUltWarp.propio && Date.now() - window.__muUltWarp.t < 25000) {
      const nom = String(window.__muUltWarp.nombre || '').split(' - ')[0].trim(); if (nom) { const r = leerWarpMapa(); r[mp] = { warp: nom, x: call('GetHeroX'), y: call('GetHeroY'), hora: new Date().toISOString() }; try { localStorage.setItem(KEY_WARPMAPA, JSON.stringify(r)); } catch (e) { /* nada */ } L('aprendí: el /move "' + nom + '" lleva al mapa ' + mp + ' (aparezco en ' + r[mp].x + ',' + r[mp].y + ')'); }
      window.__muUltWarp = null;
    }
    mapaVisto = mp;
  }, 700);
  function candidatosWarp(nombre) {
    try { const n = String(nombre || '').toLowerCase(); if (!n) return []; return [...new Set(listaMove().filter((w) => w.nombre.toLowerCase().includes(n)).map((w) => w.nombre.split(' - ')[0].trim()))]; } catch (e) { return []; }
  }
  function guardarMiSpot() {
    if (call('GetSceneFlag') !== 5) return { ok: false, motivo: 'no estás en el juego' };
    const mapa = call('GetMapIndex'), p = aquí(), nombre = nombreMapaActual();
    const apr = leerWarpMapa()[mapa], candidatos = candidatosWarp(nombre);
    let warp = apr && apr.warp ? apr.warp : null;
    if (!warp) { try { const w = nombre ? buscarWarp(nombre) : null; if (w) warp = w.nombre.split(' - ')[0].trim(); } catch (e) { /* nada */ } }
    mi.sp = { mapa, x: p.x, y: p.y, nombre, warp, aprendido: !!(apr && apr.warp), hora: new Date().toISOString() }; mi.fallas = 0; guardarMi();
    L('MI SPOT guardado: mapa ' + mapa + (nombre ? ' (' + nombre + ')' : '') + ' en (' + p.x + ',' + p.y + ')' + (warp ? ' · /move "' + warp + '"' + (apr ? ' (aprendido de tu último /move a este mapa)' : ' (adivinado por el nombre)') : ' · sin /move conocido') + (candidatos.length > 1 ? ' · candidatos: ' + candidatos.join(', ') : ''));
    return { ok: true, ...mi.sp, candidatos };
  }
  function setMiWarp(nombre) { if (!mi.sp) return { ok: false, motivo: 'primero guardá el spot' }; mi.sp.warp = String(nombre || '').trim() || null; guardarMi(); return { ok: true, warp: mi.sp.warp }; }
  async function volverAMiSpot(porQue, modoVolver) {
    const sp = mi.sp; if (!sp) return { ok: false, motivo: 'no hay "mi spot" guardado' };
    if (on || mi.ocupado) return { ok: false, motivo: 'ya estoy en otra tarea (ciclo / regreso)' };
    if (!window.__mover || !window.__mover.tabla || !window.__mover.tabla()) { mi.estado = 'falta calibrar el movimiento'; return { ok: false, motivo: mi.estado }; }
    mi.ocupado = true; const autoAntes = cfg.auto, simAntes = cfg.sim;
    on = true; cfg.auto = true; cfg.sim = false; window.__pausaVigia = true; ultWarp = 0; fallasWarp = 0; mi.estado = 'volviendo a mi spot (' + porQue + ')';
    const modo = modoVolver && ['sostener', 'pulsos', 'auto'].includes(modoVolver) ? modoVolver : (mi.modo || 'sostener');
    try {
      L('MI SPOT: ' + porQue + ' → vuelvo a ' + sp.mapa + ' (' + sp.x + ',' + sp.y + ')');
      if (window.__modo) window.__modo.fijar('manual', 'mi spot: volviendo'); await dormir(1500);
      if (call('GetMapIndex') !== sp.mapa) {
        if (!sp.warp) { mi.estado = 'reviví en otro mapa y no sé a qué /move ir (Lab > Mi spot > Nombre del /move)'; enviar('ciclo_falla', 'Mi spot: ' + mi.estado, true); return { ok: false, motivo: mi.estado }; }
        let ok = false;
        for (let i = 0; i < 3 && on && !ok; i++) { ok = await viajar(sp.warp, sp.mapa); if (!ok && on) await dormir(6000); ultWarp = 0; }
        if (!ok) { mi.estado = 'no pude viajar a "' + sp.warp + '" (¿Zen, nivel o cartel del /move?)'; enviar('ciclo_falla', 'Mi spot: ' + mi.estado, true); return { ok: false, motivo: mi.estado }; }
      }
      const llego = await caminarA({ x: sp.x, y: sp.y }, 'mispot');
      if (!on) return { ok: false, motivo: 'cortado' };
      if (llego) { const Mv = window.__mover, t0 = Date.now(); while (on && Date.now() - t0 < 3000 && dist(aquí(), sp) > 0) { Mv.paso(sp.x, sp.y, 0); await dormir(150); } Mv.parar(); }
      if (window.__modo) { await dormir(800); window.__modo.fijar(modo, 'botón (mi spot)'); }      // el ancla queda donde llegó
      mi.vueltas++; mi.estado = llego ? 'listo: de vuelta en mi spot (' + aquí().x + ',' + aquí().y + ')' : 'llegué cerca pero no al spot (' + aquí().x + ',' + aquí().y + ')'; if (!llego) mi.fallas++;
      enviar('ciclo_etapa', 'Mi spot: ' + mi.estado + ' · ' + modo + ' prendido.', !llego);
      return { ok: llego, x: aquí().x, y: aquí().y };
    } finally { on = false; cfg.auto = autoAntes; cfg.sim = simAntes; if (window.__mover) window.__mover.parar(); window.__pausaVigia = false; mi.ocupado = false; }
  }
  const miSpotTexto = () => (mi.sp ? 'Mi spot: mapa ' + mi.sp.mapa + (mi.sp.nombre ? ' (' + mi.sp.nombre + ')' : '') + ' en (' + mi.sp.x + ',' + mi.sp.y + ')' + (mi.sp.warp ? ' · /move "' + mi.sp.warp + '"' : ' · sin /move') + ' · al morir volver: ' + (mi.on ? 'ON' : 'OFF') + ' · volvió ' + mi.vueltas + ' veces' + (mi.estado ? ' · ' + mi.estado : '') + ' · camino: ' + (leerRutas().mispot ? leerRutas().mispot.pts.length + ' puntos' : 'sin grabar') : 'Mi spot: sin guardar (parate en el lugar y tocá "Guardar acá")');

  // ---------------- REGRESO AL MORIR ----------------
  // Si morís en el mapa de Lost Tower (cae en Lost Tower 1), viaja con el /move a Lost Tower 7, camina el camino grabado hasta el spot
  // y vuelve a farmear (piloto si estaba prendido, si no el Helper). Si el ciclo de reset está andando, lo hace el ciclo en su paso.
  const KEY_REG = 'muRegresoV1', regCfg = { on: true };
  try { const g = JSON.parse(localStorage.getItem(KEY_REG) || 'null'); if (g) regCfg.on = !!g.on; } catch (e) { /* nada */ }
  const regOn = (v) => { regCfg.on = !!v; try { localStorage.setItem(KEY_REG, JSON.stringify(regCfg)); } catch (e) { /* nada */ } return regCfg.on; };
  let ultMuerte = { piloto: false, modo: 'helper' }, vivoAntes = true, muertoEn = null, ult = { mapa: -1, piloto: false, helper: false, modo: 'helper' }, muertes10 = [], regEstado = '';
  async function regresar() {
    const dest = destino('lt7'), sp = dest.sp; if (!sp) return;
    muertes10 = muertes10.filter((t) => Date.now() - t < 600000); muertes10.push(Date.now());
    if (muertes10.length > 3) { regEstado = 'no vuelvo: morí ' + muertes10.length + ' veces en 10 min'; enviar('ciclo_falla', 'Morí ' + muertes10.length + ' veces en 10 min en Lost Tower. No vuelvo solo; revisá el personaje.', true); return; }
    const antes = { piloto: ultMuerte.piloto, modo: ultMuerte.modo }, autoAntes = cfg.auto, simAntes = cfg.sim;
    on = true; cfg.auto = true; cfg.sim = false; window.__pausaVigia = true; ultWarp = 0; fallasWarp = 0; regEstado = 'volviendo a ' + dest.nombre;
    try {
      L('REGRESO: morí, viajo a ' + dest.nombre + ' y camino al spot');
      if (window.__modo) window.__modo.fijar('manual', 'regreso al morir'); await dormir(2500);
      let ok = false;
      for (let i = 0; i < 3 && on && !ok; i++) { ok = await viajar(dest.warp, sp.mapa); if (!ok) await dormir(8000); }
      if (ok) {
        const llego = await caminarA(sp, dest.clave);
        if (dest.clave === 'aida' && window.__modo && window.__modo.anclar) { ultAnclaMapa = sp.mapa; await window.__modo.anclar(); }
        if (window.__modo) { await dormir(1500); window.__modo.fijar(antes.modo && antes.modo !== 'manual' ? antes.modo : 'helper', 'regreso al morir'); }
        regEstado = llego ? 'listo: de vuelta en el spot' : 'llegué al mapa pero no al spot';
        enviar('ciclo_etapa', 'Morí y volví solo a ' + dest.nombre + (llego ? ' (en el spot).' : ' (no llegué hasta el spot).'), !llego);
      } else { regEstado = 'no pude viajar a Lost Tower 7'; enviar('ciclo_falla', 'Morí y no pude viajar a Lost Tower 7 (revisá Zen, nivel o el /move).', true); }
    } finally { on = false; cfg.auto = autoAntes; cfg.sim = simAntes; if (window.__mover) window.__mover.parar(); window.__pausaVigia = false; }
  }
  setInterval(() => {
    const escena = call('GetSceneFlag'), vida = call('GetPlayerLife'), vivo = escena === 5 && vida > 0;
    if (vivo) {
      if (!vivoAntes) {   // acaba de revivir
        const m = muertoEn; vivoAntes = true; muertoEn = null; if (m) ultMuerte = m;
        if (m && m.modo !== 'manual' && m.mapa === (destino('lt7').sp || {}).mapa && (call('GetPlayerLevel') | 0) >= 46) {   // con el modo en Nada no vuelve solo
          if (on) reaparecio = true;
          else if (regCfg.on) setTimeout(() => { if (!on && call('GetPlayerLife') > 0) regresar(); }, 4000);
        } else if (m && m.modo !== 'manual' && mi.sp && mi.on && !on && !mi.ocupado) {      // MI SPOT: reviví y estaba farmeando -> vuelve solo (máx 3 muertes en 10 min)
          mi.muertes = mi.muertes.filter((t) => Date.now() - t < 600000); mi.muertes.push(Date.now());
          if (mi.muertes.length > 3) { mi.estado = 'no vuelvo: morí ' + mi.muertes.length + ' veces en 10 min'; enviar('ciclo_falla', 'Mi spot: ' + mi.estado + '. Revisá el personaje.', true); }
          else setTimeout(() => { if (!on && !mi.ocupado && call('GetPlayerLife') > 0) volverAMiSpot('morí', mi.modo).catch(() => { mi.ocupado = false; }); }, 3500);
        }
      }
      { const dm = window.__modo ? window.__modo.deseado() : null; if (dm === 'sostener' || dm === 'pulsos' || dm === 'auto') mi.modo = dm; }      // el último modo de farmeo propio (la vigilancia de vida lo pasa a Helper antes de morir)
      ult = { mapa: call('GetMapIndex'), piloto: !!(window.__piloto && window.__piloto.activo()), helper: call('HelperIsActive') === 1, modo: window.__modo ? window.__modo.deseado() : 'helper' };
    } else if (escena === 5 && vida === 0 && vivoAntes) { vivoAntes = false; muertoEn = { mapa: ult.mapa, piloto: ult.piloto, modo: ult.modo }; L('MURIÓ en el mapa ' + ult.mapa); }
  }, 500);

  // ---------------- bucle principal ----------------
  async function paso() {
    if (call('GetSceneFlag') !== 5 || !(call('GetPlayerLife') > 0)) { estado = 'esperando (muerto o fuera del juego)'; return; }
    window.__pausaVigia = true;
    if (cfg.sim) { await pasoSim(); return; }
    const nivel = call('GetPlayerLevel'), mapa = call('GetMapIndex'), lt = buscarWarp('TorrePerdida7'), ltPuede = !!(lt && lt.puede);
    // Etapa larga = Aida si está en el /move (entra recién a nivel 100: hasta ahí se sigue en Devias 3, que sube rápido); si no está en la lista, Lost Tower 7
    const aidaW = cfg.usarAida ? buscarWarp('Aida') : null, largoPuede = aidaW ? !!aidaW.puede : ltPuede;
    const et = etapaPara(nivel, largoPuede, etapa);
    if (et !== etapa) { L('etapa: ' + etapa + ' -> ' + et + ' (nivel ' + nivel + ', mapa ' + mapa + ')'); enviar('ciclo_etapa', 'Ciclo: etapa ' + et + ' (nivel ' + nivel + ').', false); etapa = et; entroEtapa = Date.now(); }
    estado = 'etapa ' + et;
    if (et === 'reset') { await hacerReset(); return; }
    if (reaparecio) {
      reaparecio = false; const dd = destino(et), sp0 = dd.sp; L('morí: vuelvo a la etapa ' + et + ' (' + dd.nombre + ')');
      if (sp0) { ultWarp = 0; fallasWarp = 0; await viajar(dd.warp, sp0.mapa); await caminarA(sp0, dd.clave); if (dd.clave === 'aida') ultAnclaMapa = sp0.mapa; }
      return;
    }
    // QUEDARSE: ya estás en el mapa elegido (por defecto el 210): sin viaje de etapa ni caminata, solo repartir los puntos (en segundo plano) y farmear donde estás
    if (cfg.quedarseEn && mapa === cfg.quedarseEn) {
      estado = 'etapa ' + et + ' · me quedo en el mapa ' + mapa;
      const libresQ = call('GetPlayerLevelUpPoints') | 0;
      if (libresQ >= 7 && Date.now() - ultPuntos > 1500 * cfg.escala && !repartiendoBG) {
        ultPuntos = Date.now(); repartiendoBG = true;
        repartir().catch((e) => { L('error repartiendo puntos: ' + String(e && e.message || e).slice(0, 80)); }).then(() => { repartiendoBG = false; });
      }
      if (resetsHechos >= cfg.tope && libresQ === 0 && nivel < cfg.nivelAranas) { enviar('ciclo_fin', 'Ciclo terminado: ' + resetsHechos + ' reset(s) hecho(s) y puntos repartidos. Quedás en nivel ' + nivel + ' en el mapa ' + mapa + '.', false); detener('tope de resets alcanzado'); return; }
      farmear('lt7'); return;
    }
    const dd = destino(et), sp = dd.sp;
    // 1) VIAJE DE ETAPA PRIMERO (nivel 15 -> Devias 3, nivel 100 -> Aida): antes iba después del reparto de puntos, que en el nivelado rápido
    //    se repetía sin parar (+7 puntos por nivel) y retrasaba el /move decenas de niveles.
    if (sp && mapa !== sp.mapa) {
      if (et === 'aranas') { if (mapa !== 0) await viajar('Lorencia', sp.mapa); }
      else await viajar(dd.warp, sp.mapa);
      if (call('GetMapIndex') !== sp.mapa) return;
      ultAnclaMapa = -1;
    }
    // 2) puntos libres: tras un reset (más de 100) se reparten antes de pelear; los chicos (28+) solo en la etapa larga, donde suben despacio.
    //    En arañas y Devias 3 se suben varios niveles por minuto: los puntos se acumulan y salen juntos en un solo lote grande.
    const libres = call('GetPlayerLevelUpPoints') | 0;
    // El reparto va en SEGUNDO PLANO: el viaje y el farmeo siguen aunque la asignación tarde o falle (antes era una cadena: si el primer eslabón no salía, no seguía nada).
    if (libres >= 7 && Date.now() - ultPuntos > 1500 * cfg.escala && !repartiendoBG) {      // continuo: apenas hay un nivel de puntos (antes: 28+ y una vez cada 30 s)
      ultPuntos = Date.now(); repartiendoBG = true;
      repartir().catch((e) => { L('error repartiendo puntos: ' + String(e && e.message || e).slice(0, 80)); }).then(() => { repartiendoBG = false; });
    }
    // tope de resets: terminado el último reparto, se frena solo
    if (resetsHechos >= cfg.tope && (call('GetPlayerLevelUpPoints') | 0) === 0 && nivel < cfg.nivelAranas) {
      enviar('ciclo_fin', 'Ciclo terminado: ' + resetsHechos + ' reset(s) hecho(s) y puntos repartidos. Quedás en nivel ' + nivel + ' en el mapa ' + mapa + '.', false);
      detener('tope de resets alcanzado'); return;
    }
    if (!sp) { estado = 'falta guardar el spot de ' + et; return; }
    if (dd.clave === 'aida') {
      // En Aida el punto bueno lo decide el ancla (respawns): se camina al spot solo al llegar o si quedó muy lejos; si no, caminarA pelearía contra el ancla
      const lejosSp = Math.max(Math.abs(call('GetHeroX') - sp.x), Math.abs(call('GetHeroY') - sp.y)) > 30;
      if (ultAnclaMapa !== sp.mapa || lejosSp) { await caminarA(sp, 'aida'); ultAnclaMapa = sp.mapa; }
    } else await caminarA(sp, et === 'aranas' ? 'arana' : et);
    farmear(et);
  }
  async function bucle() {
    while (on) {
      try { if (!ocupado) { ocupado = true; try { await paso(); } finally { ocupado = false; } } }
      catch (e) { estado = 'error: ' + String(e && e.message || e).slice(0, 60); ocupado = false; }
      await dormir(1000);
    }
  }
  function arrancar(auto, tope, sim) {
    if (on) return { ok: false, motivo: 'ya está prendido' };
    if (!M() || call('GetSceneFlag') !== 5) return { ok: false, motivo: 'no estás en el juego' };
    const e = spots(); const faltan = ['arana', 'devias3', 'lt7'].filter((k) => !e[k]);
    if (faltan.length) return { ok: false, motivo: 'faltan spots guardados: ' + faltan.join(', ') };
    if (!window.__mover || !window.__mover.tabla()) return { ok: false, motivo: 'falta calibrar el movimiento (Mover: calibrar)' };
    { const f = ['arana', 'devias3', 'lt7'].filter((k) => !leerRutas()[k]); if (f.length) L('AVISO: sin camino grabado de ' + f.map((k) => NOM_RUTA[k]).join(', ') + ' (iría en línea recta)'); }
    cfg.auto = !!auto; cfg.sim = !!sim; simEtapa = 'inicio'; simBase = null; { const P = window.__piloto; inicial = { piloto: !!(P && P.activo()), helper: call('HelperIsActive') === 1 }; }
    if (tope) cfg.tope = tope; resetsHechos = 0; etapa = '-'; ultPuntos = 0; fallasWarp = 0; ultWarp = 0; confirmado = false; pendiente = null; on = true;
    L((cfg.sim ? 'SIMULACIÓN' : 'CICLO') + ' ON (' + (cfg.auto ? 'automático' : 'paso a paso') + (cfg.sim ? ', ' + cfg.simKills + ' muertes por etapa' : ', tope ' + cfg.tope + ' reset(s)') + ')');
    enviar('ciclo_etapa', (cfg.sim ? 'Simulación' : 'Ciclo de reset') + ' prendida (' + (cfg.auto ? 'automático' : 'paso a paso') + ').', false);
    bucle(); return { ok: true };
  }
  function detener(motivo = 'manual') {
    if (!on) return; on = false; pendiente = null; L('CICLO OFF: ' + motivo); estado = 'apagado (' + motivo + ')';
    if (window.__mover) window.__mover.parar(); window.__pausaVigia = false;
    enviar('ciclo_fin', 'Ciclo detenido: ' + motivo + '.', motivo !== 'manual' && motivo !== 'tope de resets alcanzado');
  }
  (window.__muLimpiar = window.__muLimpiar || []).push(() => { try { if (on) detener('manual'); } catch (e) { /* nada */ } });
  window.__ciclo = {
    miSpot: { guardar: guardarMiSpot, warpsAprendidos: leerWarpMapa, volver: (porQue) => volverAMiSpot(porQue || 'a pedido', mi.modo), setWarp: setMiWarp, auto: (v) => { if (v != null) { mi.on = !!v; guardarMi(); } return mi.on; }, texto: miSpotTexto, datos: () => ({ ...mi, ocupado: undefined }) },
    setQuedarse: (v) => { cfg.quedarseEn = v ? 210 : 0; return cfg.quedarseEn; }, quedarse: () => cfg.quedarseEn, arrancar, detener, irAlSpot, regresar, regreso: regOn, regresoOn: () => regCfg.on, rutas: leerRutas, caminarA, grabarRuta, pararRuta, textoRutas, planPuntos, etapaPara, cfg, buscarWarp, bitacora: () => bitacora, activo: () => on,
    confirmar: () => { if (pendiente) confirmado = true; }, masTope: (n = 1) => { cfg.tope += n; return cfg.tope; },
    resumen: () => (!on && regEstado && regCfg.on ? 'Regreso al morir: ' + regEstado : on || bitacora.length ? (cfg.sim ? 'SIMULACIÓN ' : 'Ciclo ') + (on ? 'ON [' + (cfg.auto ? 'automático' : 'paso a paso') + ']' : 'OFF') + ' · ' + estado + ' · resets ' + resetsHechos + '/' + cfg.tope + (pendiente ? ' · <b style="color:#fc6">PRÓXIMO: ' + pendiente + ' → tocá "Confirmar paso"</b>' : '') : ''),
  };
})();
