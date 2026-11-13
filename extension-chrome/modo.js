// Árbitro del farmeo: una sola fuente de verdad para "quién está peleando".
// Modos:  helper    = el Helper nativo del juego
//         sostener  = SOSTENIDA: una pulsación de "habilidad sostenida" cada 310 ms (un ciclo de ataque natural, ~305 ms). NO más rápido:
//                     con pulsos cada 150 ms salieron hechizos cada 150 ms (6/s), el doble del ritmo natural, y eso no se hace.
//                     Hallazgo: la propia página del juego suelta SetManualSkillHeld/SetBasicAttackHeld cada 500 ms en escritorio, y una pulsación = UN hechizo
//                     (la pulsación vive 650 ms o hasta que se gasta); por eso con un solo pedido cada 1,5 s salía exactamente un hechizo cada 1,5 s.
//         auto      = AUTO del juego (SetAutoAttackToggle): ataca al más cercano, parecido al Helper
//         piloto    = piloto propio (clic derecho simulado)
//         manual    = nada peleando
// Todos los módulos piden el modo acá (fijar); el Vigía solo reactiva el Helper cuando el modo es "helper".
// En los modos del motor (sostener/auto) nadie toma pociones por vos (eso lo hacía el Helper), así que este módulo vigila:
// pociones por tecla (Q vida a <80 % · W maná · R SD) y, si la vida baja de 30 %, devuelve el Helper y bloquea el modo 2 min.
(() => {
  'use strict';
  // Recarga en caliente: los intervalos se registran para poder cortarlos al reinyectar el módulo sin recargar la página (ver background.js)
  const setInterval = (f, ms) => { const id = window.setInterval(f, ms); (window.__muIds = window.__muIds || []).push(id); return id; };
  const M = () => window.Module;
  const call = (n, ...a) => { try { const f = M()['_MuWeb' + n]; return typeof f === 'function' ? f(...a) : null; } catch (e) { return null; } };
  const P = () => window.__piloto;
  const NOMBRE = { helper: 'HELPER del juego', piloto: 'PILOTO propio', manual: 'NADA (todo apagado)', auto: 'AUTO del juego', sostener: 'SOSTENIDA (pulsos)', pulsos: 'SOLO PULSOS (sin AUTO)', pelea: 'PELEA (contraataque a un jugador)' };
  const MOTOR = (x) => x === 'auto' || x === 'sostener' || x === 'pulsos';
  let PULSO_MS = 10;      // v0.81.0: por defecto la bomba de pulsos va a 10 ms (probado y funcionando: pedido del usuario, sin tener que setearlo cada vez)
  // RITMO SEGURO: el servidor (OpenMU) tiene un control de velocidad de ataque: intervalo mínimo = max(60, 450 - 1,2 x velocidad de ataque) ms
  // (con velocidad 187 -> 225 ms = 4,4 ataques/s) y las violaciones sostenidas se acumulan. La velocidad de ataque del personaje es AGI/10 + equipo
  // (en la pantalla de personaje: "Velocidad de ataque"). Con el ritmo seguro prendido los pulsos no pasan de ese límite (+6 % de margen).
  // Los hechizos por encima del límite no sirven: o los descarta el servidor o suman a una violación.
  let ritmoSeguro = false, velAtaque = null, BONO_VEL = 60;     // BONO_VEL: velocidad que aporta el equipo (187 en pantalla con AGI 1270 -> 187 - 127 = 60)
  const velocidadAtaque = () => (velAtaque != null ? velAtaque : (call('GetPlayerDexterity') || 0) / 10 + BONO_VEL);
  const intervaloServidor = () => Math.max(60, 450 - 1.2 * velocidadAtaque());
  // PISO DE 62 ms (Test de ritmos solo, caja (3) 0.68.6, mapa 210, 4 fases de 60 s): bichos duros (>= 5 golpes) mueren en 5118 y 4314 ms con pulso 100 vs 3249 y 3284 ms con pulso 62 (-30 %), 4,9-5,6 golpes/s sobre el bicho vs 7,1-7,3, daño/s 39-47 mil vs 62 mil.
  // Con 62 ms respondieron MÁS hechizos (46 y 36 % contra 35 y 27 %) y fueron menos a blancos nunca golpeados (162 y 177 contra 206 y 249): el servidor no ignora los pulsos de 62 ms. La conclusión anterior (piso 100 ms, caja 68) era por saturación de bichos, no por el servidor.
  let PRUEBA = null;      // pulso de prueba (ms) puesto por telemetria.js; no se guarda y anula el ritmo elegido
  const topeCasts = () => (PRUEBA ? 45 : (!ritmoSeguro && PULSO_MS < 62) ? 120 : Math.max(11, Math.floor(1000 / intervaloServidor())));      // con AGI 2873 el servidor deja ~16/s
  const huecoPulso = () => (PRUEBA ? PRUEBA : ritmoSeguro ? Math.max(62, Math.ceil(intervaloServidor() * 1.02)) : PULSO_MS);     // margen 2 % (antes 6 % + 4 ms): el pulso de 100 ms mejoró mucho en las cajas 59-63   // piso 60 ms (el del servidor): con más AGI el hueco seguro baja de 100 ms        // pulsos cada 150 ms; tope de cordura 10 hechizos/s (decisión del usuario: igual que mantener el clic derecho)        // cadencia de pulsaciones y tope de seguridad: si se ve más de 4,5 hechizos/s se pausan los pulsos
  const HP_MIN = 0.80, HP_CORTE = 0.30, MP_MIN = 0.45, SD_MIN = 0.40;
  let hpMaxPrev = 0, hpMaxCambioT = 0;
  const POCIONES = {
    hp: { nombre: 'vida', slot: 0, key: { key: 'q', code: 'KeyQ', keyCode: 81 } },
    mp: { nombre: 'maná', slot: 1, key: { key: 'w', code: 'KeyW', keyCode: 87 } },
    sd: { nombre: 'SD', slot: 3, key: { key: 'r', code: 'KeyR', keyCode: 82 } },
  };
  const EST0 = window.__muEstadoModo === 'pelea' ? 'helper' : window.__muEstadoModo;   // una pelea no sobrevive a la recarga: vuelve el Helper
  let deseado = EST0 || 'helper', quien = EST0 ? 'recarga en caliente' : 'inicio', desde = Date.now(), nota = '', bloqueoMotor = 0, motorPrendido = false, motorBasico = false, ultPocion = 0, vivoAntes = true, pulsos = 0, pausaPulso = 0, ultPulso = 0, histCasts = [], tasaCast = 0;
  const avisoPoc = {}; let peleaSinDesde = 0;
  const enviar = (clave, texto, grave) => window.postMessage({ __muvigia: true, clave, texto: String(texto).slice(0, 280), grave: !!grave }, '*');
  const helperOn = () => call('HelperIsActive') === 1;
  const pilotoOn = () => !!(P() && P().activo());
  const cedido = () => !!(P() && P().cedido && P().cedido());
  const avisar = (t) => { try { if (window.__piloto && window.__piloto.nota) window.__piloto.nota('MODO', t); } catch (e) { /* nada */ } };
  function helper(v) { if (v === helperOn()) return; if (v && call('HelperIsSafeZone') === 1) return; call('HelperSetRunning', v ? 1 : 0); }

  // ---- ataque sin cursor del motor ----
  let CORREA = 8, lejosDelSpot = false, yendoAlAncla = false;     // correa del motor: si el juego te aleja más de 14 casillas del punto de partida, se corta y se vuelve (0 = sin correa)
  const motorOff = () => { call('SetAutoAttackToggle', 0); call('SetManualSkillHeld', 0); call('SetBasicAttackHeld', 0); motorPrendido = false; call('CancelHeroWalk'); lejosDelSpot = false; yendoAlAncla = false; try { window.__mover && window.__mover.parar(); } catch (e) { /* nada */ } };
  // v0.80.0: la habilidad de la Sostenida es configurable (por defecto 508 = Fire Burst; 78 = Fire Scream, de área). Lab > Habilidad y Test de habilidades.
  const HAB = { id: 508 };
  function elegirHabilidad() {
    try {
      const id0 = HAB.id, r = call('ResolveSkillTypeId', id0) | 0, id = r > 0 ? r : id0;
      return (call('SelectSkillTypeId', id) | 0) !== 0;
    } catch (e) { return false; }
  }
  // Pide el ataque del motor según el modo. Si no hay ninguna habilidad elegida usa el ataque básico (ej. nivel 1 después de un reset).
  // pulso = true: suelta y vuelve a apretar la habilidad sostenida (arma una pulsación nueva; el motor la gasta en un hechizo cuando el personaje puede actuar)
  function pedirMotor(pulso) {
    if (deseado === 'auto') { call('SetAutoAttackToggle', 1); return; }
    if (motorBasico) { call('SetBasicAttackHeld', 1); return; }
    if (pulso) call('SetManualSkillHeld', 0);
    call('SetManualSkillHeld', 1);
  }
  const lanzados = () => { try { return window.__paquetes && window.__paquetes.cuenta ? window.__paquetes.cuenta('tx', 'C3:0x19') : null; } catch (e) { return null; } };
  // Pulso extra al morir el bicho al que le pegábamos: el cambio de bicho tardaba ~300 ms (confirmación de muerte + hasta 150 ms hasta el próximo pulso).
  // Al llegar el aviso de muerte (C1 0x17) de uno de los últimos 3 blancos se pide un pulso enseguida (no cambia la cadencia de fondo).
  const ultBlancos = [], castT = [];
  // ESPERAR QUIETO (opcional, apagado de fábrica; botones Lab > Opciones y "Test quietos"). Pedido del usuario: los bichos que se mueven "no les llega", hay que esperar que se queden quietos.
  // Del desensamblado del cliente (FindBestWebCombatTarget): el motor elige solo el blanco con puntaje = 0,4 x cercanía + 0,6 x (1 - vida) + 0,5 x dirección del joystick (cambia de blanco solo si el
  // nuevo puntúa 1,25 veces más y no antes de 250 ms), NO mira si el bicho se mueve y no deja fijar bichos (PinSelectedTarget solo fija jugadores). O sea que desde acá no se puede ELEGIR al que
  // está quieto. Lo que sí se puede: no mandar pulsos mientras el blanco actual (el de la última tirada) se está moviendo y está a más de 'alcance' casillas (los bichos pegados al personaje
  // sí se pegan), hasta 'tope' ms por episodio (después un respiro de 1 s con pulsos libres para no trabarse). Ahorra hechizos que no llegan y evita que el motor corra detrás de un bicho que
  // se mueve. No se sabe si mata más rápido: medirlo con el "Test quietos" (alterna 60 s sin / 60 s con) y con telemetria.por_movimiento.
  const QUIETOS = { on: false, alcance: 2, tope: 600, desde: 0, libre: 0, esperas: 0, cortadas: 0, ms: 0 };
  try { const q = JSON.parse(localStorage.getItem('muQuietosV1') || 'null'); if (q && q.on) QUIETOS.on = true; } catch (e) { /* nada */ }
  function esperarQuieto(ahora) {
    if (!QUIETOS.on || ahora < QUIETOS.libre) return false;
    const u = castT[castT.length - 1]; if (!u || ahora - u.t > 700) { QUIETOS.desde = 0; return false; }
    const B = window.__bichos; if (!B || !B.mov) return false;
    const m = B.mov(u.tid);
    if (!m || !m.moviendose || (m.dist != null && m.dist <= QUIETOS.alcance)) { if (QUIETOS.desde) { QUIETOS.ms += ahora - QUIETOS.desde; QUIETOS.desde = 0; } return false; }
    if (!QUIETOS.desde) { QUIETOS.desde = ahora; QUIETOS.esperas++; }
    if (ahora - QUIETOS.desde > QUIETOS.tope) { QUIETOS.cortadas++; QUIETOS.ms += ahora - QUIETOS.desde; QUIETOS.desde = 0; QUIETOS.libre = ahora + 1000; return false; }
    return true;
  }
  // SALTAR BLANCO TRABADO (pedido del usuario con la caja 13: "aunque se acerque a menos de 4 casillas sigue sin pegarle, la guarda de cambiar es necesaria").
  // Cajas 10 a 13: el motor se queda tirándole a un bicho que no recibe NI UN golpe mientras hay otros al alcance: de 92 corridas de hechizos sobre un mismo blanco, 13 pasaron >= 0,8 s
  // sin golpe (una de 5,8 s). A 40-80 hechizos/s "10 hechizos" se cumplen en 0,15 s, antes de que llegue el primer golpe normal (mediana 0,1 s, p90 0,2 a 1,0 s): por eso la regla es
  // >= 10 hechizos Y >= 0,8 s sin golpe en ese blanco (cualquier golpe al blanco cuenta, también de la party) y que haya otro bicho a <= 7 casillas.
  // Escalera (el escalón siguiente solo si el motor sigue en el mismo blanco): 0) soltar el blanco (cortar camino, soltar habilidad, desfijar) y "ir y volver con la mira": un paso corto
  // hacia el vecino más cercano y vuelta (el motor suma 0,5 x dirección del joystick al puntaje de cada blanco); 1) + volver a elegir la habilidad y prender el AUTO del juego 0,5 s;
  // 2) + caminar 0,6 s hacia el vecino con los pulsos frenados. Anota cuántas veces cambió de blanco y con qué escalón (caja: telemetria.saltar). Botones del Lab: ON/OFF y Test saltar.
  // v0.71.0 ROTAR (pedido del usuario: "aún se queda un tiempo sin recibir daño; como los mata de 1 solo apuntar, rotemos en todos los bichos con un mínimo de tiempo para que logre tirarle esos 1 o 2"):
  // con rot (ON de fábrica) la regla pasa a ser "ROTACIÓN": se mide desde el ÚLTIMO golpe (no solo desde el primero) y se suelta el blanco apenas pasan rotMs (300 ms) y rotCasts (3) hechizos sin
  // que entre un golpe a ese bicho (el primer golpe llega a ~0,1 s de mediana: 300 ms es el mínimo para que le tire el 1 o 2 que lo matan). Un blanco que recibe golpes seguido no se toca; uno que muere
  // sale solo. No se puede ELEGIR el bicho (el motor puntúa cercanía + poca vida): se lo suelta y el motor reelige. Con rot apagado vale la regla vieja (10 hechizos y 0,8 s sin un solo golpe).
  const SALT = { on: true, rot: true, rotMs: 300, rotCasts: 3, rotMov: true, movMs: 120, dispMov: 0, limMs: 800, minCasts: 10, info: new Map(), saltados: new Map(), ultSalto: 0, ultLimpia: 0, ultSinAlt: 0, esperando: null, nivel: 0, disparos: 0, sinAlt: 0, ok: 0, okNivel: [0, 0, 0], falla: 0, msCambio: [], castsTrabados: 0, px: null, py: null, movT: 0, ultTid: null, muertes: new Map(), retargets: 0, retargetsMov: 0, castsTot: 0, castsMov: 0, volviendo: false, volvieron: 0, home: null, vigilarHasta: 0, ultVuelta: 0, malos: new Map(), reincidentes: 0, vueltasForzadas: 0 };
  // Caja 14 (v0.70.4): la guarda anda (22 de 30 saltos cambiaron de blanco, 16 en el primer escalón) pero el héroe se fue lejos: el primer salto fue seguido de una caminata de 8 casillas en 2,5 s
  // sin un solo hechizo (el ancla era vieja, a 8 casillas, y/o el motor salió detrás de un vecino a 4-7 casillas). Correcciones v0.70.5: 1) la vuelta es al ancla SOLO si está a <= 3 casillas
  // de donde estaba el héroe (si no, vuelve a donde estaba); 2) el vecino tiene que estar a <= 5 casillas (antes 7); 3) correa corta de 3 casillas durante 2,5 s después de cada salto;
  // 4) los blancos que ya se saltaron 2 veces en 90 s (en la caja 14 se repiten los mismos: 859, 1176, 1177, 707...) se saltan a los 0,35 s y 5 hechizos en vez de 0,8 s y 10.
  // El usuario (caja 13): "lo que hace mover la mira aparentemente es que se mueva un poco el personaje, y no se quede quieto, debería anclarse". En las cajas 3 a 13, entre dos hechizos
  // seguidos el motor cambió de blanco el 50 % de las veces cuando el héroe cambió de casilla (14 casos) contra el 9 % cuando estaba quieto. Por eso el empujón es un paso REAL y SIEMPRE
  // vuelve al ANCLA (REPO.home, donde prendiste Sostenida), no a donde estaba (que ya podía estar corrido). Además cuenta, sin contar los cambios por muerte ni los propios saltos,
  // cuántos cambios de blanco del motor coinciden con que el héroe se mueva (telemetria.saltar.retargets_*), para confirmar si el movimiento es lo que mueve la mira.
  try { const s = JSON.parse(localStorage.getItem('muSaltarV1') || 'null'); if (s && typeof s.on === 'boolean') SALT.on = s.on; if (s && typeof s.rot === 'boolean') SALT.rot = s.rot; } catch (e) { /* nada */ }
  // v0.83.0 (cajas 25 y 27): el golpe llega ~200 ms después del hechizo (p90 ~215) y el hechizo que mata es el 1º o 2º en el 90 % de los blancos: esperar 300 ms fijos sobra. La rotación espera
  // latencia medida + 40 ms (entre 220 y rotMs = 300): con 200 ms de latencia suelta el blanco sin respuesta a los 240 ms.
  const ROT_ADAPT = false;      // v0.83.2: apagada. Cajas 28-29 (v0.83.0/1): pausas de 0,8-4 s 24-30 % -> 46-65 % y hechizos/s 11 -> 7 con destrabe a 0,8 s + rotación adaptativa: se vuelve a los valores de v0.82
  const rotMsEf = () => { if (!ROT_ADAPT) return SALT.rotMs; try { const T = window.__telemetria, l = T && T.latencia ? T.latencia() : 0; if (l >= 80 && l <= 400) return Math.max(220, Math.min(SALT.rotMs, Math.round(l + 40))); } catch (e) { /* nada */ } return SALT.rotMs; };
  function saltarTx(tid) {
    const ahora = Date.now(), mov = ahora - SALT.movT < 400;
    SALT.castsTot++; if (mov) SALT.castsMov++;
    if (SALT.ultTid != null && tid !== SALT.ultTid && ahora - (SALT.muertes.get(SALT.ultTid) || 0) > 600 && ahora - SALT.ultSalto > 1500) { SALT.retargets++; if (mov) SALT.retargetsMov++; }   // cambio de blanco del motor sin que haya muerto el anterior
    SALT.ultTid = tid;
    let i = SALT.info.get(tid);
    if (!i || ahora - i.ult > 2500) { i = { t0: ahora, n: 0, hit: false, ult: ahora, lastHit: 0, nSin: 0 }; SALT.info.set(tid, i); }       // blanco nuevo (o que vuelve después de 2,5 s): cuenta desde cero
    i.n++; i.nSin = (i.nSin || 0) + 1; i.ult = ahora;
    const e = SALT.esperando;
    if (e && tid !== e.tid) { SALT.ok++; SALT.okNivel[e.nivel]++; SALT.msCambio.push(ahora - e.t); if (SALT.msCambio.length > 200) SALT.msCambio.shift(); SALT.esperando = null; SALT.nivel = 0; }
  }
  function saltarRx(u) {
    if (u[0] !== 0xC1) return;
    if (u[2] === 0x11 && (u.length === 10 || u.length === 16)) {
      const id = u.length === 16 ? ((u[4] | (u[5] << 8)) & 0x7FFF) : (((u[3] & 0x7F) << 8) | u[4]);
      const i = SALT.info.get(id); if (i) { i.hit = true; i.lastHit = Date.now(); i.nSin = 0; }
    } else if (u[2] === 0x17 && u.length >= 5) { const id = ((u[3] & 0x7F) << 8) | u[4]; SALT.info.delete(id); SALT.muertes.set(id, Date.now()); }
  }
  // Vuelve a 'home' con el movimiento calibrado (pasos cortos, los pulsos siguen); termina al llegar (tol casillas) o a los maxMs. El 'home' lo elige quien llama (ancla si está cerca).
  async function volverAlAncla(home, maxMs, tol) {
    const Mv = window.__mover;
    try {
      if (!Mv || !Mv.paso || !home) return;
      const t0 = Date.now();
      while (Date.now() - t0 < maxMs && vivoInst && (deseado === 'sostener' || deseado === 'pulsos')) {
        const r = Mv.paso(home.x, home.y, tol);
        if (r === 'llegó' || r === 'sin dirección' || r === 'sin calibrar') break;
        await new Promise((res) => setTimeout(res, 120));
      }
      SALT.volvieron++;
    } finally { try { if (Mv && Mv.parar) Mv.parar(); } catch (e) { /* nada */ } SALT.volviendo = false; }
  }
  const movDe = (B, id) => { try { const m = B && B.mov ? B.mov(id) : null; return m && m.moviendose ? 1 : 0; } catch (e) { return 0; } };
  function saltarTrabado(ahora) {
    { const px = call('GetHeroX'), py = call('GetHeroY'); if (px !== SALT.px || py !== SALT.py) { SALT.px = px; SALT.py = py; SALT.movT = ahora; } }          // cuándo se movió el héroe por última vez (también con 'saltar' apagado: sirve de línea base)
    if (!SALT.on) return;
    if (ahora - SALT.ultLimpia > 1000) { SALT.ultLimpia = ahora; SALT.info.forEach((v, k) => { if (ahora - v.ult > 6000) SALT.info.delete(k); }); SALT.saltados.forEach((v, k) => { if (ahora > v) SALT.saltados.delete(k); }); SALT.muertes.forEach((v, k) => { if (ahora - v > 6000) SALT.muertes.delete(k); }); SALT.malos.forEach((v, k) => { if (ahora - v.t > 90000) SALT.malos.delete(k); }); }
    // correa corta después de un salto: ya soltado el blanco, el motor puede salir caminando detrás de un vecino lejano (caja 14: 8 casillas en 2,5 s sin hechizos)
    if (SALT.vigilarHasta > ahora && !SALT.volviendo && ahora - SALT.ultVuelta > 600 && SALT.home && SALT.px != null && cheb({ x: SALT.px, y: SALT.py }, SALT.home) > 3 && (deseado === 'sostener' || deseado === 'pulsos')) {
      SALT.ultVuelta = ahora; SALT.volviendo = true; SALT.vueltasForzadas++; call('CancelHeroWalk');
      volverAlAncla(SALT.home, 1500, 0).catch(() => { /* nada */ }); return;
    }
    const u = castT[castT.length - 1]; if (!u || ahora - u.t > 300) return;                      // el blanco actual es el de la última tirada
    const mal = SALT.malos.get(u.tid), rapido = !!(mal && mal.n >= 2 && ahora - mal.t < 90000), lim = rapido ? 350 : SALT.limMs, minC = rapido ? 5 : SALT.minCasts;
    const i = SALT.info.get(u.tid); if (!i) return;
    let blancoMov = false;
    if (SALT.rot) {
      // v0.71.1 (caja 18): los hechizos a bichos que se MUEVEN responden el 10 % contra el 42 % de los quietos (a 6-7 casillas 5 % contra 100 %): si el blanco se mueve se lo suelta a los 120 ms y 2 hechizos
      let lim = rotMsEf(), minN = SALT.rotCasts;
      if (SALT.rotMov) { try { const B0 = window.__bichos, m0 = B0 && B0.mov ? B0.mov(u.tid) : null; if (m0 && m0.moviendose) { blancoMov = true; lim = SALT.movMs; minN = 2; } } catch (e) { /* nada */ } }
      if ((i.nSin || 0) < minN || ahora - (i.lastHit || i.t0) < lim) return;       // rotación: desde el último golpe (o desde el primer hechizo si no hubo ninguno)
    }       // rotación: desde el último golpe (o desde el primer hechizo si no hubo ninguno)
    else if (i.hit || i.n < minC || ahora - i.t0 < lim) return;
    if (ahora - SALT.ultSalto < (SALT.rot ? 350 : 600) || ahora < pausaPulso || VENT.auto || SALT.volviendo || (deseado !== 'sostener' && deseado !== 'pulsos')) return;
    if (call('GetBlockingUiOpen') === 1 || call('IsMasterSkillTreeOpen') === 1 || call('MsgVisible') === 1 || call('TextInputActive') === 1) return;
    const B = window.__bichos; if (!B || !B.vista) return;
    const h = { x: call('GetHeroX'), y: call('GetHeroY') };
    const alt = B.vista().filter((v) => v.id !== u.tid && cheb(v, h) <= 5 && !((SALT.saltados.get(v.id) || 0) > ahora)).sort((p, q) => (SALT.rotMov ? movDe(B, p.id) - movDe(B, q.id) : 0) || cheb(p, h) - cheb(q, h))[0];       // con rotMov los bichos quietos van primero (los que se mueven casi no reciben golpes)
    if (!alt) { if (ahora - SALT.ultSinAlt > 2000) { SALT.ultSinAlt = ahora; SALT.sinAlt++; } return; }       // no hay otro al que pasar: se sigue como siempre
    const prev = SALT.esperando;
    if (prev && prev.tid === u.tid) { SALT.falla++; SALT.nivel = ahora - prev.t < 3500 ? Math.min(SALT.nivel + 1, SALT.rot ? 1 : 2) : 0; } else SALT.nivel = 0;
    const nv = SALT.nivel, casts = i.n, seg = (ahora - i.t0) / 1000;
    if (blancoMov) SALT.dispMov++;
    SALT.disparos++; SALT.ultSalto = ahora; SALT.esperando = { tid: u.tid, t: ahora, nivel: nv }; SALT.castsTrabados += casts;
    SALT.saltados.set(u.tid, ahora + 4000);
    const m1 = { n: (mal && ahora - mal.t < 90000 ? mal.n : 0) + 1, t: ahora }; SALT.malos.set(u.tid, m1); if (m1.n === 2) SALT.reincidentes++;
    // ancla: solo si está cerca de donde estoy (<= 3 casillas); si quedó vieja (el héroe se llevó a mano a otro lado) se vuelve a donde estaba
    const anc = REPO.home && REPO.mapa === call('GetMapIndex') ? REPO.home : null, ancVieja = !!anc && cheb(anc, h) > 3, home = anc && !ancVieja ? { x: anc.x, y: anc.y } : { x: h.x, y: h.y };
    SALT.home = home; SALT.vigilarHasta = ahora + 2500;
    if (SALT.rot) { i.lastHit = ahora - rotMsEf() + 200; i.nSin = SALT.rotCasts; } else { i.t0 = ahora - (SALT.limMs - 500); i.n = SALT.minCasts; }                                             // si el motor insiste con el mismo, se vuelve a actuar a los 0,5 s
    call('CancelHeroWalk'); call('SetManualSkillHeld', 0); call('SetBasicAttackHeld', 0); call('ClearPinnedTarget');
    pausaPulso = Math.max(pausaPulso, ahora + 120);
    const Mv = window.__mover, conMv = !!(Mv && Mv.tabla && Mv.tabla());
    if (conMv && !(ESTRAT.on && ESTRAT.quieto)) {                                           // "ir y volver con la mira" (con "quieto" el escalón 0 solo suelta el blanco: caja 15, la mitad de los cambios de casilla eran los empujones): un paso REAL y vuelta al ANCLA
      // si el vecino está pegado (a 1 casilla) el paso hacia él no mueve nada: se da en sentido contrario al blanco trabado
      const st = B.vista().find((v) => v.id === u.tid), dest = cheb(alt, h) >= 2 || !st ? alt : { x: h.x + 3 * (Math.sign(h.x - st.x) || 1), y: h.y + 3 * (Math.sign(h.y - st.y) || 0) };
      const largo = nv >= 2 && !(ESTRAT.on && ESTRAT.quieto), ida = largo ? 600 : 260;               // escalón 2: caminata más larga (con los pulsos frenados), salvo con "quieto"
      SALT.volviendo = true;
      setTimeout(() => { try { Mv.paso(dest.x, dest.y, largo ? 1 : 0); } catch (e) { /* nada */ } }, 130);
      setTimeout(() => { volverAlAncla(home, 1800, 0).catch(() => { /* nada */ }); }, 130 + ida);
      if (largo) pausaPulso = Math.max(pausaPulso, ahora + 130 + ida);
    }
    if (nv >= 1) { elegirHabilidad(); call('SetAutoAttackToggle', 1); setTimeout(() => { if (deseado !== 'auto') call('SetAutoAttackToggle', 0); }, 500); pausaPulso = Math.max(pausaPulso, ahora + 550); }
    if (SALT.disparos <= 25 || SALT.disparos % 5 === 0) avisar('saltar blanco #' + u.tid + ': ' + casts + ' hechizos en ' + seg.toFixed(1) + ' s sin un golpe (escalón ' + nv + (rapido ? ', reincidente' : '') + ') → vecino #' + alt.id + ' a ' + cheb(alt, h) + ' casillas · vuelvo a (' + home.x + ',' + home.y + ')' + (ancVieja ? ' [el ancla (' + anc.x + ',' + anc.y + ') está a ' + cheb(anc, h) + ': la dejo]' : '') + ' · cambiaron ' + SALT.ok + ' de ' + SALT.disparos);
  }
  // Cadencia de los últimos N segundos: cuánto tiempo se va en la "cadena rápida" (intervalos < 130 ms), en ciclos lentos (180-400 ms) y en huecos (>= 400 ms).
  // Medido en la caja 58 (mapa 80): ~30 % del tiempo en cadena de 110 ms, ~48 % en ciclos de ~300 ms (dos hechizos cada ~330 ms), ~18 % en huecos.
  function cadencia(seg = 30) {
    const corte = Date.now() - seg * 1000, L = castT.filter((x) => x.t >= corte); if (L.length < 5) return null;
    let rap = 0, len = 0, hue = 0, otr = 0, cam = 0, ttot = 0;
    for (let i = 0; i < L.length - 1; i++) { const iv = L[i + 1].t - L[i].t; ttot += iv; if (iv < 130) rap += iv; else if (iv < 180) otr += iv; else if (iv < 400) len += iv; else hue += iv; if (L[i + 1].tid !== L[i].tid) cam++; }
    const p = (x) => Math.round(100 * x / (ttot || 1)), iv2 = L.slice(1).map((x, i) => x.t - L[i].t);
    return { seg: Math.round(ttot / 1000), hechizos: L.length, por_seg: +(L.length / (ttot / 1000)).toFixed(2), cadena_rapida_pct: p(rap), ciclos_lentos_pct: p(len), huecos_pct: p(hue), otros_pct: p(otr), bajo_98ms_pct: Math.round(100 * iv2.filter((x) => x < 98).length / iv2.length), cambios_de_blanco_pct: Math.round(100 * cam / (L.length - 1)), activos_por_seg: +((L.length - 1) / ((ttot - hue) / 1000 || 1)).toFixed(2) };
  }
  let vivoInst = true; (window.__muLimpiar = window.__muLimpiar || []).push(() => { vivoInst = false; });   // los oyentes de paquetes no se pueden quitar: los de instancias viejas se apagan con esta marca
  let escuchando = false, pulsosMuerte = 0, propias = 0;   // propias: bichos muertos a los que yo le había tirado un hechizo (sirve para medir si más daño/velocidad mata más)
  setInterval(() => {
    try {
      const Pq = window.__paquetes; if (escuchando || !Pq || !Pq.alRecibir) return; escuchando = true;
      Pq.alEnviar((u) => { if (vivoInst && u.length >= 7 && u[0] === 0xC3 && u[2] === 0x19) { const tid = ((u[5] & 0x7F) << 8) | u[6]; castT.push({ t: Date.now(), tid }); if (castT.length > 400) castT.shift(); saltarTx(tid); if (ultBlancos[ultBlancos.length - 1] !== tid) { ultBlancos.push(tid); if (ultBlancos.length > 3) ultBlancos.shift(); } } });
      Pq.alRecibir((u) => {
        if (vivoInst) saltarRx(u);
        if (!vivoInst || u[0] !== 0xC1 || u[2] !== 0x17 || u.length < 5 || (deseado !== 'sostener' && deseado !== 'pulsos')) return;
        const id = ((u[3] & 0x7F) << 8) | u[4];
        if (!ultBlancos.includes(id)) return;
        propias++;
        const ahora = Date.now(); if (ahora < pausaPulso || ahora - ultPulso < (ritmoSeguro ? huecoPulso() : 60)) return;
        ultPulso = ahora; pedirMotor(true); pulsos++; pulsosMuerte++;
      });
    } catch (e) { escuchando = false; }
  }, 1000);
  // DESTRABAR: en la caja 54 el 24 % del tiempo se fue en huecos de >0,4 s sin hechizos, tres de ellos de 5 a 12 s con 11 a 44 bichos a la vista:
  // el motor del juego se queda en un blanco lejano/inalcanzable (el último blanco era a 7 casillas) o yendo a juntar items (24 pickups en 14 s).
  // Si pasan 1,2 s sin hechizos con bichos a <= 9 casillas (y no estamos caminando a propósito): se corta el camino del juego, se suelta el blanco y se
  // vuelve a pulsar. Cuenta cuántas veces lo intentó y cuántas veces salió un hechizo dentro de los 2,5 s siguientes (para medirlo en la caja).
  // Escalera (caja 58: de 24 intentos solo 10 destrabaron, con atascos de 7 y 15 s con bichos pegándole): si el primer intento (cortar camino + soltar) no
  // alcanza y siguen sin salir hechizos, el siguiente además vuelve a elegir la habilidad y prende el AUTO del juego medio segundo, y el tercero además da un
  // paso hacia el bicho más cercano (solo si está a <= 9 casillas y dentro de la correa). Anota cuál nivel funcionó.
  const DESTR = { on: true, ms: 1200, kicks: 0, ok: 0, ultKick: 0, esperando: 0, ultC: -1, ultCastT: 0, nivel: 0, okNivel: [0, 0, 0], movT: 0, ultPos: '', uiDesde: 0, uiAviso: 0 };
  // Caja 59: dos veces el personaje pasó 70-80 s sin lanzar NADA (ni un paso) con 6-15 bichos pegándole (vida hasta 32 %) justo mientras se gastaban puntos
  // master: con una ventana del juego abierta (árbol master, tienda, mensaje) el motor no ataca. Ahí el destrabador no hace nada y avisa.
  function destrabar(ahora) {
    const ui = call('GetBlockingUiOpen') === 1 || call('IsMasterSkillTreeOpen') === 1 || call('MsgVisible') === 1 || call('TextInputActive') === 1 || call('ShopWindowOpen') === 1;
    if (ui) {
      if (!DESTR.uiDesde) DESTR.uiDesde = ahora;
      DESTR.ultCastT = ahora; DESTR.esperando = 0; DESTR.nivel = 0;
      if (ahora - DESTR.uiDesde > 20000 && ahora - DESTR.uiAviso > 120000) {
        DESTR.uiAviso = ahora; const mx = call('GetPlayerLifeMax') || 1, v = Math.round(100 * call('GetPlayerLife') / mx);
        enviar('ventana_abierta', 'Hay una ventana del juego abierta hace ' + Math.round((ahora - DESTR.uiDesde) / 1000) + ' s (ej. el árbol master): el personaje NO ataca mientras esté abierta. Vida ' + v + ' %.', v < 60);
      }
      return;
    }
    if (DESTR.uiDesde) { const s = ahora - DESTR.uiDesde; DESTR.uiDesde = 0; DESTR.ultCastT = ahora; if (s >= 3000) avisar('ventana del juego abierta ' + Math.round(s / 1000) + ' s: el motor no ataca con ventanas abiertas'); }
    const c = lanzados(); if (c == null) return;
    const pos = call('GetHeroX') + ',' + call('GetHeroY'); if (pos !== DESTR.ultPos) { DESTR.ultPos = pos; DESTR.movT = ahora; }
    if (c !== DESTR.ultC) { if (DESTR.esperando && ahora - DESTR.esperando < 3000) { DESTR.ok++; DESTR.okNivel[DESTR.nivel]++; } DESTR.esperando = 0; DESTR.nivel = 0; DESTR.ultC = c; DESTR.ultCastT = ahora; return; }
    if (!DESTR.on || !DESTR.ultCastT || ahora - DESTR.ultCastT < DESTR.ms || ahora - DESTR.ultKick < 1500 || ahora < pausaPulso || ahora - DESTR.movT < 1000) return;   // si el personaje se está moviendo (camino a propósito) no se toca
    const B = window.__bichos; if (!B || !B.vista) return;
    const h = { x: call('GetHeroX'), y: call('GetHeroY') };
    const cerca = B.vista().filter((v) => cheb(v, h) <= 9).sort((p, q) => cheb(p, h) - cheb(q, h));
    if (!cerca.length) return;                                                     // sin bichos cerca no hay nada que destrabar (esperar respawns es normal)
    DESTR.nivel = DESTR.esperando ? Math.min(DESTR.nivel + 1, 2) : 0;             // si el intento anterior no sirvió, se sube un escalón
    DESTR.ultKick = ahora; DESTR.esperando = ahora; DESTR.kicks++;
    call('CancelHeroWalk'); call('SetManualSkillHeld', 0); call('SetBasicAttackHeld', 0); call('ClearPinnedTarget');
    pausaPulso = Math.max(pausaPulso, ahora + 120);
    if (DESTR.nivel >= 1) {
      elegirHabilidad(); call('SetAutoAttackToggle', 1); setTimeout(() => { if (deseado !== 'auto') call('SetAutoAttackToggle', 0); }, 500);
      pausaPulso = Math.max(pausaPulso, ahora + 550);
    }
    if (DESTR.nivel >= 2 && !(ESTRAT.on && ESTRAT.quieto)) {         // con "quieto" prendido no hay caminata hacia el bicho (el héroe no se mueve)
      const Mv = window.__mover, t = cerca[0], dh = REPO.home ? cheb(t, REPO.home) : 0;
      if (Mv && Mv.tabla && Mv.tabla() && dh <= CORREA && cheb(t, h) >= 2) { Mv.paso(t.x, t.y, 1); setTimeout(() => { try { Mv.parar(); } catch (e) { /* nada */ } }, 600); pausaPulso = Math.max(pausaPulso, ahora + 700); }
    }
    if (DESTR.kicks <= 8 || DESTR.kicks % 10 === 0) avisar('destrabé (escalón ' + DESTR.nivel + '): ' + (Math.round((ahora - DESTR.ultCastT) / 100) / 10) + ' s sin hechizos con ' + cerca.length + ' bichos a <= 9 casillas (intento ' + DESTR.kicks + ', funcionaron ' + DESTR.ok + ': ' + DESTR.okNivel.join('/') + ') · en (' + h.x + ',' + h.y + ') · ventana ' + call('GetBlockingUiOpen') + ' árbol ' + call('IsMasterSkillTreeOpen') + ' texto ' + call('TextInputActive') + ' foco ' + ((typeof document !== 'undefined' && document.hasFocus && document.hasFocus()) ? 1 : 0));
  }
  // VENTANAS: el juego no deja atacar con una ventana abierta o con el campo de texto activo (caja 70: 10 s con 2 hechizos y 5 a 19 bichos cerca mientras TextInputActive = 1).
  // Se anota qué banderas del juego están prendidas cuando se corta el ataque, cuánto dura y cuánto tarda en salir el primer hechizo al cerrar. Al cerrar se vuelve a armar
  // el ataque (habilidad elegida, blanco soltado, pulso nuevo) por si la ventana desordenó la selección; si pasan 3 s sin hechizos (y hay bichos cerca) se re-arma otra vez.
  const VENT = { flags: '', t0: 0, c0: 0, esperando: 0, c1: 0, extra: false, rearmes: 0, log: [], auto: false, autoCorte: false, autoDesde: 0, autoC0: null };
  const banderasUi = () => {
    const f = [];
    if (call('GetBlockingUiOpen') === 1) f.push('ventana');
    if (call('IsMasterSkillTreeOpen') === 1) f.push('arbol_master');
    if (call('MsgVisible') === 1) f.push('mensaje');
    if (call('TextInputActive') === 1) f.push('texto');
    if (call('ShopWindowOpen') === 1) f.push('tienda');
    if (call('ShopPriceDialogOpen') === 1) f.push('precio');
    if (call('InventoryHasPickedItem') === 1) f.push('item_en_mano');
    if (call('GetMoveListVisible') === 1) f.push('lista_move');
    return f.some((x) => x !== 'lista_move' && x !== 'item_en_mano') ? f.join('+') : '';      // la lista de /move o un objeto en la mano, solos, no frenan el ataque (caja 10: el ataque siguió con la lista abierta)
  };
  const anotarVent = (o) => { o.hora = new Date().toISOString().slice(11, 19); VENT.log.push(o); if (VENT.log.length > 80) VENT.log.shift(); avisar('ventanas: ' + Object.keys(o).filter((k) => k !== 'hora').map((k) => k + '=' + o[k]).join(' ')); };
  const bichosA9 = () => { try { const B = window.__bichos; if (!B || !B.vista) return null; const h = { x: call('GetHeroX'), y: call('GetHeroY') }; return B.vista().filter((v) => cheb(v, h) <= 9).length; } catch (e) { return null; } };
  function rearmarAtaque() {
    VENT.rearmes++;
    call('CancelHeroWalk'); call('SetManualSkillHeld', 0); call('SetBasicAttackHeld', 0); call('ClearPinnedTarget');
    elegirHabilidad();
    ultPulso = 0; pausaPulso = Math.max(pausaPulso, Date.now() + 150);
  }
  // PRUEBA con ventana abierta (caja 0.68.4: con inventario/stats abiertos la Sostenida saca 1 hechizo en 9,5 s y 1 en 4,5 s; al cerrar vuelve en ~100 ms).
  // Con la ventana YA abierta, prueba 4 formas de atacar de a `seg` segundos y mide hechizos enviados y golpes recibidos: Sostenida (la de siempre), ataque básico,
  // AUTO del juego y Helper del juego. Solo usa funciones del propio juego. Se corta si se cierra la ventana, si morís o si la vida baja de 35 %.
  let probandoVent = false;
  async function probarVentana(seg = 3) {
    if (probandoVent) return { ok: false, motivo: 'ya hay una prueba andando' };
    if (call('GetSceneFlag') !== 5 || !(call('GetPlayerLife') > 0)) return { ok: false, motivo: 'no estás jugando o estás muerto' };
    if (!banderasUi()) return { ok: false, motivo: 'abrí primero el inventario o los stats y después apretá el botón (con la ventana ya abierta)' };
    probandoVent = true; if (VENT.auto) { VENT.auto = false; call('SetAutoAttackToggle', 0); }
    const dorm = (ms) => new Promise((r) => setTimeout(r, ms));
    const golpes = () => { try { return window.__paquetes.cuenta('rx', 'C1:0x11'); } catch (e) { return null; } };
    const vidaOk = () => { const mx = call('GetPlayerLifeMax') || 1; return call('GetPlayerLife') / mx >= 0.35; };
    const out = { ok: true, ventana: banderasUi(), seg_por_forma: seg, formas: [], corte: null };
    const formas = [
      { n: 'sostenida (la de siempre)', pausar: false },
      { n: 'ataque basico', pausar: true, entrar: () => { call('SetManualSkillHeld', 0); call('SetBasicAttackHeld', 1); }, salir: () => call('SetBasicAttackHeld', 0) },
      { n: 'AUTO del juego', pausar: true, entrar: () => { call('SetManualSkillHeld', 0); call('SetAutoAttackToggle', 1); }, salir: () => call('SetAutoAttackToggle', 0) },
      { n: 'Helper del juego', pausar: true, entrar: () => { call('SetManualSkillHeld', 0); if (call('HelperIsSafeZone') !== 1) call('HelperSetRunning', 1); }, salir: () => { call('HelperSetRunning', 0); call('CancelHeroWalk'); } },
    ];
    try {
      for (const f of formas) {
        if (!banderasUi()) { out.corte = 'se cerró la ventana antes de probar: ' + f.n; break; }
        if (!vidaOk()) { out.corte = 'vida baja'; break; }
        const c0 = lanzados(), g0 = golpes(), t0 = Date.now();
        if (f.pausar) pausaPulso = Math.max(pausaPulso, t0 + seg * 1000 + 400);
        if (f.entrar) f.entrar();
        await dorm(seg * 1000);
        if (f.salir) f.salir();
        const c1 = lanzados(), g1 = golpes();
        out.formas.push({ forma: f.n, hechizos: c0 != null && c1 != null ? c1 - c0 : null, golpes_recibidos: g0 != null && g1 != null ? g1 - g0 : null, ventana_seguia_abierta: !!banderasUi(), helper_prendido: f.n.indexOf('Helper') === 0 ? helperOn() : undefined });
        await dorm(300);
      }
    } finally {
      call('SetBasicAttackHeld', 0);
      if (deseado !== 'auto') call('SetAutoAttackToggle', 0);
      if (deseado !== 'helper' && deseado !== 'piloto' && helperOn()) call('HelperSetRunning', 0);
      probandoVent = false; rearmarAtaque();
    }
    out.resumen = out.formas.map((x) => x.forma + ': ' + x.hechizos + ' hechizos, ' + x.golpes_recibidos + ' golpes' + (x.ventana_seguia_abierta ? '' : ' (la ventana se cerró)')).join(' | ');
    anotarVent({ evento: 'prueba_ataque_con_ventana', ventana: out.ventana, resultado: out.resumen, corte: out.corte });
    return out;
  }
  // AUTO CON VENTANA: con una ventana abierta (inventario, stats) el juego no deja atacar con Sostenida, ataque básico ni Helper (0 hechizos en 3 s cada uno), pero el AUTO del juego sí
  // (9 hechizos y 7 golpes en 3 s, sin mover al personaje). Mientras haya 'ventana' o 'texto' (y no tienda, precio, árbol master ni mensaje) se prende el AUTO y se frenan los pulsos;
  // al cerrar se apaga y vuelve la Sostenida (con el re-armado). Si el AUTO te aleja más de la correa se apaga hasta que se cierre la ventana (con ella abierta no se puede caminar de vuelta).
  // PARADAS: caja (9) (nivel 294, mapa 210, pulso 10 ms): el 50 % de las ventanas de 200 ms salió sin ningún hechizo y el 42 % del tiempo se fue en paradas de >= 1,2 s, con 18 a 21 bichos "a la vista".
  // Por cada parada de >= 0,8 s se anota cuántos bichos había a <= 3 / 6 / 9 / 14 casillas al empezar y al terminar y si había blanco fijado, para separar "no hay bichos al alcance" (falta de oferta)
  // de "hay bichos al alcance y el motor del juego no lanza" (motor trabado o mal apuntado).
  const PAR = { ultC: null, ultT: 0, abierta: null, log: [], n: 0, seg: 0, segSost: 0, causas: {} };
  const bichosCerca = () => { try { const B = window.__bichos; if (!B || !B.vista) return null; const h = { x: call('GetHeroX'), y: call('GetHeroY') }, v = B.vista(), n = (r) => v.filter((m) => cheb(m, h) <= r).length; return { d3: n(3), d6: n(6), d9: n(9), d14: n(14) }; } catch (e) { return null; } };
  function seguirParadas(ahora, c, hayVentana) {
    if (hayVentana || c == null) { PAR.ultC = c; PAR.ultT = ahora; PAR.abierta = null; return; }
    PAR.segSost += 0.1;
    if (PAR.ultC == null || c !== PAR.ultC) {
      if (PAR.abierta) {
        const dur = ahora - PAR.abierta.t0, ini = PAR.abierta.ini, fin = bichosCerca();
        const causa = !ini ? 'sin_dato' : ini.d3 > 0 ? 'bichos_a_3_sin_hechizos' : ini.d6 > 0 ? 'bichos_a_6_sin_hechizos' : 'sin_bichos_a_6';
        PAR.n++; PAR.seg += dur / 1000; PAR.causas[causa] = (PAR.causas[causa] || 0) + 1;
        PAR.log.push({ hora: new Date(PAR.abierta.t0).toISOString().slice(11, 19), dur_ms: Math.round(dur), ini, fin, fijado: PAR.abierta.pin, vida: PAR.abierta.vida }); if (PAR.log.length > 100) PAR.log.shift();
        PAR.abierta = null;
      }
      PAR.ultC = c; PAR.ultT = ahora;
    } else if (!PAR.abierta && ahora - PAR.ultT >= 800) {
      const mx = call('GetPlayerLifeMax') || 1;
      PAR.abierta = { t0: PAR.ultT, ini: bichosCerca(), pin: call('HasPinnedTarget'), vida: Math.round(100 * call('GetPlayerLife') / mx) };
    }
  }
  const paradasResumen = () => ({ paradas_de_0_8s_o_mas: PAR.n, segundos_en_paradas: Math.round(PAR.seg), segundos_con_sostenida: Math.round(PAR.segSost), pct_del_tiempo_parado: PAR.segSost ? Math.round(1000 * PAR.seg / PAR.segSost) / 10 : null, por_causa: { ...PAR.causas }, ultimas: PAR.log.slice(-60) });
  let AUTOVENT = true; try { const r = JSON.parse(localStorage.getItem('muAutoVentV1') || 'null'); if (r && r.on === false) AUTOVENT = false; } catch (e) { /* nada */ }
  const autoPermitido = (f) => AUTOVENT && !probandoVent && /(^|\+)(ventana|texto)(\+|$)/.test(f) && !/(tienda|precio|arbol_master|mensaje)/.test(f);
  function autoVentanaOff(por) {
    const n = lanzados(); VENT.auto = false; if (deseado !== 'auto') call('SetAutoAttackToggle', 0);
    anotarVent({ evento: 'auto_off', por, seg: Math.round((Date.now() - VENT.autoDesde) / 100) / 10, hechizos: n != null && VENT.autoC0 != null ? n - VENT.autoC0 : null });
  }
  setInterval(() => {
    try {
      if ((deseado !== 'sostener' && deseado !== 'pulsos') || call('GetSceneFlag') !== 5) { VENT.flags = ''; VENT.esperando = 0; PAR.ultC = null; PAR.abierta = null; if (VENT.auto) autoVentanaOff('cambió el modo'); return; }
      const ahora = Date.now(), f = banderasUi(), c = lanzados();
      seguirParadas(ahora, c, !!f);
      const quiereAuto = autoPermitido(f);
      if (quiereAuto && !VENT.auto && !VENT.autoCorte) { VENT.auto = true; VENT.autoDesde = ahora; VENT.autoC0 = c; call('SetManualSkillHeld', 0); call('SetAutoAttackToggle', 1); anotarVent({ evento: 'auto_on', banderas: f }); }
      else if (VENT.auto && !quiereAuto) autoVentanaOff(f ? 'cambió a ' + f : 'se cerró la ventana');
      else if (VENT.auto && CORREA > 0 && REPO.home) { const dh = Math.max(Math.abs(call('GetHeroX') - REPO.home.x), Math.abs(call('GetHeroY') - REPO.home.y)); if (dh > CORREA) { VENT.autoCorte = true; call('CancelHeroWalk'); autoVentanaOff('correa: ' + dh + ' casillas'); } }
      if (!f) VENT.autoCorte = false;
      if (f !== VENT.flags) {
        if (f && !VENT.flags) { VENT.t0 = ahora; VENT.c0 = c; VENT.esperando = 0; anotarVent({ evento: 'abrio', banderas: f, hechizos_tx: c }); }
        else if (!f && VENT.flags) {
          rearmarAtaque(); VENT.esperando = ahora; VENT.c1 = c; VENT.extra = false;
          anotarVent({ evento: 'cerro', banderas: VENT.flags, duro_s: Math.round((ahora - VENT.t0) / 100) / 10, hechizos_durante: c != null && VENT.c0 != null ? c - VENT.c0 : null, bichos_a_9: bichosA9() });
        } else anotarVent({ evento: 'cambio', de: VENT.flags, a: f });
        VENT.flags = f;
      }
      if (VENT.esperando && c != null && !VENT.flags) {
        const dt = ahora - VENT.esperando;
        if (c > VENT.c1) { anotarVent({ evento: 'primer_hechizo', tras_ms: dt, re_armado_extra: VENT.extra }); VENT.esperando = 0; }
        else if (dt > 3000 && !VENT.extra) { VENT.extra = true; const b = bichosA9(); anotarVent({ evento: 'sin_hechizos_3s', bichos_a_9: b }); if (b) rearmarAtaque(); }
        else if (dt > 10000) { anotarVent({ evento: 'sin_hechizos_10s', bichos_a_9: bichosA9() }); VENT.esperando = 0; }
      }
    } catch (e) { /* nada */ }
  }, 100);
  // Bomba de pulsaciones: solo en los modos 'sostener' y 'pulsos'. Con guardia de velocidad: si se ven más de 4,5 hechizos/s, pausa 5 s.
  setInterval(() => {
    try {
      if ((deseado !== 'sostener' && deseado !== 'pulsos') || call('GetSceneFlag') !== 5 || !(call('GetPlayerLife') > 0)) return;
      const ahora = Date.now();
      if (!histCasts.length || ahora - histCasts[histCasts.length - 1].t >= 1000) {
        const c = lanzados(); if (c != null) { histCasts.push({ t: ahora, c }); while (histCasts.length > 6) histCasts.shift(); }
        if (histCasts.length >= 4) { const a = histCasts[histCasts.length - 4], z = histCasts[histCasts.length - 1]; tasaCast = (z.c - a.c) / ((z.t - a.t) / 1000); }
        if (tasaCast > topeCasts() && ahora > pausaPulso) { pausaPulso = ahora + 5000; nota = 'ritmo ' + tasaCast.toFixed(1) + ' hechizos/s (tope ' + topeCasts() + '): pauso los pulsos 5 s'; avisar('pulsos en pausa por ritmo alto: ' + tasaCast.toFixed(1) + '/s'); }
      }
      // Correa: el cliente persigue bichos lejanos por su cuenta (como el botón de ataque del celular). Si te alejó demasiado del punto de partida,
      // se deja de pulsar, se cancela el camino del juego y se camina de vuelta con el movimiento calibrado.
      const mpa = call('GetMapIndex');
      if (!REPO.home || REPO.mapa !== mpa) {      // cambió el mapa (viajaste): el punto de partida es donde caíste, no el del mapa anterior
        REPO.home = { x: call('GetHeroX'), y: call('GetHeroY') }; REPO.mapa = mpa;
        if (lejosDelSpot || REPO.caminando) { lejosDelSpot = false; REPO.caminando = false; try { window.__mover && window.__mover.parar(); } catch (e) { /* nada */ } call('CancelHeroWalk'); }
        nota = 'mapa nuevo: mi punto de partida es donde caí (' + REPO.home.x + ',' + REPO.home.y + ')';
      }
      if (yendoAlAncla) { call('SetManualSkillHeld', 0); return; }      // caminando hacia el ancla: sin pulsos
      // Con "quieto" prendido la correa es de 3 casillas (antes 8) y se vuelve hasta 1 casilla del ancla: el héroe casi no se mueve (caminando no ataca)
      const qt = ESTRAT.on && ESTRAT.quieto, leash = qt ? Math.min(CORREA || ESTRAT.correa, ESTRAT.correa) : CORREA;
      if (leash > 0 && REPO.home) {
        const dh = Math.max(Math.abs(call('GetHeroX') - REPO.home.x), Math.abs(call('GetHeroY') - REPO.home.y));
        if (dh > leash || (lejosDelSpot && dh > (qt ? 1 : 3))) {
          // v0.70.7: el ancla es UN solo spot elegido al prender Sostenida; ya no se re-ancla si te llevan a mano (solo apagando y prendiendo se elige de nuevo)
          if (!lejosDelSpot) { lejosDelSpot = true; ESTRAT.correaVueltas++; call('SetManualSkillHeld', 0); call('CancelHeroWalk'); nota = 'el juego me alejó ' + dh + ' casillas del punto de partida: vuelvo'; if (ESTRAT.correaVueltas <= 12 || ESTRAT.correaVueltas % 10 === 0) avisar('correa del motor: ' + dh + ' casillas, vuelvo al punto de partida (' + ESTRAT.correaVueltas + ')'); }
          const Mv = window.__mover; if (Mv && Mv.tabla && Mv.tabla()) Mv.paso(REPO.home.x, REPO.home.y, qt ? 0 : 2);
          return;
        }
        if (lejosDelSpot) { lejosDelSpot = false; try { window.__mover && window.__mover.parar(); } catch (e) { /* nada */ } nota = ''; }
      }
      destrabar(ahora);
      saltarTrabado(ahora);
      if (ahora < pausaPulso || VENT.auto || ahora - ultPulso < huecoPulso()) return;
      if (esperarQuieto(ahora)) return;      // el blanco actual se mueve y todavía no llegó: se espera (opcional)
      ultPulso = ahora; pedirMotor(true); pulsos++;
    } catch (e) { /* nada */ }
  }, 5);      // 5 ms (antes 25 y 10): con 10 ms el pulso de 100 ms salía cada ~109; con 25, cada 124 ms aunque el hueco seguro es de 108: con 25 el pulso salía cada 124 ms aunque el hueco seguro es de 108 (se redondeaba al tick siguiente): -14 % de hechizos

  // ---- vigilancia en los modos del motor ----
  const POC = { intentos: 0, gastaron: 0, fallaron: 0, seguidos: 0, log: [] };
  function teclaRapida(spec, metodo, hold) {
    const d = window.muDispatchKey, ms = hold || 90;
    if (typeof d === 'function' && metodo !== 'canvas') { d('keydown', spec); setTimeout(() => d('keyup', spec), ms); return 'muDispatchKey'; }
    const c = document.getElementById('canvas'); if (!c) return 'sin canvas';
    const ev = (t) => c.dispatchEvent(new KeyboardEvent(t, { key: spec.key, code: spec.code, keyCode: spec.keyCode, which: spec.keyCode, bubbles: true, cancelable: true }));
    ev('keydown'); setTimeout(() => ev('keyup'), ms); return 'canvas';
  }
  function pocion(hp, mp, sd) {
    const ahora = Date.now(); if (ahora - ultPocion < (hp < 0.5 ? 350 : 600)) return;
    for (const [tipo, falta] of [['sd', sd < SD_MIN], ['hp', hp < HP_MIN], ['mp', mp < MP_MIN]]) {   // mismo orden que el juego: SD, vida, maná
      if (!falta) continue;
      const p = POCIONES[tipo], n = call('GetHotkeyItemCount', p.slot) | 0;
      if (n <= 0) {
        if (!avisoPoc[tipo] || ahora - avisoPoc[tipo] > 60000) { avisoPoc[tipo] = ahora; enviar('piloto_pociones', 'Sin pociones de ' + p.nombre + ' en la tecla rápida (' + p.key.key.toUpperCase() + ').', true); }
        continue;
      }
      // dos intentos seguidos sin que baje el contador: se alterna el método de la tecla (evento directo / canvas) y se aguanta más tiempo apretada
      const alt = POC.seguidos >= 2, via = teclaRapida(p.key, alt && POC.seguidos % 2 === 0 ? 'canvas' : undefined, alt ? 200 : 90);
      ultPocion = ahora; POC.intentos++;
      const reg = { t: ahora, tipo, vida_pct: Math.round(hp * 100), antes: n, via, hold_ms: alt ? 200 : 90, gasto: null }; POC.log.push(reg); if (POC.log.length > 150) POC.log.shift();
      setTimeout(() => { try { const n2 = call('GetHotkeyItemCount', p.slot) | 0; reg.despues = n2; reg.gasto = n2 < n; if (reg.gasto) { POC.gastaron++; POC.seguidos = 0; } else { POC.fallaron++; POC.seguidos++; if (POC.seguidos === 2) avisar('pociones: 2 intentos seguidos sin gastar (' + tipo + ', vida ' + Math.round(hp * 100) + ' %): cambio el método de la tecla'); } } catch (e) { /* nada */ } }, 900);
      return;
    }
  }
  setInterval(() => {
    try {
      if (!(MOTOR(deseado) || deseado === 'pelea') || call('GetSceneFlag') !== 5) return;      // en la pelea (agresor.js) también se toman pociones y se corta a < 30 % de vida
      const vida = call('GetPlayerLife'); if (!(vida > 0)) return;
      const mxV = call('GetPlayerLifeMax') || 1, hp = vida / mxV, mp = call('GetPlayerMana') / (call('GetPlayerManaMax') || 1), sd = call('GetPlayerShield') / (call('GetPlayerShieldMax') || 1);
      // v0.75.2 (caja 22): después de un reset el reparto de puntos sube la vida MÁXIMA de golpe (VIT 21 -> 1918) y la vida actual queda igual: el porcentaje cae a 28 % por unos segundos y esto pasaba el modo a Helper y lo bloqueaba 2 min
      // (12 s sin hechizos). Si el máximo cambió más de 10 % se ignora el corte por 10 s (las pociones siguen).
      if (hpMaxPrev && Math.abs(mxV - hpMaxPrev) > 0.1 * hpMaxPrev) hpMaxCambioT = Date.now();
      hpMaxPrev = mxV;
      if (hp < HP_CORTE && Date.now() - hpMaxCambioT > 10000) {
        bloqueoMotor = Date.now() + 120000;
        enviar('piloto_fin', 'Vida en ' + Math.round(hp * 100) + ' % con el modo ' + NOMBRE[deseado] + ': vuelvo al Helper del juego (que toma pociones solo) por 2 minutos.', true);
        fijar('helper', 'vigilancia: vida baja'); return;
      }
      if (hp < HP_MIN || mp < MP_MIN || sd < SD_MIN) pocion(hp, mp, sd);
    } catch (e) { /* nada */ }
  }, 400);

  // ---- POCIONES RÁPIDAS (v0.76.0): cuando te atacan y baja el SD (sobre todo un PK) ----
  // Pedido: "potear lo más rápido que pueda el SD con los ms al mínimo cuando me atacan y baja el SD, sobre todo un PK". La vigilancia de arriba chequea cada 400 ms y deja >= 350/600 ms entre pociones
  // (máx ~2,5 por segundo, y solo si el SD < 40 %). Este lazo corre cada 25 ms: apenas ve que el SD o la vida BAJAN (o hay un PVP en curso) usa la poción de SD (tecla R) cada `ms` ms (90 por defecto)
  // mientras el SD esté < 90 % (95 % en PVP); si el SD ya está bien y la vida < 70 % usa la de vida (Q). Sigue 2 s después del último golpe. Mide cuántas pociones se gastan de verdad y el
  // mínimo tiempo entre gastos (`pociones_rapidas.gap_min_ms`): si el juego/servidor limita el uso de pociones se ve ahí.
  const PR = { on: true, ms: 60, hold: 45, sdMax: 0.90, hpMax: 0.70, ventana: 2000, intentos: 0, gastos: 0, ultBaja: 0, ultT: 0, gaps: [], t: [], cuenta: { sd: null, hp: null }, ultGasto: 0, sinPocion: 0, episodios: 0, enEpisodio: false };
  try { const g = JSON.parse(localStorage.getItem('muPotRapidoV1') || 'null'); if (g) { if (typeof g.on === 'boolean') PR.on = g.on; if (g.v === 2 && g.ms >= 30 && g.ms <= 1000) PR.ms = g.ms; } } catch (e) { /* nada */ }      // v2: el defecto pasó a 60 ms
  const guardarPR = () => { try { localStorage.setItem('muPotRapidoV1', JSON.stringify({ v: 2, on: PR.on, ms: PR.ms })); } catch (e) { /* nada */ } };
  let prSd = null, prHp = null, prMaxSd = 0, prMaxHp = 0;
  setInterval(() => {
    try {
      if (call('GetSceneFlag') !== 5) return;
      const vida = call('GetPlayerLife') || 0, mxHp = call('GetPlayerLifeMax') || 1, sdV = call('GetPlayerShield') || 0, mxSd = call('GetPlayerShieldMax') || 0, ahora = Date.now();
      // gastos reales: el contador de la tecla rápida baja
      for (const t of ['sd', 'hp']) {
        const n = call('GetHotkeyItemCount', POCIONES[t].slot) | 0;
        if (PR.cuenta[t] != null && n < PR.cuenta[t]) { PR.gastos++; if (PR.ultGasto) { PR.gaps.push(ahora - PR.ultGasto); if (PR.gaps.length > 200) PR.gaps.shift(); } PR.ultGasto = ahora; }
        PR.cuenta[t] = n;
      }
      if (!(vida > 0)) { prSd = prHp = null; return; }
      const sd = mxSd > 0 ? sdV / mxSd : 1, hp = vida / mxHp;
      if ((prMaxHp && Math.abs(mxHp - prMaxHp) > 0.1 * prMaxHp) || (prMaxSd && Math.abs(mxSd - prMaxSd) > 0.1 * prMaxSd)) { prSd = null; prHp = null; }      // cambio de máximo (reset, nivel): no es un golpe
      prMaxHp = mxHp; prMaxSd = mxSd;
      if ((prSd != null && sd < prSd - 0.01) || (prHp != null && hp < prHp - 0.01)) PR.ultBaja = ahora;
      prSd = sd; prHp = hp;
      if (!PR.on || !(MOTOR(deseado) || deseado === 'pelea' || deseado === 'manual') || call('GetBlockingUiOpen') === 1) return;      // v0.95.1: también en manual (caja 50: al terminar el PVP el modo volvió a manual y bajó la vida de 96 a 52 % sin tomar pociones: solo estaba prendido en los modos del motor); en manual solo actúa si te están bajando vida/SD
      const A = window.__agresor, pvp = !!(A && A.pvpOn && A.pvpOn()) || deseado === 'pelea';
      // v0.95.3 (caja 52): el SD se quedó en 20-28 % durante 100 s porque solo se tomaban pociones de SD "cuando te atacan"; el SD no se regenera solo. Con histéresis: si baja de 70 % se repone hasta 90 % aunque nadie te esté pegando.
      if (mxSd > 0) { if (sd < 0.70) PR.mantSd = true; else if (sd >= 0.90) PR.mantSd = false; } else PR.mantSd = false;
      const atacado = pvp || ahora - PR.ultBaja < PR.ventana || (hp < 0.5 && mxHp > 1) || !!PR.mantSd;      // v0.95.2: con la vida < 50 % también sigue tomando aunque nadie te esté pegando en este instante (caja 51: 11 s parado en 19 % de vida sin una sola poción)
      if (!atacado) { PR.enEpisodio = false; return; }
      if (!PR.enEpisodio) { PR.enEpisodio = true; PR.episodios++; }
      if (ahora - ultPocion < PR.ms) return;
      const sdLim = pvp ? Math.max(PR.sdMax, 0.95) : PR.sdMax;
      // v0.95.0 (caja 49): la poción de SD tenía SIEMPRE prioridad y el juego la deja usar muy de vez en cuando (gap mediano 3,5 s): 70 intentos seguidos sin gastar y la de VIDA (Q) nunca se probó aunque la vida
      // estaba en 15-40 %. Ahora, si hacen falta las dos, se ALTERNAN (cada una tiene su propio enfriamiento) y con la vida < 50 % la de vida va 2 de cada 3 veces; si hace falta solo una, esa.
      const faltaSd = mxSd > 0 && sd < sdLim, faltaHp = hp < PR.hpMax;
      let tipo = null; PR.alt = (PR.alt || 0) + 1;
      if (faltaSd && faltaHp) tipo = hp < 0.5 ? (PR.alt % 3 === 0 ? 'sd' : 'hp') : (PR.alt % 2 ? 'sd' : 'hp');
      else if (faltaHp) tipo = 'hp'; else if (faltaSd) tipo = 'sd';
      if (!tipo) return;
      const p = POCIONES[tipo], n = call('GetHotkeyItemCount', p.slot) | 0;
      if (n <= 0) { PR.sinPocion++; if (!avisoPoc[tipo] || ahora - avisoPoc[tipo] > 60000) { avisoPoc[tipo] = ahora; enviar('piloto_pociones', 'Sin pociones de ' + p.nombre + ' en la tecla rápida (' + p.key.key.toUpperCase() + ').', true); } return; }
      const alt = POC.seguidos >= 3, via = teclaRapida(p.key, alt && POC.seguidos % 2 === 1 ? 'canvas' : undefined, alt ? 120 : PR.hold);
      ultPocion = ahora; PR.intentos++; POC.intentos++;
      const reg = { t: ahora, tipo, vida_pct: Math.round(hp * 100), sd_pct: Math.round(sd * 100), antes: n, via, hold_ms: alt ? 120 : PR.hold, rapida: true, gasto: null }; POC.log.push(reg); if (POC.log.length > 150) POC.log.shift();
      setTimeout(() => { try { const n2 = call('GetHotkeyItemCount', p.slot) | 0; reg.despues = n2; reg.gasto = n2 < n; if (reg.gasto) { POC.gastaron++; POC.seguidos = 0; } else { POC.fallaron++; POC.seguidos++; } } catch (e) { /* nada */ } }, 700);
    } catch (e) { /* nada */ }
  }, 25);
  const potRapidoStats = () => {
    const g = [...PR.gaps].sort((a, b) => a - b), q = (f) => (g.length ? g[Math.min(g.length - 1, Math.floor(f * g.length))] : null);
    return { activo: PR.on, ms: PR.ms, hold_ms: PR.hold, sd_hasta_pct: Math.round(PR.sdMax * 100), vida_hasta_pct: Math.round(PR.hpMax * 100), episodios: PR.episodios, intentos: PR.intentos, gastos_reales: PR.gastos, sin_pociones: PR.sinPocion, gap_min_ms: g.length ? g[0] : null, gap_mediana_ms: q(0.5), gap_p90_ms: q(0.9) };
  };


  // ---- buscar bichos cuando desaparecen (solo en modos del motor) ----
  // Si pasan 2,5 s sin ningún bicho a <= 4 casillas, camina hasta el bicho más cercano que esté dentro de la correa (10 casillas del punto de partida);
  // si no hay ninguno, vuelve al punto de partida. Se corta apenas hay un bicho a <= 4. Usa el movimiento ya calibrado (mover.js), a la velocidad normal.
  const REPO = { on: true, home: null, mapa: -1, sinDesde: 0, caminando: false };
  const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  function repoParar() { if (REPO.caminando) { try { window.__mover && window.__mover.parar(); } catch (e) { /* nada */ } REPO.caminando = false; } }
  setInterval(() => {
    try {
      const Mv = window.__mover, B = window.__bichos;
      if (lejosDelSpot || yendoAlAncla) return;
      if (!REPO.on || !MOTOR(deseado) || call('GetSceneFlag') !== 5 || !(call('GetPlayerLife') > 0) || call('GetBlockingUiOpen') === 1 || call('MsgVisible') === 1) { repoParar(); REPO.sinDesde = 0; return; }
      if (!Mv || !Mv.tabla || !Mv.tabla() || !B || !B.vista) return;
      const h = { x: call('GetHeroX'), y: call('GetHeroY') }, mapa = call('GetMapIndex');
      if (!REPO.home || REPO.mapa !== mapa) { REPO.home = { x: h.x, y: h.y }; REPO.mapa = mapa; }
      const vis = B.vista();
      if (vis.some((v) => cheb(v, h) <= 4)) { REPO.sinDesde = 0; repoParar(); return; }
      if (!REPO.sinDesde) REPO.sinDesde = Date.now();
      if (Date.now() - REPO.sinDesde < 2500) return;
      const qt = ESTRAT.on && ESTRAT.quieto;       // quieto: no sale a buscar bichos caminando (esperan los respawns donde se cubre más)
      const cand = qt ? null : vis.filter((v) => cheb(v, REPO.home) <= 6 && cheb(v, h) <= 10).sort((p, q) => cheb(p, h) - cheb(q, h))[0];
      if (cand) { Mv.paso(cand.x, cand.y, 3); REPO.caminando = true; nota = 'sin bichos cerca: voy a buscarlos'; }
      else if (cheb(h, REPO.home) > (qt ? 1 : 2)) { Mv.paso(REPO.home.x, REPO.home.y, 2); REPO.caminando = true; nota = 'sin bichos: vuelvo al punto de partida'; }
      else repoParar();
    } catch (e) { /* nada */ }
  }, 300);

  // ---- recordar el modo elegido con los botones (se restaura al recargar la página) ----
  try { const r = JSON.parse(localStorage.getItem('muRitmoV1') || 'null'); if (r && r.v === 4) { if (typeof r.seguro === 'boolean') ritmoSeguro = r.seguro; if (r.ms) PULSO_MS = Math.max(10, Math.min(1000, +r.ms || 10)); } } catch (e) { /* nada */ }
  // v0.86.3: v4 de muRitmoV1: cualquier ritmo guardado antes (v3: Seguro / 100 ms / 62 ms que haya quedado de los botones viejos) se ignora: vale el defecto, pulso LIBRE de 10 ms (Seguro apagado), que ya no tiene botones en el Lab
  // v3 de muRitmoV1: lo guardado antes (Seguro / 100 ms) se ignora: el defecto es 10 ms; lo que se elige con los botones desde ahora se recuerda
  const KEY_MODO = 'muModoV1';
  const guardarModo = (x) => { try { localStorage.setItem(KEY_MODO, JSON.stringify({ modo: x, repo: REPO.on })); } catch (e) { /* nada */ } };
  let restaurado = false;
  setInterval(() => {
    try {
      if (restaurado || call('GetSceneFlag') !== 5 || !(call('GetPlayerLife') > 0)) return;
      restaurado = true;
      const g = JSON.parse(localStorage.getItem(KEY_MODO) || 'null'); if (!g) return;
      if (typeof g.repo === 'boolean') REPO.on = g.repo;
      setTimeout(() => { if (deseado === 'helper' && g.modo && g.modo !== 'helper' && g.modo !== 'piloto' && NOMBRE[g.modo] && !(window.__ciclo && window.__ciclo.activo())) fijar(g.modo, 'recuerdo (modo guardado)'); }, 5000);
    } catch (e) { /* nada */ }
  }, 2000);

  // ---- QUEDARSE QUIETO EN EL MEJOR LUGAR (v0.70.5) ----
  // Pedido del usuario con la caja 14: "que se mueva tanto hace que no pueda atacar mientras se mueve y pierde muchos hechizos por segundo. que se quede quieto en el lugar más estratégico para darle
  // a todos los spots de respawn más cercanos". Caja 14: el héroe pasó los primeros 75 s en un ancla vieja, a 8 casillas del centro del spot, donde alcanzaba el 13 % de los bichos (ninguno a <= 4
  // casillas) y paró el 45 % del tiempo; desde (130,110) alcanzaba el 98 %. Al prender Sostenida (F8 / botón): con los respawns por casilla que mide bichos.js (mejorLugar) se busca, dentro de 10
  // casillas, la casilla que más respawns cubre (de lleno a <= 4,5 casillas, a medias hasta 7,5) y, si cubre >= 10 % más que donde estás, se camina hasta ahí y se fija el ancla. Después "quieto":
  // correa de 3 casillas que lo trae de vuelta al ancla, sin salir a buscar bichos caminando y sin la caminata larga del destrabador. Cada 30 s revisa que el ancla siga siendo buena.
  const ESTRAT = { on: true, quieto: true, buscar: false, correa: 2, radio: 10, minResp: 30, gana: 1.1, maxCamino: 12, auto: false, tok: 0, ultimo: null, ultRevisa: 0, aplicados: 0, quedoAqui: 0, sinDatos: 0, corregidos: 0, correaVueltas: 0, reancladoAMano: 0, ocupado: false };
  try { const e = JSON.parse(localStorage.getItem('muEstratV1') || 'null'); if (e) { if (typeof e.on === 'boolean') ESTRAT.on = e.on; if (typeof e.quieto === 'boolean') ESTRAT.quieto = e.quieto; } } catch (e) { /* nada */ }
  async function anclarEstrategico(motivo) {
    if (!ESTRAT.on) return;
    const tok = ++ESTRAT.tok;                 // cada prendida/pedido nuevo invalida al anterior (apagar y prender en medio de la caminata no deja un ancla vieja)
    ESTRAT.ocupado = true;
    try {
      const B = window.__bichos, Mv = window.__mover, mapa = call('GetMapIndex');
      const aqui = { x: call('GetHeroX'), y: call('GetHeroY') };
      const fijarAncla = (p, txt) => { REPO.home = { x: p.x, y: p.y }; REPO.mapa = mapa; nota = txt; avisar(txt); };
      let r = null; try { r = B && B.mejorLugar ? B.mejorLugar({ radio: ESTRAT.radio, minResp: ESTRAT.minResp }) : null; } catch (e) { r = null; }
      ESTRAT.ultimo = r ? { ...r, t: Date.now(), por: motivo } : null;
      if (!r || !r.ok) { ESTRAT.sinDatos++; fijarAncla(aqui, 'ancla en (' + aqui.x + ',' + aqui.y + '): ' + (r ? r.motivo : 'bichos.js viejo: apretá F5 en la página del juego (bichos.js no se recarga en caliente)') + ' (me quedo acá)'); return; }
      const m = r.mejor;
      if (r.mejora < ESTRAT.gana || r.distancia <= 1 || r.distancia > ESTRAT.maxCamino) {
        ESTRAT.quedoAqui++;
        fijarAncla(aqui, 'ancla en (' + aqui.x + ',' + aqui.y + '): desde acá alcanzo el ' + r.aqui.a6_pct + ' % de los respawns de las cercanías' + (r.distancia > 1 ? ' (el mejor sitio, (' + m.x + ',' + m.y + '), ' + (r.distancia > ESTRAT.maxCamino ? 'queda a ' + r.distancia + ' casillas: lejos' : 'solo mejora x' + r.mejora) + ')' : ' (ya es el mejor)'));
        return;
      }
      if (!(Mv && Mv.tabla && Mv.tabla())) { ESTRAT.quedoAqui++; fijarAncla(aqui, 'ancla acá: falta calibrar el movimiento para ir a (' + m.x + ',' + m.y + ')'); return; }
      yendoAlAncla = true; call('SetManualSkillHeld', 0); call('CancelHeroWalk');
      avisar('ancla estratégica: voy a (' + m.x + ',' + m.y + '), a ' + r.distancia + ' casillas: desde ahí alcanzo el ' + m.a6_pct + ' % de los respawns (acá ' + r.aqui.a6_pct + ' %)');
      const falta = () => Math.max(Math.abs(m.x - call('GetHeroX')), Math.abs(m.y - call('GetHeroY')));
      const t1 = Date.now(); let ultPos = aqui.x + ',' + aqui.y, ultMov = Date.now();
      while (Date.now() - t1 < 30000 && MOTOR(deseado) && tok === ESTRAT.tok && falta() > 1) {
        Mv.paso(m.x, m.y, 1); await new Promise((res) => setTimeout(res, 150));
        const p = call('GetHeroX') + ',' + call('GetHeroY'); if (p !== ultPos) { ultPos = p; ultMov = Date.now(); } else if (Date.now() - ultMov > 2500) break;   // trabado (pared, bicho): se queda donde llegó
      }
      try { Mv.parar(); } catch (e) { /* nada */ }
      if (tok !== ESTRAT.tok || !MOTOR(deseado)) { yendoAlAncla = false; return; }      // lo apagaron (o lo volvieron a prender) mientras caminaba: no se fija nada
      yendoAlAncla = false; ESTRAT.aplicados++;
      const fin = { x: call('GetHeroX'), y: call('GetHeroY') };
      fijarAncla(fin, 'ancla estratégica fijada en (' + fin.x + ',' + fin.y + '): cubre ' + m.cubre_pct + ' % de los respawns (antes ' + r.aqui.cubre_pct + ' % en (' + aqui.x + ',' + aqui.y + '))');
    } catch (e) { /* nada */ } finally { if (tok === ESTRAT.tok) { ESTRAT.ocupado = false; yendoAlAncla = false; } }
  }
  // v0.70.7: SIN revisión periódica. El spot se elige una sola vez al prender Sostenida y no cambia hasta apagar y volver a prender (pedido del usuario).
  const estratStats = () => ({ on: ESTRAT.on, quieto: ESTRAT.quieto, busca_mejor_lugar: ESTRAT.buscar, correa: ESTRAT.correa, aplicados: ESTRAT.aplicados, se_quedo_donde_estaba: ESTRAT.quedoAqui, sin_datos: ESTRAT.sinDatos, corregidos_por_la_revision: ESTRAT.corregidos, vueltas_por_la_correa: ESTRAT.correaVueltas, reanclado_porque_lo_llevaron_a_mano: ESTRAT.reancladoAMano,
    ancla: REPO.home ? { x: REPO.home.x, y: REPO.home.y } : null,
    ultimo: ESTRAT.ultimo ? { hace_s: Math.round((Date.now() - ESTRAT.ultimo.t) / 1000), por: ESTRAT.ultimo.por, ok: ESTRAT.ultimo.ok, fallo: ESTRAT.ultimo.ok === false ? ESTRAT.ultimo.motivo : undefined, fuente: ESTRAT.ultimo.fuente, respawns: ESTRAT.ultimo.total, aqui: ESTRAT.ultimo.aqui, mejor: ESTRAT.ultimo.mejor, mejora: ESTRAT.ultimo.mejora, distancia: ESTRAT.ultimo.distancia } : null });

  // ---- ANCLA: Sostenida se queda en el mejor lugar del spot ----
  // Al activar Sostenida con el botón: 1) si guardaste un ancla en este mapa (botón "Guardar ancla aquí") va ahí; 2) si no, usa los datos de RESPAWN que
  // mide bichos.js (zona de 6x6 con más respawns por minuto, a <= 40 casillas); 3) si no hay datos, se queda donde está. Desde ahí la correa (8 casillas) y la
  // búsqueda de bichos (6 casillas) trabajan alrededor del ancla, para que no corra detrás de cada bicho.
  const ANCLA = { on: true, aqui: true };     // aqui: al prender Sostenida con el botón o F8 el ancla es DONDE ESTÁS (no camina al mejor spot ni a un ancla guardada); el ciclo automático en Aida no se toca
  try { const r = JSON.parse(localStorage.getItem('muAnclaAquiV1') || 'null'); if (r && r.aqui === false) ANCLA.aqui = false; } catch (e) { /* nada */ }
  const KEY_ANCLA = 'muAnclaV1';
  const anclasGuardadas = () => { try { return JSON.parse(localStorage.getItem(KEY_ANCLA) || '{}'); } catch (e) { return {}; } };
  async function anclarAlMejor() {
    if (!ANCLA.on) return;
    try {
      const B = window.__bichos, Mv = window.__mover, mapa = call('GetMapIndex'), hx = call('GetHeroX'), hy = call('GetHeroY');
      const yo = { x: hx, y: hy }, lejos = (p) => Math.max(Math.abs(p.x - hx), Math.abs(p.y - hy));
      let destino = null, porque = '';
      // Solo manda el ancla que guardaste VOS con el botón (marca m:1). Las viejas (sin marca) eran el final del camino grabado y arrastraban lejos de los bichos.
      const g = anclasGuardadas()[mapa]; if (g && g.m && lejos(g) <= 60) { destino = { x: g.x, y: g.y }; porque = 'ancla que guardaste vos'; }
      if (!destino && B && B.spots) {
        // 90 s de observación y 10 respawns: con menos es ruido. Con menos de 1 bicho en vista de promedio es una zona que otros jugadores se comen: no sirve para quedarse.
        const c = B.spots(mapa, 40, 90).filter((s) => s.respawns >= 10 && s.respawnsPorMin > 0 && s.bichosPromedio >= 1 && lejos(s.centro) <= 40);
        if (c.length) { destino = { x: Math.round(c[0].centro.x), y: Math.round(c[0].centro.y) }; porque = 'zona con más respawns (' + c[0].respawnsPorMin + '/min, ' + c[0].zona + ')'; }
      }
      if (!destino) { REPO.home = yo; nota = 'sin datos de respawn ni ancla guardada: me quedo acá'; avisar('ancla: sin datos, me quedo en (' + hx + ',' + hy + ')'); return; }
      const falta = () => Math.max(Math.abs(destino.x - call('GetHeroX')), Math.abs(destino.y - call('GetHeroY')));   // distancia ACTUAL al destino
      if (falta() > 1 && Mv && Mv.tabla && Mv.tabla()) {
        yendoAlAncla = true; call('SetManualSkillHeld', 0); avisar('ancla: voy a (' + destino.x + ',' + destino.y + ') por ' + porque);
        const t1 = Date.now(); let ultPos = hx + ',' + hy, ultMov = Date.now();
        while (Date.now() - t1 < 45000 && MOTOR(deseado) && falta() > 1) {
          Mv.paso(destino.x, destino.y, 1); await new Promise((r) => setTimeout(r, 200));
          const p = call('GetHeroX') + ',' + call('GetHeroY'); if (p !== ultPos) { ultPos = p; ultMov = Date.now(); } else if (Date.now() - ultMov > 5000) break;   // trabado
        }
        try { Mv.parar(); } catch (e) { /* nada */ }
      }
      yendoAlAncla = false;
      REPO.home = { x: call('GetHeroX'), y: call('GetHeroY') }; nota = 'ancla en (' + REPO.home.x + ',' + REPO.home.y + ') · ' + porque;
      avisar('ancla fijada en (' + REPO.home.x + ',' + REPO.home.y + ') · ' + porque);
    } catch (e) { yendoAlAncla = false; }
  }

  function fijar(modo, por = 'usuario') {
    if (!NOMBRE[modo]) return { ok: false, motivo: 'modo desconocido' };
    if (MOTOR(modo) && Date.now() < bloqueoMotor && por !== 'botón' && !/^botón/.test(por)) return { ok: false, motivo: 'bloqueado hasta que pase el tiempo por vida baja', modo: deseado };
    if (MOTOR(modo) && /^botón/.test(por)) bloqueoMotor = 0;     // si lo pedís vos con el botón, se levanta el bloqueo (si no, el cartel seguía diciendo "bloqueado")
    deseado = modo; quien = por; desde = Date.now(); nota = '';
    REPO.home = null; REPO.sinDesde = 0; repoParar();
    // OFF de verdad: apretar Nada o Helper con un botón también apaga el ciclo automático (si no, el ciclo vuelve a pedir Sostenida y te trae de vuelta al spot)
    if (/^botón/.test(por) && (modo === 'manual' || modo === 'helper' || modo === 'piloto')) {
      try { if (window.__ciclo && window.__ciclo.activo()) { window.__ciclo.detener('manual'); nota = 'ciclo automático apagado'; } } catch (e) { /* nada */ }
    }
    if (/^botón/.test(por)) guardarModo(modo);
    avisar('modo ' + modo + ' (pedido por ' + por + ')');
    if (!MOTOR(modo)) { call('CancelHeroWalk'); lejosDelSpot = false; yendoAlAncla = false; REPO.caminando = false; try { window.__mover && window.__mover.parar(); } catch (e) { /* nada */ } }   // OFF de verdad: también se suelta el vector de movimiento propio
    if (!MOTOR(modo) && motorPrendido) motorOff();
    if (MOTOR(modo)) {
      if (pilotoOn()) P().detener('modo: ' + modo);
      helper(false);                                   // el motor avisa: AUTO y Helper son excluyentes
      motorOff();
      const ok = elegirHabilidad();
      motorBasico = !ok && (call('HasCurrentSkill') | 0) === 0 && modo !== 'auto';
      histCasts = []; tasaCast = 0; pausaPulso = 0; DESTR.ultCastT = Date.now(); DESTR.ultC = -1; DESTR.esperando = 0; DESTR.nivel = 0;
      pedirMotor(false);
      motorPrendido = true;
      if (/^botón/.test(por) && modo !== 'auto' && ANCLA.aqui) {
        REPO.home = { x: call('GetHeroX'), y: call('GetHeroY') }; REPO.mapa = call('GetMapIndex'); nota = 'ancla acá, donde lo prendiste (' + REPO.home.x + ',' + REPO.home.y + ')';
        avisar('ancla fijada donde prendiste Sostenida: (' + REPO.home.x + ',' + REPO.home.y + ')');
        if (ESTRAT.on && ESTRAT.buscar) anclarEstrategico('botón').catch(() => { /* nada */ });          // afina: si cerca hay una casilla que cubre más respawns, camina ahí y se queda quieto
      } else if ((/^botón/.test(por) || (/^ciclo: lt7/.test(por) && call('GetMapIndex') === 33)) && modo !== 'auto') anclarAlMejor().then(() => { if (ESTRAT.on && ESTRAT.buscar && /^botón/.test(por)) return anclarEstrategico('botón'); }).catch(() => { /* nada */ });   // 33 = Aida
      nota = ok ? 'habilidad Fire Burst elegida' : (motorBasico ? 'sin Fire Burst ni habilidad elegida: ataque básico' : 'no pude elegir Fire Burst: usa la habilidad que tengas seleccionada');
      return { ok: true, modo };
    }
    if (modo === 'piloto') {
      if (!pilotoOn()) {
        const r = P() ? P().arrancar() : { ok: false, motivo: 'piloto.js no cargó' };
        if (!r.ok) { deseado = 'helper'; nota = 'el piloto no arrancó (' + r.motivo + '): quedó el Helper'; helper(true); return { ok: false, motivo: r.motivo, modo: 'helper' }; }
      } else if (helperOn() && !cedido()) helper(false);
    } else if (modo === 'helper') {
      if (pilotoOn()) P().detener('modo: helper');
      helper(true);
    } else {   // manual: nada peleando
      if (pilotoOn()) P().detener('modo: nada');
      helper(false);
    }
    return { ok: true, modo };
  }

  // Mantiene el modo deseado coherente con la realidad (el piloto se corta solo por vida baja; el usuario puede tocar el Helper en el juego)
  setInterval(() => {
    try {
      if (call('GetSceneFlag') !== 5 || probandoVent) return;      // durante el test con ventana el Helper se prende a propósito: no hay que tomarlo como "prendido a mano"
      const p = pilotoOn(), h = helperOn(), vivo = call('GetPlayerLife') > 0;
      if (MOTOR(deseado)) {
        if (h || p) { deseado = p ? 'piloto' : 'helper'; quien = 'prendido a mano'; motorOff(); }
        else if (vivo) {
          if (!vivoAntes) { elegirHabilidad(); }       // acaba de revivir: se vuelve a elegir la habilidad
          if (!VENT.auto) pedirMotor(false);           // refuerzo suave; en 'sostener'/'pulsos' las pulsaciones las hace la bomba de 150 ms
        }
        vivoAntes = vivo; return;
      }
      vivoAntes = vivo;
      if (deseado === 'pelea') {      // si el módulo de agresores ya no está peleando (se recargó o falló), no se queda trabado en 'pelea'
        if (window.__agresor && window.__agresor.peleando()) peleaSinDesde = 0;
        else if (!peleaSinDesde) peleaSinDesde = Date.now();
        else if (Date.now() - peleaSinDesde > 6000) { peleaSinDesde = 0; fijar('helper', 'agresor: la pelea no sigue'); return; }
      }
      if (!MOTOR(deseado) && !p && (lejosDelSpot || yendoAlAncla || REPO.caminando)) { lejosDelSpot = false; yendoAlAncla = false; REPO.caminando = false; try { window.__mover && window.__mover.parar(); } catch (e) { /* nada */ } }
      if (deseado === 'piloto' && !p) { deseado = 'helper'; quien = 'piloto se cortó'; nota = 'el piloto se detuvo solo: sigue el Helper'; }
      else if (deseado === 'helper' && p) { deseado = 'piloto'; quien = 'piloto prendido'; }
      else if (deseado === 'manual' && (h || p)) { deseado = p ? 'piloto' : 'helper'; quien = 'prendido a mano'; }
      if (deseado === 'piloto' && p && h && !cedido() && Date.now() - desde > 4000) { helper(false); nota = 'apagué el Helper que se había prendido con el piloto'; }
    } catch (e) { /* nada */ }
  }, 1500);

  // El Vigía solo debe reactivar el Helper cuando el modo es "helper"
  try { Object.defineProperty(window, '__pausaVigia', { configurable: true, get: () => deseado !== 'helper', set: () => {} }); } catch (e) { /* nada */ }

  (window.__muLimpiar = window.__muLimpiar || []).push(() => { window.__muEstadoModo = deseado; });
  motorPrendido = MOTOR(deseado);
  // Niveles por hora (en vivo): progreso = nivel + permil de experiencia/1000, medido cada 5 s sobre una ventana de ~3 minutos
  const progreso = []; 
  setInterval(() => {
    try {
      if (call('GetSceneFlag') !== 5) return;
      const lv = call('GetPlayerLevel'), pm = call('GetExperiencePermille'); if (!(lv > 0) || pm == null) return;
      const ahora = Date.now(), p = lv + pm / 1000;
      if (progreso.length && p < progreso[progreso.length - 1].p - 0.5) progreso.length = 0;     // reset de nivel
      const P = window.__paquetes;
      progreso.push({ t: ahora, p, k: P && P.cuenta ? P.cuenta('rx', 'C3:0x16') : null }); while (progreso.length && ahora - progreso[0].t > 180000) progreso.shift();
    } catch (e) { /* nada */ }
  }, 5000);
  // A estos niveles la barra de exp casi no se mueve (queda en ~1000), así que el ritmo se mide por el TIEMPO ENTRE SUBIDAS DE NIVEL (en la caja 56: 65 s,
  // 64, 66, 66, 66 = muy parejo). Se anota cada subida con su hora (revisando cada 1 s) y se usan las últimas 4.
  const subidas = []; let lvAnt = null;
  setInterval(() => {
    try {
      if (call('GetSceneFlag') !== 5) return;
      let lv = call('GetPlayerLevel'); if (!(lv > 0)) return;
      if (lv >= 400) lv = 400 + (call('GetMasterLevel') | 0);      // en 400 lo que sube es el nivel MASTER
      if (lvAnt != null && lv < lvAnt) subidas.length = 0;                      // reset de nivel o cambio de personaje
      else if (lvAnt != null && lv > lvAnt) { subidas.push({ t: Date.now(), n: lv - lvAnt }); while (subidas.length > 4) subidas.shift(); }
      lvAnt = lv;
    } catch (e) { /* nada */ }
  }, 1000);
  const segPorNivel = () => {
    if (subidas.length < 3 || Date.now() - subidas[subidas.length - 1].t > 400000) return null;
    const niv = subidas.slice(1).reduce((s, x) => s + x.n, 0), seg = (subidas[subidas.length - 1].t - subidas[0].t) / 1000;
    return niv > 0 ? +(seg / niv).toFixed(1) : null;
  };
  const muertesPorMin = () => { if (progreso.length < 12 || progreso[0].k == null) return null; const a = progreso[0], z = progreso[progreso.length - 1], m = (z.t - a.t) / 60000; return m > 0 && z.k != null ? Math.round((z.k - a.k) / m) : null; };
  const nivelesPorHora = () => { const sp = segPorNivel(); if (sp) return +(3600 / sp).toFixed(1); if (progreso.length < 12) return null; const a = progreso[0], z = progreso[progreso.length - 1], h = (z.t - a.t) / 3600000; return h > 0 ? +((z.p - a.p) / h).toFixed(1) : null; };
  const queda = () => Math.max(0, Math.round((bloqueoMotor - Date.now()) / 1000));
  window.__modo = {
    setEstrategico: (v, quieto) => { ESTRAT.on = !!v; if (quieto != null) ESTRAT.quieto = !!quieto; else ESTRAT.quieto = !!v; try { localStorage.setItem('muEstratV1', JSON.stringify({ on: ESTRAT.on, quieto: ESTRAT.quieto })); } catch (e) { /* nada */ } return ESTRAT.on; },
    setBuscarMejorLugar: (v) => { ESTRAT.buscar = !!v; return ESTRAT.buscar; }, estrategicoOn: () => ESTRAT.on, estrategicoStats: estratStats, anclarEstrategico,
    mejorLugarAhora: () => { const B = window.__bichos; return B && B.mejorLugar ? B.mejorLugar({ radio: ESTRAT.radio, minResp: ESTRAT.minResp }) : { ok: false, motivo: 'bichos.js viejo: apretá F5 en la página del juego (bichos.js no se recarga en caliente)' }; },
    setSaltar: (v, temporal) => { SALT.on = !!v; SALT.esperando = null; SALT.nivel = 0; if (!temporal) { try { localStorage.setItem('muSaltarV1', JSON.stringify({ on: SALT.on, rot: SALT.rot })); } catch (e) { /* nada */ } } return SALT.on; }, saltarOn: () => SALT.on,
    setRotarMoviles: (v) => { SALT.rotMov = !!v; return SALT.rotMov; },
    habilidad: () => HAB.id,
    setHabilidad: (id) => { id = id | 0; if (!(id > 0)) return false; HAB.id = id; let ok = true;      // nunca se guarda: al recargar la Sostenida vuelve a Fire Burst (508), la mejor
      if (MOTOR(deseado)) { try { ok = elegirHabilidad(); call('SetManualSkillHeld', 0); pedirMotor(false); } catch (e) { ok = false; } } return ok; },
    potRapido: (v, ms) => { if (v != null) PR.on = !!v; if (ms >= 30 && ms <= 1000) PR.ms = ms | 0; guardarPR(); return potRapidoStats(); }, potRapidoStats,
    // v0.72.0: viaje corto a juntar un item del piso (joyas.js, "Cajas del piso"): sin pulsos ni camino del juego mientras camina; al terminar re-arma el ataque y la correa lo trae de vuelta al ancla
    viaje: (on) => { yendoAlAncla = !!on; if (on) { call('SetManualSkillHeld', 0); call('CancelHeroWalk'); } else if (MOTOR(deseado)) { try { elegirHabilidad(); pedirMotor(false); } catch (e) { /* nada */ } } return yendoAlAncla; },
    enViaje: () => yendoAlAncla,
    ancla: () => (REPO.home ? { x: REPO.home.x, y: REPO.home.y } : null),
    setRotar: (v, temporal) => { SALT.rot = !!v; SALT.esperando = null; SALT.nivel = 0; if (!temporal) { try { localStorage.setItem('muSaltarV1', JSON.stringify({ on: SALT.on, rot: SALT.rot })); } catch (e) { /* nada */ } } return SALT.rot; },
    saltarStats: () => ({ on: SALT.on, rotar: SALT.rot, rot_ms: SALT.rotMs, rot_ms_efectivo: rotMsEf(), rot_hechizos: SALT.rotCasts, rotar_moviles: SALT.rotMov, mov_ms: SALT.movMs, disparos_por_blanco_en_movimiento: SALT.dispMov, lim_ms: SALT.limMs, min_hechizos: SALT.minCasts, disparos: SALT.disparos, sin_alternativa: SALT.sinAlt, cambiaron: SALT.ok, por_escalon: SALT.okNivel.slice(), sin_cambio: SALT.falla, ms_hasta_cambio_med: SALT.msCambio.length ? Math.round([...SALT.msCambio].sort((a, b) => a - b)[SALT.msCambio.length >> 1]) : null, hechizos_en_trabados: SALT.castsTrabados, volvieron_al_ancla: SALT.volvieron, vueltas_forzadas_por_la_correa: SALT.vueltasForzadas, blancos_reincidentes: SALT.reincidentes,
      cambios_de_blanco_sin_muerte: SALT.retargets, cambios_con_el_heroe_moviendose_pct: SALT.retargets ? Math.round(100 * SALT.retargetsMov / SALT.retargets) : null, hechizos_con_el_heroe_moviendose_pct: SALT.castsTot ? +(100 * SALT.castsMov / SALT.castsTot).toFixed(1) : null }),
    segPorNivel, muertesPorMin, cadencia, setPrueba: (ms) => { PRUEBA = ms ? Math.max(10, Math.min(1000, +ms || 100)) : null; return PRUEBA; }, nivelMaster: () => call('GetMasterLevel') | 0,
    setDestrabar: (v) => { DESTR.on = !!v; return DESTR.on; }, destrabarOn: () => DESTR.on, ventanas: () => ({ rearmes: VENT.rearmes, auto_activo: VENT.auto, auto_con_ventana: AUTOVENT, eventos: VENT.log.slice() }), probarVentana, autoVentanaOn: () => AUTOVENT, paradas: paradasResumen, setQuietos: (v, temporal) => { QUIETOS.on = !!v; QUIETOS.desde = 0; QUIETOS.libre = 0; if (!temporal) { try { localStorage.setItem('muQuietosV1', JSON.stringify({ on: QUIETOS.on })); } catch (e) { /* nada */ } } return QUIETOS.on; }, quietosOn: () => QUIETOS.on, quietosStats: () => ({ on: QUIETOS.on, alcance: QUIETOS.alcance, tope_ms: QUIETOS.tope, esperas: QUIETOS.esperas, cortadas_por_tope: QUIETOS.cortadas, ms_esperando: Math.round(QUIETOS.ms) }),
    setAutoVentana: (v) => { AUTOVENT = !!v; try { localStorage.setItem('muAutoVentV1', JSON.stringify({ on: AUTOVENT })); } catch (e) { /* nada */ } if (!AUTOVENT && VENT.auto) autoVentanaOff('desactivado'); return AUTOVENT; }, destrabarStats: () => ({ on: DESTR.on, intentos: DESTR.kicks, funcionaron: DESTR.ok, por_escalon: DESTR.okNivel.slice() }),
    fijar, anclar: anclarAlMejor, nivelesPorHora, setRitmoSeguro: (v) => { ritmoSeguro = !!v; try { localStorage.setItem('muRitmoV1', JSON.stringify({ seguro: ritmoSeguro, ms: PULSO_MS, v: 4 })); } catch (e) { /* nada */ } return ritmoSeguro; }, ritmoSeguroOn: () => ritmoSeguro, setVelocidadAtaque: (n) => { velAtaque = n ? +n : null; return velocidadAtaque(); }, huecoPulso, setPulsoMs: (ms) => { PULSO_MS = Math.max(10, Math.min(1000, +ms || 150)); try { localStorage.setItem('muRitmoV1', JSON.stringify({ seguro: ritmoSeguro, ms: PULSO_MS, v: 4 })); } catch (e) { /* nada */ } return PULSO_MS; }, pulsoMs: () => PULSO_MS, guardarAncla: () => { const o = anclasGuardadas(), mp = call('GetMapIndex'); o[mp] = { x: call('GetHeroX'), y: call('GetHeroY'), m: 1 }; try { localStorage.setItem(KEY_ANCLA, JSON.stringify(o)); } catch (e) { /* nada */ } REPO.home = { x: o[mp].x, y: o[mp].y }; return o[mp]; }, borrarAncla: () => { const o = anclasGuardadas(); delete o[call('GetMapIndex')]; try { localStorage.setItem(KEY_ANCLA, JSON.stringify(o)); } catch (e) { /* nada */ } }, setAncla: (v) => { ANCLA.on = !!v; return ANCLA.on; }, anclaOn: () => ANCLA.on, anclaAquiOn: () => ANCLA.aqui, pociones: () => ({ intentos: POC.intentos, gastaron: POC.gastaron, fallaron: POC.fallaron, seguidos_sin_gastar: POC.seguidos, ultimos: POC.log.slice(-60) }), setAnclaAqui: (v) => { ANCLA.aqui = !!v; try { localStorage.setItem('muAnclaAquiV1', JSON.stringify({ aqui: ANCLA.aqui })); } catch (e) { /* nada */ } return ANCLA.aqui; }, ancla: () => REPO.home, setCorrea: (n) => { CORREA = Math.max(0, n | 0); return CORREA; }, correa: () => CORREA, setRepos: (v) => { REPO.on = !!v; if (!v) repoParar(); guardarModo(deseado); return REPO.on; }, reposOn: () => REPO.on, deseado: () => deseado, helperOn, pilotoOn, cedido, bloqueado: () => Date.now() < bloqueoMotor,
    resumen: () => 'Farmeo: <b>' + (deseado === 'piloto' ? (cedido() ? 'PILOTO (cedido al Helper: sin foco)' : 'PILOTO') : NOMBRE[deseado]) + '</b> · Helper ' + (helperOn() ? 'ON' : 'off') + (pilotoOn() ? ' · Piloto ON' : '') + (Date.now() < bloqueoMotor ? ' · modo del motor bloqueado ' + queda() + ' s' : '') + ((deseado === 'sostener' || deseado === 'pulsos') && tasaCast ? ' · ' + tasaCast.toFixed(1) + ' hechizos/s' : '') + (nivelesPorHora() != null ? ' · ≈ ' + nivelesPorHora() + ' niveles/hora' : '') + ((deseado === 'sostener' || deseado === 'pulsos') ? ' · ritmo ' + (ritmoSeguro ? 'seguro (' + huecoPulso() + ' ms)' : 'libre (' + PULSO_MS + ' ms)') : '') + (nota ? ' · ' + nota : ''),
    texto: () => 'Farmeo: ' + NOMBRE[deseado] + ' (pedido por ' + quien + ') · Helper ' + (helperOn() ? 'ON' : 'off') + ' · Piloto ' + (pilotoOn() ? 'ON' : 'off') + (cedido() ? ' · cedido al Helper por falta de foco' : '') + (Date.now() < bloqueoMotor ? ' · motor bloqueado ' + queda() + ' s' : '') + ((deseado === 'sostener' || deseado === 'pulsos') ? ' · pulsos ' + pulsos + ' (al morir ' + pulsosMuerte + ') · muertes propias ' + propias + ' · ' + tasaCast.toFixed(1) + ' hechizos/s' : '') + (DESTR.kicks ? ' · destrabé ' + DESTR.kicks + ' (' + DESTR.ok + ' ok: ' + DESTR.okNivel.join('/') + ')' : '') + (nota ? ' · ' + nota : ''),
  };
})();
