// Laboratorio (versión limpia): solo lo que seguimos usando. NADA se ejecuta solo: cada acción es un botón que apretás vos.
(() => {
  'use strict';
  // Recarga en caliente: los intervalos se registran para poder cortarlos al reinyectar el módulo sin recargar la página (ver background.js)
  const setInterval = (f, ms) => { const id = window.setInterval(f, ms); (window.__muIds = window.__muIds || []).push(id); return id; };
  const M = () => window.Module;
  const seguro = (f, d) => { try { return f(); } catch (e) { return d === undefined ? 'ERR ' + String(e && e.message || e).slice(0, 60) : d; } };
  const call = (n, ...a) => seguro(() => { const f = M()['_MuWeb' + n]; return typeof f === 'function' ? f(...a) : 'no existe'; });
  const str = (n, ...a) => seguro(() => { const f = M()['_MuWeb' + n]; if (typeof f !== 'function') return 'no existe'; const p = f(...a) | 0; return p ? M().UTF8ToString(p) : ''; });
  const pos = () => ({ x: call('GetHeroX'), y: call('GetHeroY'), mapa: call('GetMapIndex') });
  // Los paneles (Vigía y Lab) tapaban el chat del juego abajo a la izquierda: se suben SUBE píxeles y se puede ajustar con las flechas del encabezado.
  let SUBE = 170; try { const g = JSON.parse(localStorage.getItem('muPanelV1') || 'null'); if (g && Number.isFinite(g.sube)) SUBE = Math.max(0, Math.min(900, g.sube)); } catch (e) { /* nada */ }
  const moverPaneles = (d) => { SUBE = Math.max(0, Math.min(Math.max(0, window.innerHeight - 220), SUBE + d)); try { localStorage.setItem('muPanelV1', JSON.stringify({ sube: SUBE })); } catch (e) { /* nada */ } return SUBE; };
  const sal = [];   // últimos resultados que se muestran en el panel
  const anotar = (t) => { sal.unshift(new Date().toLocaleTimeString('es-AR', { hour12: false }) + ' ' + t); sal.length = Math.min(sal.length, 3); pintar(); };

  // ---- informe de lectura (baja informe_lab.json) ----
  function lectura() {
    const o = { lab: '0.2', hora: new Date().toISOString() };
    o.heroe = { nombre: str('GetHeroNameUtf8'), clase: call('GetHeroBaseClass'), ...pos() };
    const n = call('GetMoveListCount') | 0;
    o.warps = { cantidad: n, visible: call('GetMoveListVisible'), lista: [] };
    for (let i = 0; i < Math.min(n, 80); i++) o.warps.lista.push({ i, nombre: str('GetMoveListNameUtf8', i), nivel: call('GetMoveListReqLevel', i), zen: call('GetMoveListReqZen', i), puede: call('GetMoveListCanMove', i) });
    const ns = call('GetSkillListCount') | 0;
    o.hechizos = [];
    for (let i = 0; i < ns; i++) { const tipo = call('GetSkillListType', i); o.hechizos.push({ i, tipo, nombre: str('GetSkillNameUtf8', tipo), usable: call('CanUseSkillListIndex', i), buff: call('HelperIsBuffSkillType', tipo) }); }
    o.hechizoActual = { tiene: call('HasCurrentSkill'), nombre: str('GetCurrentSkillNameUtf8') };
    o.helper = { activo: call('HelperIsActive'), zonaSegura: call('HelperIsSafeZone'), mascaraRecoger: call('HelperGetPickupMask'), nombresRecoger: str('HelperGetPickupNamesUtf8'), nombresActivo: call('HelperGetPickupNamesEnabled') };
    o.mascotas = str('GetEquippedPetsUtf8'); o.party = str('GetPartyMembersUtf8');
    return o;
  }
  async function bajarJson(o, nombre) {
    const txt = JSON.stringify(o, null, 1);
    try { await navigator.clipboard.writeText(txt); } catch (e) { /* sin portapapeles */ }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = nombre; a.click();
  }

  // ---- calibraciones (se guardan en el navegador) ----
  async function moverCalibrar() {
    if (!window.__mover) return anotar('mover.js no cargó');
    anotar('Calibrando movimiento (~25 s, Helper apagado, quedate en un lugar tranquilo y sin bichos)…');
    const r = await window.__mover.calibrar();
    if (!r.ok) return anotar('Calibración de movimiento: ' + (r.motivo || 'no se movió lo suficiente'));
    anotar('Movimiento calibrado: ' + r.tabla.map((t) => '(' + t.d.join(',') + ')→' + t.dx.toFixed(1) + ',' + t.dy.toFixed(1)).join(' '));
  }
  let pantallaOcupada = false;
  async function pantallaCalibrar() {
    if (!window.__pantalla) return anotar('pantalla.js no cargó');
    if (pantallaOcupada) return anotar('Ya hay una calibración de pantalla en curso, esperá a que termine');
    pantallaOcupada = true;
    try {
      anotar('Calibrando pantalla: 8 clics cortos (~45 s). Parate en piso LIBRE, sin bichos (mejor en un pueblo), Helper apagado…');
      const r = await window.__pantalla.calibrar();
      if (!r.ok) return anotar('Calibración falló: ' + r.motivo);
      if (r.conservada) anotar('Conservo la calibración anterior (error ' + r.cal.err.toFixed(2) + ' ≤ ' + r.nueva.err.toFixed(2) + ' de esta).');
      else anotar('Pantalla calibrada con ' + r.cal.n + ' de ' + r.cal.de + ' clics: error medio ' + r.cal.err.toFixed(2) + ' casillas · personaje a (' + r.cal.h.map((n) => n.toFixed(0)).join(',') + ') px del centro');
    } finally { pantallaOcupada = false; }
  }

  // ---- spots de las etapas del ciclo de reset (se guardan en el navegador; el ciclo todavía NO está armado) ----
  const KEY_ETAPAS = 'muEtapasV1', NOMBRES_ETAPAS = { arana: 'Arañas (Lorencia)', devias3: 'Devias 3', lt7: 'Lost Tower 7', aida: 'Aida (spot de farmeo)' };
  const leerEtapas = () => { try { return JSON.parse(localStorage.getItem(KEY_ETAPAS) || '{}'); } catch (e) { return {}; } };
  function guardarEtapa(clave) {
    const o = leerEtapas(); o[clave] = { mapa: call('GetMapIndex'), x: call('GetHeroX'), y: call('GetHeroY'), nivel: call('GetPlayerLevel'), hora: new Date().toISOString() };
    try { localStorage.setItem(KEY_ETAPAS, JSON.stringify(o)); } catch (e) { /* nada */ }
    return o[clave];
  }
  window.__etapas = { todo: leerEtapas, guardar: guardarEtapa };
  const textoEtapas = () => Object.entries(NOMBRES_ETAPAS).map(([k, n]) => { const e = leerEtapas()[k]; return n + ': ' + (e ? 'mapa ' + e.mapa + ' (' + e.x + ',' + e.y + ') nivel ' + e.nivel : 'sin guardar'); }).join(' · ');

  // ---- panel ----
  let caja = null;
  setInterval(() => {
    if (!caja) return;
    try {
      const lv = call('GetPlayerLevel'), pm = call('GetExperiencePermille');
      const n = caja.querySelector('#lab-nivel'), br = caja.querySelector('#lab-barra');
      if (n && typeof lv === 'number' && typeof pm === 'number') {
        const nph = window.__modo && window.__modo.nivelesPorHora ? window.__modo.nivelesPorHora() : null;
        const spn = window.__modo && window.__modo.segPorNivel ? window.__modo.segPorNivel() : null, mpm = window.__modo && window.__modo.muertesPorMin ? window.__modo.muertesPorMin() : null;
        const ml = lv >= 400 ? (window.__modo && window.__modo.nivelMaster ? window.__modo.nivelMaster() : call('GetMasterLevel')) : null;
        n.textContent = 'Nv ' + lv + (ml ? ' · M' + ml : '') + (pm < 999 ? ' · ' + (pm / 10).toFixed(1) + ' %' : '') + (nph != null && nph > 0 ? ' · ' + nph + (ml ? ' master/h' : ' niv/h') + (spn ? ' (' + spn + ' s)' : '') : '') + (mpm != null ? ' · ' + mpm + ' mat/min' : '');
        if (br) br.style.width = Math.max(0, Math.min(100, pm / 10)) + '%';
      }
      // se acomoda encima del panel del Vigía (abajo a la izquierda) para que nunca se tapen entre sí
      // (ojo: un elemento position:fixed tiene offsetParent null en Chrome, por eso se mide el rectángulo)
      const v = document.getElementById('vigia-panel'); if (v) v.style.bottom = (60 + SUBE) + 'px';
      const r = v ? v.getBoundingClientRect() : null, top = r && r.height > 0 ? r.top : window.innerHeight - 60 - SUBE;
      caja.style.bottom = Math.max(8, Math.round(window.innerHeight - top + 8)) + 'px';
      caja.style.maxHeight = Math.max(120, Math.round(top - 14)) + 'px';
    } catch (e) { /* nada */ }
  }, 500);
  setInterval(() => { const e = caja && caja.querySelector('#lab-modo'); if (e && window.__modo) e.innerHTML = window.__modo.resumen(); }, 1000);
  function pintar() {
    const l = caja && caja.querySelector('#lab-out'); if (!l) return;
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    l.innerHTML = sal.map((x, i) => { const h = x.slice(0, 8), t = x.slice(9); return '<div style="padding:1px 0;' + (i ? 'opacity:.78' : 'font-weight:600') + '"><span style="color:#6fe0ff">' + esc(h) + '</span> <span style="color:' + (/no |falt|error|fall|cancel/i.test(t) ? '#ff9a8a' : '#f2fff2') + '">' + esc(t) + '</span></div>'; }).join('');
  }
  function armar() {
    (window.__muLimpiar = window.__muLimpiar || []).push(() => { const p = document.getElementById('lab-panel'); if (p) p.remove(); });
    if (document.getElementById('lab-panel')) return;
    caja = document.createElement('div'); caja.id = 'lab-panel';
    caja.style.cssText = 'position:fixed;right:8px;bottom:150px;z-index:2147483647;font:11px sans-serif;background:#0b1d3af2;color:#fff;padding:5px 8px;border-radius:6px;width:310px;max-width:92vw;overflow-y:auto';
    caja.innerHTML = `<style>#lab-panel button{font:11px sans-serif;padding:1px 6px;margin:1px 1px 1px 0}#lab-panel details{margin-top:2px}#lab-panel summary{cursor:pointer;opacity:.85}#lab-panel .f{margin:2px 0}#lab-panel b{opacity:.9}</style>
      <div style="display:flex;align-items:center;gap:6px"><b>Lab</b><small style="opacity:.65">${window.__muVersionHot ? 'v' + window.__muVersionHot : ''}</small><span id="lab-nivel" style="margin-left:auto;font-weight:600"></span><button data-a="pup" title="Subir los paneles (para no tapar el chat del juego)">▲</button><button data-a="pdn" title="Bajar los paneles">▼</button><button data-a="min">_</button></div>
      <div style="height:4px;background:#1c2f55;border-radius:2px;margin:2px 0 4px"><div id="lab-barra" style="height:4px;width:0;background:#6fe0ff;border-radius:2px"></div></div>
      <div id="lab-cuerpo">
      <div id="lab-out" style="margin:0 0 4px;padding:4px 6px;background:#000d;border:1px solid #6fe0ff55;border-radius:4px;font-size:12px;line-height:1.3;max-height:70px;overflow:auto"></div>
      <div class="f"><button data-a="cbaj" title="Baja la caja negra (todo lo registrado)" style="font-weight:600">⬇ Bajar caja</button><button data-a="cmar">Marcar: está mal</button></div>
      <div class="f"><button data-a="ir1" title="Va a Aida, camina al spot, se ancla y prende Sostenida">Ir a Aida</button> <button data-a="poff">Helper</button><button data-a="ms1">Sostenida</button><button data-a="pno">Nada</button></div>
      <div class="f"><b>Ciclo</b> <button data-a="cr2" title="Reset automático sin tope">Auto</button><button data-a="cr1">Paso a paso</button><button data-a="co">OFF</button></div>
      <div id="lab-modo" style="font-size:11px;opacity:.9;margin:2px 0 3px"></div>
      <details><summary>Ciclo (más)</summary>
        <div class="f"><button data-a="cs1">Simular</button><button data-a="cs2">Simular auto</button><button data-a="cc">Confirmar paso</button><button data-a="ct">Tope +1</button></div>
        <div class="f"><b>Tras el reset, si ya estás en el 210</b> <button data-a="cq1" title="No viaja a Lorencia/Devias/Aida: reparte los puntos y farmea ahí mismo">Quedarse</button><button data-a="cq0" title="Viaja por las etapas como antes">Viajar como antes</button></div>
      </details>
      <details><summary>Puntos</summary>
        <div class="f"><button data-a="as1">Auto ON</button><button data-a="as0">OFF</button><button data-a="asp">Proporción</button><button data-a="asr">Recomendada</button><button data-a="asv">Ver</button><button data-a="asm">Mover puntos…</button></div>
        <div class="f"><b>Comando en cada reset</b> <button data-a="cm0" title="No pone puntos en Comando">0</button><button data-a="cm1" title="Pone 100 puntos en Comando">100</button><button data-a="cm5" title="Después de cada reset, antes de repartir lo demás, manda 500 puntos a /cmd (Comando 25 → 525). Fire Scream pide 70; otras habilidades de Dark Lord piden más">500</button><button data-a="cm9">1000</button><button data-a="cmv">Ver</button></div>
      </details>
      <details><summary>Joyas y party</summary>
        <div class="f"><b>Joyas</b> <button data-a="joy">Ver</button><button data-a="joyd">Depositar</button><button data-a="joyr">Retirar…</button></div>
        <div class="f"><b>Party</b> <button data-a="jug">Ver cerca</button><button data-a="grv">Ver grupo</button><button data-a="grp">Invitar a los de cerca</button></div>
        <div class="f"><b>Buff de crítico</b> <button data-a="bf1" title="Mantiene puesto el buff de crítico: lo lanza sobre vos (clic derecho, ~0,4 s) cuando se va, al entrar al juego y después de morir, y vuelve a la Sostenida">ON</button><button data-a="bf0">OFF</button><button data-a="bfp" title="Lo lanza ahora">Lanzar ya</button><button data-a="bfi" title="Si no encuentra la habilidad sola, elegila de tu lista">Elegir habilidad</button><button data-a="bfv">Ver</button></div>
        <div class="f"><b>Summon por chat</b> <button data-a="sc1" title="Lee el chat: si alguien (de tu grupo) escribe summon / summonear / jala / jalar, frena la Sostenida, tira Summon (habilidad 63) y sigue con la Sostenida. Enfriamiento del juego: 30 s">ON</button><button data-a="sc0">OFF</button><button data-a="scy" title="Hace caso al chat de PARTY (~) y también a cualquier chat (clan, público) si quien escribe está en TU party. Por defecto: el clan puede tener más de una party">Solo gente de mi party</button><button data-a="scg" title="Hace caso al chat de PARTY (~) y al de CLAN (@)">Party + clan</button><button data-a="scm" title="Hace caso en cualquier chat si quien escribe es de tu party o de tu clan">Miembros (cualquier chat)</button><button data-a="sca" title="Hace caso a cualquiera en cualquier chat (más riesgoso)">Cualquiera</button><button data-a="scp" title="Tira Summon ahora, como si lo hubieran pedido por chat">Probar Summon</button><button data-a="scv">Ver</button></div>
      </details>
      <details><summary>Opciones</summary>
        <div class="f"><b>Al morir volver al spot</b> <button data-a="rg1">ON</button><button data-a="rg0">OFF</button><button data-a="rgp">Probar</button></div>
        <div class="f"><b>Ancla</b> <button data-a="an1">Guardar aquí</button><button data-a="an0">Borrar</button><button data-a="anon">Auto ON</button><button data-a="anoff">Auto OFF</button></div>
        <div class="f"><b>Ancla al prender</b> <button data-a="anq1" title="Al prender Sostenida (botón o F8) el ancla es donde estás parado: no camina a ningún lado">Donde lo prendo</button><button data-a="anq0" title="Al prender Sostenida con el botón va al ancla guardada o a la zona con más respawns">Mejor spot</button></div>
        <div class="f"><b>Buscar bichos</b> <button data-a="rp1">ON</button><button data-a="rp0">OFF</button> <b>Ritmo seguro</b> <button data-a="rs1">ON</button><button data-a="rs0">OFF</button></div>
        <div class="f"><b>Si un jugador me ataca</b> <button data-a="ag1" title="Lo ataca con clic derecho mantenido hasta que muera, se vaya o te quede poca vida, y vuelve al spot">Contraatacar</button><button data-a="ag2" title="Solo avisa en el Vigía y por Discord">Solo avisar</button><button data-a="ag0">Apagar</button><button data-a="agv">Ver</button></div>
        <div class="f"><b>PVP automático (F10 a mano)</b> <button data-a="pa1" title="Cuando vida+escudo bajan el umbral dentro de 1 s y hay un jugador a la vista, activa solo el modo PVP (clic derecho + pulsos de 10 ms, modo PK) contra el agresor o el jugador más cercano. Se apaga solo cuando no queda nadie a la vista 6 s">ON</button><button data-a="pa0">OFF</button><button data-a="pu1">Umbral 1500</button><button data-a="pu2">2500</button><button data-a="pu3">4000</button><button data-a="pav">Ver</button></div>
        <div class="f"><b>Cartel rojo de ataque</b> <button data-a="al1" title="Cuando te sacan vida/SD (>= el mínimo en 3 s) muestra un cartel rojo arriba en el medio con cuánto te sacan y los jugadores que había cerca (los PK primero), y suena un pitido. El servidor no dice quién pega: los nombres son sospechosos">ON</button><button data-a="al0">OFF</button><button data-a="alt">Probar</button><button data-a="alm1">Mínimo 500</button><button data-a="alm2">1000</button><button data-a="alm3">2500</button>
        <b>Pociones rápidas</b> <button data-a="pr1" title="Cuando te atacan y baja el SD usa la poción de SD (R) cada pocos ms (y la de vida si falta) en vez de cada 0,6 s">ON</button><button data-a="pr0">OFF</button><button data-a="pm1">60 ms</button><button data-a="pm2">90 ms</button><button data-a="pm3">150 ms</button><button data-a="prv">Ver</button></div>
        <div class="f"><b>Volver al ancla si me alejo más de</b> <button data-a="lz1">1</button><button data-a="lz3">3</button><button data-a="lz8">8 (normal)</button></div>
        <div class="f"><b>Teclas</b> F6 joyas 10/10/10 · F7 party cercanos · F8 Sostenida · F9 caja · F10 PVP al azar <button data-a="tk1">ON</button><button data-a="tk0">OFF</button> <b>F6</b> <button data-a="f6s" title="10 Bless, 10 Soul y 10 Chaos sueltas">sueltas</button><button data-a="f6p" title="1 pack de 10 de Bless, 1 pack de 10 de Soul y 10 Chaos sueltas (para alas Evo 3)">packs</button></div>
        <div class="f"><b>Telemetría</b> <button data-a="tel" title="Resumen: qué % de hechizos recibe respuesta del servidor según lo pegados que salen, latencia y mínimo entre aceptados">Ver</button><button data-a="telp" title="Alterna el pulso 100 / 62 / 100 / 62 ms, 60 s cada uno (4 min), parado y atacando en el mismo lugar">Test de ritmos</button><button data-a="telb" title="Alterna el pulso 62 / 50 / 40 / 62 ms, 60 s cada uno (4 min): ver si bajar de 62 ms mata más rápido o el servidor empieza a descartar">Test bajo</button><button data-a="telc" title="Alterna el pulso 62 / 40 / 30 / 40 ms, 60 s cada uno (4 min): confirma si 40 ms es mejor que 62 y si 30 ms agrega algo">Test 40/30</button><button data-a="telr" title="Pulso 40 ms durante 120 s, después 30 ms durante 120 s y después 62 ms durante 120 s (6 min). Quedate atacando en el mismo lugar">Test 120 s</button><button data-a="telx" title="Pulso 40, 30, 20 y 10 ms, 60 s cada uno (4 min). Por debajo de ~25 ms el navegador ya no llega a pulsar tan seguido: mirá los hechizos por segundo reales de cada fase">Test 40-10</button><button data-a="tel0">Reiniciar</button><button data-a="vt" title="Abrí el inventario o los stats, apretá este botón y prueba 4 formas de atacar con la ventana abierta (3 s cada una)">Test con ventana</button></div>
        <div class="f"><b>Pulso</b> <button data-a="pl0" title="Ritmo seguro: el mínimo que permite tu velocidad de ataque (con AGI alta, 62 ms). En el Test de ritmos mató a los bichos duros un 30 % más rápido que con 100 ms">Seguro</button><button data-a="pl1" title="Pulso cada 100 ms = 10 hechizos/s">100 ms</button><button data-a="pl2" title="Pulso cada 62 ms (~16/s): el mínimo que permite la regla del servidor con tu AGI. Se mide con el Test de ritmos">62 ms</button><button data-a="pl3" title="Pulso cada 50 ms (20/s): por debajo de lo que permite la regla del servidor (60 ms). Probalo primero con el Test bajo">50 ms</button><button data-a="pl4" title="Pulso cada 40 ms (25/s): el más rápido que midió el Test bajo. Se guarda; volvé con Seguro si algo falla">40 ms</button><button data-a="pl5" title="Pulso cada 20 ms. En el Test 40-10 dio unos 15 hechizos/s y 0,81 avisos de experiencia/s">20 ms</button><button data-a="pl6" title="Pulso cada 10 ms (el más rápido). En el Test 40-10 dio 18 hechizos/s de promedio y 0,96 avisos de experiencia/s, pero la mitad de los hechizos fueron a blancos que nunca recibieron un golpe">10 ms</button><button data-a="cad" title="Cuánto tiempo se va en cadena rápida, ciclos lentos y huecos (últimos 30 s)">Ver cadencia</button></div>
        <div class="f"><b>Master</b> <button data-a="mt" title="Lee el árbol master del juego (nombres, niveles, efectos, puntos) y baja arbol_master.json. Solo lectura: no gasta puntos.">Ver árbol master</button></div>
        <div class="f"><b>Destrabar si deja de lanzar</b> <button data-a="dt1">ON</button><button data-a="dt0">OFF</button><button data-a="dtv">Ver</button></div>
        <div class="f"><b>Esperar a que el blanco se quede quieto</b> <button data-a="qt1" title="Si el blanco del motor se mueve y está a más de 2 casillas no manda pulsos (hasta 0,6 s por vez). No se sabe si mata más rápido: medilo con Test quietos">ON</button><button data-a="qt0">OFF</button><button data-a="tqt" title="Alterna 60 s sin / 60 s con esperar quieto, dos veces (4 min). Parado atacando en el mismo lugar: compará muertes, exp/s y % de hechizos con respuesta">Test quietos</button></div>
        <div class="f"><b>Saltar el blanco que no recibe golpes</b> <button data-a="sl1" title="Si el motor lleva 10 hechizos Y 0,8 s sobre un bicho que no recibió ni un golpe y hay otro a 7 casillas o menos: suelta el blanco, mueve la mira un paso hacia el otro y vuelve (escalera de 3 escalones). Prendido de fábrica. La caja trae telemetria.saltar con cuántas veces cambió de blanco">ON</button><button data-a="sl0">OFF</button><button data-a="slv">Ver</button><button data-a="rot1" title="ROTAR (v0.71.0, prendido de fábrica): suelta el blanco apenas pasan 0,3 s y 3 hechizos sin que le entre un golpe (medido desde el último golpe) para que el motor pase a otro bicho; los que mueren de 1-2 golpes salen solos. Con OFF vale la regla vieja (10 hechizos y 0,8 s sin ningún golpe)">Rotar ON</button><button data-a="rot0">Rotar OFF</button><button data-a="rotm1" title="Móviles (v0.71.1): si el blanco se está moviendo lo suelta a los 0,12 s y 2 hechizos sin golpe (caja 18: a los que se mueven les entra el 10 % de los hechizos, a los quietos el 42 %) y prefiere pasar a un bicho quieto. Prendido de fábrica">Móviles ON</button><button data-a="rotm0">Móviles OFF</button><button data-a="tsl" title="Alterna 60 s sin / 60 s con saltar, dos veces (4 min). Parado atacando en el mismo lugar: compará muertes, exp/s y % de hechizos con respuesta">Test saltar</button></div>
        <div class="f"><b>Habilidad de la Sostenida</b> siempre Fire Burst · <button data-a="tha" title="Alterna 60 s con Fire Burst / 60 s con Fire Scream, dos veces (4 min), parado atacando en el mismo lugar. Mide muertes por minuto, avisos de exp y golpes por segundo de cada una. Al terminar vuelve a Fire Burst">Test habilidades</button></div>
        <div class="f"><b>Quedarse quieto en el mejor lugar</b> <button data-a="es1" title="El ancla queda FIJA donde prendés Sostenida (F8). Correa de 2 casillas que lo trae de vuelta, sin salir a buscar bichos caminando ni dar pasos extra. Prendido de fábrica. (Calcular / Ir ahora siguen sirviendo a mano)">ON</button><button data-a="es0" title="Vuelve a como era: ancla donde estás, correa de 8 casillas y búsqueda de bichos caminando">OFF</button><button data-a="esv" title="Muestra cuántos respawns hay medidos cerca, cuánto alcanzás desde donde estás y cuál es la mejor casilla">Calcular</button><button data-a="esa" title="Camina ahora a la mejor casilla y fija el ancla ahí">Ir ahora</button></div>
        <div class="f"><b>Seguir atacando con ventana abierta (AUTO)</b> <button data-a="av1" title="Al abrir inventario o stats se prende el AUTO del juego (es lo único que ataca con ventana abierta); al cerrar vuelve la Sostenida">ON</button><button data-a="av0">OFF</button></div>
        <div class="f"><b>Cajas del piso</b> <button data-a="lk1" title="Va a buscar caminando (sin forjar paquetes) los items del piso con la firma elegida, a 12 casillas o menos, y vuelve al ancla. Solo con Sostenida prendida y vida > 40 %. Por defecto: Box of Kundun +5 (14:11 nivel 12, firma NO verificada en este servidor)">ON</button><button data-a="lk0">OFF</button><button data-a="lkv" title="Muestra qué firma busca, cuántas juntó y qué items hay cerca (grupo:índice nivel)">Ver</button><button data-a="lkm" title="Parate al lado de la caja caída y apretá: agrega la firma del item más cercano a la lista de lo que se busca">Marcar el más cercano</button><button data-a="lkr" title="Vuelve a la firma por defecto (Kundun +5)">Reiniciar</button><button data-a="tnv" title="Lista las tiendas de NPC que abriste (nombre, mapa, posición, cuántos items) y avisa cuál vende el Scroll of Fire Scream. Para llenarla: hablá con los NPC (Pasi, Izabel, etc.) y abrí la tienda">Tiendas vistas</button><button data-a="tnb">Borrar tiendas</button></div>
        <div class="f"><b>Items del piso</b> <button data-a="ip1">Mostrar</button><button data-a="ip0" title="Prueba: ocultarlos puede evitar que el juego se frene yendo a juntarlos (y deja de juntar joyas)">Ocultar (prueba)</button></div>
        <div class="f"><b>Otros modos</b> <button data-a="ma1">AUTO del juego</button><button data-a="mp1">Solo pulsos</button><button data-a="mn">Apagar todo</button></div>
      </details>
      <details><summary>Spots y caminos (una vez)</summary>
        <div class="f"><b>Spots</b> <button data-a="e1">Arañas</button><button data-a="e2">Devias 3</button><button data-a="e3">Lost Tower 7</button><button data-a="e4">Aida</button><button data-a="e0">Ver</button></div>
        <div class="f"><b>Caminos</b> <button data-a="r1">Arañas</button><button data-a="r2">Devias 3</button><button data-a="r3">Lost Tower 7</button><button data-a="r4">Aida</button><button data-a="rp">PARAR y guardar</button><button data-a="r0">Ver</button><button data-a="rx">Bajar</button></div>
        <div class="f"><b>Mi spot</b> <button data-a="ms1" title="Guarda el mapa y la casilla donde estás parado ahora. Si morís (y estabas farmeando) vuelve solo: /move si cambia el mapa, camina hasta acá, deja el ancla y vuelve a prender la Sostenida">Guardar acá</button><button data-a="msg" title="Grabá el camino UNA vez: tocá esto parado donde reaparecés al morir, caminá hasta el spot y tocá Parar camino. Así no choca con paredes">Grabar camino</button><button data-a="msp">Parar camino</button><button data-a="msv" title="Vuelve ahora al spot guardado">Volver ahora</button><button data-a="mson">Al morir: ON</button><button data-a="msoff">OFF</button><button data-a="msw" title="Solo hace falta si reaparecés en OTRO mapa: el nombre exacto del /move de ese mapa">Nombre del /move</button><button data-a="msx">Ver</button></div>
      </details>
      <details><summary>Datos y calibración</summary>
        <div class="f"><b>Golpes</b> <button data-a="gol">Ver daño</button><button data-a="gol0">Reiniciar</button> <b>Spots</b> <button data-a="spq">Mejores del mapa</button><button data-a="spx">Bajar todos</button></div>
        <div class="f"><b>Bichos</b> <button data-a="bahora">Ahora</button><button data-a="bic">Ranking</button><button data-a="bicx">Bajar</button> <button data-a="paq">Paquetes</button><button data-a="inf">Informe</button></div>
        <div class="f"><b>Calibrar</b> (solo si falla el movimiento) <button data-a="movc">Mover</button><button data-a="pcal">Pantalla</button></div>
      </details>
      <details><summary>Avanzado (piloto viejo y mediciones)</summary>
        <div class="f"><button data-a="mh">Medir Helper 5 min</button><button data-a="mp">Medir Piloto 5 min</button></div>
        <div class="f"><b>Grabar mi juego</b> <button data-a="gman1">Empezar</button><button data-a="gman2">Parar y bajar</button> <button data-a="pon">Piloto propio</button></div>
        <div class="f"><b>Piloto se mueve</b> <button data-a="mv0">No (como Helper)</button><button data-a="mv1">Sí (a los núcleos)</button></div>
        <div class="f"><b>Barrido</b> <button data-a="bw1">Normal</button><button data-a="bw5">Chico</button> <b>Fijar blanco</b> <button data-a="fj1">ON (prueba)</button><button data-a="fj0">OFF</button></div>
        <div class="f"><b>Blanco</b> <button data-a="bp1">Hasta que muera</button><button data-a="bp0">Rotar</button> <b>Shift</b> <button data-a="sh1">ON</button><button data-a="sh0">OFF</button></div>
      </details></div>`;
    (document.body || document.documentElement).appendChild(caja);
    caja.onclick = async (e) => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'min') { const c = caja.querySelector('#lab-cuerpo'); c.hidden = !c.hidden; }
      if (a === 'pup' || a === 'pdn') { moverPaneles(a === 'pup' ? 50 : -50); const v = document.getElementById('vigia-panel'); if (v) v.style.bottom = (60 + SUBE) + 'px'; return; }
      if (a === 'inf') { await bajarJson(lectura(), 'informe_lab.json'); anotar('informe_lab.json bajado'); }
      if (a === 'movc') moverCalibrar();
      if (a === 'pcal') pantallaCalibrar();
      if (a === 'ir1') {
        if (!window.__ciclo) return anotar('ciclo.js no cargó');
        anotar('Yendo al spot de Aida… (para cortar: "OFF" del ciclo, Nada o Helper)');
        const r = await window.__ciclo.irAlSpot('aida', anotar);
        anotar(r.ok ? 'LISTO: estás en el spot (' + r.x + ',' + r.y + ') con Sostenida y ancla' : 'No pude: ' + r.motivo);
        return;
      }
      if (a === 'anq1' || a === 'anq0') {
        if (!window.__modo || !window.__modo.setAnclaAqui) return anotar('modo.js no cargó (recargá la extensión)');
        return anotar('Ancla al prender Sostenida: ' + (window.__modo.setAnclaAqui(a === 'anq1') ? 'DONDE LO PRENDO (el ancla es el lugar donde estás al apretar el botón o F8)' : 'MEJOR SPOT (va al ancla guardada o a la zona con más respawns)'));
      }
      if (a === 'an1' || a === 'an0' || a === 'anon' || a === 'anoff') {
        if (!window.__modo) return anotar('modo.js no cargó');
        if (a === 'an1') { const p = window.__modo.guardarAncla(); anotar('Ancla guardada para este mapa en (' + p.x + ',' + p.y + ').' + (window.__modo.anclaAquiOn && window.__modo.anclaAquiOn() ? ' Ojo: con "Donde lo prendo" activo no se usa; apretá "Mejor spot" para que Sostenida vuelva acá.' : ' Sostenida va a volver acá.')); }
        else if (a === 'an0') { window.__modo.borrarAncla(); anotar('Ancla de este mapa borrada (se usa el mejor spot por respawns)'); }
        else anotar('Ancla automática: ' + (window.__modo.setAncla(a === 'anon') ? 'ON (Sostenida va al mejor lugar al activarla)' : 'OFF (se queda donde estás)'));
        return;
      }
      if (a === 'al1' || a === 'al0' || a === 'alt' || a === 'alm1' || a === 'alm2' || a === 'alm3') {
        const A = window.__agresor; if (!A || !A.alerta) return anotar('agresor.js no cargó (recargá la extensión)');
        if (a === 'alt') { A.alertaTest(); return anotar('Cartel de prueba mostrado (debería sonar un pitido y desaparecer solo a los 6 s)'); }
        const s = a === 'al1' ? A.alerta(true) : a === 'al0' ? A.alerta(false) : A.alerta(null, a === 'alm1' ? 500 : a === 'alm2' ? 1000 : 2500);
        return anotar('Cartel de ataque: ' + (s.on ? 'ON' : 'OFF') + ' · aparece si te sacan ' + s.min + ' o más (vida+SD) en 3 s · mostró ' + s.mostradas + ' veces · mayor daño en 3 s: ' + s.pico);
      }
      if (a === 'pr1' || a === 'pr0' || a === 'pm1' || a === 'pm2' || a === 'pm3' || a === 'prv') {
        const Mo = window.__modo; if (!Mo || !Mo.potRapido) return anotar('modo.js no cargó (recargá la extensión)');
        const s = a === 'pr1' ? Mo.potRapido(true) : a === 'pr0' ? Mo.potRapido(false) : a === 'pm1' ? Mo.potRapido(null, 60) : a === 'pm2' ? Mo.potRapido(null, 90) : a === 'pm3' ? Mo.potRapido(null, 150) : Mo.potRapidoStats();
        return anotar('Pociones rápidas: ' + (s.activo ? 'ON' : 'OFF') + ' · una cada ' + s.ms + ' ms mientras te atacan (SD < ' + s.sd_hasta_pct + ' %, vida < ' + s.vida_hasta_pct + ' %) · episodios ' + s.episodios + ', intentos ' + s.intentos + ', gastadas de verdad ' + s.gastos_reales + (s.gap_min_ms != null ? ' · tiempo mínimo entre gastos ' + s.gap_min_ms + ' ms (mediana ' + s.gap_mediana_ms + ')' : '') + (s.sin_pociones ? ' · SIN POCIONES ' + s.sin_pociones + ' veces' : ''));
      }
      if (a === 'pa1' || a === 'pa0' || a === 'pu1' || a === 'pu2' || a === 'pu3' || a === 'pav') {
        const A = window.__agresor; if (!A || !A.pvpAuto) return anotar('agresor.js no cargó (recargá la extensión)');
        const s = a === 'pa1' ? A.pvpAuto(true) : a === 'pa0' ? A.pvpAuto(false) : a === 'pu1' ? A.pvpAuto(null, 1500) : a === 'pu2' ? A.pvpAuto(null, 2500) : a === 'pu3' ? A.pvpAuto(null, 4000) : A.pvpAutoStats();
        return anotar('PVP automático: ' + (s.on ? 'ON' : 'OFF') + ' · se activa si vida+escudo bajan ' + s.umbral + ' o más en 1 s con un jugador a la vista · disparó ' + s.disparos + ' veces, ' + s.sinJugador + ' golpes sin jugador a la vista' + (s.ult ? ' · último: ' + s.ult : ''));
      }
      if (a === 'ag0' || a === 'ag1' || a === 'ag2' || a === 'agv') {
        if (!window.__agresor) return anotar('agresor.js no cargó');
        if (a !== 'agv') window.__agresor.setModo(a === 'ag1' ? 'contraatacar' : a === 'ag2' ? 'avisar' : 'apagado');
        return anotar(window.__agresor.texto() + (a === 'ag1' ? ' · necesita el navegador con foco y la pantalla calibrada' : ''));
      }
      if (a === 'lz1' || a === 'lz3' || a === 'lz8') {
        if (!window.__modo) return anotar('modo.js no cargó');
        const n = window.__modo.setCorrea(a === 'lz1' ? 1 : a === 'lz3' ? 3 : 8); return anotar('Correa: vuelvo al ancla si me alejo más de ' + n + ' casillas · ancla en ' + JSON.stringify(window.__modo.ancla()));
      }
      if (a === 'vt') {
        if (!window.__modo || !window.__modo.probarVentana) return anotar('modo.js no tiene la prueba (recargá la extensión)');
        anotar('Test con ventana: probando 4 formas de atacar, 3 s cada una (≈ 13 s). No cierres la ventana.');
        window.__modo.probarVentana(3).then((r) => { anotar(r.ok ? 'Test con ventana: ' + r.resumen + (r.corte ? ' · cortado: ' + r.corte : '') : 'Test con ventana: ' + r.motivo); toast(r.ok ? 'Test con ventana terminado: mirá el Lab' : 'Test con ventana: ' + r.motivo); });
        return;
      }
      if (a === 'qt1' || a === 'qt0') {
        if (!window.__modo || !window.__modo.setQuietos) return anotar('modo.js no cargó (recargá la extensión)');
        return anotar('Esperar quieto: ' + (window.__modo.setQuietos(a === 'qt1') ? 'ON (no manda pulsos mientras el blanco se mueve a más de 2 casillas, hasta 0,6 s por vez)' : 'OFF'));
      }
      if (a === 'es1' || a === 'es0' || a === 'esv' || a === 'esa') {
        const Mo = window.__modo; if (!Mo || !Mo.setEstrategico) return anotar('modo.js no cargó (recargá la extensión)');
        if (a === 'es1' || a === 'es0') Mo.setEstrategico(a === 'es1');
        const resumenE = () => {
          const r = Mo.mejorLugarAhora(), st = Mo.estrategicoStats();
          return 'Quieto en el mejor lugar: ' + (st.on ? 'ON (correa ' + st.correa + ' casillas, sin buscar bichos caminando)' : 'OFF') + ' · ' + (r.ok ? 'respawns medidos cerca: ' + r.total + ' en ' + r.puntos + ' puntos (' + r.fuente + ') · acá alcanzás el ' + r.aqui.a6_pct + ' % (de lleno, a <= 4,5: ' + r.aqui.a4_pct + ' %) · el mejor lugar es (' + r.mejor.x + ',' + r.mejor.y + '), a ' + r.distancia + ' casillas: ' + r.mejor.a6_pct + ' % (a <= 4,5: ' + r.mejor.a4_pct + ' %)' : 'todavía no hay datos: ' + r.motivo) + ' · ancla ' + (st.ancla ? '(' + st.ancla.x + ',' + st.ancla.y + ')' : 'sin fijar') + ' · se aplicó ' + st.aplicados + ' veces, se quedó donde estaba ' + st.se_quedo_donde_estaba + ', corregidos por la revisión ' + st.corregidos_por_la_revision + ', vueltas por la correa ' + st.vueltas_por_la_correa;
        };
        if (a === 'esa') { anotar('Voy al mejor lugar…'); Mo.anclarEstrategico('Lab').then(() => anotar(resumenE())); return; }
        return anotar(resumenE());
      }
      if (a === 'sl1' || a === 'sl0' || a === 'slv' || a === 'rot1' || a === 'rot0' || a === 'rotm1' || a === 'rotm0') {
        const Mo = window.__modo; if (!Mo || !Mo.setSaltar) return anotar('modo.js no cargó (recargá la extensión)');
        if (a === 'rotm1' || a === 'rotm0') Mo.setRotarMoviles(a === 'rotm1');
        if (a === 'rot1' || a === 'rot0') { Mo.setRotar(a === 'rot1'); if (a === 'rot1') Mo.setSaltar(true); }
        else if (a !== 'slv' && a !== 'rotm1' && a !== 'rotm0') Mo.setSaltar(a === 'sl1');
        const st = Mo.saltarStats();
        return anotar('Saltar blanco trabado: ' + (st.on ? 'ON' : 'OFF') + ' · Rotar ' + (st.rotar ? 'ON' : 'OFF') + ' · Móviles ' + (st.rotar_moviles ? 'ON (' + st.disparos_por_blanco_en_movimiento + ' saltos por blanco en movimiento)' : 'OFF') + ' (regla: ' + (st.rotar ? st.rot_hechizos + ' hechizos y ' + st.rot_ms + ' ms desde el último golpe' : st.min_hechizos + ' hechizos y ' + st.lim_ms + ' ms sin un golpe') + ') · saltó ' + st.disparos + ' veces, cambió de blanco ' + st.cambiaron + ' (por escalón ' + st.por_escalon.join('/') + '), sin cambio ' + st.sin_cambio + ', sin otro bicho al que ir ' + st.sin_alternativa + (st.ms_hasta_cambio_med != null ? ' · tarda ' + st.ms_hasta_cambio_med + ' ms en cambiar' : '') + ' · hechizos gastados en blancos trabados ' + st.hechizos_en_trabados + ' · volvió al ancla ' + st.volvieron_al_ancla + ' veces · cambios de blanco del motor sin muerte: ' + st.cambios_de_blanco_sin_muerte + (st.cambios_con_el_heroe_moviendose_pct != null ? ' (' + st.cambios_con_el_heroe_moviendose_pct + ' % con el héroe moviéndose; el héroe se movía en el ' + st.hechizos_con_el_heroe_moviendose_pct + ' % de los hechizos)' : ''));
      }
      if (a === 'hb1' || a === 'hb2' || a === 'hbv' || a === 'tha') {
        const Mo = window.__modo; if (!Mo || !Mo.setHabilidad) return anotar('modo.js no cargó (recargá la extensión)');
        if (a === 'hb1' || a === 'hb2') { const ok = Mo.setHabilidad(a === 'hb1' ? 508 : 78); return anotar('Habilidad de la Sostenida: ' + (a === 'hb1' ? 'Fire Burst (508)' : 'Fire Scream (78)') + (ok ? '' : ' · OJO: el juego no la dejó elegir (¿la tenés aprendida? Energía 150 y Comando 70)') + ' · queda guardada'); }
        if (a === 'hbv') return anotar('Habilidad de la Sostenida: ' + ({ 508: 'Fire Burst (508)', 78: 'Fire Scream (78)' }[Mo.habilidad()] || Mo.habilidad()) + ' · mana ' + call('GetPlayerMana') + '/' + call('GetPlayerManaMax'));
        const T = window.__telemetria; if (!T || !T.probarHab) return anotar('telemetria.js no cargó (recargá la extensión)');
        if (T.probando()) return anotar('Ya hay una prueba andando');
        anotar('Test de habilidades: Fire Burst / Fire Scream / Fire Burst / Fire Scream, 60 s cada una (~4,5 min). Quedate atacando en el mismo lugar con la Sostenida prendida; se corta si morís, bajás de 35 % de vida o abrís una ventana.');
        T.probarHab([508, 78, 508, 78], 60, anotar).then((r) => { anotar(T.textoPruebaHab(r)); toast(r.ok ? 'Test de habilidades terminado: mirá el Lab' : 'Test de habilidades: ' + r.motivo); });
        return;
      }
      if (a === 'tel' || a === 'telp' || a === 'telb' || a === 'telc' || a === 'telr' || a === 'telx' || a === 'tqt' || a === 'tsl' || a === 'tel0') {
        const T = window.__telemetria; if (!T) return anotar('telemetria.js no cargó (recargá la extensión)');
        if (a === 'tel0') { T.reiniciar(); return anotar('Telemetría reiniciada'); }
        if (a === 'tel') return anotar(T.resumen());
        if (T.probando()) return anotar('La prueba de ritmos ya está andando');
        const fasesT = a === 'tsl' ? ['s0', 's1', 's0', 's1'] : a === 'tqt' ? ['q0', 'q1', 'q0', 'q1'] : a === 'telx' ? [40, 30, 20, 10] : a === 'telr' ? [40, 30, 62] : a === 'telc' ? [62, 40, 30, 40] : a === 'telb' ? [62, 50, 40, 62] : [100, 62, 100, 62], segT = a === 'telr' ? 120 : 60;
        anotar((a === 'tsl' ? 'Test saltar: ' : a === 'tqt' ? 'Test quietos: ' : 'Test de ritmos: ') + fasesT.length + ' fases de ' + segT + ' s (' + fasesT.join(' / ') + (a === 'tqt' || a === 'tsl' ? '' : ' ms') + '), ' + Math.round(fasesT.length * (segT + 2.5) / 60 * 10) / 10 + ' min. Quedate atacando en el mismo lugar; se corta si morís, bajás de 35 % de vida o abrís una ventana.');
        T.probar(fasesT, segT, anotar).then((r) => { anotar(T.textoPrueba(r)); toast(r.ok ? 'Test de ritmos terminado: mirá el Lab' : 'Test de ritmos: ' + r.motivo); });
        return;
      }
      if (a === 'tk1' || a === 'tk0' || a === 'f6s' || a === 'f6p') {
        if (a === 'tk1' || a === 'tk0') TK.on = a === 'tk1'; else TK.packs = a === 'f6p';
        guardarTK(); return anotar('Teclas ' + (TK.on ? 'ON' : 'OFF') + ' · F6 saca ' + (TK.packs ? '1 pack de Bless, 1 pack de Soul y 10 Chaos' : '10 Bless, 10 Soul y 10 Chaos sueltas'));
      }
      if (a === 'pl0' || a === 'pl1' || a === 'pl2' || a === 'pl3' || a === 'pl4' || a === 'pl5' || a === 'pl6' || a === 'cad') {
        if (!window.__modo) return anotar('modo.js no cargó');
        if (a === 'pl0') { window.__modo.setRitmoSeguro(true); anotar('Pulso: ritmo seguro (' + window.__modo.huecoPulso() + ' ms)'); return; }
        if (a === 'pl5' || a === 'pl6') { const ms = a === 'pl5' ? 20 : 10; window.__modo.setPulsoMs(ms); window.__modo.setRitmoSeguro(false); anotar('Pulso: ' + ms + ' ms manual (el tope de seguridad sube a 45 hechizos/s). Mirá niv/h arriba y volvé con Seguro si algo falla.'); return; }
        if (a === 'pl4') { window.__modo.setPulsoMs(40); window.__modo.setRitmoSeguro(false); anotar('Pulso: 40 ms manual (por debajo de la regla del servidor: 60 ms). Mirá la cadencia y los golpes; volvé con Seguro si algo falla.'); return; }
        if (a === 'pl3') { window.__modo.setPulsoMs(50); window.__modo.setRitmoSeguro(false); anotar('Pulso: 50 ms manual (por debajo de la regla del servidor). Mirá la cadencia y los golpes; volvé con Seguro si algo falla.'); return; }
        if (a === 'pl2') { window.__modo.setPulsoMs(62); window.__modo.setRitmoSeguro(false); anotar('Pulso: 62 ms manual (el mínimo de la regla del servidor). Miralo con el Test de ritmos y volvé con Seguro si algo falla.'); return; }
        if (a === 'pl1') { window.__modo.setPulsoMs(100); window.__modo.setRitmoSeguro(false); anotar('Pulso: 100 ms (10/s). Después mirá "Ver cadencia".'); return; }
        const c = window.__modo.cadencia(30); return anotar(c ? c.por_seg + '/s (activos ' + c.activos_por_seg + '/s) · cadena rápida ' + c.cadena_rapida_pct + ' % · ciclos lentos ' + c.ciclos_lentos_pct + ' % · huecos ' + c.huecos_pct + ' % · <98 ms ' + c.bajo_98ms_pct + ' % · cambios de blanco ' + c.cambios_de_blanco_pct + ' % · pulso ' + window.__modo.huecoPulso() + ' ms' : 'Sin datos: hacen falta unos segundos de Sostenida atacando.');
      }
      if (a === 'mt') {
        // Solo lectura de lo que el propio juego sabe del árbol master. Si el árbol nunca se abrió en esta sesión puede estar vacío.
        const n = call('GetMasterTreeSkillCount') | 0, nodos = [];
        for (let i = 0; i < Math.min(n, 400); i++) nodos.push({ i, id: call('GetMasterTreeSkillId', i), nombre: str('GetMasterTreeSkillNameUtf8', i), grupo: call('GetMasterTreeSkillGroup', i), rango: call('GetMasterTreeSkillRank', i), nivel: call('GetMasterTreeSkillLevel', i), maximo: call('GetMasterTreeSkillMaxLevel', i), puntos_requeridos: call('GetMasterTreeSkillRequiredPoints', i), estado: call('GetMasterTreeSkillState', i), padre: call('GetMasterTreeSkillParent', i), efecto: str('GetMasterTreeSkillEffectUtf8', i) });
        const o = { hora: new Date().toISOString(), nivel: call('GetPlayerLevel'), nivel_master: call('GetMasterLevel'), puntos_master_libres: call('GetMasterSkillPoints'), puede_abrir_arbol: call('CanOpenMasterSkillTree'), cantidad: n, nodos };
        if (!n) return anotar('El árbol master está vacío para el juego. Abrilo una vez desde el juego (la ventana de Master) y volvé a apretar este botón. Nivel master ' + o.nivel_master + ', puntos libres ' + o.puntos_master_libres);
        bajarJson(o, 'arbol_master.json');
        const fb = nodos.filter((x) => /fire|fuego|burst|r[aá]faga|llama/i.test(x.nombre + ' ' + x.efecto)).slice(0, 3);
        return anotar('Árbol master: ' + n + ' nodos · nivel master ' + o.nivel_master + ' · puntos libres ' + o.puntos_master_libres + (fb.length ? ' · Fire/Burst: ' + fb.map((x) => x.nombre + ' ' + x.nivel + '/' + x.maximo).join(', ') : '') + ' (arbol_master.json bajado)');
      }
      if (a === 'av1' || a === 'av0') {
        if (!window.__modo || !window.__modo.setAutoVentana) return anotar('modo.js no cargó (recargá la extensión)');
        return anotar('AUTO con ventana abierta: ' + (window.__modo.setAutoVentana(a === 'av1') ? 'ON (al abrir inventario/stats se prende el AUTO del juego; al cerrar vuelve la Sostenida)' : 'OFF'));
      }
      if (a === 'dt1' || a === 'dt0' || a === 'dtv') {
        if (!window.__modo) return anotar('modo.js no cargó');
        if (a !== 'dtv') window.__modo.setDestrabar(a === 'dt1');
        const s = window.__modo.destrabarStats(); return anotar('Destrabar: ' + (s.on ? 'ON' : 'OFF') + ' · intentos ' + s.intentos + ' · funcionaron ' + s.funcionaron + ' (por escalón ' + s.por_escalon.join('/') + ')');
      }
      if (a === 'tnv' || a === 'tnb') { const T = window.__tiendas; if (!T) return anotar('joyas.js no cargó (recargá la extensión)'); if (a === 'tnb') { T.borrar(); return anotar('Tiendas borradas'); } return anotar('Tiendas de NPC vistas: ' + T.texto()); }
      if (a === 'lk1' || a === 'lk0' || a === 'lkv' || a === 'lkm' || a === 'lkr') {
        const Lk = window.__loot; if (!Lk) return anotar('joyas.js no cargó (recargá la extensión)');
        if (a === 'lk1' || a === 'lk0') Lk.setOn(a === 'lk1');
        if (a === 'lkr') Lk.reiniciar();
        if (a === 'lkm') { const r = Lk.marcarMasCercano(); if (!r.ok) return anotar('No marqué nada: ' + r.motivo); anotar('Marcado: ' + r.firma + ' (el item más cercano, a ' + r.a + ' casillas)'); }
        const s = Lk.stats(), cerca = Lk.cerca();
        return anotar('Cajas del piso: ' + (s.activo ? 'ON' : 'OFF') + ' · busca ' + s.firmas.join(' + ') + ' · fue a ' + s.objetivos + ', juntó ' + s.juntados + ', las juntó otro ' + s.los_junto_otro + ', no pudo ' + s.perdidos + (s.ms_viaje_med != null ? ' · ' + s.ms_viaje_med + ' ms por viaje' : '') + (s.ultimo ? ' · último: ' + s.ultimo : '') + ' · cerca: ' + (cerca.length ? cerca.join(' | ') : 'nada') + (s.sin_firma_bichos_viejo ? ' · ojo: bichos.js viejo, apretá F5 en la página del juego' : ''));
      }
      if (a === 'ip1' || a === 'ip0') {
        const v = a === 'ip1' ? 1 : 0; call('SetGroundItemsVisible', v);
        try { localStorage.setItem('muItemsPisoV1', JSON.stringify({ visible: !!v })); } catch (e) { /* nada */ }
        return anotar('Items del piso: ' + (v ? 'visibles (normal)' : 'ocultos (prueba: mirá si los pickups bajan y el ataque no se frena)') + ' · el juego dice: ' + call('GetGroundItemsVisible'));
      }
      if (a === 'rs1' || a === 'rs0') { if (!window.__modo) return anotar('modo.js no cargó'); const on = window.__modo.setRitmoSeguro(a === 'rs1'); anotar('Ritmo seguro: ' + (on ? 'ON (un hechizo cada ' + window.__modo.huecoPulso() + ' ms como mínimo)' : 'OFF (pulsos libres)')); }
      if (a === 'rp1' || a === 'rp0') { if (!window.__modo) return anotar('modo.js no cargó'); anotar('Buscar bichos si desaparecen: ' + (window.__modo.setRepos(a === 'rp1') ? 'ON' : 'OFF')); }
      if (a === 'gol') { if (!window.__golpes) return anotar('golpes.js no cargó'); const f = window.__golpes.filas(call('GetMapIndex')).slice(0, 5); if (!f.length) return anotar('Todavía no registré golpes en este mapa'); window.__golpes.porStats().slice(-3).forEach((x) => anotar('con STR/AGI/ENE ' + x.str_agi_ene + ': ' + x.golpes + ' golpes · medio ' + x.danoMedio + ' · crítico ' + x.pctCritico + '% · ' + (x.golpesPorBicho != null ? x.golpesPorBicho + ' golpes por bicho' : ''))); f.forEach((x) => anotar('tipo ' + x.tipo + ': ' + x.golpes + ' golpes · medio ' + x.danoMedio + ' (máx ' + x.danoMax + ') · ' + (x.golpesPorBicho != null ? x.golpesPorBicho + ' golpes por bicho · vida ~' + (x.vidaMaxEstimada || x.vidaEstimada) : 'sin muertes') + ' · crítico ' + x.pctCritico + '%')); return; }
      if (a === 'gol0') { if (window.__golpes) window.__golpes.reiniciar(); anotar('Golpes reiniciados'); return; }
      if (a === 'spq') {
        const B = window.__bichos; if (!B || !B.spots) return anotar('bichos.js no cargó (hace falta F5 una vez)');
        const r = B.spots(call('GetMapIndex'), 5, 40);
        if (!r.length) return anotar('Todavía no hay datos suficientes de este mapa (recorrelo un rato: hacen falta ~40 s por zona)');
        anotar('Zonas con más RESPAWNS por minuto en el mapa ' + call('GetMapIndex') + ' (zonas de 6x6; respawns vistos en total: ' + B.respawnsVistos() + '):');
        r.forEach((x, i) => anotar((i + 1) + '. ' + x.zona + ' · ' + x.respawnsPorMin + ' respawns/min (' + x.respawns + ') · exp potencial/min ' + x.expPotencialPorMin + ' · visto ' + x.observadoSeg + ' s · ' + x.tipos));
        return;
      }
      if (a === 'spx') {
        const B = window.__bichos; if (!B || !B.spots) return anotar('bichos.js no cargó (hace falta F5 una vez)');
        const mapas = [...new Set(Object.keys(B.densidad()).map((k) => k.split('|')[0]))];
        await bajarJson({ hora: new Date().toISOString(), por_mapa: Object.fromEntries(mapas.map((mp) => [mp, B.spots(+mp, 8, 40)])), exp_por_tipo: null }, 'spots.json'); anotar('spots.json bajado (' + mapas.length + ' mapas)'); return;
      }
      if (a === 'ma1' || a === 'ms1' || a === 'mp1' || a === 'mn') {
        if (!window.__modo) return anotar('modo.js no cargó');
        const r = window.__modo.fijar(a === 'ma1' ? 'auto' : a === 'ms1' ? 'sostener' : a === 'mp1' ? 'pulsos' : 'manual', 'botón (prueba del motor)');
        anotar(window.__modo.texto() + (a === 'mn' ? '' : ' · para cortar: botón Apagar o Nada'));
      }
      if (a === 'pon' || a === 'poff' || a === 'pno') {
        if (!window.__modo) return anotar('modo.js no cargó');
        const r = window.__modo.fijar(a === 'pon' ? 'piloto' : a === 'poff' ? 'helper' : 'manual', 'botón');
        anotar(r.ok ? window.__modo.texto() : 'El piloto no arrancó: ' + r.motivo + ' → quedó el Helper');
      }
      if (a === 'mv0' || a === 'mv1' || a === 'bw1' || a === 'bw5') {
        if (!window.__piloto) return anotar('piloto.js no cargó');
        if (a === 'mv0' || a === 'mv1') window.__piloto.setMoverse(a === 'mv1'); else window.__piloto.setBarrido(a === 'bw5' ? 0.5 : 1);
        const o = window.__piloto.opciones(); anotar('Piloto: ' + (o.moverse ? 'se mueve a los núcleos' : 'quieto como el Helper') + ' · barrido ' + (o.barrido === 1 ? 'normal' : 'x' + o.barrido));
      }
      if (a === 'fj1' || a === 'fj0') {
        if (!window.__piloto) return anotar('piloto.js no cargó');
        window.__piloto.setFijar(a === 'fj1'); anotar(a === 'fj1' ? 'Fijar blanco ON: cuando el puntero cae justo sobre un bicho, el juego lo fija y el puntero se queda quieto ahí. Mirá los "PIN" en la caja negra.' : 'Fijar blanco OFF');
      }
      if (a === 'mh' || a === 'mp') {
        if (!window.__piloto) return anotar('piloto.js no cargó');
        anotar('Midiendo 5 min (' + (a === 'mh' ? 'Helper' : 'Piloto') + '). No toques nada…');
        anotar(await window.__piloto.medir(a === 'mh' ? 'helper' : 'piloto', 5, anotar));
      }
      if (a === 'gman1') { if (!window.__caja) return anotar('caja.js no cargó'); window.__caja.empezarManual(); anotar('GRABANDO tu juego manual (Helper y piloto apagados). Jugá como siempre y después tocá PARAR y bajar'); }
      if (a === 'gman2') { if (!window.__caja) return anotar('caja.js no cargó'); const r = window.__caja.pararManual(); anotar('Grabación terminada: ' + r.seg + ' s, ' + r.entradas + ' entradas de mouse/teclas, ' + r.muestras + ' muestras, ' + r.kb + ' KB (caja_manual.json)'); }
      if (a === 'bp1' || a === 'bp0') {
        if (!window.__piloto) return anotar('piloto.js no cargó');
        window.__piloto.setPersistir(a === 'bp1'); anotar(a === 'bp1' ? 'Blanco: el piloto se queda en el MISMO bicho hasta que muera (para bichos duros)' : 'Blanco: el piloto rota entre los bichos más cercanos (para muchos bichos débiles)');
      }
      if (a === 'cs1' || a === 'cs2' || a === 'cr1' || a === 'cr2') {
        if (!window.__ciclo) return anotar('ciclo.js no cargó');
        const r = window.__ciclo.arrancar(a === 'cs2' || a === 'cr2', (a === 'cr1' || a === 'cr2') ? 9999 : 1, a === 'cs1' || a === 'cs2');   // real: sin tope de resets
        anotar(r.ok ? ((a === 'cs1' || a === 'cs2') ? 'SIMULACIÓN prendida' : 'CICLO REAL prendido') + (a === 'cs1' || a === 'cr1' ? ' (paso a paso: vas a ver "PRÓXIMO" en el panel, confirmá con "Confirmar paso")' : ' (automático)') : 'No arrancó: ' + r.motivo);
      }
      if (a === 'cc') { if (window.__ciclo) window.__ciclo.confirmar(); anotar('Paso confirmado'); }
      if (a === 'co') { if (window.__ciclo) window.__ciclo.detener('manual'); anotar('Ciclo OFF'); }
      if (a === 'cq1' || a === 'cq0') { if (!window.__ciclo || !window.__ciclo.setQuedarse) return anotar('ciclo.js no cargó (recargá la extensión)'); return anotar('Ciclo: ' + (window.__ciclo.setQuedarse(a === 'cq1') ? 'si después del reset seguís en el mapa 210, te quedás ahí (sin viajar)' : 'viaja por las etapas como antes')); }
      if (a === 'ct') { if (window.__ciclo) anotar('Tope de resets: ' + window.__ciclo.masTope(1)); }
      if (a === 'e1' || a === 'e2' || a === 'e3' || a === 'e4') {
        const k = a === 'e1' ? 'arana' : a === 'e2' ? 'devias3' : a === 'e3' ? 'lt7' : 'aida', e = guardarEtapa(k);
        anotar('Spot guardado — ' + NOMBRES_ETAPAS[k] + ': mapa ' + e.mapa + ' (' + e.x + ',' + e.y + ') a nivel ' + e.nivel);
      }
      if (a === 'e0') anotar(textoEtapas());
      if (a === 'rg1' || a === 'rg0') { if (!window.__ciclo) return; anotar('Volver al spot al morir: ' + (window.__ciclo.regreso(a === 'rg1') ? 'ON' : 'OFF')); }
      if (a === 'rgp') { if (!window.__ciclo) return; anotar('Probando el regreso: viajo a Lost Tower 7 y camino al spot…'); window.__ciclo.regresar(); }
      if (a === 'as1' || a === 'as0') { if (!window.__stats) return anotar('stats.js no cargó'); window.__stats.activar(a === 'as1'); anotar(window.__stats.texto()); }
      if (a === 'bf1' || a === 'bf0' || a === 'bfp' || a === 'bfi' || a === 'bfv') {
        const G = window.__grupo; if (!G || !G.buff) return anotar('grupo.js no cargó (recargá la extensión)');
        if (a === 'bf1' || a === 'bf0') G.buff.on(a === 'bf1');
        if (a === 'bfp') { anotar('Lanzando el buff de crítico…'); const r = await G.buff.lanzar('prueba del Lab'); return anotar(r.ok ? 'Buff lanzado (' + r.via + ')' : 'No salió: ' + (r.motivo || 'no se vio ningún efecto ni hechizo enviado (mirá mana, Comando y la habilidad)')); }
        if (a === 'bfi') {
          const l = G.buff.habilidades(); const txt = l.map((x) => x.tipo + ' = ' + (x.nombre || '?')).join('\n');
          const r = window.prompt('Número de la habilidad del buff de crítico (vacío o 0 = que la busque sola por el nombre).\nTus habilidades:\n' + txt, String(G.buff.id() || ''));
          if (r == null) return anotar('Cancelado');
          G.buff.id(parseInt(r, 10) || 0);
        }
        const s = G.buff.stats();
        return anotar('Buff de crítico: ' + (s.activo ? 'ON' : 'OFF') + ' · habilidad ' + (s.habilidad_id || 'NO ENCONTRADA') + (s.nombre ? ' (' + s.nombre + ')' : '') + (s.id_manual ? ' [elegida a mano]' : ' [buscada por nombre]') + ' · efecto del servidor ' + (s.efecto_id == null ? 'sin aprender todavía' : s.efecto_id) + ' · puesto ahora: ' + (s.buff_puesto == null ? '?' : s.buff_puesto ? 'sí' : 'no') + ' · lanzados ' + s.lanzados + ', fallos ' + s.fallos + ', terminaciones vistas ' + s.terminaciones_vistas + (s.duracion_s ? ', dura ' + s.duracion_s + ' s' : '') + ' · renueva como mucho cada ' + s.renueva_cada_s + ' s' + (s.ultimo ? ' · último: ' + s.ultimo : ''));
      }
      if (a === 'sc1' || a === 'sc0' || a === 'scy' || a === 'scg' || a === 'scm' || a === 'sca' || a === 'scp' || a === 'scv' || a === 'sce1' || a === 'sce2' || a === 'sce3' || a === 'sce4') {
        const G = window.__grupo; if (!G || !G.summonChat) return anotar('grupo.js no cargó (recargá la extensión)');
        if (a === 'sc1' || a === 'sc0') G.summonChat.on(a === 'sc1');
        if (a === 'sce1' || a === 'sce2' || a === 'sce3' || a === 'sce4') G.summonChat.espera(a === 'sce1' ? 2000 : a === 'sce2' ? 3500 : a === 'sce3' ? 6000 : 8000);
        if (a === 'scy' || a === 'scg' || a === 'scm' || a === 'sca') G.summonChat.modo(a === 'scy' ? 'party' : a === 'scg' ? 'grupo' : a === 'scm' ? 'miembros' : 'cualquiera');
        if (a === 'scp') { anotar('Tirando Summon…'); const r = await G.invocar('prueba del Lab'); return anotar(r.ok ? 'Summon lanzado (' + r.via + ')' : 'No salió: ' + (r.motivo || 'el enfriamiento no arrancó (mirá mana, Comando y que tengas la habilidad)')); }
        const s = G.summonChat.stats();
        return anotar('Summon por chat: ' + (s.activo ? 'ON' : 'OFF') + ' · ' + ({ party: 'chat de party o gente de tu party por cualquier chat', grupo: 'chat de party y de clan', miembros: 'miembros de party/clan en cualquier chat', cualquiera: 'cualquiera' }[s.modo]) + ' · espera tras el Summon ' + s.espera_ms / 1000 + ' s · chats leídos ' + s.chats_leidos + ' (party ' + s.canales.grupo + ', clan ' + s.canales.clan + ', públicos ' + s.canales.publico + ', otros ' + s.canales.gens + ') · con palabra clave ' + s.con_palabra_clave + ', Summon lanzado ' + s.summon_lanzados + ', fallos ' + s.fallos + ', ignorados ' + s.ignorados + ' · enfriamiento ' + s.enfriamiento_s + ' s' + (s.ultimo ? ' · último: ' + s.ultimo : '') + (s.chats_leidos === 0 ? ' · (si hablan y no leo nada, hay que apretar F5 en la página y mandarme la caja)' : ''));
      }
      if (a === 'cm0' || a === 'cm1' || a === 'cm5' || a === 'cm9' || a === 'cmv') {
        if (!window.__stats || !window.__stats.setCmd) return anotar('stats.js no cargó (recargá la extensión)');
        const n = a === 'cm0' ? window.__stats.setCmd(0) : a === 'cm1' ? window.__stats.setCmd(100) : a === 'cm5' ? window.__stats.setCmd(500) : a === 'cm9' ? window.__stats.setCmd(1000) : window.__stats.cmdPuntos();
        return anotar('Comando en cada reset: ' + (n > 0 ? n + ' puntos (Comando ' + (25 + n) + ' después del reset)' : 'nada') + ' · hoy tenés Comando ' + call('GetPlayerCommand') + ' · el Auto-stats de la extensión tiene que estar en ON (Puntos > Auto ON)' + ' · si usás también el Auto-stats VIP del juego, poné ahí el Comando');
      }
      if (a === 'asm') {
        if (!window.__stats) return anotar('stats.js no cargó');
        const r = window.prompt('Mover puntos de un stat a otro (str, agi, vit, ene): "de a cantidad". Empezá con 1 para probar. Ej: str agi 1', 'str agi 1');
        const p = r && r.trim().toLowerCase().split(/[\s,]+/); if (!p || p.length < 3) return anotar('Cancelado o formato no válido');
        const n = parseInt(p[2], 10);
        if (!window.confirm('¿Quitar ' + n + ' punto(s) de ' + p[0].toUpperCase() + ' y ponerlos en ' + p[1].toUpperCase() + '? Si el servidor se niega, los puntos quitados quedan libres.')) return anotar('Cancelado');
        anotar('Moviendo ' + n + ' punto(s)…'); const x = await window.__stats.mover(p[0], p[1], n);
        anotar(x.ok ? 'Listo: quité ' + x.quitados + ', puse ' + x.puestos + ', libres ahora ' + x.libres + (x.motivo ? ' · ' + x.motivo : '') : 'No se pudo: ' + x.motivo);
        return;
      }
      if (a === 'asr') { if (!window.__stats) return anotar('stats.js no cargó'); window.__stats.proporcionRecomendada(); anotar(window.__stats.texto()); return; }
      if (a === 'asv') anotar(window.__stats ? window.__stats.texto() : 'stats.js no cargó');
      if (a === 'asp' && window.__stats) {
        const c = window.__stats.cfg.pesos, r = window.prompt('Proporción STR AGI STA ENG (números separados por espacios)', [c.str, c.agi, c.vit, c.ene].join(' '));
        const n = r && r.trim().split(/[\s,]+/).map(Number); if (n && n.length === 4 && n.every((x) => x >= 0) && n.some((x) => x > 0)) { window.__stats.setPesos(n[0], n[1], n[2], n[3]); anotar(window.__stats.texto()); } else anotar('Proporción no válida, no cambió nada');
      }
      if (a === 'r1' || a === 'r2' || a === 'r3' || a === 'r4') {
        if (!window.__ciclo) return anotar('ciclo.js no cargó');
        const r = window.__ciclo.grabarRuta(a === 'r1' ? 'arana' : a === 'r2' ? 'devias3' : a === 'r3' ? 'lt7' : 'aida');
        anotar(r.ok ? 'GRABANDO camino desde mapa ' + r.mapa + ' (' + r.x + ',' + r.y + '). Caminá hasta el spot y tocá "PARAR y guardar"' : 'No pude: ' + r.motivo);
      }
      if (a === 'ms1' || a === 'msg' || a === 'msp' || a === 'msv' || a === 'mson' || a === 'msoff' || a === 'msw' || a === 'msx') {
        const C = window.__ciclo; if (!C || !C.miSpot) return anotar('ciclo.js no cargó (recargá la extensión)');
        const MS = C.miSpot;
        if (a === 'ms1') {
          const r = MS.guardar();
          if (r.ok && r.candidatos && r.candidatos.length > 1 && !r.aprendido) {      // varios /move para el mismo mapa (ej. RuinasKanturu1/2/3 con puertas distintas): que elija el que usa
            const n = prompt('Hay varios /move para este mapa. ¿Con cuál entrás a este spot? Escribí el número:\n' + r.candidatos.map((c, i) => (i + 1) + ') ' + c).join('\n'), String(Math.max(1, r.candidatos.indexOf(r.warp) + 1)));
            const k = n == null ? 0 : parseInt(n, 10); if (k >= 1 && k <= r.candidatos.length) { MS.setWarp(r.candidatos[k - 1]); r.warp = r.candidatos[k - 1]; }
          }
          return anotar(r.ok ? 'Mi spot guardado: mapa ' + r.mapa + (r.nombre ? ' (' + r.nombre + ')' : '') + ' en (' + r.x + ',' + r.y + ')' + (r.warp ? ' · /move "' + r.warp + '"' : ' · no encontré el /move de este mapa (si reaparecés en otro mapa, usá "Nombre del /move")') + ' · conviene grabar el camino desde donde reaparecés' : 'No pude: ' + r.motivo); }
        if (a === 'msg') { const r = C.grabarRuta('mispot'); return anotar(r.ok ? 'GRABANDO el camino a Mi spot desde (' + r.x + ',' + r.y + ') del mapa ' + r.mapa + '. Caminá hasta el spot y tocá "Parar camino"' : 'No pude: ' + r.motivo); }
        if (a === 'msp') { const r = C.pararRuta(); return anotar(r.ok ? 'Camino guardado (' + r.clave + '): ' + r.puntos + ' puntos, de (' + r.inicio.x + ',' + r.inicio.y + ') a (' + r.fin.x + ',' + r.fin.y + ')' : r.motivo); }
        if (a === 'msv') { anotar('Volviendo a mi spot…'); const r = await MS.volver('a pedido'); return anotar(r.ok ? 'Listo: en mi spot (' + r.x + ',' + r.y + ')' : 'No pude: ' + (r.motivo || 'no llegué')); }
        if (a === 'mson' || a === 'msoff') MS.auto(a === 'mson');
        if (a === 'msw') { const n = prompt('Nombre exacto del /move del mapa del spot (ej. Aida):', (MS.datos().sp && MS.datos().sp.warp) || ''); if (n == null) return; const r = MS.setWarp(n); return anotar(r.ok ? '/move del spot: ' + (r.warp || '(ninguno)') : r.motivo); }
        return anotar(MS.texto());
      }
      if (a === 'rp') { if (!window.__ciclo) return; const r = window.__ciclo.pararRuta(); anotar(r.ok ? 'Camino guardado (' + r.clave + '): ' + r.puntos + ' puntos, de (' + r.inicio.x + ',' + r.inicio.y + ') a (' + r.fin.x + ',' + r.fin.y + ')' : r.motivo); }
      if (a === 'rx') { if (!window.__ciclo) return; await bajarJson({ hora: new Date().toISOString(), spots: window.__etapas.todo(), caminos: window.__ciclo.rutas() }, 'caminos.json'); anotar('caminos.json bajado'); }
      if (a === 'r0') anotar(window.__ciclo ? window.__ciclo.textoRutas() : 'ciclo.js no cargó');
      if (a === 'sh1' || a === 'sh0') {
        if (!window.__piloto) return anotar('piloto.js no cargó');
        window.__piloto.setShift(a === 'sh1'); anotar(a === 'sh1' ? 'Shift ON: el piloto mantiene Shift apretado (en MU, Shift + clic ataca sin moverse)' : 'Shift OFF');
      }
      if (a === 'cbaj') { bajarCajaConRuta('Bajar caja'); }
      if (a === 'cmar') { if (window.__caja) window.__caja.marcar('MARCA: el usuario dice que ahora está mal'); anotar('Marca guardada a las ' + new Date().toLocaleTimeString('es-AR', { hour12: false })); }
      if (a === 'bahora') { const x = window.__bichos && window.__bichos.ahora(); if (!x) return anotar('bichos.js no cargó'); anotar('BICHOS AHORA · héroe (' + x.heroe + ') mapa ' + x.mapa + ' · ' + JSON.stringify(x.validacion)); x.cercanos.forEach((c) => anotar('  tipo ' + c.tipo + ' en (' + c.x + ',' + c.y + ') a ' + c.d + ' casillas · aviso hace ' + c.hace_s + ' s')); }
      if (a === 'bic') anotar(window.__bichos ? window.__bichos.texto() : 'bichos.js no cargó');
      if (a === 'bicx' && window.__bichos) { await bajarJson({ hora: new Date().toISOString(), validacion: window.__bichos.validacion(), zonas: window.__bichos.datos() }, 'datos_bichos.json'); anotar('datos_bichos.json bajado'); }
      if (a === 'paq' && window.__paquetes) { await bajarJson(window.__paquetes.informe(), 'informe_paquetes.json'); anotar('informe_paquetes.json bajado'); }
      if (a === 'joyr') {
        if (!window.__joyas) return anotar('joyas.js no cargó');
        const r = window.prompt('Retirar del banco: joya (0 Bless, 1 Soul, 2 Chaos, 3 Life, 4 Creation, 5 Guardian, 6 Gemstone, 7 Harmony, 8 Lower refine, 9 Higher refine, 10 Socket, 11 Rare), cantidad y formato (0 sueltas, 1 packs). Ej: 0 100 0', '0 100 0');
        const n = r && r.trim().split(/[\s,]+/).map(Number);
        if (!n || n.length < 2 || n.some(isNaN)) return anotar('Cancelado o formato no válido');
        const x = window.__joyas.retirar(n[0], n[1], n[2] || 0);
        anotar(x.ok ? 'Retiro pedido: ' + window.__joyas.nombres[n[0]] + ' x' + n[1] + '…' : 'No retiré: ' + x.motivo); if (x.ok) { setTimeout(() => anotar(window.__joyas.resumen()), 2500); setTimeout(() => anotar(window.__joyas.resumen()), 6000); }
        return;
      }
      if (a === 'grp') {
        if (!window.__grupo) return anotar('grupo.js no cargó');
        const c = window.__grupo.candidatos(); if (!c.length) return anotar('No hay nadie para invitar (sin jugadores cerca, ya en tu grupo, PK, o invitados hace menos de 10 min)');
        if (!window.confirm('¿Invitar a party a: ' + c.map((x) => x.nombre).join(', ') + '?')) return anotar('Cancelado');
        anotar('Invitando a ' + c.length + '…'); const r = await window.__grupo.invitar(c); anotar(r.ok ? window.__grupo.resumen() : 'No invité: ' + r.motivo); return;
      }
      if (a === 'grv') { anotar(window.__grupo ? window.__grupo.ver() : 'grupo.js no cargó'); return; }
      if (a === 'jug') {
        const f = window.Module && window.Module._MuWebGetCommandablePlayersUtf8; let t = '';
        try { const p = f ? f() | 0 : 0; t = p ? window.Module.UTF8ToString(p) : '(vacío)'; } catch (e) { t = 'error: ' + e; }
        anotar('Jugadores cerca según el juego: ' + t.slice(0, 400)); return;
      }
      if (a === 'joy' || a === 'joyd') {
        if (!window.__joyas) return anotar('joyas.js no cargó');
        const ok = window.__joyas.mandar(a === 'joy' ? 's' : 'a');
        anotar(ok ? 'comando enviado…' : 'no se pudo enviar (¿ocupado?)');
        setTimeout(() => anotar(window.__joyas.resumen()), 2500);
        if (a === 'joyd') setTimeout(() => { window.__joyas.mandar('s'); setTimeout(() => anotar(window.__joyas.resumen()), 2500); }, 3000);
        if (a === 'joy') setTimeout(() => anotar(JSON.stringify(window.__joyas.estado())), 3000);
      }
    };
  }
  // ---- TECLAS RÁPIDAS: F6 sacar joyas del banco · F7 invitar a party a los cercanos · F8 Sostenida ON/OFF · F9 bajar la caja negra ----
  // Se escuchan en la fase de captura de la ventana: el juego y el navegador no las ven (F6 mueve el foco a la barra de direcciones y F7 pregunta por la
  // navegación con cursor si no se frenan). No actúan con Ctrl/Alt/Shift, con el chat escribiendo, ni con "Teclas OFF" (Lab > Opciones).
  const KEY_TK = 'muTeclasV1'; let TK = { on: true, packs: false };
  try { const g = JSON.parse(localStorage.getItem(KEY_TK) || 'null'); if (g) TK = { ...TK, ...g }; } catch (e) { /* nada */ }
  const guardarTK = () => { try { localStorage.setItem(KEY_TK, JSON.stringify(TK)); } catch (e) { /* nada */ } };
  const dormirTK = (ms) => new Promise((r) => setTimeout(r, ms));
  function toast(t) {
    try {
      let e = document.getElementById('lab-toast');
      if (!e) { e = document.createElement('div'); e.id = 'lab-toast'; e.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#000d;color:#fff;font:600 14px sans-serif;padding:6px 14px;border-radius:8px;pointer-events:none;border:1px solid #6fe0ff88;max-width:80vw;text-align:center'; (document.body || document.documentElement).appendChild(e); }
      e.textContent = t; e.style.display = 'block'; clearTimeout(e._t); e._t = setTimeout(() => { e.style.display = 'none'; }, 3500);
    } catch (e) { /* nada */ }
  }
  const aviso = (t) => { toast(t); anotar(t); };
  let ocupadoTK = false;
  async function teclaF6() {
    const J = window.__joyas; if (!J) return aviso('F6: joyas.js no cargó');
    if (ocupadoTK) return aviso('F6: ya estoy sacando joyas');
    ocupadoTK = true;
    try {
      // 10 sueltas de cada una; en modo "packs": 1 pack (de 10) de Bless y de Soul + 10 Chaos sueltas (para la receta de alas Evo 3)
      const plan = TK.packs ? [[0, 1, 1, '1 pack de Bless'], [1, 1, 1, '1 pack de Soul'], [2, 10, 0, '10 Chaos']] : [[0, 10, 0, '10 Bless'], [1, 10, 0, '10 Soul'], [2, 10, 0, '10 Chaos']];
      for (const [idx, cant, fmt, nombre] of plan) {
        let r = null;
        for (let i = 0; i < 25; i++) { r = J.retirar(idx, cant, fmt); if (r.ok || !/ocupado/.test(r.motivo || '')) break; await dormirTK(700); }
        if (!r || !r.ok) return aviso('F6: no saqué ' + nombre + ': ' + (r && r.motivo));
        aviso('F6: pedí ' + nombre + '…'); await dormirTK(1200);
      }
      await dormirTK(1500); aviso('F6: listo · ' + J.resumen());
    } finally { ocupadoTK = false; }
  }
  async function teclaF7() {
    const G = window.__grupo; if (!G) return aviso('F7: grupo.js no cargó');
    const c = G.candidatos(); if (!c.length) return aviso('F7: no hay nadie para invitar (sin jugadores cerca, ya en tu grupo, PK, o invitados hace menos de 10 min)');
    aviso('F7: invitando a ' + c.map((x) => x.nombre).join(', ') + '…');
    const r = await G.invitar(c); aviso(r.ok ? 'F7: ' + G.resumen() : 'F7: no invité: ' + r.motivo);
  }
  function teclaF8() {
    const Mo = window.__modo; if (!Mo) return aviso('F8: modo.js no cargó');
    const on = Mo.deseado() === 'sostener';
    Mo.fijar(on ? 'manual' : 'sostener', 'botón (tecla F8)');        // igual que los botones Sostenida / Nada (Sostenida también va al ancla)
    aviso('F8: Sostenida ' + (on ? 'APAGADA (Nada)' : 'ENCENDIDA'));
  }
  // Baja la caja negra y, cuando termina la descarga, copia al portapapeles la ruta completa del archivo (entre comillas) para pegársela directo a Claude.
  let esperaRuta = 0, ultRuta = '', ultRutaT = 0;
  function bajarCajaConRuta(tag) {
    if (!window.__caja) return aviso(tag + ': caja.js no cargó');
    const r = window.__caja.bajar(); esperaRuta = Date.now();
    aviso(tag + ': caja negra bajada (' + r.kb + ' KB, ' + r.muestras + ' muestras) · esperando la ruta…');
    setTimeout(() => { if (esperaRuta && Date.now() - esperaRuta >= 7500) { esperaRuta = 0; aviso(tag + ': bajó, pero no me llegó la ruta (si Chrome pidió permiso de descargas, aceptalo; recargá la extensión)'); } }, 8000);
  }
  function teclaF9() { bajarCajaConRuta('F9'); }
  function teclaF10() {
    const A = window.__agresor; if (!A || !A.pvp) return aviso('F10: agresor.js no cargó (recargá la extensión)');
    const on = A.pvp();
    aviso(on ? 'F10: PVP ENCENDIDO: ataco a un jugador al azar de la pantalla con pulsos de 10 ms (F10 de nuevo para apagar)' : 'F10: PVP APAGADO');
  }
  async function copiarTexto(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* sin foco o sin permiso: se prueba el método viejo */ }
    try { const a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;left:-9999px;top:0'; (document.body || document.documentElement).appendChild(a); a.focus(); a.select(); const ok = document.execCommand('copy'); a.remove(); return !!ok; } catch (e) { return false; }
  }
  const ACtk = new AbortController(); (window.__muLimpiar = window.__muLimpiar || []).push(() => ACtk.abort());
  const TECLAS = { F6: teclaF6, F7: teclaF7, F8: teclaF8, F9: teclaF9, F10: teclaF10 };
  window.addEventListener('keydown', (e) => {
    try {
      const f = TECLAS[e.key]; if (!f || !TK.on || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      if (call('TextInputActive') === 1) { if (e.key === 'F8') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) toast('F8 ignorada: el cuadro de chat del juego está abierto (Esc o Enter para cerrarlo y volvé a apretar)'); } return; }
      e.preventDefault(); e.stopImmediatePropagation(); if (e.repeat) return;
      Promise.resolve().then(f).catch((x) => anotar(e.key + ': error ' + String(x && x.message || x).slice(0, 80)));
    } catch (x) { /* nada */ }
  }, { capture: true, signal: ACtk.signal });
  window.addEventListener('message', (e) => {
    try {
      if (e.source !== window || !e.data || !e.data.__muvigiaRuta) return;
      const ruta = String(e.data.__muvigiaRuta); if (ruta === ultRuta && Date.now() - ultRutaT < 4000) return;     // el puente puede estar inyectado dos veces tras una recarga en caliente
      ultRuta = ruta; ultRutaT = Date.now(); esperaRuta = 0;
      copiarTexto('"' + ruta + '"').then((ok) => aviso(ok ? 'Ruta copiada: ' + ruta : 'Ruta (no pude copiarla sola, copiala a mano): ' + ruta));
    } catch (x) { /* nada */ }
  }, { signal: ACtk.signal });
  window.__lab = { lectura, teclas: TECLAS };
  const ini = () => setTimeout(armar, 2000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ini); else ini();
})();
