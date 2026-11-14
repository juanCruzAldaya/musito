// Banco de joyas: usa EXACTAMENTE el mismo comando de chat que la ventana del juego (/jbank s|a|w ...).
// 's' = ver estado (solo lectura), 'a' = depositar todo el inventario. Nunca retira. Depósito automático (cada 20 s): apagado de fábrica.
(() => {
  'use strict';
  // Recarga en caliente: los intervalos se registran para poder cortarlos al reinyectar el módulo sin recargar la página (ver background.js)
  const setInterval = (f, ms) => { const id = window.setInterval(f, ms); (window.__muIds = window.__muIds || []).push(id); return id; };
  const NOMBRES = ['Bless', 'Soul', 'Chaos', 'Life', 'Creation', 'Guardian', 'Gemstone', 'Harmony', 'Lower refine', 'Higher refine', 'Socket', 'Rare'];
  const INTERVALO_MS = 20000;   // depósito automático: cada 20 s (el comando 'a' ya devuelve el estado de las 12 joyas)
  let est = null, pend = null, ultimaLectura = 0, ultimoDeposito = 0, ultimoResultado = '';
  // El interruptor "depositar solo" (popup) se recuerda en localStorage y se escucha directo del puente: no depende de que vigia.js reenvíe la configuración
  const KEY_AUTO = 'muJoyasAutoV1';
  let auto = (() => { try { const v = localStorage.getItem(KEY_AUTO); if (v != null) return v === '1'; } catch (e) { /* nada */ } return window.__muJoyasAuto === true; })();
  const guardarAuto = () => { try { localStorage.setItem(KEY_AUTO, auto ? '1' : '0'); } catch (e) { /* nada */ } };
  const bitacoraJ = [], t0 = Date.now(); let ultMotivo = '', ultMotivoT = 0, vivoJ = true;
  const L = (t) => { bitacoraJ.push({ t_ms: Date.now() - t0, txt: t }); if (bitacoraJ.length > 80) bitacoraJ.shift(); };
  const M = () => window.Module;
  const suma = (k) => (est ? est.filas.reduce((a, f) => a + (f ? f[k] : 0), 0) : 0);

  function mandar(accion, args = '0 1 0') {
    if (pend && Date.now() - pend.t < 12000) return false;
    pend = null;
    const nonce = crypto.randomUUID().replace(/-/g, '');
    let ptr = 0;
    try {
      ptr = window.muAllocateUtf8(`/jbank ${accion} ${args} v1 ${nonce}`);
      if (M()._MuWebSubmitChatUtf8(ptr, 0, 0) !== 1) return false;
    } catch (e) { return false; } finally { try { if (ptr) M()._free(ptr); } catch (e) { /* nada */ } }
    pend = { nonce, t: Date.now(), accion, filas: [] };
    return true;
  }

  function observar(m) {
    const p = m.trim().split(' ');
    if (!pend || p[0] !== '_JB' || p[1] !== pend.nonce) return;
    if (p[2] === 'row') {
      const [k, bank, have, free] = p.slice(3).map(Number);
      if (k >= 0 && k < 12) pend.filas[k] = { bank, have, free };
    } else if (p[2] === 'done') {
      ultimoResultado = pend.accion + ':' + ({ ok: 'listo', balance: 'no hay tantas en el banco', inventory: 'no hay tantas en el inventario', space: 'NO HAY ESPACIO en el inventario', busy: 'cerrá comercio/NPC/ventanas y reintentá', unavailable: 'banco no disponible' }[p[3]] || p[3]);
      if (pend.filas.filter(Boolean).length === 12) est = { t: Date.now(), filas: pend.filas };
      L('respuesta ' + ultimoResultado + (est ? ' · inventario ' + suma('have') + ' · banco ' + suma('bank') : ''));
      if (pend.accion === 'a') ultimaLectura = 0; // releer enseguida
      pend = null;
    }
  }

  // El juego define muJewelBankNotice al cargar bank.js: lo envolvemos sin cambiar su comportamiento.
  window.__joyasObservar = (m) => { try { observar(String(m)); } catch (e) { /* nada */ } };   // siempre apunta a la instancia más nueva (recarga en caliente)
  setInterval(() => {
    const f = window.muJewelBankNotice;
    if (typeof f !== 'function' || f.__joyas) return;
    const w = function (m) { try { if (window.__joyasObservar) window.__joyasObservar(m); } catch (e) { /* nada */ } return f.apply(this, arguments); };
    w.__joyas = true; window.muJewelBankNotice = w;
  }, 1000);

  // devuelve null si se puede mandar el comando, o el motivo por el que no
  function motivoBloqueo() {
    const M_ = M();
    if (!M_) return 'sin cliente';
    if (M_._MuWebGetSceneFlag() !== 5) return 'fuera del juego';
    if (M_._MuWebGetPlayerLife() <= 0) return 'muerto';
    if (M_._MuWebGetBlockingUiOpen() === 1) return 'hay una ventana del juego abierta';
    if (M_._MuWebShopWindowOpen() === 1) return 'tienda abierta';
    const dlg = document.querySelector('dialog[open]'); if (dlg) return 'diálogo abierto (' + (dlg.id || dlg.className || 'sin id') + ')';   // no pisar la ventana del banco si la tenés abierta
    return null;
  }
  const libre = () => motivoBloqueo() === null;

  setInterval(() => {
    try {
      const ahora = Date.now();
      if (!auto) { if (ahora - ultMotivoT > 60000) { ultMotivoT = ahora; L('depósito automático APAGADO (interruptor del popup)'); } return; }
      const bloq = motivoBloqueo();
      if (bloq) { if (bloq !== ultMotivo || ahora - ultMotivoT > 60000) { ultMotivo = bloq; ultMotivoT = ahora; L('no deposito: ' + bloq); } return; }
      if (pend) { if (ahora - pend.t > 15000) { L('el juego no respondió al comando (nonce ' + pend.nonce.slice(0, 6) + '): lo libero'); pend = null; } return; }
      if (ahora - ultimoDeposito >= INTERVALO_MS) { if (mandar('a')) { ultimoDeposito = ahora; L('envié /jbank a'); } else L('no pude mandar el comando por el chat'); }
    } catch (e) { /* no frenar */ }
  }, 2000);

  // Retirar del banco: /jbank w <joya 0-11> <cantidad> <0 sueltas | 1 packs (solo joyas 0-9)> — el mismo comando que la ventana "Retirar" del juego.
  function retirar(idx, cantidad, formato = 0) {
    idx = idx | 0; cantidad = cantidad | 0; formato = formato ? 1 : 0;
    if (idx < 0 || idx > 11) return { ok: false, motivo: 'joya inválida (0-11)' };
    if (cantidad < 1 || cantidad > 100000) return { ok: false, motivo: 'cantidad inválida (1-100000)' };
    if (formato === 1 && idx >= 10) return { ok: false, motivo: 'Socket y Rare solo salen sueltas' };
    const f = est && est.filas[idx];
    if (f && cantidad > f.bank && formato === 0) return { ok: false, motivo: 'en el banco tenés solo ' + f.bank };
    if (f && formato === 0 && Number.isInteger(f.free) && cantidad > f.free) return { ok: false, motivo: 'el inventario tiene lugar para ' + f.free + ' sueltas (probá menos o formato 1 = packs)' };
    if (!libre()) return { ok: false, motivo: 'hay una ventana abierta (cerrala: banco, tienda, mensaje) o estás muerto' };
    return mandar('w', idx + ' ' + cantidad + ' ' + formato) ? { ok: true } : { ok: false, motivo: 'ocupado, reintentá' };
  }
  const AC = new AbortController();
  window.addEventListener('message', (e) => { if (!vivoJ || e.source !== window || !e.data || !e.data.__muvigiaCfg || !e.data.cfg) return; auto = !!e.data.cfg.joyas; guardarAuto(); L('configuración del popup: depositar solo = ' + (auto ? 'SÍ' : 'NO')); }, { signal: AC.signal });
  (window.__muLimpiar = window.__muLimpiar || []).push(() => { window.__muJoyasAuto = auto; vivoJ = false; AC.abort(); });
  // El interruptor de "depositar solo" viene del popup (chrome.storage) y lo aplica vigia.js al recibir la configuración. Al reinyectar este módulo en
  // caliente la instancia nueva arrancaba con auto = false y nadie volvía a mandar la configuración: por eso dejaba de depositar. Se la pedimos de nuevo.
  try { window.postMessage({ __muvigiaPide: true }, '*'); } catch (e) { /* nada */ }
  // ---- ESCÁNER DE TIENDAS DE NPC (v0.77.0) ----
  // Pedido: "en Magdalenas lo venden, el tema es dónde" (Scroll of Fire Scream). El cliente no tiene una función para leer lo que vende un NPC, pero el servidor manda la lista al abrir la tienda (C2 0x31: tipo, cantidad y
  // por item 1 byte de casilla + los datos del item; datos: byte0>>4 = grupo, byte1 = índice, byte2 = nivel, igual que los items del piso). Esto anota CADA tienda que abrís (nombre del NPC, mapa, posición, items) y avisa si vende el
  // Scroll of Fire Scream (12:35). Hay que abrir las tiendas a mano (hablar con el NPC): no manda nada propio. Lab > Cajas del piso > "Tiendas vistas".
  const KEY_TIENDAS = 'muTiendasV1', TIENDAS = (() => { try { return JSON.parse(localStorage.getItem(KEY_TIENDAS) || '[]'); } catch (e) { return []; } })();
  const BUSCADOS = { '12:35': 'Scroll of Fire Scream' };
  let tiendasEscuchando = false;
  function onTienda(u) {
    try {
      if (!vivoJ || !u || u[0] !== 0xC2 || u[3] !== 0x31 || u.length < 7) return;
      const tipo = u[4], n = u[5]; if (!n) return;
      const L = Math.round((u.length - 6) / n); if (L < 4 || 6 + n * L !== u.length) { L2('tienda: no pude leer la lista (largo ' + u.length + ', ' + n + ' items)'); return; }
      const items = [], hay = [];
      for (let i = 0; i < n; i++) { const o = 6 + i * L, g = u[o + 1] >> 4, ix = u[o + 2], lv = u[o + 3], k = g + ':' + ix; items.push(k + (lv ? '+' + lv : '')); if (BUSCADOS[k]) hay.push(BUSCADOS[k]); }
      const m = M(); let npc = ''; try { const f = m._MuWebGetNearbyNpcNameUtf8, p = f ? f() | 0 : 0; npc = p ? m.UTF8ToString(p) : ''; } catch (e) { /* nada */ }
      const reg = { hora: new Date().toISOString(), npc: npc || '(NPC sin nombre)', mapa: m._MuWebGetMapIndex(), x: m._MuWebGetHeroX(), y: m._MuWebGetHeroY(), tipo, items, vende: hay };
      const ya = TIENDAS.findIndex((t) => t.npc === reg.npc && t.mapa === reg.mapa && t.tipo === reg.tipo); if (ya >= 0) TIENDAS[ya] = reg; else TIENDAS.push(reg);
      if (TIENDAS.length > 60) TIENDAS.shift();
      try { localStorage.setItem(KEY_TIENDAS, JSON.stringify(TIENDAS)); } catch (e) { /* nada */ }
      L2('tienda de "' + reg.npc + '" (mapa ' + reg.mapa + ' en ' + reg.x + ',' + reg.y + '): ' + n + ' items' + (hay.length ? ' · ¡VENDE ' + hay.join(', ') + '!' : ''));
      if (hay.length) window.postMessage({ __muvigia: true, clave: 'tienda_fs', texto: '¡' + reg.npc + ' (mapa ' + reg.mapa + ', ' + reg.x + ',' + reg.y + ') vende ' + hay.join(', ') + '!', grave: false }, '*');
    } catch (e) { /* nada */ }
  }
  const L2 = (t) => L(t);
  setInterval(() => { try { const Pq = window.__paquetes; if (!tiendasEscuchando && Pq && Pq.alRecibir) { tiendasEscuchando = true; Pq.alRecibir(onTienda); } } catch (e) { /* nada */ } }, 1500);
  window.__tiendas = {
    lista: () => TIENDAS.map((t) => ({ ...t })),
    texto: () => (TIENDAS.length ? TIENDAS.map((t) => '"' + t.npc + '" (mapa ' + t.mapa + ', ' + t.x + ',' + t.y + '): ' + t.items.length + ' items' + (t.vende.length ? ' · VENDE ' + t.vende.join(', ') : '')).join(' | ') : 'Todavía no abriste ninguna tienda de NPC (hablá con el NPC para abrirla).'),
    borrar: () => { TIENDAS.length = 0; try { localStorage.removeItem(KEY_TIENDAS); } catch (e) { /* nada */ } },
  };
  // ---- CAJAS DEL PISO (v0.72.0): juntar rápido los items que elige el usuario (por defecto Box of Kundun +5) ----
  // El cliente ya junta solo lo que cae cerca (~1 pedido/s). Esto va a buscar, sin forjar paquetes, SOLO los items con la firma elegida: camina hasta la casilla del item (pasar por encima lo levanta),
  // sin pulsos mientras camina, y la correa del modo lo trae de vuelta al ancla. Firma = grupo:índice y nivel que trae el aviso de item caído (C2 0x20: byte0>>4 = grupo, byte1 = índice, byte2 = nivel).
  // La firma de la Kundun +5 (14:11 nivel 12) es la del MU estándar y NO está verificada en este servidor: la caja trae loot.firmas_vistas (todo lo que cayó) y el Lab tiene "Marcar el más cercano".
  const LOOT = { on: true, clic: false, paquete: true, esperaMs: 40000, pedidos: 0, firmas: [{ g: 14, i: 11, lv: 12 }], radio: 12, ocupado: false, ign: new Map(), vistos: new Map(), ids: new Set(), objetivos: 0, vueltas: 0, noVolvio: 0, clics: 0, offOk: null, offStats: {}, juntados: 0, otros: 0, perdidos: 0, sinDatos: 0, msViaje: [], ult: '' };
  // v0.91.0: set Paewang (en el juego "Real"; Dark Lord): pantalón 9:51, guantes 10:51, botas 11:51 (las piezas que le faltan al usuario). Grupo:índice según el OpenMU del servidor (CreateArmor/CreateGloves/CreateBoots 51). Cualquier nivel.
  const PAEWANG = [{ g: 9, i: 51, lv: null }, { g: 10, i: 51, lv: null }];      // las botas (11:51) YA las tiene: se excluyeron a pedido (v0.92.0)
  const EXCLUIDOS = [{ g: 11, i: 51 }];
  // v0.99.2 (pedido: "las box of kundun quiero levantar"): TODAS las Box of Kundun, no solo la +5. En el MU estándar son 14:11 con nivel 8 a 12 (+1 a +5). La +5 (nivel 12) ya está confirmada: son las 42 que el usuario tiene en la mochila (caja 63). Los niveles 8 a 11 son los estándar, sin verificar en este servidor.
  const KUNDUN = [8, 9, 10, 11].map((lv) => ({ g: 14, i: 11, lv }));
  // v0.99.6 PARA PROBAR EL CLIC (pedido: "ponete algo que levante de acá"): Rollo de Arcángel +8 (13:16 nivel 8) y Hueso Sangriento +8 (13:17 nivel 8), los más abundantes del piso en Devias/mapa 60 (caja 63: x33 y x35). Se sacan con Lab > "Reiniciar firmas" o avisándome.
  const PRUEBA = [{ g: 13, i: 16, lv: 8 }, { g: 13, i: 17, lv: 8 }];
  // v0.100.2 (pedido del usuario: "ahora solo dejemos el id de los guantes reales"): la lista queda SOLO con los Guantes Reales (10:51, cualquier nivel). Lo guardado de antes se reemplaza una vez (muLootV1 v7).
  const SOLO = [{ g: 10, i: 51, lv: null }];
  LOOT.firmas = SOLO.map((f) => ({ ...f })); LOOT.nombres = [];
  const sinExcluidos = () => { LOOT.firmas = LOOT.firmas.filter((f) => !EXCLUIDOS.some((e) => e.g === f.g && e.i === f.i)); };
  try { const s = JSON.parse(localStorage.getItem('muLootV1') || 'null'); if (s) { if (typeof s.on === 'boolean') LOOT.on = s.on; if (typeof s.clic === 'boolean') LOOT.clic = s.clic; if (!(s.v >= 5)) { LOOT.on = false; LOOT.clic = false; } if (!(s.v >= 6)) LOOT.on = true; if (typeof s.paquete === 'boolean') LOOT.paquete = s.paquete; if (Array.isArray(s.firmas) && s.firmas.length) { LOOT.firmas = s.firmas; if (!(s.v >= 2)) PAEWANG.forEach((p) => { if (!LOOT.firmas.some((x) => x.g === p.g && x.i === p.i)) LOOT.firmas.push(p); }); if (!(s.v >= 4)) PRUEBA.forEach((p) => { if (!LOOT.firmas.some((x) => x.g === p.g && x.i === p.i && x.lv === p.lv)) LOOT.firmas.push(p); }); if (!(s.v >= 3)) KUNDUN.forEach((p) => { if (!LOOT.firmas.some((x) => x.g === p.g && x.i === p.i && x.lv === p.lv)) LOOT.firmas.push(p); }); sinExcluidos(); } if (Array.isArray(s.nombres)) LOOT.nombres = s.nombres.slice(0, 40); if (!(s.v >= 7)) { LOOT.firmas = SOLO.map((f) => ({ ...f })); LOOT.nombres = []; } if (s.vGuantes) LOOT.vGuantes = true; if (s.vGuantes2) LOOT.vGuantes2 = true; if (Array.isArray(s.guantesJuego)) LOOT.guantesJuego = s.guantesJuego.slice(0, 120); } } catch (e) { /* nada */ }
  const guardarLoot = () => { try { localStorage.setItem('muLootV1', JSON.stringify({ v: 7, vGuantes: !!LOOT.vGuantes, vGuantes2: !!LOOT.vGuantes2, guantesJuego: LOOT.guantesJuego || [], on: LOOT.on, clic: LOOT.clic, paquete: LOOT.paquete, firmas: LOOT.firmas, nombres: LOOT.nombres })); } catch (e) { /* nada */ } };
  // nombre del item en el idioma del juego (MuWebGetItemNameUtf8(grupo, índice)); sin acentos y en minúscula para comparar. Se guarda en memoria: 1 consulta por item distinto.
  const normN = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const cacheNom = new Map();
  const nombreItem = (g, i) => { const k = g * 1000 + i; if (cacheNom.has(k)) return cacheNom.get(k); let n = ''; try { const m = M(), p = m._MuWebGetItemNameUtf8 ? m._MuWebGetItemNameUtf8(g, i) | 0 : 0; n = p ? m.UTF8ToString(p) : ''; } catch (e) { n = ''; } if (n) cacheNom.set(k, n); return n; };      // v0.100.3: los vacíos no se guardan (al principio el juego todavía no cargó los nombres)
  const firmaTxt = (f) => f.g + ':' + f.i + (f.lv == null ? ' (cualquier nivel)' : ' nivel ' + f.lv);
  const coincide = (it) => it.g !== undefined && (LOOT.firmas.some((f) => it.g === f.g && it.i === f.i && (f.lv == null || it.lv === f.lv)) || (LOOT.nombres.length > 0 && (() => { const n = normN(nombreItem(it.g, it.i)); return !!n && LOOT.nombres.some((q) => n.includes(q)); })()));
  const chebJ = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const heroJ = () => { const m = M(); return { x: m._MuWebGetHeroX(), y: m._MuWebGetHeroY() }; };
  const OFFS_CLIC = [[0, -22], [0, -36], [0, -8], [0, -50], [-28, -22], [28, -22], [0, 8], [-56, -22], [56, -22], [0, -64], [-28, -42], [28, -42]];
  async function juntar(it) {
    LOOT.ocupado = true; LOOT.objetivos++;
    const B = window.__bichos, Mo = window.__modo, Mv = window.__mover, t0 = Date.now(); let ok = false, llegoT = 0, razon = 'tiempo', clics = 0, ult = null, pidio = false, pqs = 0, ajustes = 0, ultPed = 0; const chk = () => { const P4 = window.__paquetes; if (ult && !pidio && P4 && P4.pedidosDe && P4.pedidosDe(it.id) > ult.p0) { pidio = true; const e = LOOT.offStats[ult.o.join(',')] = LOOT.offStats[ult.o.join(',')] || { clics: 0, pedidos: 0 }; e.pedidos++; LOOT.offOk = ult.o; } }; const lista = LOOT.offOk ? [LOOT.offOk].concat(OFFS_CLIC.filter((x) => x.join(',') !== LOOT.offOk.join(','))) : OFFS_CLIC; const keyIt = it.g + ':' + it.i + ':' + it.lv; let rc0 = null; try { const P0 = window.__paquetes; rc0 = P0 && P0.recogidas ? (P0.recogidas().ok[keyIt] || 0) : null; } catch (e) { rc0 = null; }
    let dest = null, h0 = null, volvio = null, msVuelta = 0; try { dest = Mo.ancla ? Mo.ancla() : null; h0 = heroJ(); } catch (e) { /* nada */ }
    try {
      Mo.viaje(true);
      while ((Date.now() - t0 < 7000 || (llegoT && Date.now() - llegoT < LOOT.esperaMs + 1200 && Date.now() - t0 < LOOT.esperaMs + 15000)) && vivoJ && LOOT.on) {      // v0.100.10: el tope de 7 s era para CAMINAR; ya parado esperando el servidor tiene sus propios 5,8 s (caja 77: 'tiempo' en plena espera)
        chk(); const aun = B.suelo().find((x) => x.id === it.id), h = heroJ();
        if (!aun) {      // v0.99.5: "juntado" solo si el SERVIDOR lo confirmó (paquetes.recogidas.ok de ese tipo subió); antes alcanzaba con que el item desapareciera con vos cerca (caja 65: 1 "juntada" falsa)
          ok = chebJ(it, h) <= 2; const P2 = window.__paquetes; if (ok && P2 && P2.recogidas && rc0 != null) ok = (P2.recogidas().ok[keyIt] || 0) > rc0;
          razon = ok ? 'juntado' : 'lo juntó otro'; break;
        }
        if (M()._MuWebGetPlayerLife() <= 0) { razon = 'murió'; break; }
        // v0.100.9 (pedido: "va caminando y nunca se para al lado para agarrar; en MU hay que pararse al lado, apretar y después volver a caminar"): al llegar se FRENA (sin seguir mandando pasos), se espera
        // ~350 ms a que el servidor tenga la posición nueva y recién ahí se pide recoger (hasta 3, uno cada 800 ms). Si algo lo corre a más de 1 casilla, vuelve a caminar hasta el item.
        let r;
        // v0.100.10 (caja 77: se frenó UNA casilla más allá del item, a distancia 1, y el 1.er pedido salió desde ahí): si al frenar quedó a 1 casilla y todavía no pidió nada, vuelve a ponerse EXACTO sobre la casilla (hasta 2 ajustes).
        if (llegoT) { const dd = chebJ(heroJ(), it); if (dd > 1) { llegoT = 0; pqs = 0; r = Mv.paso(it.x, it.y, 0); } else if (dd === 1 && pqs === 0 && ajustes < 2 && Date.now() - llegoT > 250) { ajustes++; llegoT = 0; r = Mv.paso(it.x, it.y, 0); } else r = 'llegó'; }
        else r = Mv.paso(it.x, it.y, 0);
        if (r === 'llegó' && !llegoT) { llegoT = Date.now(); try { Mv.parar(); } catch (e) { /* nada */ } try { M()._MuWebCancelHeroWalk && M()._MuWebCancelHeroWalk(); } catch (e) { /* nada */ } }
        if (r === 'sin calibrar' || r === 'sin dirección') { razon = r; break; }
        if (r === 'llegó') {
          // v0.99.5: pasar por encima SOLO levanta joyas; las demás hay que clickearlas. v0.99.7 (caja 67): 10 clics sobre la casilla del piso y NINGÚN pedido de recoger: el clic no le pega al item. En el MU el item se elige con el puntero sobre su
          // NOMBRE (la etiqueta flota por encima de la casilla) o su modelo, así que se prueban puntos más arriba (como hace atacar() con los bichos) y se mira si el CLIENTE manda el pedido de recoger (tx C3 22 con el id del item): ese es el acierto y se recuerda el punto.
          if (!llegoT) llegoT = Date.now();
          else if (LOOT.paquete && window.__paquetes && window.__paquetes.recoger) {
            // v0.100.11 (caja 79: parado EXACTO sobre el item, 5 veces rechazado con el item recién caído, y el que sí se levantó antes fue ~25 s después): casi seguro el item es del que mató al monstruo durante un rato.
            // Antes se rendía a los ~4 s y se iba. Ahora se queda parado sobre la casilla y pide cada 300 ms (el cliente del juego pide ~3 por segundo) hasta LOOT.esperaMs (40 s); sale si lo levantó (confirmación del servidor),
            // si se lo llevó otro (desaparece del piso), si la vida baja de 35 % o se acaba el tiempo.
            const desdeP = Date.now() - llegoT, P6 = window.__paquetes;
            if (P6.recogidas && rc0 != null && (P6.recogidas().ok[keyIt] || 0) > rc0) { ok = true; razon = 'juntado'; break; }
            const vMax = M()._MuWebGetPlayerLifeMax ? M()._MuWebGetPlayerLifeMax() : 0;
            if (vMax && M()._MuWebGetPlayerLife() < 0.35 * vMax) { razon = 'vida baja esperando (' + pqs + ' pedidos)'; break; }
            if (desdeP > LOOT.esperaMs) { razon = 'llegó y pedí recogerlo ' + pqs + ' veces en ' + Math.round(desdeP / 1000) + ' s: el servidor no lo dio'; break; }
            if (desdeP > 350 && Date.now() - ultPed >= 300) { const rr = P6.recoger(it.id); if (rr && rr.ok) { ultPed = Date.now(); pqs++; LOOT.pedidos++; } else if (!(rr && rr.motivo === 'muy seguido')) { razon = 'no pude mandar el pedido (' + ((rr && rr.motivo) || '?') + ')'; break; } }
          } else if (LOOT.paquete && !LOOT.clic) { razon = 'no pedí recogerlo: paquetes.js viejo (falta F5 en la página del juego)'; break;      // caja 72: recargaron la extensión pero no la página
          } else {
            const S = window.__pantalla, P3 = window.__paquetes, desde = Date.now() - llegoT, puedeClic = !!(LOOT.clic && S && S.pixelDe && S.clic && S.enPantalla && document.hasFocus());
            const pidios = () => (P3 && P3.pedidosDe ? P3.pedidosDe(it.id) : 0);
            if (puedeClic && !pidio && clics < lista.length && desde > 250 + clics * 380) {
              const px = S.pixelDe(it.x, it.y, 0), o = lista[clics++];
              if (px && S.enPantalla(px)) { LOOT.clics++; const e = LOOT.offStats[o.join(',')] = LOOT.offStats[o.join(',')] || { clics: 0, pedidos: 0 }; e.clics++; ult = { o, p0: pidios() }; await S.clic(px.x + o[0], px.y + o[1], 90); }
            } else if (desde > (puedeClic ? 250 + lista.length * 380 + 600 : 900) || (pidio && desde > 3000)) { razon = 'llegó pero no lo levantó' + (puedeClic ? ' (tras ' + clics + ' clics' + (pidio ? ', el cliente SÍ pidió recogerlo: el servidor lo rechazó o tardó' : ', el cliente nunca pidió recogerlo: el clic no le pegó') + ')' : ' (sin clic: ' + (!LOOT.clic ? 'clic apagado' : document.hasFocus() ? 'sin calibrar' : 'el navegador no tiene el foco') + ')'); break; }
          }
        }
        await new Promise((res) => setTimeout(res, 60));
      }
    } catch (e) { razon = 'error'; } finally {
      try {      // v0.100.4 (pedido: "tiene que volver a donde estaba"): después de juntar (o no) vuelve caminando al ancla de la Sostenida (o, si no hay, a donde arrancó), hasta 1 casilla, máximo 6 s.
        const dst = dest || h0, tv = Date.now();
        if (dst && M()._MuWebGetPlayerLife() > 0 && chebJ(heroJ(), dst) > 1) {
          LOOT.vueltas++;
          while (Date.now() - tv < 6000 && chebJ(heroJ(), dst) > 1 && M()._MuWebGetPlayerLife() > 0) { const rv = Mv.paso(dst.x, dst.y, 1); if (rv === 'sin calibrar' || rv === 'sin dirección') break; await new Promise((res) => setTimeout(res, 60)); }
          volvio = chebJ(heroJ(), dst) <= 1; msVuelta = Date.now() - tv; if (!volvio) LOOT.noVolvio++;
        } else volvio = true;
      } catch (e) { /* nada */ }
      try { Mv.parar(); } catch (e) { /* nada */ }
      try { Mo.viaje(false); } catch (e) { /* nada */ }
      LOOT.ocupado = false;
    }
    if (ok) { LOOT.juntados++; LOOT.msViaje.push(Date.now() - t0); if (LOOT.msViaje.length > 100) LOOT.msViaje.shift(); } else if (razon === 'lo juntó otro') LOOT.otros++; else { LOOT.perdidos++; LOOT.ign.set(it.id, /no lo dio/.test(razon) ? Date.now() + 20000 : Date.now() + 15000); }      // v0.100.6: si el servidor no lo dio (probable: todavía es de otro, que lo mató), se vuelve a intentar cuando el item tenga ~30 s en el piso (caja 76: rechazado a los 5-9 s, aceptado a los ~30 s)
    LOOT.ult = razon + ' · ' + it.g + ':' + it.i + '+' + it.lv + ' en (' + it.x + ',' + it.y + ') · ' + (Date.now() - t0) + ' ms' + (volvio === false ? ' · NO pude volver al punto (' + msVuelta + ' ms)' : msVuelta ? ' · volví en ' + msVuelta + ' ms' : '');
    L('piso: ' + LOOT.ult);
  }
  setInterval(() => {
    try {
      const B = window.__bichos, Mo = window.__modo, Mv = window.__mover, m = M();
      if (!vivoJ || !B || !B.suelo || !m || m._MuWebGetSceneFlag() !== 5) return;
      const lista = B.suelo(), ahora = Date.now();
      lista.forEach((it) => {      // qué cae en este mapa (cada item una vez): sirve para descubrir la firma de la caja que busca el usuario
        if (it.g === undefined) { LOOT.sinDatos++; return; }
        if (LOOT.ids.has(it.id)) return;
        LOOT.ids.add(it.id); if (LOOT.ids.size > 4000) LOOT.ids.clear();
        const k = it.g + ':' + it.i + ':' + it.lv; LOOT.vistos.set(k, (LOOT.vistos.get(k) || 0) + 1);
      });
      LOOT.ign.forEach((v, k) => { if (v < ahora) LOOT.ign.delete(k); });
      if (!LOOT.on || LOOT.ocupado || !Mo || !Mv || !Mo.viaje || !(Mv.tabla && Mv.tabla())) return;
      if (!['sostener', 'pulsos', 'auto'].includes(Mo.deseado()) || m._MuWebGetPlayerLife() <= 0 || !libre()) return;
      if (m._MuWebGetPlayerLifeMax && m._MuWebGetPlayerLife() < 0.4 * m._MuWebGetPlayerLifeMax()) return;
      const h = heroJ();
      const it = lista.filter((x) => coincide(x) && ahora - x.t < 120000 && chebJ(x, h) <= LOOT.radio && !(LOOT.ign.get(x.id) > ahora)).sort((p, q) => chebJ(p, h) - chebJ(q, h))[0];
      if (it) juntar(it).catch(() => { LOOT.ocupado = false; });
    } catch (e) { /* no frenar */ }
  }, 100);
  // ---- LISTA DE NOMBRES DEL HELPER NATIVO (v0.92.0) ----
  // Caja 44: la Bota Real +6 cayó, el viaje llegó a la casilla y NO la levantó (pasar por encima solo levanta joyas). El Helper del juego tiene su propia lista "levantar items por nombre" (la de la ventana del Helper):
  // MuWebHelperSetPickupNamesUtf8(texto, activar) reemplaza la lista (un nombre por línea, hasta 2048 bytes) y la aplica con ApplyConfig; MuWebHelperGetPickupNamesUtf8 / ...Enabled la leen.
  // Se usa solo lo que exporta el juego, sin paquetes propios. Se MEZCLA con lo que el usuario ya tenga en esa lista (nunca la borra). Los nombres salen del propio juego (MuWebGetItemNameUtf8 del grupo:índice).
  const HELP = { auto: true, ult: '', intentos: 0, listo: false, ultLectura: null };
  try { const s = JSON.parse(localStorage.getItem('muHelperNombresV1') || 'null'); if (s && typeof s.auto === 'boolean') HELP.auto = s.auto; } catch (e) { /* nada */ }
  const guardarHelp = () => { try { localStorage.setItem('muHelperNombresV1', JSON.stringify({ auto: HELP.auto })); } catch (e) { /* nada */ } };
  const strH = (n) => { try { const m = M(), f = m['_MuWeb' + n]; if (typeof f !== 'function') return null; const p = f() | 0; return p ? m.UTF8ToString(p) : ''; } catch (e) { return null; } };
  function helperLeer() {
    const m = M(); if (!m || !m._MuWebHelperGetPickupNamesUtf8) return { ok: false, motivo: 'el juego no exporta la lista de nombres del Helper' };
    const txt = strH('HelperGetPickupNamesUtf8'); const en = m._MuWebHelperGetPickupNamesEnabled ? m._MuWebHelperGetPickupNamesEnabled() : null; const mask = m._MuWebHelperGetPickupMask ? m._MuWebHelperGetPickupMask() : null;
    const r = { ok: true, nombres: (txt || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean), activo: en, mascara: mask }; HELP.ultLectura = r; return r;
  }
  // agrega los nombres que falten (y activa la lista); no quita ninguno. Devuelve lo que quedó leído del juego.
  function helperAgregar(nombres, activar = true) {
    const m = M(); if (!m || !m._MuWebHelperSetPickupNamesUtf8 || typeof window.muAllocateUtf8 !== 'function') return { ok: false, motivo: 'falta MuWebHelperSetPickupNamesUtf8 o muAllocateUtf8' };
    const ant = helperLeer(); if (!ant.ok) return ant;
    const norm1 = (t) => normN(t); const tengo = new Set(ant.nombres.map(norm1)); const nuevos = [];
    for (const n of nombres) { const t = String(n || '').trim(); if (t && !tengo.has(norm1(t))) { tengo.add(norm1(t)); nuevos.push(t); } }
    if (!nuevos.length && ant.activo) return { ok: true, sinCambios: true, ...ant };
    const lista = ant.nombres.concat(nuevos); let texto = lista.join('\n');
    while (new TextEncoder().encode(texto).length > 2000 && lista.length > 1) { lista.pop(); nuevos.pop(); texto = lista.join('\n'); }      // tope del juego: 2048 bytes
    let ptr = 0, r = null; HELP.intentos++;
    let diag = '';
    const llamar = (p) => m._MuWebHelperSetPickupNamesUtf8(p, activar ? 1 : 0);
    try {
      ptr = window.muAllocateUtf8(texto);
      let leido = ''; try { leido = m.UTF8ToString(ptr); } catch (e) { /* nada */ }
      diag = ' [ptr ' + ptr + ', el juego lee ' + JSON.stringify(leido).slice(0, 50) + ']';
      r = llamar(ptr);
      if (r === -1 || r == null) {      // v0.99.1: en el código del cliente (SetPickupNamesUtf8) el -1 sale SOLO si el puntero es nulo o strlen(texto) > 2048. El puntero no es nulo, así que sospecho que muAllocateUtf8 no deja el 0 final y strlen se pasa. 2º intento: texto + varios NUL.
        try { diag += ' · muAllocateUtf8 = ' + String(window.muAllocateUtf8).replace(/\s+/g, ' ').slice(0, 260); } catch (e) { /* nada */ }
        let p3 = 0; try { p3 = window.muAllocateUtf8(texto + '\0\0\0\0\0\0\0\0'); r = llamar(p3); diag += ' · 2º intento con NUL final (' + p3 + ') → ' + r; } catch (e) { diag += ' · el intento con NUL falló'; } finally { try { if (p3) m._free(p3); } catch (e) { /* nada */ } }
      }
      if (r === -1 || r == null) {      // v0.99.9 SONDA (caja 68: sigue -1 con puntero válido y NUL final): variantes del llamado, para ver cuál acepta el juego. Solo si todas las anteriores dieron -1; ninguna borra nada (siempre va la lista completa).
        const pv = [[texto, 0], [texto + '\n', 1], [texto + '\r\n', 1]];
        for (const [tv, act] of pv) {
          let p5 = 0; try { p5 = window.muAllocateUtf8(tv); const rv = m._MuWebHelperSetPickupNamesUtf8(p5, act); diag += ' · variante(' + JSON.stringify(tv.slice(-3)) + ',' + act + ')→' + rv; if (rv !== -1 && rv != null) { r = rv; break; } } catch (e) { diag += ' · variante falló'; } finally { try { if (p5) m._free(p5); } catch (e) { /* nada */ } }
        }
        try { diag += ' · IsActive=' + (m._MuWebHelperIsActive ? m._MuWebHelperIsActive() : '?') + ' escena=' + m._MuWebGetSceneFlag(); } catch (e) { /* nada */ }
      }
      if (r === -1 || r == null) {      // caja 45: devolvió -1 (puntero nulo o texto > 2048 bytes): 2º intento reservando yo la memoria con malloc, con el 0 final
        let p2 = 0;
        try { const bytes = new TextEncoder().encode(texto); p2 = m._malloc ? m._malloc(bytes.length + 1) : 0; if (p2 && m.HEAPU8) { m.HEAPU8.set(bytes, p2); m.HEAPU8[p2 + bytes.length] = 0; r = llamar(p2); diag += ' · 2º intento con malloc (' + p2 + ') → ' + r; } else diag += ' · sin malloc/HEAPU8'; } catch (e) { diag += ' · el 2º intento falló'; } finally { try { if (p2) m._free(p2); } catch (e) { /* nada */ } }
      }
    } catch (e) { return { ok: false, motivo: 'error: ' + String(e && e.message || e).slice(0, 80) }; } finally { try { if (ptr) m._free(ptr); } catch (e) { /* nada */ } }
    const des = helperLeer(); HELP.ult = 'agregué ' + nuevos.length + ' nombre(s) [' + nuevos.join(', ') + '] · el juego devolvió ' + r + diag + ' · ahora la lista tiene ' + (des.nombres || []).length + ' y está ' + (des.activo ? 'ACTIVADA' : 'apagada'); L('helper: ' + HELP.ult);
    return { ok: r !== -1, devolvio: r, agregados: nuevos, ...des };
  }
  // v0.100.3 (pedido: "agregá los guantes valorosos y los guantes divinos para lootear y chequear que funcione, salen con más cadencia"): no sé su grupo:índice en este servidor, así que al entrar al juego
  // se buscan por NOMBRE en la tabla del propio cliente (MuWebGetItemNameUtf8) y se agregan sus firmas (grupo 10 = guantes, cualquier nivel). Una sola vez (queda guardado); el resultado va al registro.
  // v0.100.5 (caja 74): "Guantes Divinos" salió (10:19 y 10:50) pero "Guantes Valoros…" no existe con ese nombre: se prueban variantes y se guarda la lista de TODOS los guantes del juego (loot.guantes_del_juego) para ver cómo se llaman.
  const BUSCAR_GUANTES = ['guantes valoros', 'guantes valeros', 'guantes valien', 'guantes del valor', 'guantes de valor', 'guantes divin'];
  let guantesTick = 0;
  setInterval(() => {
    try {
      if (LOOT.vGuantes2) return; const m = M(); if (!m || m._MuWebGetSceneFlag() !== 5) return; if (++guantesTick < 6) return;
      const enc = [];
      for (const q of BUSCAR_GUANTES) { const r = window.__loot && window.__loot.buscarNombre ? window.__loot.buscarNombre(q) : null; if (r && r.ok) r.encontrados.filter((x) => x.g === 10).forEach((x) => { if (!enc.some((e) => e.i === x.i)) enc.push(x); }); }
      if (!enc.length && guantesTick < 40) return;      // los nombres todavía no se pueden leer: reintenta
      LOOT.vGuantes = true; LOOT.vGuantes2 = true;
      try { const t = window.__loot.buscarNombre('guantes'); if (t && t.ok) LOOT.guantesJuego = t.encontrados.filter((x) => x.g === 10).map((x) => x.g + ':' + x.i + ' ' + x.nombre); } catch (e) { /* nada */ }
      enc.forEach((x) => { if (!LOOT.firmas.some((f) => f.g === x.g && f.i === x.i)) LOOT.firmas.push({ g: x.g, i: x.i, lv: null }); });
      guardarLoot();
      L('piso: ' + (enc.length ? 'agregué a la lista ' + enc.map((x) => x.g + ':' + x.i + ' ' + x.nombre).join(', ') : 'NO encontré "Guantes Valorosos" ni "Guantes Divinos" en los nombres del juego (decime cómo aparecen en el piso)'));
    } catch (e) { LOOT.vGuantes = true; LOOT.vGuantes2 = true; }
  }, 1000);
  const nombresPaewang = () => PAEWANG.map((p) => nombreItem(p.g, p.i)).filter(Boolean);
  // una sola vez por carga, con el personaje en el juego y vivo (ApplyConfig recarga la configuración del Helper): pone los nombres del set Real
  let helperTick = 0;
  setInterval(() => {
    try {
      if (HELP.listo || !HELP.auto) return; const m = M(); if (!m || m._MuWebGetSceneFlag() !== 5 || !(m._MuWebGetPlayerLife() > 0)) { helperTick = 0; return; }
      if (++helperTick < 8) return;      // ~8 s dentro del juego
      const nm = nombresPaewang(); if (nm.length < PAEWANG.length) { if (helperTick > 40) HELP.listo = true; return; }      // los nombres todavía no se pueden leer
      // v0.99.8: leyendo el código del cliente, SetPickupNamesUtf8 solo aplica la lista si YA existe el objeto de la ventana del Helper (global 9019656); si no, no hace nada y devuelve -1. Hipótesis: ese objeto se crea recién cuando abrís la ventana del Helper (botón HELPER de arriba a la derecha).
      // Por eso se reintenta cada ~20 s (hasta 30 veces) hasta que el juego deje la lista aplicada. Sin verificar en el juego.
      if (helperTick % 20 !== 0 && HELP.intentos > 0) return;
      const rr = helperAgregar(nm, true); const lista = helperLeer(); if ((rr && rr.ok && !rr.devolvio) || (lista.ok && lista.nombres && nm.every((n) => lista.nombres.some((x) => normN(x) === normN(n))))) HELP.listo = true; else if (HELP.intentos >= 2) HELP.listo = true;
    } catch (e) { HELP.listo = true; HELP.ult = 'error: ' + String(e && e.message || e).slice(0, 80); }
  }, 1000);
  window.__loot = {
    helperLeer, helperAgregar, helperAuto: (v) => { if (v != null) { HELP.auto = !!v; guardarHelp(); } return HELP.auto; }, helperEstado: () => ({ auto: HELP.auto, ultimo: HELP.ult, intentos: HELP.intentos, ...(helperLeer()) }),
    on: () => LOOT.on, setOn: (v) => { LOOT.on = !!v; guardarLoot(); return LOOT.on; }, clic: () => LOOT.clic, setClic: (v) => { LOOT.clic = !!v; guardarLoot(); return LOOT.clic; }, setEspera: (ms) => { LOOT.esperaMs = Math.max(2000, Math.min(120000, +ms || 40000)); return LOOT.esperaMs; }, paquete: () => LOOT.paquete, setPaquete: (v) => { LOOT.paquete = !!v; guardarLoot(); return LOOT.paquete; },
    firmas: () => LOOT.firmas.slice(), firmaTxt,
    marcarMasCercano: () => {      // agrega la firma del item del piso más cercano al héroe (para enseñarle cuál es la caja)
      const B = window.__bichos; if (!B || !B.suelo) return { ok: false, motivo: 'bichos.js no cargó' };
      const h = heroJ(), it = B.suelo().filter((x) => x.g !== undefined).sort((p, q) => chebJ(p, h) - chebJ(q, h))[0];
      if (!it) return { ok: false, motivo: B.suelo().length ? 'bichos.js viejo: apretá F5 en la página del juego' : 'no hay items en el piso' };
      const f = { g: it.g, i: it.i, lv: it.lv }; if (!LOOT.firmas.some((x) => x.g === f.g && x.i === f.i && x.lv === f.lv)) LOOT.firmas.push(f);
      guardarLoot();
      return { ok: true, firma: firmaTxt(f), a: chebJ(it, h) };
    },
    reiniciar: () => { LOOT.firmas = SOLO.map((f) => ({ ...f })); LOOT.nombres = []; guardarLoot(); return LOOT.firmas.slice(); },
    nombreItem,
    // busca en TODOS los items del juego los que tengan ese texto en el nombre (idioma del cliente): { ok, encontrados: ['10:51 Guantes ...'] }
    buscarNombre: (texto) => { const q = normN(texto); if (q.length < 3) return { ok: false, motivo: 'escribí al menos 3 letras' }; const m = M(); if (!m || !m._MuWebGetItemNameUtf8) return { ok: false, motivo: 'el juego no tiene la consulta de nombres' }; const out = []; for (let g = 0; g <= 15; g++) for (let i = 0; i <= 511; i++) { const n = nombreItem(g, i); if (n && normN(n).includes(q)) out.push({ g, i, nombre: n }); if (out.length > 200) break; } return { ok: true, encontrados: out }; },
    // agrega el texto como filtro: todo item del piso cuyo nombre lo contenga se va a buscar (cualquier nivel)
    agregarNombre: (texto) => { const q = normN(texto); if (q.length < 3) return { ok: false, motivo: 'escribí al menos 3 letras' }; if (!LOOT.nombres.includes(q)) LOOT.nombres.push(q); guardarLoot(); let h = null; try { const r = window.__loot.buscarNombre(texto); if (r.ok && r.encontrados.length && r.encontrados.length <= 40) h = helperAgregar([...new Set(r.encontrados.map((x) => x.nombre))], true); } catch (e) { /* nada */ } return { ok: true, nombres: LOOT.nombres.slice(), helper: h }; },
    quitarNombres: () => { LOOT.nombres = []; guardarLoot(); return true; },
    cerca: () => { const B = window.__bichos, h = heroJ(); return B && B.suelo ? B.suelo().filter((x) => chebJ(x, h) <= 15).sort((p, q) => chebJ(p, h) - chebJ(q, h)).slice(0, 12).map((x) => (x.g === undefined ? '?' : x.g + ':' + x.i + ' niv ' + x.lv) + ' a ' + chebJ(x, h)) : []; },
    stats: () => ({ activo: LOOT.on, firmas: LOOT.firmas.map(firmaTxt), nombres: LOOT.nombres.slice(), firmas_nombres: LOOT.firmas.map((f) => f.g + ':' + f.i + ' = ' + (nombreItem(f.g, f.i) || '?')), helper_nombres: (() => { try { return { auto: HELP.auto, ultimo: HELP.ult, intentos: HELP.intentos, ...(helperLeer()) }; } catch (e) { return null; } })(), radio: LOOT.radio, guantes_del_juego: LOOT.guantesJuego || null, objetivos: LOOT.objetivos, vueltas: LOOT.vueltas, no_volvio: LOOT.noVolvio, por_paquete: LOOT.paquete, pedidos_propios: LOOT.pedidos, clics: LOOT.clics, clic_acierto_punto: LOOT.offOk, clic_puntos: LOOT.offStats, juntados: LOOT.juntados, los_junto_otro: LOOT.otros, perdidos: LOOT.perdidos, ms_viaje_med: LOOT.msViaje.length ? Math.round([...LOOT.msViaje].sort((a, b) => a - b)[LOOT.msViaje.length >> 1]) : null, ultimo: LOOT.ult, sin_firma_bichos_viejo: LOOT.sinDatos,
      firmas_vistas: [...LOOT.vistos].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => k + ' x' + n) }),
  };
  window.__joyas = {
    mandar, retirar, nombres: NOMBRES, setAuto: (v) => { auto = !!v; guardarAuto(); L('setAuto(' + auto + ')'); }, bitacora: () => bitacoraJ.slice(), auto: () => auto,
    totales: () => (est ? { banco: suma('bank'), inv: suma('have'), hace_s: Math.round((Date.now() - est.t) / 1000) } : null),
    estado: () => est && { hace_s: Math.round((Date.now() - est.t) / 1000), tipos: est.filas.map((f, i) => ({ joya: NOMBRES[i], banco: f.bank, inventario: f.have, libres: f.free })) },
    resumen: () => (auto ? '' : 'Joyas: depósito automático APAGADO · ') + (est ? 'Joyas: inventario ' + suma('have') + ' · banco ' + suma('bank') : 'Joyas: sin datos') + (ultimoResultado ? ' (' + ultimoResultado + ')' : ''),
  };
})();
