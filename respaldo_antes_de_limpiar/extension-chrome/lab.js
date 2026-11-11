// Laboratorio: explora qué se puede leer y hacer. NADA se ejecuta solo: cada prueba es un botón que apretás vos.
(() => {
  'use strict';
  const M = () => window.Module;
  const seguro = (f, d) => { try { return f(); } catch (e) { return d === undefined ? 'ERR ' + String(e && e.message || e).slice(0, 60) : d; } };
  const call = (n, ...a) => seguro(() => { const f = M()['_MuWeb' + n]; return typeof f === 'function' ? f(...a) : 'no existe'; });
  const str = (n, ...a) => seguro(() => { const f = M()['_MuWeb' + n]; if (typeof f !== 'function') return 'no existe'; const p = f(...a) | 0; return p ? M().UTF8ToString(p) : ''; });
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const pos = () => ({ x: call('GetHeroX'), y: call('GetHeroY'), mapa: call('GetMapIndex') });
  const sal = []; // resultados de pruebas
  const anotar = (t) => { sal.unshift(new Date().toLocaleTimeString('es-AR', { hour12: false }) + ' ' + t); sal.length = Math.min(sal.length, 6); pintar(); };

  function lectura() {
    const o = { lab: '0.1', hora: new Date().toISOString() };
    o.heroe = { nombre: str('GetHeroNameUtf8'), clase: call('GetHeroBaseClass'), ...pos() };
    const n = call('GetMoveListCount') | 0;
    o.warps = { cantidad: n, visible: call('GetMoveListVisible'), lista: [] };
    for (let i = 0; i < Math.min(n, 80); i++) o.warps.lista.push({ i, nombre: str('GetMoveListNameUtf8', i), nivel: call('GetMoveListReqLevel', i), zen: call('GetMoveListReqZen', i), puede: call('GetMoveListCanMove', i), caceria: call('GetMoveListIsCaceria', i) });
    const ns = call('GetSkillListCount') | 0;
    o.hechizos = [];
    for (let i = 0; i < ns; i++) {
      const tipo = call('GetSkillListType', i);
      o.hechizos.push({ i, tipo, nombrePorTipo: str('GetSkillNameUtf8', tipo), nombrePorIndice: str('GetSkillNameUtf8', i), usable: call('CanUseSkillListIndex', i), cooldownMs: call('GetSkillCooldownMs', i), cooldownTotal: call('GetSkillCooldownTotalMs', i), buff: call('HelperIsBuffSkillType', tipo) });
    }
    o.hechizoActual = { tiene: call('HasCurrentSkill'), nombre: str('GetCurrentSkillNameUtf8') };
    o.npcCercano = { clave: call('GetNearbyNpcKey'), nombre: str('GetNearbyNpcNameUtf8') };
    o.blanco = { fijado: call('HasPinnedTarget'), indice: call('GetPinnedTargetIndex'), placa: str('GetTargetPlateUtf8') };
    o.caceria = { activa: call('GetCaceriaActive'), bots: call('GetCaceriaBotCount'), lista: [], marcadores: call('GetCaceriaMarkerCount') };
    for (let i = 0; i < Math.min(o.caceria.bots | 0, 20); i++) o.caceria.lista.push({ id: call('GetCaceriaBotId', i), vida: call('GetCaceriaBotHealthPercent', i) });
    o.party = str('GetPartyMembersUtf8'); o.mascotas = str('GetEquippedPetsUtf8'); o.gremio = str('GetGuildInfoUtf8');
    o.jugadoresComandables = str('GetCommandablePlayersUtf8'); o.masCercano = call('GetNearestCommandablePlayer');
    o.helper = { activo: call('HelperIsActive'), zonaSegura: call('HelperIsSafeZone'), mascaraRecoger: call('HelperGetPickupMask'), nombresRecoger: str('HelperGetPickupNamesUtf8'), nombresActivo: call('HelperGetPickupNamesEnabled') };
    o.entrada = { padV2: call('PadV2IsEnabled'), padEstado: call('PadGetState'), caminoAcumulado: call('GetPadStat', 0) };
    o.mensaje = { visible: call('MsgVisible'), codigo: call('MsgCode'), tipo: call('MsgType'), texto: call('MsgVisible') ? str('MsgTextUtf8') : '' };
    o.tienda = { abierta: call('ShopWindowOpen'), titulo: str('ShopGetTitleUtf8'), personal: call('ShopIsStoreOpen') };
    return o;
  }

  async function copiar(o, nombre) {
    const txt = JSON.stringify(o, null, 1);
    try { await navigator.clipboard.writeText(txt); } catch (e) { /* sin portapapeles */ }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = nombre; a.click();
  }

  // --- pruebas con acción (solo al apretar el botón) --------------------------------------
  // Cada prueba: se niega si el Helper está activo y registra la posición cada 0,5 s para ver la trayectoria real.
  async function traza(ms) { const t = []; for (let i = 0; i <= ms; i += 500) { const p = pos(); t.push(p.x + ',' + p.y); await dormir(500); } return t.join(' > '); }
  function helperActivo() { if (call('HelperIsActive') === 1) { anotar('APAGÁ EL HELPER primero (está activo y se mueve solo)'); return true; } return false; }
  async function probarClic() {
    if (helperActivo()) return;
    const c = document.getElementById('canvas'); if (!c) return anotar('no hay canvas');
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2 + 160, cy = r.top + r.height / 2;
    const ev = (t, b) => c.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, screenX: cx, screenY: cy, button: 0, buttons: b }));
    const pr = traza(3500); ev('mousemove', 0); ev('mousedown', 1); await dormir(80); ev('mouseup', 0);
    anotar('CLIC +160px: ' + await pr);
  }
  async function probarPad() {
    if (helperActivo()) return;
    const pr = traza(2500); const r = call('PadSetVector', 1000, 0, 1);
    await dormir(1500); call('PadSetVector', 0, 0, 0); call('PadRelease');
    anotar('PAD res=' + r + ' padV2=' + call('PadV2IsEnabled') + ': ' + await pr);
  }
  async function probarLite() {
    if (helperActivo()) return;
    const pr = traza(2500); const r = call('SetLiteMoveVector', 1, 0);
    await dormir(1500); call('SetLiteMoveVector', 0, 0);
    anotar('LITE res=' + r + ': ' + await pr);
  }
  // Mide el ritmo real de ataque durante 10 s: con el Helper (solo mide) o manteniendo apretada la tecla de ataque del juego.
  async function medirAtaque(modo, seg = 10) {
    const P = window.__paquetes; if (!P || !P.cuenta) return anotar('paquetes.js no cargó');
    const helper = call('HelperIsActive') === 1;
    if (modo === 'tecla' && helper) return anotar('APAGÁ EL HELPER primero');
    if (modo === 'helper' && !helper) return anotar('Prendé el Helper primero');
    const leer = () => ({ cast: P.cuenta('tx', 'C3:0x19'), paso: P.cuenta('tx', 'C1:0xd4'), muer: P.cuenta('rx', 'C1:0x17'), exp: P.cuenta('rx', 'C3:0x16'), pick: P.cuenta('tx', 'C3:0x22'), res: P.cuenta('rx', 'C3:0x19'), dmg: P.cuenta('rx', 'C1:0x11') });
    const a = leer(); const x0 = pos();
    if (modo === 'tecla') call('SetManualSkillHeld', 1);
    anotar('midiendo ' + seg + ' s (' + modo + ')…');
    await dormir(seg * 1000);
    if (modo === 'tecla') call('SetManualSkillHeld', 0);
    const b = leer(), x1 = pos(), f = (k) => ((b[k] - a[k]) / seg).toFixed(1);
    anotar('ATAQUE ' + modo + ' (' + seg + 's)' + ': hechizos/s ' + f('cast') + ' · pasos/s ' + f('paso') + ' · muertes en vista/s ' + f('muer') + ' · avisos exp/s ' + f('exp') + ' · juntar/s ' + f('pick') + ' · resultados-hechizo/s ' + f('res') + ' · golpes/s ' + f('dmg') + ' · pos (' + x0.x + ',' + x0.y + ')→(' + x1.x + ',' + x1.y + ')');
  }
  async function moverCalibrar() {
    if (!window.__mover) return anotar('mover.js no cargó');
    anotar('calibrando movimiento (~25 s, Helper apagado, quedate en un lugar tranquilo)…');
    const r = await window.__mover.calibrar();
    if (!r.ok) return anotar('calibración: ' + (r.motivo || 'no se movió lo suficiente') + (r.tabla ? ' ' + JSON.stringify(r.tabla.map((t) => [t.d.join(','), t.dx.toFixed(1), t.dy.toFixed(1)])) : ''));
    anotar('calibrado: ' + r.tabla.map((t) => '(' + t.d.join(',') + ')→' + t.dx.toFixed(1) + ',' + t.dy.toFixed(1)).join(' '));
  }
  async function moverIdaVuelta() {
    if (!window.__mover) return anotar('mover.js no cargó');
    const o = window.__mover.pos(); const a = await window.__mover.ir(o.x + 6, o.y + 6, { maxMs: 8000 });
    anotar('ir (+6,+6): ' + a.motivo + ', final (' + (a.final && a.final.x) + ',' + (a.final && a.final.y) + '), falta ' + a.falta + ', ' + a.ms + ' ms');
    const b = await window.__mover.ir(o.x, o.y, { maxMs: 8000 });
    anotar('volver: ' + b.motivo + ', final (' + (b.final && b.final.x) + ',' + (b.final && b.final.y) + '), falta ' + b.falta + ', ' + b.ms + ' ms');
  }
  // Prueba pareja Helper -> tecla -> Helper (30 s cada tramo) contra lo mismo. Pausa al Vigía, corta si la vida baja de 50 %,
  // y siempre deja el Helper prendido como estaba al empezar.
  async function compararABA() {
    const P = window.__paquetes; if (!P || !P.cuenta) return anotar('paquetes.js no cargó');
    if (call('HelperIsActive') !== 1) return anotar('Prendé el Helper y ponelo a atacar a un bicho primero');
    const leer = () => ({ cast: P.cuenta('tx', 'C3:0x19'), paso: P.cuenta('tx', 'C1:0xd4'), muer: P.cuenta('rx', 'C1:0x17'), exp: P.cuenta('rx', 'C3:0x16'), res: P.cuenta('rx', 'C3:0x19'), dmg: P.cuenta('rx', 'C1:0x11') });
    const bloque = async (nombre, seg, tecla) => {
      const a = leer(), t0 = Date.now(); let corte = '';
      if (tecla) call('SetManualSkillHeld', 1);
      try {
        while (Date.now() - t0 < seg * 1000) {
          await dormir(500);
          const v = call('GetPlayerLife'), m = call('GetPlayerLifeMax');
          if (!(v > 0) || v / m < 0.5) { corte = ' (CORTADO: vida baja)'; break; }
        }
      } finally { if (tecla) call('SetManualSkillHeld', 0); }
      const dt = (Date.now() - t0) / 1000, b = leer(), f = (k) => ((b[k] - a[k]) / dt).toFixed(1);
      anotar(nombre + ' (' + dt.toFixed(0) + 's)' + corte + ': hechizos/s ' + f('cast') + ' · resultados/s ' + f('res') + ' · golpes/s ' + f('dmg') + ' · avisos exp/s ' + f('exp') + ' · muertes/s ' + f('muer') + ' · pasos/s ' + f('paso'));
      return corte === '';
    };
    window.__pausaVigia = true;
    try {
      anotar('A-B-A: 1/3 Helper 30 s…');
      if (!(await bloque('A1 Helper', 30, false))) return;
      anotar('A-B-A: 2/3 apago el Helper y mantengo ataque 30 s…');
      call('HelperSetRunning', 0); await dormir(2500);
      if (call('HelperIsActive') === 1) return anotar('No pude apagar el Helper; corto la prueba');
      if (!(await bloque('B Tecla', 30, true))) return;
      anotar('A-B-A: 3/3 vuelvo a prender el Helper…');
      call('HelperSetRunning', 1); await dormir(5000);
      await bloque('A2 Helper', 30, false);
      anotar('A-B-A terminado');
    } finally {
      call('SetManualSkillHeld', 0);
      if (call('HelperIsActive') !== 1) call('HelperSetRunning', 1);   // dejarlo prendido como estaba
      window.__pausaVigia = false;
    }
  }
  // Reposicionar al racimo (una vez por clic): apaga el Helper, camina al punto con más bichos y lo vuelve a prender ahí
  // (el Helper cazá alrededor de donde lo prendés). Solo si la mejora es clara; siempre lo deja prendido como estaba.
  async function reposicionar() {
    const B = window.__bichos, Mv = window.__mover;
    if (!B || !Mv) return anotar('faltan bichos.js o mover.js');
    if (!Mv.tabla()) return anotar('Primero tocá "Mover: calibrar"');
    const c = B.racimo(3, 14);
    if (!c || !c.total) return anotar('no hay bichos a la vista');
    if (c.mejor.n - c.aqui < 3 || c.dist < 3) return anotar('Ya estás bien ubicado: aquí ' + c.aqui + ', mejor ' + c.mejor.n + ' a ' + c.dist + ' casillas (no vale la pena moverse)');
    const v0 = call('GetPlayerLife'), m0 = call('GetPlayerLifeMax');
    if (!(v0 / m0 >= 0.6)) return anotar('Vida baja (' + Math.round(100 * v0 / m0) + '%), no me muevo');
    const estaba = call('HelperIsActive') === 1;
    window.__pausaVigia = true;
    try {
      if (estaba) { call('HelperSetRunning', 0); await dormir(1500); }
      anotar('Reposicionando a (' + c.mejor.x + ',' + c.mejor.y + '): de ' + c.aqui + ' a ' + c.mejor.n + ' bichos…');
      const r = await Mv.ir(c.mejor.x, c.mejor.y, { tol: 1, maxMs: 8000 });
      const f = r.final || {};
      anotar('Reposición: ' + r.motivo + ', quedó en (' + f.x + ',' + f.y + '), faltaban ' + r.falta + ', ' + r.ms + ' ms');
    } finally {
      if (estaba) call('HelperSetRunning', 1);
      window.__pausaVigia = false;
    }
  }
  // Barrido de mouse: SOLO movimientos del mouse (sin clics) sobre una grilla alrededor del centro de la pantalla.
  // En cada punto lee si el juego marca algo como seleccionado. Sirve para saber si el hover sintético funciona y dónde caen los bichos.
  let barriendo = false;
  async function barrerHover() {
    if (barriendo) return anotar('Ya hay un barrido en curso, esperá la línea "Barrido: …"');
    const c = document.getElementById('canvas'); if (!c) return anotar('no hay canvas');
    barriendo = true;
    try {
    const r = c.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const leer = () => ({ fij: call('HasPinnedTarget'), idx: call('GetPinnedTargetIndex'), placa: str('GetTargetPlateUtf8'), cmd: call('GetCommandTargetPlayer'), tap: call('TapDebug') });
    const mover = (x, y) => {
      const o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: 0 };
      c.dispatchEvent(new MouseEvent('mousemove', o));
      try { c.dispatchEvent(new PointerEvent('pointermove', { ...o, pointerId: 1, pointerType: 'mouse', isPrimary: true })); } catch (e) { /* sin PointerEvent */ }
    };
    mover(r.left + 5, r.top + 5); await dormir(120);
    const base = JSON.stringify(leer()); const hits = []; let puntos = 0;
    anotar('barriendo la pantalla con el mouse (~20 s, no toques nada)…');
    for (let dy = -300; dy <= 300; dy += 40) {
      for (let dx = -440; dx <= 440; dx += 40) {
        const x = cx + dx, y = cy + dy; mover(x, y); puntos++; await dormir(45);
        const v = leer();
        if (JSON.stringify(v) !== base && hits.length < 40) hits.push({ dx, dy, v });
      }
    }
    mover(r.left + 5, r.top + 5);
    anotar('Barrido: ' + puntos + ' puntos, ' + hits.length + ' con cambio. Base=' + base);
    hits.slice(0, 6).forEach((h) => anotar('  (' + h.dx + ',' + h.dy + ') → ' + JSON.stringify(h.v)));
    window.__hoverHits = hits;
    } finally { barriendo = false; }
  }
  // Monitor de selección: NO genera ningún evento. Mientras vos pasás el mouse por un bicho y hacés clic, anota cada vez que
  // cambia alguna de las señales del juego (blanco fijado, índice, placa, TapDebug, NPC cercano). 20 s.
  async function monitorSeleccion() {
    const leer = () => ({ fij: call('HasPinnedTarget'), idx: call('GetPinnedTargetIndex'), placa: str('GetTargetPlateUtf8'), cmd: call('GetCommandTargetPlayer'), tap: call('TapDebug'), npc: call('GetNearbyNpcKey'), pk: call('HasNearbyManualPickup') });
    let prev = JSON.stringify(leer()); const cambios = []; const t0 = Date.now();
    anotar('MONITOR 20 s: pasá el mouse por un bicho, después hacé clic en él, después clic en el piso, y volvé a pasar por otro…');
    while (Date.now() - t0 < 20000) {
      await dormir(100);
      const v = JSON.stringify(leer());
      if (v !== prev) { cambios.push(((Date.now() - t0) / 1000).toFixed(1) + 's ' + v); prev = v; }
    }
    anotar('Monitor: ' + cambios.length + ' cambios');
    cambios.slice(0, 8).forEach((x) => anotar('  ' + x));
    window.__monitorCambios = cambios;
  }
  // Clic con eventos POINTER (el cliente usa SDL3, que escucha PointerEvents). Mide pasos enviados y trayectoria.
  const ptr = (c, tipo, x, y, buttons) => c.dispatchEvent(new PointerEvent(tipo, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: buttons ? 0.5 : 0, button: tipo === 'pointermove' ? -1 : 0, buttons }));
  async function probarClicPointer(dx = 160, dy = 0) {
    if (helperActivo()) return;
    const c = document.getElementById('canvas'); if (!c) return anotar('no hay canvas');
    const P = window.__paquetes, r = c.getBoundingClientRect();
    const x = r.left + r.width / 2 + dx, y = r.top + r.height / 2 + dy;
    const d0 = P ? P.cuenta('tx', 'C1:0xd4') : 0, c0 = P ? P.cuenta('tx', 'C3:0x19') : 0;
    const pr = traza(3500);
    ptr(c, 'pointermove', x, y, 0); await dormir(60); ptr(c, 'pointerdown', x, y, 1); await dormir(90); ptr(c, 'pointerup', x, y, 0);
    const t = await pr;
    anotar('CLIC-POINTER (' + dx + ',' + dy + 'px): ' + t + ' · pasos enviados ' + (P ? P.cuenta('tx', 'C1:0xd4') - d0 : '?') + ' · hechizos enviados ' + (P ? P.cuenta('tx', 'C3:0x19') - c0 : '?'));
  }
  let pantallaOcupada = false;
  async function pantallaCalibrar() {
    if (!window.__pantalla) return anotar('pantalla.js no cargó');
    if (pantallaOcupada) return anotar('Ya hay una prueba de pantalla en curso, esperá a que termine');
    pantallaOcupada = true; try {
    anotar('Calibrando pantalla: 4 clics de caminar cortos, dos veces (~45 s). Parate en piso LIBRE, sin bichos, Helper apagado…');
    const r = await window.__pantalla.calibrar();
    if (!r.ok) return anotar('Calibración falló: ' + r.motivo);
    if (r.conservada) anotar('Conservo la calibración anterior (error ' + r.cal.err.toFixed(2) + ' ≤ ' + r.nueva.err.toFixed(2) + ' de esta). Si querés reemplazarla igual, avisame.');
    else anotar('Pantalla calibrada con ' + r.cal.n + ' de ' + r.cal.de + ' clics: error medio ' + r.cal.err.toFixed(2) + ' casillas · personaje desplazado del centro (' + r.cal.h.map((n) => n.toFixed(0)).join(',') + ') px');
    anotar('Clics (píxel → casillas que caminó): ' + r.pts.map((p) => '(' + p.o.join(',') + ')→(' + p.d.join(',') + ')').join(' '));
    } finally { pantallaOcupada = false; }
  }
  async function atacarMasCercano() {
    const B = window.__bichos, S = window.__pantalla; if (!B || !S) return anotar('faltan bichos.js o pantalla.js');
    if (!S.cal()) return anotar('Primero tocá "Pantalla: calibrar"');
    if (helperActivo()) return;
    if (pantallaOcupada) return anotar('Ya hay una prueba de pantalla en curso');
    if (call('GetPlayerLife') / call('GetPlayerLifeMax') < 0.6) return anotar('Vida por debajo de 60 %: no pruebo (los clics en el piso te hacen caminar entre los bichos)');
    pantallaOcupada = true; try {
    const o = pos(); let m = null, dm = 99;
    for (const v of B.vista()) { const d = Math.max(Math.abs(v.x - o.x), Math.abs(v.y - o.y)); if (d < dm && S.enPantalla(S.pixelDe(v.x, v.y))) { dm = d; m = v; } }
    if (!m || dm > 8) return anotar('No hay bichos visibles en pantalla a 8 casillas o menos' + (m ? ' (el más cerca visible: ' + dm + ')' : ''));
    const px = S.pixelDe(m.x, m.y);
    anotar('Atacando al bicho a ' + dm + ' casillas, píxel (' + Math.round(px.x) + ',' + Math.round(px.y) + ')…');
    const r = await S.atacar(m, 3000);
    anotar('ATAQUE POR CLIC: ' + (r.ok ? 'ACERTÓ en ' + r.intentos + ' intento(s) · corrección ' + r.sesgo.join(',') + ' px · hechizos ' + r.hechizos + ' · pasos ' + r.pasos : 'falló: ' + r.motivo + ' · hechizos ' + r.hechizos + ' · pasos ' + r.pasos));
    } finally { pantallaOcupada = false; }
  }
  async function probarCamino() { // solo lectura continua 5 s del "camino" por si el juego expone el destino
    const l = []; for (let i = 0; i < 5; i++) { l.push(JSON.stringify(pos())); await dormir(1000); }
    anotar('posición 5 s: ' + l.join(' '));
  }

  // --- panel ------------------------------------------------------------------------------
  let caja = null;
  function pintar() {
    if (!caja) return;
    const l = caja.querySelector('#lab-out'); if (l) l.innerHTML = sal.join('<br>');
  }
  function armar() {
    if (document.getElementById('lab-panel')) return;
    caja = document.createElement('div'); caja.id = 'lab-panel';
    caja.style.cssText = 'position:fixed;left:8px;bottom:150px;z-index:2147483647;font:11px sans-serif;background:#103a;color:#fff;padding:5px 8px;border-radius:6px;max-width:340px';
    caja.innerHTML = '<b>Laboratorio</b> <button data-a="min">_</button><div id="lab-cuerpo">' +
      '<button data-a="inf">Informe (lectura)</button> <button data-a="pos">Mirar posición 5s</button><br>' +
      'Pruebas con acción (apagá el Helper antes):<br>' +
      '<button data-a="movc">Mover: calibrar</button> <button data-a="movi">Mover: ir 6 y volver</button> <button data-a="repo">Reposicionar al racimo</button><br>' +
      '<button data-a="atqh">Medir ataque: Helper (10s)</button> <button data-a="atqt">Medir ataque: tecla (10s)</button> <button data-a="atqh30">Medir ataque: Helper (30s)</button><br>' +
      '<button data-a="aba">Comparar Helper-tecla-Helper (90s)</button><br>' +
      '<b>CAJA NEGRA:</b> <button data-a="cbaj">Bajar todo (para que lo lea Claude)</button> <button data-a="cmar">MARCAR: ahora está mal</button><br>' +
      '<b>Piloto propio:</b> <button data-a="pon">ON</button> <button data-a="poff">OFF</button> <button data-a="mh">Medir Helper 5 min</button> <button data-a="mp">Medir Piloto 5 min</button><br>' +
      '<b>Blanco:</b> <button data-a="pcal">Pantalla: calibrar (8 clics)</button> <button data-a="patq">Atacar al más cercano: clic DERECHO (3s)</button><br>' +
      '<button data-a="bahora">Bichos: ver ahora</button> <button data-a="mon">Monitor de selección (20s)</button> <button data-a="bar">Barrer con el mouse (20s)</button> <button data-a="bl1">Fijar</button> <button data-a="bl2">Leer</button> <button data-a="bl3">Soltar</button><br>' +
      '<button data-a="paq">Paquetes: bajar resumen</button> <button data-a="bic">Bichos: ranking</button> <button data-a="bicx">Bichos: bajar datos</button><br>' +
      '<button data-a="spots">Spots: ranking del mapa</button> <button data-a="spotsx">Spots: bajar datos</button><br>' +
      '<button data-a="joy">Joyas: ver estado</button> <button data-a="joyd">Joyas: depositar todo</button><br>' +
      '<button data-a="clic">Clic caminar +160px</button> <button data-a="clicp">Clic caminar (pointer) +160px</button> <button data-a="clicp2">Clic pointer −160px</button> <button data-a="pad">Pad →</button> <button data-a="lite">Lite →</button>' +
      '<div id="lab-out" style="margin-top:4px;opacity:.9"></div></div>';
    (document.body || document.documentElement).appendChild(caja);
    caja.onclick = async (e) => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'min') { const c = caja.querySelector('#lab-cuerpo'); c.hidden = !c.hidden; }
      if (a === 'inf') { await copiar(lectura(), 'informe_lab.json'); anotar('informe copiado y bajado'); }
      if (a === 'pos') probarCamino();
      if (a === 'joy' || a === 'joyd') {
        if (!window.__joyas) return anotar('joyas.js no cargó');
        const ok = window.__joyas.mandar(a === 'joy' ? 's' : 'a');
        anotar(ok ? 'comando enviado…' : 'no se pudo enviar (¿ocupado?)');
        setTimeout(() => anotar(window.__joyas.resumen()), 2500);
        if (a === 'joyd') setTimeout(() => { window.__joyas.mandar('s'); setTimeout(() => anotar(window.__joyas.resumen()), 2500); }, 3000);
        if (a === 'joy') setTimeout(() => anotar(JSON.stringify(window.__joyas.estado())), 3000);
      }
      if (a === 'paq' && window.__paquetes) { await copiar(window.__paquetes.informe(), 'informe_paquetes.json'); anotar('resumen de paquetes bajado'); }
      if (a === 'movc') moverCalibrar();
      if (a === 'movi') moverIdaVuelta();
      if (a === 'repo') reposicionar();
      if (a === 'atqh') medirAtaque('helper');
      if (a === 'atqt') medirAtaque('tecla');
      if (a === 'atqh30') medirAtaque('helper', 30);
      if (a === 'aba') compararABA();
      if (a === 'pcal') pantallaCalibrar();
      if (a === 'patq') atacarMasCercano();
      if (a === 'bahora') { const x = window.__bichos && window.__bichos.ahora(); if (!x) return anotar('bichos.js no cargó'); anotar('BICHOS AHORA · héroe (' + x.heroe + ') mapa ' + x.mapa + ' · ' + JSON.stringify(x.validacion)); x.cercanos.forEach((c) => anotar('  tipo ' + c.tipo + ' en (' + c.x + ',' + c.y + ') a ' + c.d + ' casillas · aviso hace ' + c.hace_s + ' s')); }
      if (a === 'mon') monitorSeleccion();
      if (a === 'bar') barrerHover();
      if (a === 'bl1') { const r = call('PinSelectedTarget'); anotar('Fijar blanco → ' + r + ' · fijado=' + call('HasPinnedTarget') + ' índice=' + call('GetPinnedTargetIndex') + ' placa=' + JSON.stringify(str('GetTargetPlateUtf8'))); }
      if (a === 'bl2') anotar('Blanco: fijado=' + call('HasPinnedTarget') + ' índice=' + call('GetPinnedTargetIndex') + ' placa=' + JSON.stringify(str('GetTargetPlateUtf8')));
      if (a === 'bl3') { call('ClearPinnedTarget'); anotar('Blanco soltado · fijado=' + call('HasPinnedTarget')); }
      if (a === 'cbaj') { if (!window.__caja) return anotar('caja.js no cargó'); const r = window.__caja.bajar(); anotar('Caja negra bajada: ' + r.muestras + ' muestras, ' + r.bitacora + ' decisiones, ' + r.kb + ' KB (caja_negra.json)'); }
      if (a === 'cmar') { if (window.__caja) window.__caja.marcar('MARCA: el usuario dice que ahora está mal'); anotar('Marca guardada a las ' + new Date().toLocaleTimeString('es-AR', { hour12: false })); }
      if (a === 'pon') { if (!window.__piloto) return anotar('piloto.js no cargó'); const r = window.__piloto.arrancar(); anotar(r.ok ? 'Piloto ON (Helper apagado). Para cortar: OFF' : 'Piloto no arrancó: ' + r.motivo); }
      if (a === 'poff') { if (window.__piloto) window.__piloto.detener('manual'); anotar('Piloto OFF'); }
      if (a === 'mh' || a === 'mp') {
        if (!window.__piloto) return anotar('piloto.js no cargó');
        anotar('Midiendo 5 min (' + (a === 'mh' ? 'Helper' : 'Piloto') + '). No toques nada…');
        anotar(await window.__piloto.medir(a === 'mh' ? 'helper' : 'piloto', 5, anotar));
      }
      if (a === 'bic') anotar(window.__bichos ? window.__bichos.texto() : 'bichos.js no cargó');
      if (a === 'bicx' && window.__bichos) { await copiar({ hora: new Date().toISOString(), validacion: window.__bichos.validacion(), zonas: window.__bichos.datos() }, 'datos_bichos.json'); anotar('datos de bichos bajados'); }
      if (a === 'spots') anotar(window.__spots ? window.__spots.texto() : 'spots.js no cargó');
      if (a === 'spotsx' && window.__spots) { await copiar({ hora: new Date().toISOString(), celdas: window.__spots.datos() }, 'datos_spots.json'); anotar('datos de spots bajados'); }
      if (a === 'clic') probarClic();
      if (a === 'clicp') probarClicPointer(160, 0);
      if (a === 'clicp2') probarClicPointer(-160, 0);
      if (a === 'pad') probarPad();
      if (a === 'lite') probarLite();
    };
  }
  window.__lab = { lectura, probarClic, probarPad, probarLite };
  const ini = () => setTimeout(armar, 2000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ini); else ini();
})();
