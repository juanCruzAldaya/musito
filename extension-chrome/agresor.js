// Agresores: vigila (solo lectura de los avisos del servidor) quién te ataca y, si lo activás, CONTRAATACA al jugador que te pegó.
//   Detección: C1 0x18 (animación de ataque: atacante, objetivo) y C3 0x19 (hechizo de otro: hechizo, atacante, objetivo) cuyo objetivo es TU id.
//     Tu id se aprende solo: es el objetivo de los ataques de los bichos cuando justo te baja la vida. "Jugador" = un atacante que no es un bicho conocido.
//     Hace falta que te peguen 3 veces en 5 s y que te baje la vida a la vez (así un buff de la party no cuenta).
//   Contraataque: modo 'pelea' (modo.js) = apaga Sostenida/Helper; clic derecho mantenido SOBRE el jugador (igual que lo hiciste a mano), con la
//     misma rutina que el piloto viejo (pantalla.atacar). Corta si: murió, se fue, vida < 35 %, pasaron 90 s, no salen hechizos sobre él, o es de tu party.
//     Después vuelve al punto donde estabas y retoma el modo anterior. Necesita el navegador con foco (el clic simulado no anda en segundo plano).
//   Tres modos (botones del Lab > Opciones): apagado · avisar (HUD + Discord, por defecto) · contraatacar. No manda paquetes propios.
(() => {
  'use strict';
  // Recarga en caliente: los intervalos se registran para poder cortarlos al reinyectar el módulo sin recargar la página (ver background.js)
  const setInterval = (f, ms) => { const id = window.setInterval(f, ms); (window.__muIds = window.__muIds || []).push(id); return id; };
  const M = () => window.Module;
  const call = (n, ...a) => { try { const f = M()['_MuWeb' + n]; return typeof f === 'function' ? f(...a) : null; } catch (e) { return null; } };
  const str = (n, ...a) => { try { const f = M()['_MuWeb' + n]; const p = f(...a) | 0; return p ? M().UTF8ToString(p) : ''; } catch (e) { return ''; } };
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const enviar = (clave, texto, grave) => window.postMessage({ __muvigia: true, clave, texto: String(texto).slice(0, 280), grave: !!grave }, '*');
  const nota = (t) => { try { if (window.__piloto && window.__piloto.nota) window.__piloto.nota('AGRESOR', t); } catch (e) { /* nada */ } };
  const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const t0 = Date.now();
  const bit = [];
  const log = (t) => { bit.push({ t_ms: Date.now() - t0, txt: t }); if (bit.length > 300) bit.shift(); nota(t); };

  const KEY = 'muAgresorV1', MODOS = ['apagado', 'avisar', 'contraatacar'];
  const MAX_PELEA_MS = 90000, VIDA_CORTE = 0.35, SENAL_MS = 7000, LEJOS = 14;
  const FARMEO = ['sostener', 'pulsos', 'auto', 'helper', 'piloto'];      // solo se contraataca si estabas farmeando (con "Nada" no se toca nada)
  let modoAg = 'avisar';
  try { const g = JSON.parse(localStorage.getItem(KEY) || 'null'); if (g && MODOS.includes(g.modo)) modoAg = g.modo; } catch (e) { /* nada */ }
  const guardar = () => { try { localStorage.setItem(KEY, JSON.stringify({ modo: modoAg })); } catch (e) { /* nada */ } };

  let vivo = true; (window.__muLimpiar = window.__muLimpiar || []).push(() => { vivo = false; });
  let escuchando = false, heroId = null, mapaAct = null, ultDano = 0, prevVida = null, peleando = null, totalVotos = 0, maxMons = 0, ultPoda = 0;
  const votos = new Map(), monstruos = new Map(), pos = new Map(), ataques = new Map(), muertos = new Map(), frio = new Map(), peleas = [], nombreDe = new Map();
  const id16 = (a, b) => ((a & 0x7F) << 8) | b;
  // v0.70.2: aprender mi id con el ECO de mis propios hechizos + registro de golpes fuertes (caja 12: estuvo ciego 1338 s de 1529 s)
  const misCasts = [], ecos = new Map(), fuertes = [];
  let nMisCasts = 0, sinIdMs = 0, conIdMs = 0, ultTick = 0, prevMax = 0;
  const FUERTE = 0.15;                       // un instante que saca >= 15 % de vida+escudo juntos se registra aparte (caja: agresores.golpes_fuertes)
  const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const enTexto = (g, nombre) => !!nombre && !!g && new RegExp('(^|[^A-Za-z0-9_])' + escRe(nombre) + '($|[^A-Za-z0-9_])').test(g);

  function reiniciar(porque) {
    heroId = null; votos.clear(); totalVotos = 0; monstruos.clear(); pos.clear(); ataques.clear(); muertos.clear(); maxMons = 0;
    misCasts.length = 0; ecos.clear(); nMisCasts = 0; nombreDe.clear();
    log('reinicio los datos de agresores (' + porque + '): mi id cambia al cambiar de mapa');
  }

  // ---- lectura de paquetes ----
  // Mis hechizos salen como C3 0x19 [hechizo(2), blanco(2)] y el servidor los repite a todos (yo incluido) como C3 0x19 [hechizo(2), ORIGEN(2), blanco(2)]:
  // el origen que repite mis hechizos (mismo hechizo y mismo blanco, justo después) soy yo. Aprende el id en ~1 s en vez de esperar a que un bicho me saque vida.
  function onTx(u) {
    if (!vivo || !u || modoAg === 'apagado' || u.length < 7 || u[0] !== 0xC3 || u[2] !== 0x19) return;
    misCasts.push({ sk: (u[3] << 8) | u[4], tid: id16(u[5], u[6]), t: Date.now() }); nMisCasts++; atqCast(id16(u[5], u[6]));
    if (misCasts.length > 60) misCasts.shift();
  }
  function eco(u) {
    const ahora = Date.now(), sk = (u[3] << 8) | u[4], src = id16(u[5], u[6]), tgt = id16(u[7], u[8]);
    let coincide = false;
    for (let i = misCasts.length - 1; i >= 0; i--) { const c = misCasts[i]; if (ahora - c.t > 700) break; if (c.sk === sk && c.tid === tgt) { coincide = true; break; } }
    if (!coincide) return;
    ecos.set(src, (ecos.get(src) || 0) + 1);
    if (nMisCasts < 8) return;
    let mejor = null, n = 0, segundo = 0; ecos.forEach((v, k) => { if (v > n) { segundo = n; n = v; mejor = k; } else if (v > segundo) segundo = v; });
    // Caja 13: solo ~40 % de mis hechizos vuelven como eco (el servidor acepta ~7,5 por segundo de los ~22 que salen), así que la vara no es "la mayoría" sino "le gana con claridad a
    // cualquier otro origen": al menos 5 ecos, 15 % de mis hechizos y más del doble (+3) que el segundo. Con empate (varios pegándole al mismo bicho con el mismo hechizo) no se aprende nada.
    if (mejor != null && n >= 5 && n >= 0.15 * nMisCasts && n >= 2 * segundo + 3 && mejor !== heroId) {
      const antes = heroId; heroId = mejor;
      log('mi id en este mapa: ' + heroId + (antes == null ? '' : ' (corrijo, antes ' + antes + ')') + ' (' + n + ' ecos de ' + nMisCasts + ' hechizos míos)');
    }
    if (nMisCasts > 400) { ecos.forEach((v, k) => ecos.set(k, Math.floor(v / 2))); nMisCasts = Math.floor(nMisCasts / 2); }
  }
  function onRx(u) {
    if (!vivo || !u || modoAg === 'apagado') return;
    const h = u[0];
    if (h === 0xC1 && u[2] === 0xD4 && u.length >= 10) { pos.set(id16(u[3], u[4]), { x: u[5], y: u[6], tx: u[7], ty: u[8], t: Date.now() }); return; }
    if (h === 0xC1 && u[2] === 0x17 && u.length >= 5) { muertos.set(id16(u[3], u[4]), Date.now()); return; }
    if (h === 0xC1 && u[2] === 0x18 && u.length >= 9) { golpeA(id16(u[3], u[4]), id16(u[7], u[8]), 'ataque'); return; }
    if (h === 0xC3 && u[2] === 0x19 && u.length >= 9) { eco(u); golpeA(id16(u[5], u[6]), id16(u[7], u[8]), 'hechizo ' + ((u[3] << 8) | u[4])); }
  }
  function golpeA(src, tgt, que) {
    const ahora = Date.now();
    if (src === tgt) return;
    if (monstruos.has(src)) {                 // un bicho le pega a alguien: si justo me bajó la vida, ese alguien probablemente soy yo
      if (heroId == null && ahora - ultDano < 700) {
        votos.set(tgt, (votos.get(tgt) || 0) + 1); totalVotos++;
        let mejor = null, n = 0; votos.forEach((v, k) => { if (v > n) { n = v; mejor = k; } });
        if (n >= 4 && n / totalVotos >= 0.7) { heroId = mejor; log('mi id en este mapa: ' + heroId + ' (' + n + ' de ' + totalVotos + ' ataques de bichos con daño mío)'); }
      }
      return;
    }
    if (heroId == null || tgt !== heroId || src === heroId) return;
    let a = ataques.get(src);
    if (!a) { a = { id: src, ev: [], total: 0, danos: 0, primera: ahora, ultima: 0, confirmado: 0, tipos: {} }; ataques.set(src, a); }
    a.ev.push(ahora); while (a.ev.length && ahora - a.ev[0] > 5000) a.ev.shift();
    a.total++; a.ultima = ahora; a.tipos[que] = (a.tipos[que] || 0) + 1;
    if (ahora - ultDano < 900) a.danos++;
    evaluar(a, ahora);
  }
  function evaluar(a, ahora) {
    if (modoAg === 'apagado') return;
    // un id más alto que todos los bichos vistos es casi seguro un jugador; si no, se pide más evidencia
    const necesarios = a.id > maxMons ? 3 : 6;
    if (!(a.ev.length >= necesarios && a.danos >= 1 && ahora - ultDano < 6000)) return;
    if (!a.confirmado) {
      a.confirmado = ahora;
      const j = pos.get(a.id), h = { x: call('GetHeroX'), y: call('GetHeroY') };
      log('AGRESOR #' + a.id + ': ' + a.ev.length + ' ataques en 5 s con daño tuyo a la vez' + (j ? ' · está a ' + cheb({ x: j.tx, y: j.ty }, h) + ' casillas' : '') + ' · mi PK ' + call('GetHeroPk') + ' · modo ' + modoAg);
      enviar('agresor', 'Un jugador te está atacando (id ' + a.id + ', mapa ' + call('GetMapIndex') + ', vida ' + vidaPct() + ' %)' + (modoAg === 'contraatacar' ? ' · modo contraatacar' : ' · solo aviso') + '.', true);
    }
    if (modoAg === 'contraatacar' && !peleando && ahora >= (frio.get(a.id) || 0)) pelear(a.id).catch((e) => { log('error en el contraataque: ' + String(e && e.message || e).slice(0, 80)); });
  }
  const vidaPct = () => { const m = call('GetPlayerLifeMax'); return m ? Math.round(100 * call('GetPlayerLife') / m) : 0; };

  // Quiénes hay cerca (lista del menú "Grupo" del juego: nombre y PK) y cuáles son de tu clan (GetGuildMembersUtf8). No dice quién pegó (el servidor no manda nombres en los golpes),
  // pero si en un golpe fuerte hay un solo jugador cerca y es de tu clan, es casi seguro él.
  function jugadoresCerca() {
    const out = [], clan = str('GetGuildMembersUtf8');
    for (const l of str('GetCommandablePlayersUtf8').split('\n')) {
      const p = l.split('\t'); if (p.length < 2 || !p[1]) continue;
      const pk = parseInt(p[2], 10);
      out.push({ nombre: p[1], pk: Number.isFinite(pk) ? pk : -1, clan: enTexto(clan, p[1]), party: enParty(p[1]) });
    }
    return out.slice(0, 12);
  }
  function registrarFuerte(ahora, baja, restante) {
    const ult = fuertes[fuertes.length - 1];
    if (ult && ahora - ult.ms < 3000) { ult.golpes++; ult.perdio_pct += Math.round(baja * 100); ult.restante_pct = Math.round(restante * 100); ult.ms = ahora; return; }      // misma ráfaga
    let bichos = null; try { const B = window.__bichos, h = { x: call('GetHeroX'), y: call('GetHeroY') }; bichos = B && B.vista ? B.vista().filter((m) => cheb(m, h) <= 3).length : null; } catch (e) { /* nada */ }
    const cerca = jugadoresCerca();
    const e = { t_s: Math.round((ahora - t0) / 1000), ms: ahora, mapa: call('GetMapIndex'), golpes: 1, perdio_pct: Math.round(baja * 100), restante_pct: Math.round(restante * 100), mi_id: heroId, bichos_a_3: bichos, jugadores_cerca: cerca, atacantes_no_bicho_2s: [...ataques.values()].filter((a) => ahora - a.ultima < 2000).map((a) => ({ id: a.id, ataques: a.total, tipos: a.tipos })) };
    fuertes.push(e); if (fuertes.length > 30) fuertes.shift();
    log('GOLPE FUERTE: perdí ' + e.perdio_pct + ' % de vida+escudo de golpe (quedé en ' + e.restante_pct + ' %)' + (heroId == null ? ' · NO sabía mi id (no puedo decir quién fue)' : '') + ' · bichos a <= 3 casillas: ' + (bichos == null ? '?' : bichos) + ' · jugadores cerca: ' + (cerca.length ? cerca.map((c) => c.nombre + (c.clan ? ' (de tu clan)' : '') + (c.party ? ' (de tu party)' : '') + (c.pk > 0 ? ' pk' + c.pk : '')).join(', ') : 'ninguno'));
  }

  // ---- contraataque ----
  async function volverA(home) {
    const Mv = window.__mover; if (!home || !Mv || !Mv.tabla || !Mv.tabla()) return;
    const hero = () => ({ x: call('GetHeroX'), y: call('GetHeroY') });
    const t1 = Date.now(); let ult = hero().x + ',' + hero().y, ultMov = Date.now();
    while (vivo && Date.now() - t1 < 30000 && cheb(hero(), home) > 1) {
      Mv.paso(home.x, home.y, 1); await dormir(200);
      const p = hero().x + ',' + hero().y; if (p !== ult) { ult = p; ultMov = Date.now(); } else if (Date.now() - ultMov > 4000) break;
    }
    try { Mv.parar(); } catch (e) { /* nada */ }
  }
  // Un jugador que corre no se puede pegar: cada paso (D4) trae origen y destino y a ~4,5 casillas/s tarda dist/4,5 en llegar; pasado eso (+150 ms) está quieto.
  const jugadorMoviendose = (j) => { if (!j) return false; const pasos = Math.max(Math.abs(j.tx - j.x), Math.abs(j.ty - j.y)); return Date.now() - j.t < pasos / 4.5 * 1000 + 150; };
  const enParty = (nombre) => { if (!nombre) return false; const p = str('GetPartyMembersUtf8').toLowerCase(); return p.length > 0 && p.includes(nombre.toLowerCase()); };

  async function pelear(id) {
    const S = window.__pantalla, Mo = window.__modo, P = window.__paquetes;
    if (peleando) return;
    const rechazo = (txt, seg) => { frio.set(id, Date.now() + (seg || 20) * 1000); log('NO contraataco a #' + id + ': ' + txt); };
    if (!S || !S.cal || !S.cal() || !S.atacar) return rechazo('falta calibrar la pantalla (Lab > Datos y calibración > Pantalla)', 60);
    if (!Mo || !P) return rechazo('falta modo.js o paquetes.js');
    if (call('HelperIsSafeZone') === 1) return rechazo('estoy en zona segura');
    const prev = Mo.deseado();
    if (!FARMEO.includes(prev)) return rechazo('el modo es "' + prev + '" (solo contraataco si estoy farmeando)');
    if (typeof document !== 'undefined' && document.hasFocus && !document.hasFocus()) {
      enviar('agresor_foco', 'Te están atacando y el navegador no tiene el foco: no puedo contraatacar (el clic simulado necesita la ventana activa).', true);
      return rechazo('el navegador no tiene el foco', 30);
    }
    const h0 = Mo.ancla && Mo.ancla(), home = h0 ? { x: h0.x, y: h0.y } : { x: call('GetHeroX'), y: call('GetHeroY') };
    const pelea = { id, desde: Date.now(), casts: 0, chunks: 0, pkAntes: call('GetHeroPk'), vidaMin: vidaPct(), placas: [], resultado: '' };
    peleando = pelea; peleas.push(pelea); if (peleas.length > 30) peleas.shift();
    log('CONTRAATAQUE a #' + id + ' (modo anterior: ' + prev + ', vuelvo a (' + home.x + ',' + home.y + '))');
    Mo.fijar('pelea', 'agresor: contraataque');
    let sinCasts = 0, fuera = 0, esperaMov = 0;
    try {
      while (true) {
        const ahora = Date.now(), a = ataques.get(id), j = pos.get(id);
        if (!vivo || modoAg !== 'contraatacar') { pelea.resultado = 'apagué el contraataque'; break; }
        if (Mo.deseado() !== 'pelea') { pelea.resultado = 'otro modo tomó el control (' + Mo.deseado() + ')'; break; }
        if (!(call('GetPlayerLife') > 0)) { pelea.resultado = 'morí'; break; }
        const v = vidaPct(); pelea.vidaMin = Math.min(pelea.vidaMin, v);
        if (v < VIDA_CORTE * 100) { pelea.resultado = 'vida baja (' + v + ' %)'; frio.set(id, ahora + 60000); break; }
        const m = muertos.get(id); if (m && m >= pelea.desde) { pelea.resultado = 'LO MATÉ (aviso de muerte del servidor)'; break; }
        if (ahora - pelea.desde > MAX_PELEA_MS) { pelea.resultado = 'tiempo máximo (' + MAX_PELEA_MS / 1000 + ' s)'; frio.set(id, ahora + 120000); break; }
        const senal = Math.max(a ? a.ultima : 0, j ? j.t : 0);
        if (ahora - senal > SENAL_MS) { pelea.resultado = 'se fue o dejó de atacar (' + Math.round((ahora - senal) / 1000) + ' s sin señales)'; frio.set(id, ahora + 45000); break; }
        if (!j) { await dormir(250); continue; }
        const objetivo = { x: j.tx, y: j.ty };
        if (cheb(objetivo, { x: call('GetHeroX'), y: call('GetHeroY') }) > LEJOS) { pelea.resultado = 'se alejó más de ' + LEJOS + ' casillas'; frio.set(id, ahora + 45000); break; }
        // mientras el jugador se mueve no se lo ataca: se espera a que se quede quieto (hasta 1,5 s seguidos; después se ataca igual para no trabarse)
        if (jugadorMoviendose(j)) { if (!esperaMov) esperaMov = ahora; if (ahora - esperaMov < 1500) { pelea.esperas = (pelea.esperas || 0) + 1; await dormir(100); continue; } } else esperaMov = 0;
        const c0 = P.cuenta('tx', 'C3:0x19');
        const r = await S.atacar(objetivo, 1800);
        const casts = P.cuenta('tx', 'C3:0x19') - c0; pelea.casts += Math.max(0, casts); pelea.chunks++;
        const placa = str('GetTargetPlateUtf8').replace(/\t/g, ' | ');
        if (pelea.placas.length < 6 && placa && !pelea.placas.includes(placa)) pelea.placas.push(placa);
        if (pelea.chunks <= 3 || pelea.chunks % 5 === 0) log('contraataque #' + id + ' tanda ' + pelea.chunks + ': ' + casts + ' hechizos' + (r && r.ok ? '' : ' (' + (r && r.motivo || 'falló') + ')') + ' · placa: ' + (placa || '-') + ' · vida ' + v + ' %');
        if (enParty(placa.split(' | ')[0])) { pelea.resultado = 'ES DE MI PARTY (' + placa.split(' | ')[0] + '): paro'; frio.set(id, ahora + 600000); break; }
        if (pelea.deClan == null && placa) { pelea.deClan = enTexto(str('GetGuildMembersUtf8'), placa.split(' | ')[0]); if (pelea.deClan) log('OJO: #' + id + ' (' + placa.split(' | ')[0] + ') figura en la lista de tu clan'); }
        if (r && !r.ok && /fuera de la pantalla/.test(r.motivo || '')) { if (++fuera >= 8) { pelea.resultado = 'queda fuera de la pantalla'; frio.set(id, ahora + 30000); break; } await dormir(300); continue; }
        fuera = 0;
        if (casts <= 0) { if (++sinCasts >= 3) { pelea.resultado = 'no salen hechizos sobre él (¿no se lo puede atacar?)'; frio.set(id, ahora + 300000); break; } } else sinCasts = 0;
      }
    } catch (e) { pelea.resultado = 'error: ' + String(e && e.message || e).slice(0, 60); }
    finally {
      try { const c = S.centro(); S.derecho.soltar(c.x, c.y); } catch (e) { /* nada */ }
      pelea.seg = Math.round((Date.now() - pelea.desde) / 1000); pelea.pkDespues = call('GetHeroPk');
      log('FIN del contraataque a #' + id + ': ' + pelea.resultado + ' · ' + pelea.seg + ' s · ' + pelea.casts + ' hechizos · vida mínima ' + pelea.vidaMin + ' % · mi PK ' + pelea.pkAntes + ' → ' + pelea.pkDespues);
      enviar('agresor_fin', 'Fin del contraataque (id ' + id + '): ' + pelea.resultado + ' · ' + pelea.seg + ' s · vida mínima ' + pelea.vidaMin + ' %.', /morí|vida baja/.test(pelea.resultado));
      try {
        if (vivo && Mo.deseado() === 'pelea') {
          if (FARMEO.includes(prev) && prev !== 'helper') await volverA(home);
          const rr = Mo.fijar(prev, 'agresor: fin'); if (!rr || !rr.ok) Mo.fijar('helper', 'agresor: fin (el modo anterior no se pudo)');
        }
      } catch (e) { /* nada */ }
      peleando = null;
    }
  }

  // ---- F10: ATACAR A UN JUGADOR AL AZAR de la pantalla con pulsos de 10 ms (v0.73.0, pedido del usuario) ----
  // Prendido: elige al azar un jugador que se vea en la pantalla (no tuyo: ni de la party ni del clan; se confirma con la placa del blanco), mantiene el clic derecho sobre él (lo que ya hace el contraataque,
  // validado a mano en la caja 51) y ADEMÁS manda pulsos de SetManualSkillHeld cada 10 ms (la "bomba" de la Sostenida) con el puntero encima. Pone el modo PK del juego (el "Ctrl"), lo deja como estaba al
  // apagar. Cuando muere o se va, elige otro al azar. Corta si morís, bajás de 35 % de vida, o con F10 de nuevo. NO está probado en el juego: en `agresores.pvp` queda cuántos hechizos salieron por tanda.
  // v0.74.0 PVP AUTOMÁTICO: cuando te pegan fuerte se activa solo (pedido: "ni bien baja el sd 2 mil, 3 mil"). Dispara si vida+escudo bajan >= umbral dentro de 1 s Y hay un jugador a la vista (si no, pueden ser bichos).
  // Elige al agresor confirmado si lo hay, si no al jugador más cercano; se apaga solo cuando no queda ningún jugador a la vista 6 s (vuelve al modo anterior). Lab: PVP auto ON/OFF y umbral.
  const PA = { on: false, umbral: 2500, ventanaMs: 1000, frioHasta: 0, disparos: 0, sinJugador: 0, ult: '' };
  // v0.84.2: APAGADO de fábrica (caja 31: se prendió solo con un golpe de 20 mil, atacó a 3 jugadores cerca y mató a 2; PK 4 -> 6). Lo guardado antes (sin v:2) se ignora
  try { const g = JSON.parse(localStorage.getItem('muPvpAutoV1') || 'null'); if (g && g.v === 2) { if (typeof g.on === 'boolean') PA.on = g.on; if (g.umbral >= 500 && g.umbral <= 20000) PA.umbral = g.umbral; } } catch (e) { /* nada */ }
  const guardarPA = () => { try { localStorage.setItem('muPvpAutoV1', JSON.stringify({ v: 2, on: PA.on, umbral: PA.umbral })); } catch (e) { /* nada */ } };
  const histVida = [];
  const nomDe = (id) => { const r = nombreDe.get(id); return r && Date.now() - r.t < 20000 ? r.nm : undefined; };      // el id de un jugador cambia si sale y vuelve a entrar: el nombre vale 20 s
  const PVP = { on: false, auto: false, uno: null, unoNombre: '', raton: false, enganchado: false, objetivos: 0, casts: 0, tandas: 0, muertes: 0, descartados: 0, sinHechizos: 0, ult: '', hechizosSinClic: 0 };
  // v0.87.0 PVP CON EL MOUSE (tecla 0): ataca al jugador que tengas más cerca del puntero (<= 90 px). Posición del mouse REAL (los eventos simulados no cuentan: isTrusted).
  // Mientras hay un blanco enganchado se frenan los movimientos reales hacia el juego (si no, el puntero real y el simulado se pisan y el clic derecho mantenido se suelta).
  const CUR = { x: null, y: null, t: 0 }, RADIO_CUR = 90, SOLTAR_CUR = 150;
  { const ACc = new AbortController(); (window.__muLimpiar = window.__muLimpiar || []).push(() => ACc.abort());
    window.addEventListener('pointermove', (e) => { if (!e.isTrusted) return; CUR.x = e.clientX; CUR.y = e.clientY; CUR.t = Date.now(); if (PVP.on && PVP.raton && PVP.enganchado) e.stopImmediatePropagation(); }, { capture: true, signal: ACc.signal}); }
  const pulsoPvp = () =>
 { call('SetManualSkillHeld', 0); call('SetManualSkillHeld', 1); };
  function candidatosPvp(edadMax) {
    const S = window.__pantalla, ahora = Date.now(), h = { x: call('GetHeroX'), y: call('GetHeroY') }, out = [];
    pos.forEach((j, id) => {
      if (id === heroId || monstruos.has(id) || ahora - j.t > (edadMax || 3000) || (frio.get(id) || 0) > ahora) return;
      if (cheb({ x: j.tx, y: j.ty }, h) > 9) return;
      if (cheb({ x: j.tx, y: j.ty }, h) === 0 && cheb({ x: j.x, y: j.y }, h) === 0) return;      // caja 22: con el id propio todavía sin aprender (recién cambiado de mapa) se eligió a sí mismo (#512): mis propios pasos no son otro jugador
      const px = S.pixelAtaque ? S.pixelAtaque({ x: j.tx, y: j.ty }) : null; if (!px || !S.enPantalla(px)) return;
      out.push(id);
    });
    return out;
  }
  async function pvpLoop() {
    const auto = PVP.auto, uno = PVP.uno, raton = PVP.raton, etq = raton ? 'PVP MOUSE' : uno ? 'PVP UNO (' + PVP.unoNombre + ')' : auto ? 'PVP AUTO' : 'PVP F10', tIni = Date.now();
    const S = window.__pantalla, Mo = window.__modo, P = window.__paquetes;
    const fin = (txt) => { PVP.ult = txt; log(etq + ': ' + txt); };
    if (!S || !S.cal || !S.cal() || !S.derecho) { PVP.on = false; return fin('falta calibrar la pantalla (Lab > Datos y calibración > Pantalla)'); }
    if (!Mo || !P) { PVP.on = false; return fin('falta modo.js o paquetes.js'); }
    if (peleando) { PVP.on = false; return fin('ya hay una pelea en curso'); }
    if (modoAg === 'apagado') { modoAg = 'avisar'; guardar(); log('F10 prendió la lectura de jugadores (modo de agresores: avisar)'); }
    const prev = Mo.deseado(), pk0 = call('GetPkMode');
    const pelea = { id: -1, desde: Date.now(), casts: 0, chunks: 0, pkAntes: call('GetHeroPk'), vidaMin: vidaPct(), placas: [], resultado: '', pvp: true };
    peleando = pelea; Mo.fijar('pelea', raton ? 'PVP con el mouse' : uno ? 'PVP a ' + PVP.unoNombre : 'F10: jugador al azar'); call('SetPkMode', uno || raton ? 0 : 1);      // contra uno solo: el modo PK se prende recién cuando la placa confirma el nombre
    fin('prendido (modo anterior ' + prev + ', PK antes ' + pk0 + ')');
    let avisoSin = 0, sinJugDesde = 0;
    const distCur = (x) => { const q = pos.get(x), px = q && S.pixelAtaque({ x: q.tx, y: q.ty }); return px && CUR.x != null ? Math.hypot(px.x - CUR.x, px.y - CUR.y) : Infinity; };
    try {
      while (PVP.on && vivo) {
        if (Mo.deseado() !== 'pelea') { fin('otro modo tomó el control (' + Mo.deseado() + ')'); break; }
        if (!(call('GetPlayerLife') > 0)) { fin('morí'); break; }
        if (vidaPct() < VIDA_CORTE * 100) { fin('vida baja (' + vidaPct() + ' %): corto'); break; }
        if (typeof document !== 'undefined' && document.hasFocus && !document.hasFocus()) { await dormir(400); continue; }
        let cand;
        if (raton) {      // al jugador que esté más cerca del puntero; si el mouse no está cerca de ninguno, espera con el modo PK apagado
          call('SetPkMode', 0); PVP.enganchado = false;
          const cu = candidatosPvp(40000).filter((x) => { const n = nomDe(x); return !(n && (enParty(n) || enTexto(str('GetGuildMembersUtf8'), n))); });
          cand = cu.filter((x) => distCur(x) <= RADIO_CUR).sort((p, q) => distCur(p) - distCur(q));
          if (!cand.length) { if (Date.now() - avisoSin > 15000) { avisoSin = Date.now(); log(etq + ': ' + (CUR.x == null ? 'todavía no moviste el mouse' : 'ningún jugador cerca del puntero') + ', espero'); } await dormir(80); continue; }
        } else if (uno) {
      // contra uno solo: por nombre. Nunca se ataca a otro; si no está a la vista, espera
          call('SetPkMode', 0);
          if (enParty(PVP.unoNombre) || enTexto(str('GetGuildMembersUtf8'), PVP.unoNombre)) { fin('ES DE TU PARTY/CLAN: no lo ataco'); break; }
          const cerca = str('GetCommandablePlayersUtf8').split('\n').some((l) => (l.split('\t')[1] || '').toLowerCase() === uno);
          const cu = candidatosPvp(40000), conocido = cu.find((x) => nomDe(x) === uno), ids = conocido != null ? [conocido] : cu.filter((x) => nomDe(x) === undefined);
          if (!ids.length) { if (Date.now() - avisoSin > 8000) { avisoSin = Date.now(); log(etq + ': ' + (cerca ? 'está cerca pero no lo veo en pantalla (o ya revisé a todos los de la vista)' : 'no está cerca') + ', espero'); } await dormir(400); continue; }
          const hh = { x: call('GetHeroX'), y: call('GetHeroY') };
          cand = ids.slice().sort((p, q) => cheb({ x: pos.get(p).tx, y: pos.get(p).ty }, hh) - cheb({ x: pos.get(q).tx, y: pos.get(q).ty }, hh));
        } else cand = candidatosPvp();
        if (!cand.length) {
          if (auto) { if (!sinJugDesde) sinJugDesde = Date.now(); if (Date.now() - sinJugDesde > 6000) { fin('ya no hay jugadores a la vista: termino y vuelvo al modo anterior'); break; } if (Date.now() - tIni > 120000) { fin('pasaron 120 s: termino'); break; } }
          if (Date.now() - avisoSin > 8000) { avisoSin = Date.now(); log(etq + ': no hay jugadores a la vista (<= 9 casillas), espero'); } await dormir(300); continue; }
        sinJugDesde = 0;
        let id;
        if (auto) {      // al agresor confirmado (el que ataca con daño tuyo) si está a la vista; si no, al jugador más cercano
          const h = { x: call('GetHeroX'), y: call('GetHeroY') }, ag = activos().map((a) => a.id).find((x) => cand.includes(x));
          id = ag != null ? ag : cand.slice().sort((p, q) => cheb({ x: pos.get(p).tx, y: pos.get(p).ty }, h) - cheb({ x: pos.get(q).tx, y: pos.get(q).ty }, h))[0];
        } else id = uno || raton ? cand[0] : cand[Math.floor(Math.random() * cand.length)];
        PVP.objetivos++; pelea.id = id; const t0 = Date.now(); let casts = 0, sinCasts = 0, motivo = 'tiempo', ultCheck = 0;
        const j0 = pos.get(id); const px0 = S.pixelAtaque({ x: j0.tx, y: j0.ty });
        S.derecho.iniciar(px0.x, px0.y); await dormir(250);
        if (uno) {      // ¿es él? la placa se mira SIN modo PK (si es otro, no le pego); recién si coincide se prende el PK y salen los pulsos
          let nm = ''; for (let k = 0; k < 14 && !nm; k++) { nm = (str('GetTargetPlateUtf8').split('\t')[0] || '').trim().toLowerCase(); if (!nm) await dormir(30); }
          if (nm !== uno) {
            try { const c = S.centro(); S.derecho.soltar(c.x, c.y); } catch (e) { /* nada */ }
            if (nm) { nombreDe.set(id, { nm, t: Date.now() }); log(etq + ': #' + id + ' es ' + nm + ', no lo toco'); }
            else { frio.set(id, Date.now() + 4000); PVP.sinPlaca = (PVP.sinPlaca || 0) + 1; if (PVP.sinPlaca % 5 === 1) log(etq + ': no pude leer la placa de #' + id + ' (el clic derecho sin modo PK quizá no lo selecciona)'); }
            await dormir(250); continue;
          }
          nombreDe.set(id, { nm: uno, t: Date.now() }); call('SetPkMode', 1); log(etq + ': lo encontré (#' + id + '): lo ataco');
        }
        let objNm = '';
        if (raton) {      // ¿quién es? la placa se mira SIN modo PK: si es de tu party/clan (o no se lee) no se le pega
          let nm = ''; for (let k = 0; k < 14 && !nm; k++) { nm = (str('GetTargetPlateUtf8').split('\t')[0] || '').trim(); if (!nm) await dormir(30); }
          if (!nm || enParty(nm) || enTexto(str('GetGuildMembersUtf8'), nm)) {
            try { const c = S.centro(); S.derecho.soltar(c.x, c.y); } catch (e) { /* nada */ }
            if (nm) { nombreDe.set(id, { nm: nm.toLowerCase(), t: Date.now() }); frio.set(id, Date.now() + 3600000); PVP.descartados++; log(etq + ': #' + id + ' (' + nm + ') es de tu party/clan: no lo toco'); }
            else { frio.set(id, Date.now() + 4000); PVP.sinPlaca = (PVP.sinPlaca || 0) + 1; if (PVP.sinPlaca % 5 === 1) log(etq + ': no pude leer la placa de #' + id + ' (el clic derecho sin modo PK quizá no lo selecciona)'); }
            await dormir(250); continue;
          }
          objNm = nm; nombreDe.set(id, { nm: nm.toLowerCase(), t: Date.now() }); call('SetPkMode', 1); PVP.enganchado = true; log(etq + ': atacando a ' + nm + ' (#' + id + ')');
        }
        const timer = setInterval(() => { try { pulsoPvp(); } catch (e) { /* nada */ } }, 10);
        let c1 = P.cuenta('tx', 'C3:0x19'), tC = Date.now();
        try {
          while (PVP.on && vivo) {
            const ahora = Date.now(), j = pos.get(id);
            if (!(call('GetPlayerLife') > 0)) { motivo = 'morí'; break; }
            if (vidaPct() < VIDA_CORTE * 100) { motivo = 'vida baja'; break; }
            const m = muertos.get(id); if (m && m >= t0) { motivo = 'LO MATÉ (aviso de muerte)'; PVP.muertes++; break; }
            if (!j || ahora - j.t > (uno || raton ? 40000 : 5000)) { motivo = 'se fue'; frio.set(id, ahora + 30000); break; }
            if (cheb({ x: j.tx, y: j.ty }, { x: call('GetHeroX'), y: call('GetHeroY') }) > 11) { motivo = 'se alejó'; frio.set(id, ahora + 30000); break; }
            const px = S.pixelAtaque({ x: j.tx, y: j.ty }); if (!px || !S.enPantalla(px)) { motivo = 'salió de la pantalla'; frio.set(id, ahora + 20000); break; }
            S.derecho.mover(px.x, px.y);
            if (ahora - ultCheck > (uno || raton ? 150 : 1000)) {            // la placa del blanco: si es de tu party o clan, se corta y no se lo vuelve a elegir
              ultCheck = ahora; const placa = str('GetTargetPlateUtf8').replace(/\t/g, ' | '), nombre = placa.split(' | ')[0];
              if (placa && !pelea.placas.includes(placa) && pelea.placas.length < 8) pelea.placas.push(placa);
              if (raton) {      // misma placa que al enganchar; party/clan corta con el PK apagado; y el mouse manda: si lo sacás o lo ponés sobre otro, cambia
                if (nombre && nombre.trim() !== objNm) { call('SetPkMode', 0); motivo = 'el blanco cambió a otro (' + nombre + '): paro'; break; }
                if (nombre && (enParty(nombre) || enTexto(str('GetGuildMembersUtf8'), nombre))) { call('SetPkMode', 0); motivo = 'ES DE TU PARTY/CLAN (' + nombre + '): paro'; PVP.descartados++; frio.set(id, ahora + 3600000); break; }
                const d0 = distCur(id); if (d0 > SOLTAR_CUR) { motivo = 'sacaste el mouse'; break; }
                if (d0 > RADIO_CUR * 0.7) { const otro = candidatosPvp(40000).find((x) => x !== id && distCur(x) <= RADIO_CUR * 0.7 && distCur(x) < d0 - 25); if (otro != null) { motivo = 'el mouse pasó a otro jugador'; break; } }
              }
              if (uno && nombre && nombre.trim().toLowerCase() !== uno) { call('SetPkMode', 0); motivo = 'el blanco cambió a otro (' + nombre + '): paro'; break; }
              if (nombre && (enParty(nombre) || enTexto(str('GetGuildMembersUtf8'), nombre))) { motivo = 'ES DE TU PARTY/CLAN (' + nombre + '): lo descarto'; PVP.descartados++; frio.set(id, ahora + 3600000); break; }
            }
            if (ahora - tC >= 2000) {                 // cada 2 s: ¿salieron hechizos?
              const c2 = P.cuenta('tx', 'C3:0x19'), d = c2 - c1; casts += d; PVP.casts += d; pelea.casts += d; PVP.tandas++; pelea.chunks++; c1 = c2; tC = ahora;
              if (d <= 0) { if (++sinCasts >= 2) { motivo = 'no salen hechizos sobre él (¿no se lo puede atacar? ¿falta el modo PK?)'; PVP.sinHechizos++; frio.set(id, ahora + 120000); break; } } else sinCasts = 0;
            }
            if (!uno && !raton && ahora - t0 > 25000) { motivo = 'pasaron 25 s: elijo otro'; frio.set(id, ahora + 20000); break; }
            await dormir(60);
          }
        } finally {
          clearInterval(timer); PVP.enganchado = false; try { const c = S.centro(); S.derecho.soltar(c.x, c.y); } catch (e) { /* nada */ }
          const resto = P.cuenta('tx', 'C3:0x19') - c1; if (resto > 0) { casts += resto; PVP.casts += resto; pelea.casts += resto; PVP.tandas++; }       // los hechizos de la última tanda (menos de 2 s) también cuentan
        }
        PVP.ult = 'jugador #' + id + ': ' + motivo + ' · ' + Math.round((Date.now() - t0) / 1000) + ' s · ' + casts + ' hechizos'; log(etq + ': ' + PVP.ult);
        pelea.vidaMin = Math.min(pelea.vidaMin, vidaPct());
        if (raton) { call('SetPkMode', 0); if (/LO MATÉ/.test(motivo)) frio.set(id, Date.now() + 4000); }
        if (uno) { frio.delete(id); call('SetPkMode', 0); if (/LO MATÉ/.test(motivo)) { fin('lo maté: termino'); break; } }
        if (/morí|vida baja/.test(motivo)) break;
        await dormir(300);
      }
    } catch (e) { fin('error: ' + String(e && e.message || e).slice(0, 80)); }
    finally {
      PVP.on = false; PVP.auto = false; PVP.enganchado = false; PA.frioHasta = Date.now() + 5000; try { call('SetPkMode', pk0 === 1 ? 1 : 0); } catch (e) { /* nada */ }
      pelea.seg = Math.round((Date.now() - pelea.desde) / 1000); pelea.resultado = PVP.ult; pelea.pkDespues = call('GetHeroPk'); peleas.push(pelea); if (peleas.length > 30) peleas.shift();
      try { if (vivo && Mo.deseado() === 'pelea') { const rr = Mo.fijar(FARMEO.includes(prev) && prev !== 'helper' ? prev : (prev === 'helper' ? 'helper' : 'manual'), 'F10: fin'); if (!rr || !rr.ok) Mo.fijar('helper', 'F10: fin'); } } catch (e) { /* nada */ }
      peleando = null; log(etq + ': apagado · PK ' + pelea.pkAntes + ' → ' + pelea.pkDespues + ' · ' + pelea.casts + ' hechizos en ' + pelea.seg + ' s');
    }
  }
  function pvpToggle(v, auto, uno, raton) {
    const quiere = v == null ? !PVP.on : !!v;
    if (quiere === PVP.on) return PVP.on;
    PVP.on = quiere; PVP.raton = quiere && !!raton; PVP.enganchado = false; PVP.auto = quiere && !!auto; PVP.uno = quiere && uno ? String(uno).trim().toLowerCase() : null; PVP.unoNombre = PVP.uno ? String(uno).trim() : ''; if (quiere) pvpLoop().catch(() => { PVP.on = false; peleando = null; });
    return PVP.on;
  }

  // ---- ALERTA DE ATAQUE (v0.76.0): cartel rojo arriba en el medio ----
  // Pedido: "cuando me ataca alguien un pop up en el medio arriba con contraste rojo para que se vea quién y cuánto me saca, y que me avise". Suma el daño (vida + SD) de los últimos 3 s y, si pasa del mínimo y hay un
  // jugador cerca (o el golpe es fuerte), muestra el cartel con el total, los jugadores cerca (los PK primero y en amarillo; los de tu party/clan no cuentan) y tu vida/SD, y suena un pitido. El servidor NO dice quién pega:
  // los nombres son "sospechosos" (los que estaban cerca), no una certeza. Si hay un PVP en curso muestra también la placa de su blanco.
  const AL = { on: true, min: 1000, ventana: 3000, acum: 0, t0: 0, ult: 0, ultBeep: 0, ultJug: 0, jug: [], mostradas: 0, pico: 0, el: null, hideT: null, ultTxt: '' };
  try { const g = JSON.parse(localStorage.getItem('muAlertaAtaqueV1') || 'null'); if (g) { if (typeof g.on === 'boolean') AL.on = g.on; if (g.min >= 200 && g.min <= 20000) AL.min = g.min; } } catch (e) { /* nada */ }
  const guardarAL = () => { try { localStorage.setItem('muAlertaAtaqueV1', JSON.stringify({ on: AL.on, min: AL.min })); } catch (e) { /* nada */ } };
  const fmtN = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const escH = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function alertaEl() {
    if (AL.el && AL.el.isConnected) return AL.el;
    const d = document.createElement('div'); d.id = 'mu-alerta-ataque';
    d.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483600;min-width:320px;max-width:80vw;padding:10px 22px;background:#c00018;color:#fff;border:3px solid #ff8080;border-radius:10px;box-shadow:0 0 22px 6px rgba(255,0,40,.65);font:700 20px/1.3 system-ui,Segoe UI,Arial,sans-serif;text-align:center;pointer-events:none;display:none';
    (document.body || document.documentElement).appendChild(d); AL.el = d; return d;
  }
  function pitidoAlerta() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; const ctx = window.__muAudio || (window.__muAudio = new AC()); if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime; [0, 0.17].forEach((dt, k) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = k ? 1040 : 780; g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(0.25, t + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.15); o.connect(g); g.connect(ctx.destination); o.start(t + dt); o.stop(t + dt + 0.16); });
    } catch (e) { /* nada */ }
  }
  function alertaMostrar(txtPrincipal, jug, extra) {
    const el = alertaEl(), mxSd = call('GetPlayerShieldMax') || 0, sdPct = mxSd ? Math.round(100 * (call('GetPlayerShield') || 0) / mxSd) : 100;
    const quien = jug.length ? jug.slice().sort((a, b) => (b.pk - a.pk)).slice(0, 4).map((j) => (j.pk > 0 ? '<span style="color:#ffe14d">☠ ' + escH(j.nombre) + ' (PK ' + j.pk + ')</span>' : escH(j.nombre))).join(' · ') : '<span style="opacity:.85">sin jugadores a la vista (¿bicho o fuera de pantalla?)</span>';
    el.innerHTML = '<div style="font-size:26px;letter-spacing:1px">⚠ TE ATACAN  −' + txtPrincipal + '</div><div style="font-size:17px;margin-top:2px">' + (jug.length ? 'Cerca: ' : '') + quien + '</div><div style="font-size:15px;margin-top:2px;opacity:.95">Vida ' + vidaPct() + ' % · SD ' + sdPct + ' %' + (extra ? ' · ' + extra : '') + '</div>';
    el.style.display = 'block'; AL.ultTxt = el.textContent;
    clearTimeout(AL.hideT); AL.hideT = setTimeout(() => { try { el.style.display = 'none'; } catch (e) { /* nada */ } }, 6000);
  }
  function alertaDano(ahora, dmg) {
    if (!AL.on || !(dmg > 0)) return;
    if (ahora - AL.ult > AL.ventana) { AL.acum = 0; AL.t0 = ahora; }
    AL.acum += dmg; AL.ult = ahora; if (AL.acum > AL.pico) AL.pico = AL.acum;
    if (ahora - AL.ultJug > 500) { AL.ultJug = ahora; try { AL.jug = jugadoresCerca().filter((j) => !j.party && !j.clan); } catch (e) { AL.jug = []; } }
    if (!(AL.acum >= AL.min && (AL.jug.length || AL.acum >= PA.umbral))) return;
    const seg = Math.max(0.2, (ahora - AL.t0) / 1000);
    alertaMostrar(fmtN(AL.acum) + ' en ' + seg.toFixed(1) + ' s', AL.jug, PVP.on ? (PVP.auto ? 'PVP AUTO activo' : 'PVP activo') : '');
    if (ahora - AL.ultBeep > 4000) { AL.ultBeep = ahora; AL.mostradas++; pitidoAlerta(); log('ALERTA: te sacan ' + fmtN(AL.acum) + ' (vida+SD) · jugadores cerca: ' + (AL.jug.length ? AL.jug.map((j) => j.nombre + (j.pk > 0 ? ' PK' + j.pk : '')).join(', ') : 'ninguno')); }
  }
  // ---- mantenimiento (cada 200 ms) ----
  setInterval(() => {
    try {
      const Pq = window.__paquetes;
      if (!escuchando && Pq && Pq.alRecibir) { escuchando = true; Pq.alRecibir(onRx); if (Pq.alEnviar) Pq.alEnviar(onTx); }
      if (call('GetSceneFlag') !== 5 || modoAg === 'apagado') { ultTick = 0; return; }
      const ahora = Date.now(), mp = call('GetMapIndex');
      if (mapaAct !== null && mp !== mapaAct) reiniciar('cambió el mapa');
      mapaAct = mp;
      if (ultTick) { const dt = Math.min(1000, ahora - ultTick); if (heroId == null) sinIdMs += dt; else conIdMs += dt; }       // cuánto tiempo estuve "ciego" (sin saber mi id)
      ultTick = ahora;
      const v = (call('GetPlayerLife') | 0) + (call('GetPlayerShield') | 0), vmax = (call('GetPlayerLifeMax') | 0) + (call('GetPlayerShieldMax') | 0);
      if (prevVida != null && v < prevVida) {
        ultDano = ahora; if (prevMax > 0 && vmax > 0 && Math.abs(vmax - prevMax) <= 0.1 * prevMax) { try { alertaDano(ahora, prevVida - v); } catch (e) { /* nada */ } }      // cartel rojo de ataque (no cuenta los cambios de máximo)
        // golpe fuerte = baja >= 15 % del máximo en un instante (si el máximo cambió, fue un reset/equipo, no un golpe)
        if (prevMax > 0 && vmax > 0 && Math.abs(vmax - prevMax) <= 0.1 * prevMax && (prevVida - v) / prevMax >= FUERTE) registrarFuerte(ahora, (prevVida - v) / prevMax, v / prevMax);
      }
      prevVida = v; prevMax = vmax;
      if (PA.on) {      // golpe fuerte: vida+escudo bajaron >= umbral dentro de la ventana -> PVP automático (si hay un jugador a la vista)
        histVida.push([ahora, v, vmax]); while (histVida.length && ahora - histVida[0][0] > PA.ventanaMs) histVida.shift();
        const maxV = histVida.reduce((m, q) => (Math.abs(q[2] - vmax) <= 0.05 * vmax ? Math.max(m, q[1]) : m), 0), baja = maxV - v;      // se ignoran las muestras con otro máximo de vida (reset, subida de nivel, equipo: caja 22 vio una "baja" de 51596 por eso)
        if (baja >= PA.umbral && !PVP.on && !peleando && ahora >= PA.frioHasta && v > 0 && heroId != null) {
          PA.frioHasta = ahora + 3000;
          if (candidatosPvp().filter((x) => x !== heroId).length) {
            PA.disparos++; PA.ult = 'bajaron ' + baja + ' de vida+escudo en <= ' + PA.ventanaMs + ' ms (vida ' + vidaPct() + ' %)';
            log('PVP AUTO: ' + PA.ult + ' → activo el modo PVP'); enviar('agresor_pvp', 'Me pegaron fuerte (' + baja + '): activé el PVP automático (vida ' + vidaPct() + ' %).');
            pvpToggle(true, true);
          } else { PA.sinJugador++; PA.ult = 'bajaron ' + baja + ' pero no hay jugadores a la vista (¿bichos?): no activo'; log('PVP AUTO: ' + PA.ult); }
        }
      }
      const B = window.__bichos; if (B && B.vista) for (const m of B.vista()) { monstruos.set(m.id, ahora); if (m.id > maxMons) maxMons = m.id; }
      if (ahora - ultPoda > 5000) {
        ultPoda = ahora;
        monstruos.forEach((t, k) => { if (ahora - t > 60000) monstruos.delete(k); });
        pos.forEach((p, k) => { if (ahora - p.t > 60000) pos.delete(k); });
        muertos.forEach((t, k) => { if (ahora - t > 60000) muertos.delete(k); });
        ataques.forEach((a, k) => { if (ahora - a.ultima > 180000 && peleando?.id !== k) ataques.delete(k); });
      }
    } catch (e) { /* nada */ }
  }, 200);

  // ---- REGISTRO DE A QUIÉN ATACO (v0.85.0, pedido: "podemos tomar logs de a quién ataco") ----
  // Cada hechizo que sale (C3 0x19) hacia un id que no es bicho ni soy yo se anota como posible jugador; una vez por segundo se lee la placa del blanco (GetTargetPlateUtf8) y se confirma el
  // nombre si figura entre los jugadores cercanos. Al dejar de pegarle 5 s se cierra el registro (con o sin confirmar el nombre, si fueron >= 3 hechizos) y se guarda en el navegador
  // (muAtaquesJugadoresV1, últimos 200: sobrevive a recargas) y en la caja (agresores.ataques_a_jugadores). Sirve para cualquier ataque: PVP F10, contraataque, a mano o la Sostenida.
  const KEY_ATQ = 'muAtaquesJugadoresV1', atq = new Map(); let hist = [];
  try { const g = JSON.parse(localStorage.getItem(KEY_ATQ) || '[]'); if (Array.isArray(g)) hist = g.slice(-200); } catch (e) { /* nada */ }
  const guardarAtq = () => { try { localStorage.setItem(KEY_ATQ, JSON.stringify(hist.slice(-200))); } catch (e) { /* nada */ } };
  function atqCast(tid) {
    const ahora = Date.now(); let r = atq.get(tid);
    if (!r) {
      if (monstruos.has(tid) || tid === heroId || !pos.has(tid)) return;      // bicho, yo mismo o un id que nunca vi moverse
      r = { id: tid, primera: ahora, ultima: ahora, casts: 0, nombres: {}, mapa: call('GetMapIndex'), pk0: call('GetHeroPk'), placaT: 0, murio: false, pk: null, clan: false, party: false, avisado: false };
      atq.set(tid, r);
    }
    r.casts++; r.ultima = ahora;
  }
  const nombreTop = (r) => { let m = null, n = 0; for (const k in r.nombres) if (r.nombres[k] > n) { n = r.nombres[k]; m = k; } return m; };
  setInterval(() => {
    try {
      const ahora = Date.now();
      atq.forEach((r, id) => {
        if (ahora - r.ultima <= 5000) {
          if (ahora - r.placaT >= 1000) {
            r.placaT = ahora; const nombre = str('GetTargetPlateUtf8').split('\t')[0];
            if (nombre) { const j = jugadoresCerca().find((x) => x.nombre === nombre); if (j) { r.nombres[nombre] = (r.nombres[nombre] || 0) + 1; r.pk = j.pk; r.clan = j.clan; r.party = j.party; if (!r.avisado && (j.party || j.clan)) { r.avisado = true; log('OJO: estás atacando a ' + nombre + ' (de tu ' + (j.party ? 'party' : 'clan') + ')'); } } }
          }
          const m = muertos.get(id); if (m && m >= r.primera) r.murio = true;
          return;
        }
        atq.delete(id);
        const nombre = nombreTop(r);
        if (!nombre && r.casts < 3) return;      // un bicho que se coló o un hechizo suelto: no se anota
        const via = PVP.on ? (PVP.auto ? 'PVP automático' : 'PVP F10') : (peleando ? 'contraataque' : 'a mano o Sostenida');
        const reg = { hora: new Date(r.primera).toISOString(), mapa: r.mapa, id, nombre: nombre || null, hechizos: r.casts, seg: Math.round((r.ultima - r.primera) / 1000), murio: r.murio, via, pk_mio_antes: r.pk0, pk_mio_despues: call('GetHeroPk'), pk_del_otro: r.pk, de_mi_clan: r.clan, de_mi_party: r.party };
        if (!nombre) reg.jugadores_cerca = jugadoresCerca().map((x) => x.nombre + (x.pk > 0 ? ' pk' + x.pk : '')).slice(0, 8);
        hist.push(reg); if (hist.length > 200) hist.shift(); guardarAtq();
        log('ATAQUÉ A ' + (nombre || 'un jugador sin nombre leído (#' + id + ')') + (r.party ? ' (de tu party)' : r.clan ? ' (de tu clan)' : '') + ' · ' + r.casts + ' hechizos en ' + reg.seg + ' s · ' + (r.murio ? 'MURIÓ' : 'no murió') + ' · ' + via + ' · mi PK ' + reg.pk_mio_antes + ' → ' + reg.pk_mio_despues);
      });
    } catch (e) { /* nada */ }
  }, 1000);
  const ataquesTexto = (n) => { const l = hist.slice(-(n || 5)); return 'Ataques a jugadores registrados: ' + hist.length + (l.length ? ' · últimos: ' + l.map((x) => x.hora.slice(11, 19) + ' ' + (x.nombre || '#' + x.id) + ' (' + x.hechizos + ' hechizos' + (x.murio ? ', murió' : '') + ', ' + x.via + (x.de_mi_party ? ', de tu party' : x.de_mi_clan ? ', de tu clan' : '') + ')').join(' | ') : ''); };

  const activos = () => [...ataques.values()].filter((a) => a.confirmado && Date.now() - a.ultima < 120000).sort((p, q) => q.ultima - p.ultima);
  window.__agresor = {
    modo: () => modoAg, peleando: () => !!peleando, heroId: () => heroId,
    setModo: (m) => { if (!MODOS.includes(m)) return modoAg; modoAg = m; guardar(); log('modo de agresores: ' + m); return modoAg; },
    setHeroId: (n) => { heroId = n == null ? null : (n | 0); votos.clear(); totalVotos = 0; return heroId; },
    probar: (id) => pelear(id | 0),
    pvp: pvpToggle, pvpRaton: (v) => pvpToggle(v, false, null, true), pvpUno: (nombre) => (nombre && String(nombre).trim() ? pvpToggle(true, false, nombre) : pvpToggle(false)), pvpOn: () => PVP.on, pvpStats: () => ({ ...PVP }), ataquesAJugadores: () => hist.slice(), ataquesTexto, borrarAtaques: () => { hist = []; guardarAtq(); return 0; },
    alerta: (v, min) => { if (v != null) AL.on = !!v; if (min >= 200 && min <= 20000) AL.min = min | 0; guardarAL(); return { on: AL.on, min: AL.min, mostradas: AL.mostradas, pico: Math.round(AL.pico) }; },
    alertaTest: () => { AL.jug = [{ nombre: 'Prueba', pk: 3, clan: false, party: false }, { nombre: 'Otro', pk: 0, clan: false, party: false }]; alertaMostrar('3.250 en 0.8 s', AL.jug, 'esto es una PRUEBA'); pitidoAlerta(); return true; },
    pvpAuto: (v, umbral) => { if (v != null) PA.on = !!v; if (umbral >= 500 && umbral <= 20000) PA.umbral = umbral | 0; guardarPA(); return { ...PA }; }, pvpAutoStats: () => ({ ...PA }),
    resumen: () => {
      if (modoAg === 'apagado') return '';
      if (peleando) return '<b style="color:#f96">⚔ Contraataque a #' + peleando.id + ' · ' + Math.round((Date.now() - peleando.desde) / 1000) + ' s · ' + peleando.casts + ' hechizos</b>';
      const a = activos()[0];
      return a ? '<b style="color:#fc6">Agresor #' + a.id + '</b>: ' + a.total + ' ataques (hace ' + Math.round((Date.now() - a.ultima) / 1000) + ' s)' + (modoAg === 'avisar' ? ' · solo aviso' : '') : '';
    },
    texto: () => 'Agresores: ' + ({ apagado: 'APAGADO', avisar: 'solo avisar', contraatacar: 'CONTRAATACAR' }[modoAg]) + ' · mi id ' + (heroId == null ? 'sin aprender' : heroId) + (peleando ? ' · peleando con #' + peleando.id : '') + (activos().length ? ' · agresores recientes: ' + activos().map((a) => '#' + a.id + ' (' + a.total + ')').join(', ') : '') + (peleas.length ? ' · última pelea: ' + peleas[peleas.length - 1].resultado : ''),
    datos: () => ({ modo: modoAg, id_propio: heroId, votos_id: Object.fromEntries(votos), max_id_bicho_visto: maxMons,
      ciego_s: Math.round(sinIdMs / 1000), con_id_s: Math.round(conIdMs / 1000),                               // segundos sin saber / sabiendo mi id: sin id no se puede ver a quien me ataca
      ecos: { hechizos_mios: nMisCasts, votos: Object.fromEntries(ecos) },
      golpes_fuertes: fuertes.map(({ ms, ...r }) => r),                                                         // bajones >= 15 % de vida+escudo de golpe, con los jugadores que había cerca
      ataques_vistos: [...ataques.values()].sort((p, q) => q.total - p.total).slice(0, 10).map((a) => ({ id: a.id, ataques: a.total, con_dano: a.danos, confirmado: !!a.confirmado, tipos: a.tipos })),
      ataques_a_jugadores: hist.slice(-60), pvp: { ...PVP }, pvp_auto: { ...PA }, alerta_ataque: { on: AL.on, minimo: AL.min, mostradas: AL.mostradas, pico_en_3s: Math.round(AL.pico) },
      agresores: [...ataques.values()].filter((a) => a.confirmado).map((a) => ({ id: a.id, ataques: a.total, con_dano: a.danos, tipos: a.tipos, primera_s: Math.round((a.primera - t0) / 1000), ultima_s: Math.round((a.ultima - t0) / 1000) })), peleas: peleas.map((p) => ({ ...p, desde: Math.round((p.desde - t0) / 1000) })), bitacora: bit.slice(-120) }),
  };
})();
