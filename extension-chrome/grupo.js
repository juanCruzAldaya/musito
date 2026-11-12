// Invitar a party a los jugadores cercanos. Usa lo mismo que el menú "Grupo" del juego: GetCommandablePlayersUtf8 (lista "idx\tnombre\tpk")
// y RunPlayerCommand(idx, 2) (2 = Grupo). Solo se dispara a mano desde un botón, con confirmación y con pausa entre invitaciones.
(() => {
  'use strict';
  // Recarga en caliente: los intervalos se registran para poder cortarlos al reinyectar el módulo sin recargar la página (ver background.js)
  const setInterval = (f, ms) => { const id = window.setInterval(f, ms); (window.__muIds = window.__muIds || []).push(id); return id; };
  const M = () => window.Module;
  const CMD_GRUPO = 2, PAUSA_MS = 2500, MAX_POR_VEZ = 5, ENFRIA_MS = 10 * 60 * 1000;
  const invitados = new Map();   // nombre -> { t: hora de la última invitación, unido: ¿llegó a entrar al grupo? }
  let ocupado = false, ultimo = '';
  const texto = (n) => { try { const f = M()['_MuWeb' + n]; const p = f() | 0; return p ? M().UTF8ToString(p) : ''; } catch (e) { return ''; } };
  function cercanos() {
    const out = [];
    for (const l of texto('GetCommandablePlayersUtf8').split('\n')) {
      const p = l.split('\t'); if (p.length < 2) continue;
      const idx = parseInt(p[0], 10), pk = parseInt(p[2], 10);
      if (Number.isFinite(idx) && p[1]) out.push({ idx, nombre: p[1], pk: Number.isFinite(pk) ? pk : -1 });
    }
    return out;
  }
  const grupoActual = () => texto('GetPartyMembersUtf8');
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // ¿está este nombre en el grupo? Por palabra completa (antes usaba "includes" y confundía nombres parecidos)
  const estaEn = (g, nombre) => new RegExp('(^|[^A-Za-z0-9_])' + esc(nombre) + '($|[^A-Za-z0-9_])').test(g);
  const nombresDe = (g) => new Set(g.split(/[\t\n,;|]+/).map((x) => x.trim()).filter((x) => x.length >= 2 && !/^[\d\s./%-]+$/.test(x)));

  // Registro de quién entra y sale de tu grupo (no distingue si se fue solo o lo sacaron: el juego no lo informa por acá; la extensión NUNCA saca a nadie)
  const eventos = [], salio = new Map();
  let previos = null;
  setInterval(() => {
    try {
      if (!M() || M()._MuWebGetSceneFlag() !== 5) return;
      const g = grupoActual(), ahora = nombresDe(g), yo = texto('GetHeroNameUtf8');
      if (previos) {
        const cerca = new Set(cercanos().map((c) => c.nombre));
        for (const n of ahora) if (!previos.has(n) && n !== yo) { eventos.push({ t: Date.now(), tipo: 'entró', nombre: n }); const r = invitados.get(n); if (r) r.unido = true; }
        for (const n of previos) if (!ahora.has(n) && n !== yo) { eventos.push({ t: Date.now(), tipo: 'salió', nombre: n, cerca: cerca.has(n), grupoAhora: g.slice(0, 120) }); salio.set(n, Date.now()); }
        while (eventos.length > 40) eventos.shift();
      }
      previos = ahora;
    } catch (e) { /* nada */ }
  }, 2000);

  // Quiénes se invitarían: no PK, no ya en tu grupo, y no invitados hace menos de 10 min SI NO RESPONDIERON.
  // Los que ya estuvieron en tu grupo y se fueron vuelven a ser candidatos a los 60 s de haber salido.
  function candidatos() {
    // v0.84.0 (pedido: "que el F7 agregue automático gente del clan sea PK o no"): los del clan se invitan aunque sean PK y van primero en la lista
    const g = grupoActual(), clan = texto('GetGuildMembersUtf8'), ahora = Date.now(), delClan = (n) => !!clan && estaEn(clan, n);
    return cercanos().filter((c) => {
      if (estaEn(g, c.nombre) || (c.pk >= 4 && !delClan(c.nombre))) return false;
      const r = invitados.get(c.nombre);
      if (r && r.unido) { const sal = salio.get(c.nombre); return !(sal && ahora - sal < 60000); }
      return !(r && ahora - r.t < ENFRIA_MS);
    }).sort((a, b) => (delClan(b.nombre) ? 1 : 0) - (delClan(a.nombre) ? 1 : 0)).slice(0, MAX_POR_VEZ);
  }
  async function invitar(lista) {
    if (ocupado) return { ok: false, motivo: 'ya estoy invitando' };
    if (!M() || M()._MuWebGetSceneFlag() !== 5 || M()._MuWebGetPlayerLife() <= 0) return { ok: false, motivo: 'no estás en el juego' };
    ocupado = true; const hechos = [], sinEnvio = [];
    try {
      for (const c of lista) {
        if (M()._MuWebGetPlayerLife() <= 0) break;
        const ok = (M()._MuWebRunPlayerCommand(c.idx | 0, CMD_GRUPO) | 0) === 1;
        invitados.set(c.nombre, { t: Date.now(), unido: false }); hechos.push(c.nombre); if (!ok) sinEnvio.push(c.nombre);
        await new Promise((r) => setTimeout(r, PAUSA_MS));
      }
    } finally { ocupado = false; }
    if (hechos.length) await new Promise((r) => setTimeout(r, 6000));   // dar tiempo a que acepten
    const g = grupoActual(), unidos = hechos.filter((n) => estaEn(g, n)), faltan = hechos.filter((n) => !estaEn(g, n));
    unidos.forEach((n) => { const r = invitados.get(n); if (r) r.unido = true; });
    ultimo = hechos.length ? 'invité a ' + hechos.join(', ') + ' · ya están en tu grupo: ' + (unidos.join(', ') || 'nadie todavía') + (faltan.length ? ' · sin respuesta: ' + faltan.join(', ') : '') + (sinEnvio.length ? ' · el juego no confirmó el envío a: ' + sinEnvio.join(', ') + ' (puede ser falso aviso)' : '') : 'nadie para invitar';
    return { ok: true, hechos };
  }
  // ---- AUTO-INVITAR AL CLAN (v0.88.0) ----
  // Pedido: "si se acerca uno del clan que no está en el party y hay lugar y soy líder, que lo invite". Cada 1,5 s, si está prendido: soy el LÍDER (el primero de la lista del grupo es mi nombre), el grupo tiene lugar (< MAX_GRUPO),
  // hay alguien cerca que figura en la lista de mi CLAN, que no está en el grupo y que no invité hace poco. Es lo mismo que el F7 (RunPlayerCommand(idx, 2)) pero de a UNO y con todo vuelto a leer justo antes de mandar.
  // SEGURIDAD (caja 34: un F7 deshizo el grupo entero de 10 jugadores): nunca a mí mismo, nunca a alguien cuyo nombre aparezca en el texto del grupo (se busca como texto suelto, sin importar mayúsculas), el índice se vuelve a buscar por nombre
  // en el instante del envío, y si después de invitar el grupo desaparece o dejo de ser líder, se APAGA solo y queda anotado. Apagado de fábrica. NO está probado en el juego.
  const MAX_GRUPO = 10;      // en la caja 34 el grupo llegó a 10 integrantes; el máximo real del servidor no está verificado
  const AUTO = { on: false, ocupado: false, ult: 0, enviados: 0, desarmes: 0, ultTxt: '', log: [] };
  try { const s = JSON.parse(localStorage.getItem('muAutoClanV1') || 'null'); if (s && s.v === 1 && typeof s.on === 'boolean') AUTO.on = s.on; } catch (e) { /* nada */ }
  const guardarAUTO = () => { try { localStorage.setItem('muAutoClanV1', JSON.stringify({ v: 1, on: AUTO.on })); } catch (e) { /* nada */ } };
  const LOGA = (t) => { AUTO.ultTxt = t; AUTO.log.push({ t: new Date().toISOString().slice(11, 19), txt: t }); if (AUTO.log.length > 40) AUTO.log.shift(); };
  const miNombre = () => (texto('GetHeroNameUtf8') || '').trim();
  // quién soy dentro del grupo: 'lider' (primero de la lista), 'miembro' o 'sin grupo'; y los nombres en orden
  function miGrupo() {
    const yo = miNombre(), nombres = [...nombresDe(grupoActual())];
    if (!yo || !nombres.length) return { rol: 'sin grupo', nombres, yo };
    return { rol: nombres[0].toLowerCase() === yo.toLowerCase() ? 'lider' : (nombres.some((n) => n.toLowerCase() === yo.toLowerCase()) ? 'miembro' : 'sin grupo'), nombres, yo };
  }
  const puedeAuto = (nombre) => { const r = invitados.get(nombre), ahora = Date.now(); if (r && r.unido) { const sal = salio.get(nombre); return !(sal && ahora - sal < 60000); } return !(r && ahora - r.t < ENFRIA_MS); };
  async function tickAuto() {
    if (!AUTO.on || AUTO.ocupado || ocupado || !M() || M()._MuWebGetSceneFlag() !== 5 || !(M()._MuWebGetPlayerLife() > 0) || Date.now() - AUTO.ult < 3000) return;
    const mg = miGrupo(); if (mg.rol !== 'lider' || mg.nombres.length >= MAX_GRUPO) return;
    const clan = texto('GetGuildMembersUtf8'); if (!clan) return;
    const yoL = mg.yo.toLowerCase(), gl = grupoActual().toLowerCase();
    const elegible = (c) => c.nombre && c.nombre.toLowerCase() !== yoL && estaEn(clan, c.nombre) && !gl.includes(c.nombre.toLowerCase()) && puedeAuto(c.nombre);
    const c0 = cercanos().find(elegible); if (!c0) return;
    AUTO.ocupado = true; ocupado = true; AUTO.ult = Date.now();
    try {
      // volver a leer TODO justo antes de mandar
      const mg2 = miGrupo(), gl2 = grupoActual().toLowerCase(), c = cercanos().find((x) => x.nombre === c0.nombre);
      if (!c || mg2.rol !== 'lider' || mg2.nombres.length >= MAX_GRUPO || gl2.includes(c.nombre.toLowerCase()) || c.nombre.toLowerCase() === mg2.yo.toLowerCase()) return;
      const antes = mg2.nombres.length, ok = (M()._MuWebRunPlayerCommand(c.idx | 0, CMD_GRUPO) | 0) === 1;
      invitados.set(c.nombre, { t: Date.now(), unido: false }); AUTO.enviados++;
      LOGA('invité a ' + c.nombre + ' (del clan, cerca; grupo de ' + antes + ')' + (ok ? '' : ' · el juego no confirmó el envío'));
      setTimeout(() => {      // control de seguridad: 6 s después el grupo tiene que seguir en pie y yo seguir siendo líder
        try {
          const d = miGrupo(), r = invitados.get(c.nombre);
          if (d.rol !== 'lider' || d.nombres.length < antes - 1) { AUTO.on = false; AUTO.desarmes++; guardarAUTO(); LOGA('¡SE DESARMÓ EL GRUPO después de invitar a ' + c.nombre + ' (antes ' + antes + ', ahora ' + d.nombres.length + ', rol ' + d.rol + ')! Apagué el auto-invitar'); }
          else if (r && estaEn(grupoActual(), c.nombre)) { r.unido = true; LOGA(c.nombre + ' entró al grupo'); }
        } catch (e) { /* nada */ }
      }, 6000);
    } finally { AUTO.ocupado = false; ocupado = false; }
  }
  setInterval(() => { tickAuto().catch((e) => { AUTO.ocupado = false; ocupado = false; LOGA('error: ' + String(e && e.message || e).slice(0, 80)); }); }, 1500);
  const AUTOAPI = { on: (v) => { if (v != null) { AUTO.on = !!v; guardarAUTO(); LOGA(AUTO.on ? 'ENCENDIDO' : 'APAGADO'); } return AUTO.on; }, stats: () => ({ activo: AUTO.on, max_grupo: MAX_GRUPO, enviados: AUTO.enviados, desarmes: AUTO.desarmes, ultimo: AUTO.ultTxt, yo: miNombre(), rol: miGrupo().rol, integrantes: miGrupo().nombres.length, registro: AUTO.log.slice(-12) }) };
  // ---- SUMMON A PEDIDO DEL CHAT (v0.79.0) ----
  // Pedido: "leer el chat; cuando dicen summon / summonear / jala / jalar: frenar la Sostenida, tirar Summon y seguir con la Sostenida". Lee los mensajes de chat que manda el servidor (C1 0x00: remitente de 10 bytes y
  // el texto desde el byte 13; el chat del grupo, del clan y el público llegan igual: el servidor los distingue por el prefijo del texto). Si el mensaje trae una de las palabras y el que escribe es de tu grupo (por defecto;
  // se puede abrir a cualquiera), pausa la Sostenida (modo.viaje), elige la habilidad Summon (63) y la lanza con clic derecho sobre tu personaje (con pulsos de SetManualSkillHeld como segundo intento), mira que
  // arranque su enfriamiento (30 s) y devuelve el modo (elige de nuevo Fire Burst). NO está probado en el juego: la caja trae `summon_chat` con lo que leyó y cómo salió cada intento.
  // v0.79.1 (pedido: "solo en el chat de grupo o de clan tiene que aparecer"): el canal se reconoce por el prefijo del texto, como en el MU original: '~' = chat de PARTY, '@' = chat de CLAN ('@@' alianza), '$' = Gens, sin prefijo = público.
  // modo 'grupo' (por defecto): solo hace caso a los mensajes de party o de clan; 'miembros': a cualquier canal si quien escribe es de tu party o clan; 'cualquiera': a todo. El prefijo NO está verificado en este servidor:
  // `canales` cuenta todos los chats leídos por canal y el registro anota por qué se ignoró cada mensaje con palabra clave.
  const INV = { on: true, esperaMs: 8000, modo: 'party', canales: { grupo: 0, clan: 0, gens: 0, publico: 0 }, prefijos: {}, cooldownMs: 31000, demMin: 2000, demMax: 6000, demT: 0, ultDem: 0, pend: null, encolados: 0, derechoMal: 0, leidos: 0, coinciden: 0, lanzados: 0, fallos: 0, ignorados: 0, ult: '', log: [], ultT: 0, ocupado: false, escuchando: false, muestras: [] };
  try { const g = JSON.parse(localStorage.getItem('muSummonChatV1') || 'null'); if (g) { if (typeof g.on === 'boolean') INV.on = g.on; if (g.v >= 3 && ['party', 'grupo', 'miembros', 'cualquiera'].includes(g.modo)) INV.modo = g.modo; if (g.v >= 2 && typeof g.esperaMs === 'number' && g.esperaMs >= 0 && g.esperaMs <= 20000) INV.esperaMs = g.esperaMs; } } catch (e) { /* nada */ }
  // v2: la espera por defecto pasó a 8 s (pedido del usuario); lo guardado antes con 3,5 s (sin v:2) se ignora
  const guardarINV = () => { try { localStorage.setItem('muSummonChatV1', JSON.stringify({ v: 3, on: INV.on, modo: INV.modo, esperaMs: INV.esperaMs })); } catch (e) { /* nada */ } };
  const LOGI = (t) => { INV.log.push({ t: new Date().toISOString().slice(11, 19), txt: t }); if (INV.log.length > 40) INV.log.shift(); };
  const norm = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // v0.82.1: toda la familia de "jalar" (jala, jale, jalen, jalame, jalalo, jalanos, jalar, jalando, jalaron…) y de "summonear" (summon, summonea, summoneen, sumonear…); se excluyen jalapeño, jalea, jaleo y Jalisco. Ya sin tildes ni mayúsculas (norm)
  const PALABRAS = /(^|[^a-z0-9])(summ?on\w*|(?!jalap|jalea|jaleo|jalisc)jal[ae]\w*)($|[^a-z0-9])/;
  const decodificar = (bytes) => { let fin = bytes.length; for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) { fin = i; break; } const b = bytes.slice(0, fin); try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return String.fromCharCode(...b); } };
  function leerChat(u) {
    try {
      if (!u || u[0] !== 0xC1 || u[2] !== 0x00 || u.length < 14) return null;
      const quien = decodificar(u.slice(3, 13)).trim(), msg = decodificar(u.slice(13)).replace(/[\u0000-\u001f]/g, '').trim();
      const p = msg.charAt(0), canal = p === '~' ? 'grupo' : p === '@' ? 'clan' : p === '$' ? 'gens' : 'publico', texto = canal === 'publico' ? msg : msg.replace(/^[~@$]+/, '').trim();
      return { quien, msg, canal, texto, prefijo: canal === 'publico' ? '' : p };
    } catch (e) { return null; }
  }
  const yoSoy = () => texto('GetHeroNameUtf8') || texto('GetPlayerNameUtf8');
  function onChat(u) {
    const c = leerChat(u); if (!c || !c.msg) return;
    INV.leidos++; INV.canales[c.canal] = (INV.canales[c.canal] || 0) + 1; { const p0 = c.msg.charAt(0); if (/[^A-Za-z0-9\s]/.test(p0)) INV.prefijos[p0] = (INV.prefijos[p0] || 0) + 1; }
    if (!INV.on) return;
    // v0.84.1: los avisos del juego cuando OTRO Dark Lord summonea ("Summoning in 5 second(s)...", "Summoning canceled") no son un pedido (caja 30: cada cuenta regresiva de ReyAzteca disparaba mi Summon)
    if (/^summoning\b/.test(norm(c.texto)) || /\bsummoning (in \d|cancel)/.test(norm(c.texto))) return;
    if (!PALABRAS.test(norm(c.texto))) return;
    INV.coinciden++;
    const yo = yoSoy(); if (yo && c.quien.toLowerCase() === yo.toLowerCase()) { INV.ignorados++; return; }      // mis propios mensajes no cuentan
    const miembro = estaEn(grupoActual(), c.quien) || estaEn(texto('GetGuildMembersUtf8'), c.quien), delCanal = c.canal === 'grupo' || c.canal === 'clan';
    LOGI('chat [' + c.canal + '] de "' + c.quien + '"' + (miembro ? ' (miembro de tu party/clan)' : ' (no figura en tu party/clan)') + ': ' + c.msg.slice(0, 80));
    // v0.82.4: modo 'party' = el chat de PARTY (~) o CUALQUIER chat (clan, público) si quien escribe está en MI party; el que no está en mi party y escribe por clan/público se ignora
    if (INV.modo === 'party' && c.canal !== 'grupo' && !estaEn(grupoActual(), c.quien)) { INV.ignorados++; INV.ult = 'ignoré el mensaje de ' + c.quien + ': era del chat ' + c.canal + ' y no está en tu PARTY (solo hago caso al chat de party o a gente de tu party)'; LOGI(INV.ult); return; }
    if (INV.modo === 'grupo' && !delCanal) { INV.ignorados++; INV.ult = 'ignoré el mensaje de ' + c.quien + ': era del chat ' + c.canal + ' (solo hago caso al chat de party o de clan)'; LOGI(INV.ult); return; }
    if (INV.modo === 'miembros' && !miembro) { INV.ignorados++; INV.ult = 'ignoré a ' + c.quien + ': no es de tu party ni de tu clan'; LOGI(INV.ult); return; }
    // v0.83.1 (pedido: "que no sea tan rápido"): el Summon automático espera un tiempo al azar de 2 a 6 s desde el mensaje. Otro pedido que llegue mientras espera no suma otro Summon.
    if (INV.demT && Date.now() < INV.demT) { LOGI('ya hay un Summon por salir: no sumo otro'); return; }
    const dem = INV.demMax > 0 ? Math.round(INV.demMin + Math.random() * (INV.demMax - INV.demMin)) : 0, mot = 'chat de ' + c.quien;
    const ir = () => { INV.demT = 0; invocar(mot).catch((e) => { INV.ocupado = false; LOGI('error: ' + String(e && e.message || e).slice(0, 80)); }); };
    if (dem > 0) { INV.demT = Date.now() + dem; INV.ultDem = dem; LOGI('espero ' + (dem / 1000).toFixed(1) + ' s (al azar) antes de tirar el Summon'); setTimeout(ir, dem); } else ir();
  }
  const dormirI = (ms) => new Promise((r) => setTimeout(r, ms));
  const cd63 = () => { const m = M(); try { return Math.max(m._MuWebGetSkillCooldownMs ? m._MuWebGetSkillCooldownMs(63) | 0 : 0, 0); } catch (e) { return 0; } };
  // v0.82.1 (caja 25: 16 pedidos con palabra clave, 7 lanzados, 6 rebotados por el enfriamiento de 30 s del Summon o por estar ocupado): un pedido que llega con el Summon en enfriamiento
  // ya no se pierde: queda en cola (el último, hasta 45 s) y se lanza apenas termina el enfriamiento. Antes se descartaba (y el de "ya estoy lanzando" ni se anotaba).
  function encolar(motivo, porque) { INV.pend = { t: Date.now(), motivo }; INV.encolados++; INV.ult = 'pedido en cola (' + porque + '): lo lanzo apenas pueda'; LOGI(INV.ult + ' · ' + motivo); }
  async function invocar(motivo, deCola) {
    const m = M(), Mo = window.__modo, S = window.__pantalla, Pq = window.__paquetes;
    if (BUFS.some((b) => b.ocupado)) { const t0 = Date.now(); while (BUFS.some((b) => b.ocupado) && Date.now() - t0 < 3000) await dormirI(100); }      // justo estaba lanzando el buff de crítico (dura ~0,5 s)
    if (INV.ocupado) { if (!deCola && /^chat/.test(motivo)) encolar(motivo, 'estaba lanzando otra cosa'); return { ok: false, motivo: 'ya estoy lanzando' }; }
    if (!m || m._MuWebGetSceneFlag() !== 5 || !(m._MuWebGetPlayerLife() > 0)) { INV.ult = 'no estoy en el juego o estoy muerto'; return { ok: false, motivo: INV.ult }; }
    // v0.82.3 (caja 27): con el cuadro de chat o una ventana del juego abiertos (ej. escribiendo /move) el juego rechaza elegir la habilidad: no se intenta, el pedido queda en cola
    if ((m._MuWebTextInputActive && m._MuWebTextInputActive()) || (m._MuWebGetBlockingUiOpen && m._MuWebGetBlockingUiOpen())) { INV.ult = 'hay un cuadro de chat o una ventana abierta: espero a que se cierre'; LOGI(INV.ult); if (!deCola && /^chat/.test(motivo)) encolar(motivo, 'ventana abierta'); return { ok: false, motivo: INV.ult }; }
    const ahora = Date.now(), resta = INV.cooldownMs - (ahora - INV.ultT);
    if (resta > 0) { INV.ult = 'Summon en espera (' + Math.ceil(resta / 1000) + ' s)'; LOGI(INV.ult); if (/^chat/.test(motivo)) encolar(motivo, 'enfriamiento'); return { ok: false, motivo: INV.ult }; }
    const cd = cd63(); if (cd > 0) { INV.ult = 'Summon en enfriamiento (' + Math.ceil(cd / 1000) + ' s)'; LOGI(INV.ult); if (/^chat/.test(motivo)) encolar(motivo, 'enfriamiento'); return { ok: false, motivo: INV.ult }; }
    INV.ocupado = true; INV.ultT = ahora;
    const prev = Mo && Mo.deseado ? Mo.deseado() : null, farmeando = ['sostener', 'pulsos', 'auto'].includes(prev);
    const aviso = (t) => window.postMessage({ __muvigia: true, clave: 'summon_chat', texto: t, grave: false }, '*');
    let ok = false, via = '';
    try {
      if (farmeando && Mo.viaje) Mo.viaje(true);       // frena los pulsos y suelta la habilidad sin tocar el modo ni el ancla
      await dormirI(250);
      const id0 = 63, r = m._MuWebResolveSkillTypeId ? m._MuWebResolveSkillTypeId(id0) | 0 : 0, id = r > 0 ? r : id0;
      // v0.82.3 (caja 27, 20:19:14: "no pude elegir Summon" una vez, a pesar de andar antes y después y el pedido se perdió): reintenta la elección hasta 6 veces (cada 150 ms) y, si igual no puede,
      // devuelve el candado de 31 s y deja el pedido en cola para reintentar
      let sel = m._MuWebSelectSkillTypeId(id) | 0; for (let k = 0; !sel && k < 6; k++) { await dormirI(150); sel = m._MuWebSelectSkillTypeId(id) | 0; }
      if (!sel) { INV.fallos++; INV.ultT = 0; INV.ult = 'no pude elegir Summon (¿no tengo la habilidad?)'; LOGI(INV.ult); aviso('Summon: no pude elegirlo (¿lo tenés aprendido?).'); if (!deCola && /^chat/.test(motivo)) encolar(motivo, 'no pude elegir la habilidad'); return { ok: false, motivo: INV.ult }; }
      await dormirI(150);
      const c0 = Pq ? Pq.cuenta('tx', 'C3:0x19') : 0;
      // 1º intento: clic derecho sobre tu propio personaje (centro de la pantalla): lanza la habilidad elegida
      let probeDerecho = false;
      if (INV.derechoMal < 2 && S && S.derecho && S.centro && (!document.hasFocus || document.hasFocus())) {
        const c = S.centro(); S.derecho.iniciar(c.x, c.y); await dormirI(350); try { S.derecho.soltar(c.x, c.y); } catch (e) { /* nada */ }
        await dormirI(450); probeDerecho = true; if (cd63() > 0) { ok = true; via = 'clic derecho'; INV.derechoMal = 0; }
      }
      // 2º intento: pulsos de SetManualSkillHeld con Summon elegida
      if (!ok) { const t0 = Date.now(); while (Date.now() - t0 < 700) { m._MuWebSetManualSkillHeld(0); m._MuWebSetManualSkillHeld(1); await dormirI(30); } m._MuWebSetManualSkillHeld(0); await dormirI(300); if (cd63() > 0) { ok = true; via = 'pulsos'; if (probeDerecho) INV.derechoMal++; } else INV.derechoMal = 0; }      // el clic derecho nunca anduvo con el Summon (caja 25: 7 de 7 por pulsos): tras 2 fallos lo saltea y ahorra ~1 s
      const c1 = Pq ? Pq.cuenta('tx', 'C3:0x19') : 0;
      if (ok) { INV.lanzados++; INV.ult = 'Summon lanzado (' + via + ') por ' + motivo; LOGI(INV.ult + ' · hechizos enviados ' + (c1 - c0)); aviso('Summon lanzado a pedido del chat (' + motivo + ').'); }
      else { INV.fallos++; INV.ult = 'intenté Summon y no arrancó el enfriamiento (hechizos enviados ' + (c1 - c0) + ')'; LOGI(INV.ult); aviso('Summon: lo intenté pero no salió (mirá el mana, el Comando y la habilidad).'); INV.ultT = 0; }
      if (ok && INV.esperaMs > 0) { LOGI('espero ' + (INV.esperaMs / 1000).toFixed(1) + ' s a que termine el Summon antes de volver a atacar'); await dormirI(INV.esperaMs); }      // v0.80.1: no seguir atacando mientras dura la animación del Summon (atacar la cortaría)
      return { ok, via };
    } finally {
      try { if (farmeando && Mo.viaje) Mo.viaje(false); } catch (e) { /* nada */ }      // vuelve a elegir Fire Burst y a pulsar
      INV.ocupado = false;
    }
  }
  setInterval(() => {
    try {
      const p = INV.pend; if (!p || INV.ocupado || BUF.ocupado) return;
      const ahora = Date.now(); if (ahora - p.t > 45000) { INV.pend = null; LOGI('pedido en cola vencido (más de 45 s): ' + p.motivo); return; }
      if (INV.cooldownMs - (ahora - INV.ultT) > 0 || cd63() > 0) return;
      INV.pend = null; invocar(p.motivo + ' (en cola)', true).then((r) => { if (r && !r.ok && /cuadro|ventana|no pude elegir/.test(r.motivo || '') && !INV.pend) INV.pend = p; }).catch((e) => { INV.ocupado = false; LOGI('error: ' + String(e && e.message || e).slice(0, 80)); });      // si no se pudo por la ventana abierta o la elección, vuelve a la cola con su hora original (vence a los 45 s)
    } catch (e) { /* nada */ }
  }, 500);
  setInterval(() => { try { const Pq = window.__paquetes; if (!INV.escuchando && !window.__grupoInvEsc && Pq && Pq.alRecibir) { INV.escuchando = true; window.__grupoInvEsc = true; Pq.alRecibir((u) => { try { if (window.__grupoInvocarOnChat) window.__grupoInvocarOnChat(u); } catch (e) { /* nada */ } }); } } catch (e) { /* nada */ } }, 1500);
  // ---- BUFF DE CRÍTICO SIEMPRE PUESTO (v0.82.0) ----
  // Pedido: "que siempre me mantenga el buff de crítico; cuando se va, activarlo de nuevo; es tirar ese skill, como el summon pero más rápido". Busca en tu lista de habilidades la que se llama "crítico/critical"
  // (o la que elijas con el Lab), la lanza sobre vos mismo con clic derecho (como el Summon pero con esperas cortas: ~0,4 s) y vuelve a la Sostenida. Cuándo relanzar: el servidor avisa cada efecto que
  // empieza o termina con el paquete C1 0x07 (estado, id del jugador, id del efecto); la extensión aprende sola qué efecto es el del crítico (la primera vez que lo lanza) y relanza cuando ESE efecto termina en vos.
  // Si no logra reconocerlo, relanza cada 120 s (relanzar un buff activo solo lo renueva). También lo relanza al entrar al juego y después de morir (la muerte lo borra). NO probado en el juego.
  const BUFS = [];      // los buffs que mantiene (crítico, aumentar vida): comparten el 'estoy lanzando' para no pisarse
  const txtArg = (n, a) => { try { const f = M()['_MuWeb' + n]; const p = f(a) | 0; return p ? M().UTF8ToString(p) : ''; } catch (e) { return ''; } };
  function listaHab() {
    const m = M(), out = []; if (!m || !m._MuWebGetSkillListCount) return out;
    const n = m._MuWebGetSkillListCount() | 0;
    for (let i = 0; i < n && i < 60; i++) { const tipo = m._MuWebGetSkillListType(i) | 0; out.push({ i, tipo, nombre: txtArg('GetSkillNameUtf8', tipo) }); }
    return out;
  }
  function crearBuff(CFG) {
  const BUF = { on: true, id: 0, nombre: '', eff: null, pid: null, activo: null, ultCast: 0, reintentoT: 0, seguidos: 0, lanzados: 0, fallos: 0, ocupado: false, ult: '', log: [], vistos: {}, votos: {}, durS: null, iniT: 0, ventana: 0, vi: false, vidaPrev: null, mapaPrev: null, termino: 0, tickN: 0 };
  try { const g = JSON.parse(localStorage.getItem(CFG.clave) || 'null'); if (g) { /* el buff de crítico arranca SIEMPRE prendido (pedido del usuario, v0.88.2): no se recupera el "apagado" guardado */ if (g.id > 0 && g.id < 2000) BUF.id = g.id | 0; if (g.eff >= 0 && g.eff < 256) BUF.eff = g.eff | 0; } } catch (e) { /* nada */ }
  const guardarBUF = () => { try { localStorage.setItem(CFG.clave, JSON.stringify({ v: 1, on: BUF.on, id: BUF.id, eff: BUF.eff })); } catch (e) { /* nada */ } };
  const LOGB = (t) => { BUF.log.push({ t: new Date().toISOString().slice(11, 19), txt: t }); if (BUF.log.length > 40) BUF.log.shift(); };
  const buscarCritico = () => { const h = CFG.buscar(listaHab()); if (h) { BUF.nombre = h.nombre; return h.tipo; } return 0; };
  const miPid = () => { try { const A = window.__agresor, h = A && A.heroId ? A.heroId() : null; return h != null ? h : BUF.pid; } catch (e) { return BUF.pid; } };
  const cadaMs = () => (BUF.eff != null && miPid() != null ? 600000 : 120000);      // red de seguridad: con el efecto reconocido confía en el aviso del servidor; si no, renueva cada 2 min
  function onEfecto(u) {
    if (!u || u[0] !== 0xC1 || u[1] !== 7 || u[2] !== 0x07 || u.length < 7) return;
    const est = u[3] ? 1 : 0, pid = (u[4] << 8) | u[5], eff = u[6], ahora = Date.now(), k = eff + (est ? '+' : '-');
    BUF.vistos[k] = (BUF.vistos[k] || 0) + 1;
    const yo = miPid(), enVentana = BUF.ventana && ahora - BUF.ventana < 3500;
    if (est && enVentana && (BUF.eff == null || eff === BUF.eff) && (yo == null || pid === yo)) {
      if (BUF.eff == null) {
        const kk = eff + ':' + pid; BUF.votos[kk] = (BUF.votos[kk] || 0) + 1;
        if (yo != null || BUF.votos[kk] >= 2) { BUF.eff = eff; BUF.pid = pid; guardarBUF(); LOGB('aprendí el efecto de ' + CFG.txt + ': ' + eff + ' (mi id ' + pid + ')'); }
      } else if (BUF.pid == null) BUF.pid = pid;
      BUF.vi = true;
    }
    if (BUF.eff == null || eff !== BUF.eff) return;
    const mio = miPid(); if (mio == null || pid !== mio) return;
    if (est) { BUF.activo = true; if (!BUF.iniT) BUF.iniT = ahora; }
    else { BUF.activo = false; BUF.termino++; if (BUF.iniT) { BUF.durS = Math.round((ahora - BUF.iniT) / 1000); } BUF.iniT = 0; BUF.reintentoT = 0; LOGB('el buff de ' + CFG.txt + ' terminó' + (BUF.durS ? ' (duró ' + BUF.durS + ' s)' : '') + ': lo relanzo'); }
  }
  async function lanzarBuff(motivo) {
    const m = M(), Mo = window.__modo, S = window.__pantalla, Pq = window.__paquetes;
    if (INV.ocupado || BUFS.some((b) => b.ocupado)) return { ok: false, motivo: 'ya estoy lanzando algo' };
    if (!m || m._MuWebGetSceneFlag() !== 5 || !(m._MuWebGetPlayerLife() > 0)) return { ok: false, motivo: 'no estoy en el juego o estoy muerto' };
    const id0 = BUF.id || buscarCritico();
    if (!id0) { BUF.fallos++; BUF.ult = 'no encontré la habilidad de ' + CFG.txt + ' en tu lista'; LOGB(BUF.ult); return { ok: false, motivo: BUF.ult }; }
    BUF.ocupado = true; INV.ocupado = true;
    const prev = Mo && Mo.deseado ? Mo.deseado() : null, farmeando = ['sostener', 'pulsos', 'auto'].includes(prev);
    const tx = () => (Pq ? (Pq.cuenta('tx', 'C3:0x19') | 0) + (Pq.cuenta('tx', 'C3:0x1e') | 0) : 0);
    const cd = () => { try { return m._MuWebGetSkillCooldownMs ? Math.max(m._MuWebGetSkillCooldownMs(id0) | 0, 0) : 0; } catch (e) { return 0; } };
    let ok = false, via = '';
    try {
      if (farmeando && Mo.viaje) Mo.viaje(true);
      await dormirI(120);
      const r = m._MuWebResolveSkillTypeId ? m._MuWebResolveSkillTypeId(id0) | 0 : 0, id = r > 0 ? r : id0;
      let sel = m._MuWebSelectSkillTypeId(id) | 0; for (let k = 0; !sel && k < 6; k++) { await dormirI(150); sel = m._MuWebSelectSkillTypeId(id) | 0; }
      if (!sel) { BUF.fallos++; BUF.ult = 'no pude elegir la habilidad ' + id0 + ' (¿la tenés aprendida?)'; LOGB(BUF.ult); return { ok: false, motivo: BUF.ult }; }
      await dormirI(60);
      const c0 = tx(); BUF.ventana = Date.now(); BUF.vi = false;
      const salio = () => tx() > c0 || BUF.vi || cd() > 0;
      const conFoco = !document.hasFocus || document.hasFocus();
      if (S && S.derecho && S.centro && conFoco) {
        const c = S.centro();
        S.derecho.iniciar(c.x, c.y); await dormirI(120); try { S.derecho.soltar(c.x, c.y); } catch (e) { /* nada */ }      // 1º intento rápido
        await dormirI(180); if (salio()) { ok = true; via = 'clic derecho rápido'; }
        if (!ok) { S.derecho.iniciar(c.x, c.y); await dormirI(350); try { S.derecho.soltar(c.x, c.y); } catch (e) { /* nada */ } await dormirI(450); if (salio()) { ok = true; via = 'clic derecho lento'; } }      // 2º: como el Summon
      }
      if (!ok) { const t0 = Date.now(); while (Date.now() - t0 < 600) { m._MuWebSetManualSkillHeld(0); m._MuWebSetManualSkillHeld(1); await dormirI(30); } m._MuWebSetManualSkillHeld(0); await dormirI(250); if (salio()) { ok = true; via = 'pulsos'; } }
      if (ok) { BUF.lanzados++; BUF.activo = true; BUF.ultCast = Date.now(); BUF.seguidos = 0; BUF.ult = 'buff de ' + CFG.txt + ' lanzado (' + via + ', ' + motivo + ')'; LOGB(BUF.ult); }
      else { BUF.fallos++; BUF.seguidos++; BUF.ult = 'intenté el buff de ' + CFG.txt + ' y no salió (mirá mana, AG y la habilidad)'; LOGB(BUF.ult); }
      return { ok, via };
    } finally {
      try { if (farmeando && Mo.viaje) Mo.viaje(false); } catch (e) { /* nada */ }      // vuelve a elegir Fire Burst y a pulsar
      BUF.ocupado = false; INV.ocupado = false;
    }
  }
  async function tickBuf() {
    if (!BUF.on || BUFS.some((b) => b.ocupado) || INV.ocupado) return;
    const m = M(); if (!m || m._MuWebGetSceneFlag() !== 5) return;
    const vida = m._MuWebGetPlayerLife() | 0, ahora = Date.now();
    if (vida <= 0) { if (BUF.activo !== false) LOGB('morí: el buff se pierde'); BUF.activo = false; BUF.vidaPrev = 0; BUF.iniT = 0; return; }
    const mapa = m._MuWebGetMapIndex ? m._MuWebGetMapIndex() | 0 : 0; if (BUF.mapaPrev != null && mapa !== BUF.mapaPrev) BUF.pid = null; BUF.mapaPrev = mapa;      // al cambiar de mapa mi id cambia
    if (BUF.vidaPrev === 0) { BUF.vidaPrev = vida; BUF.reintentoT = ahora + 2500; return; }      // recién revivido: espero un poco
    BUF.vidaPrev = vida;
    if ((m._MuWebGetBlockingUiOpen && m._MuWebGetBlockingUiOpen()) || (m._MuWebTextInputActive && m._MuWebTextInputActive()) || (m._MuWebMsgVisible && m._MuWebMsgVisible())) return;
    const Mo = window.__modo; if (Mo && Mo.enViaje && Mo.enViaje()) return;      // caminando a juntar algo / volviendo al ancla
    if (ahora < BUF.reintentoT) return;
    const vencido = BUF.activo === true && ahora - BUF.ultCast >= cadaMs();
    if (BUF.activo === true && !vencido) return;
    const motivo = BUF.activo === null ? 'al entrar' : BUF.activo === false ? 'se fue' : 'renovación';
    const r = await lanzarBuff(motivo);
    if (!r.ok) BUF.reintentoT = Date.now() + Math.min(20000, 1500 * Math.max(1, BUF.seguidos));
  }
  setInterval(() => { tickBuf().catch((e) => { BUF.ocupado = false; LOGB('error: ' + String(e && e.message || e).slice(0, 80)); }); }, 1000);
  const BUFAPI = {
    on: (v) => { if (v != null) { BUF.on = !!v; if (BUF.on) { BUF.activo = null; BUF.reintentoT = 0; } guardarBUF(); } return BUF.on; },
    id: (n) => { if (n != null) { BUF.id = n > 0 && n < 2000 ? n | 0 : 0; BUF.eff = null; BUF.votos = {}; BUF.activo = null; BUF.reintentoT = 0; guardarBUF(); } return BUF.id; },
    habilidades: listaHab, buscar: buscarCritico,
    lanzar: (m) => lanzarBuff(m || 'a pedido'),
    stats: () => ({ activo: BUF.on, habilidad_id: BUF.id || buscarCritico() || null, nombre: BUF.nombre, id_manual: BUF.id || null, efecto_id: BUF.eff, mi_id: miPid(), buff_puesto: BUF.activo, lanzados: BUF.lanzados, fallos: BUF.fallos, terminaciones_vistas: BUF.termino, duracion_s: BUF.durS, renueva_cada_s: Math.round(cadaMs() / 1000), efectos_vistos: { ...BUF.vistos }, ultimo: BUF.ult, registro: BUF.log.slice(-12) }),
  };
    BUFS.push(BUF);
    return { BUF, onEfecto, API: BUFAPI };
  }
  const B1 = crearBuff({ clave: 'muBuffCriticoV1', txt: 'crítico', buscar: (l) => l.find((x) => /critic/.test(norm(x.nombre))) });
  // Aumentar vida (Swell Life, habilidad 48; en el juego en español "Aumentar vida"): buff de grupo que gasta 22 de maná y 24 de AG. Pedido del usuario: tenerlo puesto todo el tiempo como el de crítico (v0.90.0).
  const B2 = crearBuff({ clave: 'muBuffVidaV1', txt: 'aumentar vida', buscar: (l) => l.find((x) => x.tipo === 48) || l.find((x) => /swell|fortitude|aumentar vida/.test(norm(x.nombre))) });
  const BUFAPI = B1.API, BUFAPI2 = B2.API;
  window.__grupoInvocarOnChat = (u) => { onChat(u); B1.onEfecto(u); B2.onEfecto(u); };       // siempre apunta a la instancia más nueva (recarga en caliente)
  window.__grupo = {
    invocar: (m) => invocar(m || 'a pedido'), summonChat: { on: (v) => { if (v != null) { INV.on = !!v; guardarINV(); } return INV.on; }, modo: (m) => { if (['party', 'grupo', 'miembros', 'cualquiera'].includes(m)) { INV.modo = m; guardarINV(); } return INV.modo; }, demora: (a, b) => { if (a >= 0 && b >= a && b <= 30000) { INV.demMin = a | 0; INV.demMax = b | 0; } return [INV.demMin, INV.demMax]; }, espera: (ms) => { if (ms >= 0 && ms <= 20000) { INV.esperaMs = ms | 0; guardarINV(); } return INV.esperaMs; }, stats: () => ({ activo: INV.on, modo: INV.modo, espera_ms: INV.esperaMs, demora_al_azar_ms: [INV.demMin, INV.demMax], ultima_demora_ms: INV.ultDem, canales: { ...INV.canales }, prefijos_vistos: { ...INV.prefijos }, chats_leidos: INV.leidos, con_palabra_clave: INV.coinciden, summon_lanzados: INV.lanzados, fallos: INV.fallos, ignorados: INV.ignorados, ultimo: INV.ult, enfriamiento_s: Math.ceil(cd63() / 1000), registro: INV.log.slice(-30), en_cola: INV.pend ? INV.pend.motivo : null, encolados: INV.encolados, clic_derecho_fallos_seguidos: INV.derechoMal }) },
    buff: BUFAPI, buffVida: BUFAPI2, autoClan: AUTOAPI, cercanos, candidatos, invitar, grupoActual, eventos: () => eventos.slice(), resumen: () => ultimo,
    crudo: () => ({ grupo: JSON.stringify(grupoActual()).slice(0, 700), clan: JSON.stringify(texto('GetGuildMembersUtf8')).slice(0, 1500), cercanos: JSON.stringify(texto('GetCommandablePlayersUtf8')).slice(0, 700) }),      // para averiguar si el texto del clan trae el estado conectado/desconectado de cada integrante
    ver: () => 'Auto-invitar clan: ' + (AUTO.on ? 'ENCENDIDO' : 'apagado') + (AUTO.ultTxt ? ' (' + AUTO.ultTxt + ')' : '') + ' · Grupo (crudo): ' + (grupoActual() || '(vacío)').replace(/\s+/g, ' ').slice(0, 200) + ' · eventos: ' + (eventos.slice(-6).map((e) => new Date(e.t).toLocaleTimeString('es-AR', { hour12: false }) + ' ' + e.nombre + ' ' + e.tipo + (e.tipo === 'salió' ? (e.cerca ? ' (estaba cerca)' : ' (no estaba cerca)') : '')).join(' | ') || 'ninguno todavía'),
  };
})();
