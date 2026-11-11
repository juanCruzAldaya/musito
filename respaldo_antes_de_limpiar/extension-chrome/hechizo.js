// Mantiene el ataque del Helper en Fire Burst Strengthener (skill 508).
// Lee la config guardada por el propio juego (localStorage muMobileHelper:<héroe>.attacks) y, si difiere,
// la corrige apretando los mismos botones de la ventana del Helper (así el juego guarda y aplica por su cuenta).
(() => {
  'use strict';
  const OBJETIVO = 508;
  let activo = true, estado = 'sin datos', ultimaCorreccion = 0, fallos = 0;
  const M = () => window.Module;
  const call = (n, ...a) => { try { const f = M()['_MuWeb' + n]; return typeof f === 'function' ? f(...a) : null; } catch (e) { return null; } };
  const str = (n, ...a) => { try { const f = M()['_MuWeb' + n]; const p = f(...a) | 0; return p ? M().UTF8ToString(p) : ''; } catch (e) { return ''; } };
  const txt = (e) => (e.innerText || e.title || e.getAttribute('aria-label') || '').trim();
  const enviar = (clave, texto, grave) => window.postMessage({ __muvigia: true, clave, texto, grave: !!grave }, '*');

  function guardado() {
    const heroe = str('GetHeroNameUtf8'); if (!heroe) return null;
    try { const o = JSON.parse(localStorage.getItem('muMobileHelper:' + heroe) || 'null'); return o && Array.isArray(o.attacks) ? o.attacks : null; } catch (e) { return null; }
  }
  const ok = (a) => a && a.length === 1 && a[0] === OBJETIVO;

  async function corregir() {
    const nombre = str('GetSkillNameUtf8', OBJETIVO); if (!nombre) return false;
    const sel = document.getElementById('mu-mobile-helper-attacks-selected');
    const cat = document.getElementById('mu-mobile-helper-attacks-catalog');
    if (!sel || !cat) return false;
    // 1) sacar todo lo que no sea Fire Burst (el juego vuelve a dibujar la lista tras cada clic)
    for (let i = 0; i < 12; i++) {
      const chip = [...sel.querySelectorAll('.helper-chip')].find((c) => txt(c) !== nombre);
      if (!chip) break;
      chip.click(); await new Promise((r) => setTimeout(r, 150));
    }
    // 2) si Fire Burst no quedó, agregarlo desde el catálogo
    if (![...sel.querySelectorAll('.helper-chip')].some((c) => txt(c) === nombre)) {
      const card = [...cat.querySelectorAll('.helper-skill-card')].find((c) => txt(c) === nombre && !c.classList.contains('is-added'));
      if (card) { card.click(); await new Promise((r) => setTimeout(r, 200)); }
    }
    return true;
  }

  async function revisar() {
    if (!activo || !M() || call('GetSceneFlag') !== 5 || !(call('GetPlayerLifeMax') > 0)) return;
    const a = guardado();
    if (a === null) { estado = 'sin datos'; return; }
    if (ok(a)) { estado = 'ok'; fallos = 0; return; }
    const ahora = Date.now();
    if (ahora - ultimaCorreccion < 30000) return;
    ultimaCorreccion = ahora;
    const antes = a.join(',');
    await corregir();
    await new Promise((r) => setTimeout(r, 500));
    if (ok(guardado())) { estado = 'corregido'; fallos = 0; enviar('hechizo_ok', 'Corregí el ataque del Helper: tenía [' + antes + '], ahora Fire Burst Strengthener.', false); }
    else { estado = 'MAL'; if (++fallos >= 2) { enviar('hechizo_mal', 'El Helper no ataca con Fire Burst (tiene [' + antes + ']) y no pude corregirlo.', true); fallos = 0; } }
  }

  setInterval(() => { revisar().catch(() => {}); }, 5000);
  window.__hechizo = {
    setActivo: (v) => { activo = !!v; },
    resumen: () => 'Ataque Helper: ' + ({ ok: 'Fire Burst ✓', corregido: 'Fire Burst ✓ (corregido)', MAL: '<b style="color:#f66">NO es Fire Burst</b>', 'sin datos': 'sin datos' }[estado] || estado),
    revisar,
  };
})();
