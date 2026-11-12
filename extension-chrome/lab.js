// Lab (v0.84.0, versión mínima): solo lo que se usa y está probado. Arriba a la izquierda. La versión completa quedó en ..\respaldo_lab_0.83.2\lab.js
// Lo que se sacó del panel NO se borró del motor: sigue andando con sus valores de fábrica (pulso, pociones rápidas, cartel rojo, destrabar, saltar, etc.).
(() => {
  'use strict';
  // Recarga en caliente: los intervalos se registran para poder cortarlos al reinyectar el módulo sin recargar la página (ver background.js)
  const setInterval = (f, ms) => { const id = window.setInterval(f, ms); (window.__muIds = window.__muIds || []).push(id); return id; };
  const M = () => window.Module;
  const seguro = (f, d) => { try { return f(); } catch (e) { return d === undefined ? 'ERR ' + String(e && e.message || e).slice(0, 60) : d; } };
  const call = (n, ...a) => seguro(() => { const f = M()['_MuWeb' + n]; return typeof f === 'function' ? f(...a) : 'no existe'; });
  // El Vigía (abajo) se sube SUBE píxeles para no tapar el chat del juego (valor que el usuario ya había dejado guardado; ya no hay flechas para moverlo).
  let SUBE = 170; try { const g = JSON.parse(localStorage.getItem('muPanelV1') || 'null'); if (g && Number.isFinite(g.sube)) SUBE = Math.max(0, Math.min(900, g.sube)); } catch (e) { /* nada */ }
  const sal = [];   // últimos resultados que se muestran en el panel
  const anotar = (t) => { sal.unshift(new Date().toLocaleTimeString('es-AR', { hour12: false }) + ' ' + t); sal.length = Math.min(sal.length, 3); pintar(); };

  // ---- spots de las etapas del ciclo (los lee ciclo.js y la caja negra; ya no hay botones para guardarlos) ----
  const KEY_ETAPAS = 'muEtapasV1';
  const leerEtapas = () => { try { return JSON.parse(localStorage.getItem(KEY_ETAPAS) || '{}'); } catch (e) { return {}; } };
  const guardarEtapa = (clave) => {
    const o = leerEtapas(); o[clave] = { mapa: call('GetMapIndex'), x: call('GetHeroX'), y: call('GetHeroY'), nivel: call('GetPlayerLevel'), hora: new Date().toISOString() };
    try { localStorage.setItem(KEY_ETAPAS, JSON.stringify(o)); } catch (e) { /* nada */ }
    return o[clave];
  };
  window.__etapas = { todo: leerEtapas, guardar: guardarEtapa };

  async function bajarJson(o, nombre) {
    const txt = JSON.stringify(o, null, 1);
    try { await navigator.clipboard.writeText(txt); } catch (e) { /* sin portapapeles */ }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = nombre; a.click();
  }

  // ---- panel ----
  let caja = null;
  const G = () => window.__grupo;
  const estados = () => ({
    sost: !!(window.__modo && window.__modo.deseado() === 'sostener'),
    sum: !!(G() && G().summonChat && G().summonChat.stats().activo),
    buf: !!(G() && G().buff && G().buff.on()),
  });
  setInterval(() => {
    if (!caja) return;
    try {
      const lv = call('GetPlayerLevel'), pm = call('GetExperiencePermille');
      const n = caja.querySelector('#lab-nivel'), br = caja.querySelector('#lab-barra');
      if (n && typeof lv === 'number' && typeof pm === 'number') {
        const Mo = window.__modo, nph = Mo && Mo.nivelesPorHora ? Mo.nivelesPorHora() : null, spn = Mo && Mo.segPorNivel ? Mo.segPorNivel() : null, mpm = Mo && Mo.muertesPorMin ? Mo.muertesPorMin() : null;
        const ml = lv >= 400 ? (Mo && Mo.nivelMaster ? Mo.nivelMaster() : call('GetMasterLevel')) : null;
        n.textContent = 'Nv ' + lv + (ml ? ' · M' + ml : '') + (pm < 999 ? ' · ' + (pm / 10).toFixed(1) + ' %' : '') + (nph != null && nph > 0 ? ' · ' + nph + (ml ? ' master/h' : ' niv/h') + (spn ? ' (' + spn + ' s)' : '') : '') + (mpm != null ? ' · ' + mpm + ' mat/min' : '');
        if (br) br.style.width = Math.max(0, Math.min(100, pm / 10)) + '%';
      }
      const v = document.getElementById('vigia-panel'); if (v) v.style.bottom = (60 + SUBE) + 'px';
      const e = estados();
      for (const [k, on] of [['sost', e.sost], ['sum', e.sum], ['buf', e.buf]]) { const b = caja.querySelector('[data-a="t_' + k + '"]'); if (b) b.classList.toggle('on', on); }
    } catch (e) { /* nada */ }
  }, 500);
  function pintar() {
    const l = caja && caja.querySelector('#lab-out'); if (!l) return;
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    l.style.display = sal.length ? 'block' : 'none';
    l.innerHTML = sal.map((x, i) => { const h = x.slice(0, 8), t = x.slice(9); return '<div style="padding:1px 0;' + (i ? 'opacity:.78' : 'font-weight:600') + '"><span style="color:#6fe0ff">' + esc(h) + '</span> <span style="color:' + (/no |falt|error|fall|cancel/i.test(t) ? '#ff9a8a' : '#f2fff2') + '">' + esc(t) + '</span></div>'; }).join('');
  }
  function armar() {
    (window.__muLimpiar = window.__muLimpiar || []).push(() => { const p = document.getElementById('lab-panel'); if (p) p.remove(); });
    if (document.getElementById('lab-panel')) return;
    caja = document.createElement('div'); caja.id = 'lab-panel';
    // arriba a la izquierda, justo debajo del cuadro de la mascota (el chat del juego queda libre mientras "Más" está cerrado)
    caja.style.cssText = 'position:fixed;left:6px;top:96px;z-index:2147483647;font:11px sans-serif;background:#0b1d3aea;color:#fff;padding:4px 7px;border-radius:6px;width:286px;max-width:92vw;max-height:70vh;overflow-y:auto';
    caja.innerHTML = `<style>#lab-panel button{font:11px sans-serif;padding:2px 7px;margin:1px 2px 1px 0;border:1px solid #ffffff33;border-radius:4px;background:#1c2f55;color:#fff;cursor:pointer}#lab-panel button.on{background:#1f8f4a;border-color:#52e08a}#lab-panel button:hover{filter:brightness(1.25)}#lab-panel details{margin-top:3px}#lab-panel summary{cursor:pointer;opacity:.85}#lab-panel .f{margin:2px 0}#lab-panel b{opacity:.9}</style>
      <div style="display:flex;align-items:center;gap:6px"><b>Lab</b><small style="opacity:.6">${window.__muVersionHot ? 'v' + window.__muVersionHot : ''}</small><span id="lab-nivel" style="margin-left:auto;font-weight:600;text-align:right"></span><button data-a="min" title="Achicar / agrandar">_</button></div>
      <div style="height:3px;background:#1c2f55;border-radius:2px;margin:2px 0 3px"><div id="lab-barra" style="height:3px;width:0;background:#6fe0ff;border-radius:2px"></div></div>
      <div id="lab-cuerpo">
      <div id="lab-out" style="display:none;margin:0 0 3px;padding:3px 5px;background:#000d;border:1px solid #6fe0ff55;border-radius:4px;font-size:11px;line-height:1.3;max-height:60px;overflow:auto"></div>
      <div class="f"><button data-a="t_sost" title="Sostenida prendida / apagada (tecla F8)">Sostenida F8</button><button data-a="t_sum" title="Summon cuando alguien de tu party escribe summon / jala (demora de 2 a 6 s)">Summon</button><button data-a="t_buf" title="Mantiene puesto el buff de crítico">Buff crítico</button><button data-a="hab" title="Cambia la habilidad con la que pega la Sostenida: Fire Burst (508, la de siempre) → Chaotic Diseier (238, de área, gasta AG) → Fire Scream (78). No se guarda: al recargar vuelve a Fire Burst">Habilidad: …</button><button data-a="cbaj" title="Baja la caja negra y copia la ruta (tecla F9)">⬇ Caja F9</button></div>
      <details><summary>Más</summary>
        <div class="f"><b>Mi spot</b> <button data-a="sp_g" title="Guarda el mapa y la casilla donde estás parado. Si morís vuelve solo">Guardar acá</button><button data-a="sp_r" title="Grabá el camino UNA vez: tocá esto donde reaparecés, caminá hasta el spot y tocá Parar camino">Grabar camino</button><button data-a="sp_p">Parar camino</button><button data-a="sp_v" title="Vuelve ahora al spot guardado">Volver ahora</button><button data-a="sp_on">Al morir: ON</button><button data-a="sp_off">OFF</button><button data-a="sp_x">Ver</button></div>
        <div class="f"><b>Party</b> <button data-a="grp" title="Invita a los de cerca (tecla F7). Los de tu clan entran siempre, sean PK o no">Invitar cercanos F7</button><button data-a="grv">Ver grupo</button><button data-a="aic" title="Si soy líder del grupo, hay lugar y se acerca alguien de tu CLAN que no está en el grupo, lo invita solo (de a uno). Si el grupo se desarma después de invitar, se apaga solo. Apagado de fábrica">Auto-invitar clan: …</button></div>
        <div class="f"><b>Joyas</b> <button data-a="joy">Ver</button><button data-a="joyd">Depositar</button><button data-a="joyr">Retirar…</button> <button data-a="f6s" title="F6: 10 Bless, 10 Soul y 10 Chaos sueltas">F6 sueltas</button><button data-a="f6p" title="F6: 1 pack de Bless, 1 de Soul y 10 Chaos sueltas">F6 packs</button></div>
        <div class="f"><b>Probar</b> <button data-a="scp" title="Tira Summon ahora">Summon</button><button data-a="bfp" title="Lanza el buff de crítico ahora">Buff</button><button data-a="cmar" title="Deja una marca en la caja negra">Marcar: está mal</button></div>
        <div class="f"><b>Puntos</b> <button data-a="pt_m" title="Reparto por metas: VIT y AGI hasta 65.000, STR y ENE hasta 65.000 (50/50 si faltan puntos), 500 de Comando y TODO lo que sobre a Comando (por chat, cuando juntan 200 o más). Rige desde el próximo reparto (el del reset)">Metas: 65k a todos / resto a Comando</button><button data-a="pt_n" title="Cambiar los números de las metas">Cambiar…</button><button data-a="pt_o" title="Vuelve al reparto proporcional de antes (STR 33 / AGI 21 / VIT 7,5 / ENE 39 %)">Reparto anterior</button><button data-a="pt_v">Ver</button> <button data-a="pt_on">Auto ON</button><button data-a="pt_off">OFF</button></div>
        <div class="f"><b>PVP con el mouse</b> <button data-a="pvm" title="Ataca al jugador que tengas más cerca del puntero (nunca a tu party ni a tu clan). Es lo mismo que la tecla 0">Prender / apagar (tecla 0)</button></div>
        <div class="f"><b>PVP a uno solo</b> <button data-a="pvu" title="Te pide el nombre y ataca SOLO a ese jugador (nunca a otro, ni a tu party/clan). Apretalo de nuevo para apagar">Elegir nombre…</button></div>
        <div class="f"><b>A quién ataqué</b> <button data-a="atq" title="Últimos jugadores a los que les tiraste hechizos (nombre, cuántos, si murió, de tu party/clan). Queda guardado aunque recargues; la lista completa va en la caja negra">Ver</button></div>
      </details></div>`;
    (document.body || document.documentElement).appendChild(caja);
    caja.onclick = async (e) => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'min') { const c = caja.querySelector('#lab-cuerpo'); c.hidden = !c.hidden; return; }
      if (a === 't_sost') return teclaF8();
      if (a === 'hab') { const Mo = window.__modo; if (!Mo || !Mo.setHabilidad) return anotar('modo.js no cargó (recargá la extensión)'); const ORD = [508, 238, 78], NOM = { 508: 'Fire Burst', 238: 'Chaotic Diseier', 78: 'Fire Scream' }; const sig = ORD[(ORD.indexOf(Mo.habilidad()) + 1) % ORD.length]; const ok = Mo.setHabilidad(sig); return toast('Habilidad de la Sostenida: ' + NOM[sig] + (ok ? '' : ' (OJO: el juego no la dejó elegir)') + '. No se guarda: al recargar vuelve a Fire Burst'); }
      if (a === 't_sum') { const g = G(); if (!g || !g.summonChat) return anotar('grupo.js no cargó (recargá la extensión)'); const on = !g.summonChat.stats().activo; g.summonChat.on(on); return toast('Summon por chat: ' + (on ? 'ON' : 'OFF')); }
      if (a === 't_buf') { const g = G(); if (!g || !g.buff) return anotar('grupo.js no cargó (recargá la extensión)'); const on = !g.buff.on(); g.buff.on(on); return toast('Buff de crítico: ' + (on ? 'ON' : 'OFF')); }
      if (a === 'cbaj') return bajarCajaConRuta('Bajar caja');
      if (a === 'cmar') { if (window.__caja) window.__caja.marcar('MARCA: el usuario dice que ahora está mal'); return anotar('Marca guardada a las ' + new Date().toLocaleTimeString('es-AR', { hour12: false })); }
      if (a === 'scp') { const g = G(); if (!g) return anotar('grupo.js no cargó'); anotar('Tirando Summon…'); const r = await g.invocar('prueba del Lab'); return anotar(r.ok ? 'Summon lanzado (' + r.via + ')' : 'No salió: ' + (r.motivo || 'el enfriamiento no arrancó (mirá mana, Comando y que tengas la habilidad)')); }
      if (a === 'bfp') { const g = G(); if (!g || !g.buff) return anotar('grupo.js no cargó'); anotar('Lanzando el buff de crítico…'); const r = await g.buff.lanzar('prueba del Lab'); return anotar(r.ok ? 'Buff lanzado (' + r.via + ')' : 'No salió: ' + (r.motivo || 'no se vio ningún efecto ni hechizo enviado (mirá mana, Comando y la habilidad)')); }
      if (a === 'pvm') { const A = window.__agresor; if (!A || !A.pvpRaton) return anotar('agresor.js no cargó (recargá la extensión)'); return toast(A.pvpRaton() ? 'PVP con el mouse ENCENDIDO' : 'PVP con el mouse APAGADO'); }
      if (a === 'pvu') { const A = window.__agresor; if (!A || !A.pvpUno) return anotar('agresor.js no cargó (recargá la extensión)'); if (A.pvpOn()) { A.pvp(false); return toast('PVP apagado'); } let u = ''; try { u = localStorage.getItem('muPvpUnoV1') || ''; } catch (e) { /* nada */ } const n = window.prompt('¿A qué jugador atacar? (solo a ese; tiene que estar cerca)', u); if (!n || !n.trim()) return anotar('PVP a uno: cancelado'); try { localStorage.setItem('muPvpUnoV1', n.trim()); } catch (e) { /* nada */ } A.pvpUno(n); return toast('PVP a ' + n.trim() + ': lo busco en pantalla (apretá de nuevo para apagar)'); }
      if (a === 'atq') { const A = window.__agresor; return anotar(A && A.ataquesTexto ? A.ataquesTexto(4) : 'agresor.js no cargó (recargá la extensión)'); }
      if (a.startsWith('pt_')) {
        const S = window.__stats; if (!S) return anotar('stats.js no cargó (recargá la extensión)');
        if (a === 'pt_on' || a === 'pt_off') S.activar(a === 'pt_on');
        if (a === 'pt_m') S.setMetas(65000, 65000, 50, 50); S.restoCmd(true);
        if (a === 'pt_o') S.setModo('pesos');
        if (a === 'pt_n') {
          const c = S.cfg, r = window.prompt('Metas de puntos: AGI total, VIT total, % de STR y % de ENE del resto (el Comando se maneja aparte). Ej: 65000 65000 50 50', [c.metas.agi, c.metas.vit, c.resto.str, c.resto.ene].join(' '));
          const n = r && r.trim().split(/[\s,]+/).map(Number); if (!n || n.length < 4 || n.some((x) => !(x >= 0)) || n[2] + n[3] <= 0) return anotar('Cancelado o formato no válido');
          S.setMetas(n[0], n[1], n[2], n[3]);
        }
        return anotar(S.texto());
      }
      if (a === 'grp') return teclaF7();
      if (a === 'aic') { const g = G(); if (!g || !g.autoClan) return anotar('grupo.js no cargó (recargá la extensión)'); const on = !g.autoClan.on(); g.autoClan.on(on); return toast('Auto-invitar clan: ' + (on ? 'ENCENDIDO (si soy líder y hay lugar, invita a los del clan que se acerquen)' : 'APAGADO')); }
      if (a === 'grv') return anotar(G() ? G().ver() : 'grupo.js no cargó');
      if (a === 'f6s' || a === 'f6p') { TK.packs = a === 'f6p'; guardarTK(); return anotar('F6 saca ' + (TK.packs ? '1 pack de Bless, 1 pack de Soul y 10 Chaos' : '10 Bless, 10 Soul y 10 Chaos sueltas')); }
      if (a === 'joy' || a === 'joyd') {
        if (!window.__joyas) return anotar('joyas.js no cargó');
        const ok = window.__joyas.mandar(a === 'joy' ? 's' : 'a');
        anotar(ok ? 'comando enviado…' : 'no se pudo enviar (¿ocupado?)');
        setTimeout(() => anotar(window.__joyas.resumen()), 2500);
        if (a === 'joyd') setTimeout(() => { window.__joyas.mandar('s'); setTimeout(() => anotar(window.__joyas.resumen()), 2500); }, 3000);
        return;
      }
      if (a === 'joyr') {
        if (!window.__joyas) return anotar('joyas.js no cargó');
        const r = window.prompt('Retirar del banco: joya (0 Bless, 1 Soul, 2 Chaos, 3 Life, 4 Creation, 5 Guardian, 6 Gemstone, 7 Harmony, 8 Lower refine, 9 Higher refine, 10 Socket, 11 Rare), cantidad y formato (0 sueltas, 1 packs). Ej: 0 100 0', '0 100 0');
        const n = r && r.trim().split(/[\s,]+/).map(Number);
        if (!n || n.length < 2 || n.some(isNaN)) return anotar('Cancelado o formato no válido');
        const x = window.__joyas.retirar(n[0], n[1], n[2] || 0);
        anotar(x.ok ? 'Retiro pedido: ' + window.__joyas.nombres[n[0]] + ' x' + n[1] + '…' : 'No retiré: ' + x.motivo); if (x.ok) { setTimeout(() => anotar(window.__joyas.resumen()), 2500); setTimeout(() => anotar(window.__joyas.resumen()), 6000); }
        return;
      }
      if (a.startsWith('sp_')) {
        const C = window.__ciclo; if (!C || !C.miSpot) return anotar('ciclo.js no cargó (recargá la extensión)');
        const MS = C.miSpot;
        if (a === 'sp_g') {
          const r = MS.guardar();
          if (r.ok && r.candidatos && r.candidatos.length > 1 && !r.aprendido) {      // varios /move para el mismo mapa: que elija el que usa
            const n = prompt('Hay varios /move para este mapa. ¿Con cuál entrás a este spot? Escribí el número:\n' + r.candidatos.map((c, i) => (i + 1) + ') ' + c).join('\n'), String(Math.max(1, r.candidatos.indexOf(r.warp) + 1)));
            const k = n == null ? 0 : parseInt(n, 10); if (k >= 1 && k <= r.candidatos.length) { MS.setWarp(r.candidatos[k - 1]); r.warp = r.candidatos[k - 1]; }
          }
          return anotar(r.ok ? 'Mi spot guardado: mapa ' + r.mapa + (r.nombre ? ' (' + r.nombre + ')' : '') + ' en (' + r.x + ',' + r.y + ')' + (r.warp ? ' · /move "' + r.warp + '"' : ' · no encontré el /move de este mapa') + ' · conviene grabar el camino desde donde reaparecés' : 'No pude: ' + r.motivo);
        }
        if (a === 'sp_r') { const r = C.grabarRuta('mispot'); return anotar(r.ok ? 'GRABANDO el camino a Mi spot desde (' + r.x + ',' + r.y + ') del mapa ' + r.mapa + '. Caminá hasta el spot y tocá "Parar camino"' : 'No pude: ' + r.motivo); }
        if (a === 'sp_p') { const r = C.pararRuta(); return anotar(r.ok ? 'Camino guardado (' + r.clave + '): ' + r.puntos + ' puntos, de (' + r.inicio.x + ',' + r.inicio.y + ') a (' + r.fin.x + ',' + r.fin.y + ')' : r.motivo); }
        if (a === 'sp_v') { anotar('Volviendo a mi spot…'); const r = await MS.volver('a pedido'); return anotar(r.ok ? 'Listo: en mi spot (' + r.x + ',' + r.y + ')' : 'No pude: ' + (r.motivo || 'no llegué')); }
        if (a === 'sp_on' || a === 'sp_off') MS.auto(a === 'sp_on');
        return anotar(MS.texto());
      }
    };
  }

  // ---- TECLAS RÁPIDAS: F6 sacar joyas del banco · F7 invitar a party · F8 Sostenida ON/OFF · F9 bajar la caja negra · F10 PVP al azar · 0 PVP con el mouse ----
  // Se escuchan en la fase de captura de la ventana: el juego y el navegador no las ven. No actúan con Ctrl/Alt/Shift ni con el chat escribiendo.
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
    const g = G(); if (!g) return aviso('F7: grupo.js no cargó');
    const c = g.candidatos(); if (!c.length) return aviso('F7: no hay nadie para invitar (sin jugadores cerca, ya en tu grupo, PK que no es del clan, o invitados hace menos de 10 min)');
    aviso('F7: invitando a ' + c.map((x) => x.nombre).join(', ') + '…');
    const r = await g.invitar(c); aviso(r.ok ? 'F7: ' + g.resumen() : 'F7: no invité: ' + r.motivo);
  }
  function teclaF8() {
    const Mo = window.__modo; if (!Mo) return aviso('F8: modo.js no cargó');
    const on = Mo.deseado() === 'sostener';
    Mo.fijar(on ? 'manual' : 'sostener', 'botón (tecla F8)');        // Sostenida también va al ancla (donde la prendés)
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
  function teclaCero() {
    const A = window.__agresor; if (!A || !A.pvpRaton) return aviso('0: agresor.js no cargó (recargá la extensión)');
    const on = A.pvpRaton();
    aviso(on ? '0: PVP CON EL MOUSE ENCENDIDO: ataco al jugador que tengas más cerca del puntero (nunca party/clan). 0 de nuevo para apagar' : '0: PVP CON EL MOUSE APAGADO');
  }
  async function copiarTexto(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* sin foco o sin permiso: se prueba el método viejo */ }
    try { const a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;left:-9999px;top:0'; (document.body || document.documentElement).appendChild(a); a.focus(); a.select(); const ok = document.execCommand('copy'); a.remove(); return !!ok; } catch (e) { return false; }
  }
  const ACtk = new AbortController(); (window.__muLimpiar = window.__muLimpiar || []).push(() => ACtk.abort());
  const TECLAS = { F6: teclaF6, F7: teclaF7, F8: teclaF8, F9: teclaF9, F10: teclaF10, '0': teclaCero };
  window.addEventListener('keydown', (e) => {
    try {
      const f = TECLAS[e.key]; if (!f || !TK.on || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      if (e.key === '0') { const t = e.target, tg = t && t.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT' || (t && t.isContentEditable)) return; }      // el 0 también se escribe en cuadros de texto de la página
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
  window.__lab = { teclas: TECLAS };
  const ini = () => setTimeout(armar, 2000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ini); else ini();
})();
