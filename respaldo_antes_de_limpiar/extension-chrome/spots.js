// Medidor de spots: solo lee. Cada segundo, con el Helper activo, anota cuánta experiencia se gana en cada zona (celdas de 10x10)
// de cada mapa, separado por franjas de 25 niveles (la exp que pide cada nivel cambia). Guarda en el navegador (localStorage).
(() => {
  'use strict';
  const KEY = 'muSpotsV1', MIN_SEG = 180;
  let datos = {}; try { datos = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { datos = {}; }
  let prev = null, sucio = false, ultGuardado = 0, actual = null;
  const M = () => window.Module;
  const n = (f) => { try { const g = M()['_MuWeb' + f]; return typeof g === 'function' ? g() : null; } catch (e) { return null; } };
  const banda = (nivel) => Math.floor(nivel / 25);
  const clave = (m, x, y, nivel) => m + '|' + Math.floor(x / 10) + '|' + Math.floor(y / 10) + '|' + banda(nivel);

  function tick() {
    if (!M() || n('GetSceneFlag') !== 5 || !(n('GetPlayerLife') > 0)) { prev = null; return; }
    const m = n('GetMapIndex'), x = n('GetHeroX'), y = n('GetHeroY'), nivel = n('GetPlayerLevel');
    const xp = nivel * 1000 + n('GetExperiencePermille');
    const farmeando = n('HelperIsActive') === 1 && n('HelperIsSafeZone') !== 1 && nivel < 400;
    if (prev && prev.m === m && Math.hypot(x - prev.x, y - prev.y) <= 30 && farmeando) {
      const d = xp - prev.xp;
      if (d >= 0 && d <= 300) {
        const k = clave(m, x, y, nivel); const c = datos[k] || (datos[k] = { s: 0, x: 0 });
        c.s += 1; c.x += d; sucio = true; actual = { k, c };
      }
    }
    prev = { m, x, y, xp };
    if (sucio && Date.now() - ultGuardado > 30000) { try { localStorage.setItem(KEY, JSON.stringify(datos)); } catch (e) { /* lleno */ } sucio = false; ultGuardado = Date.now(); }
  }
  setInterval(() => { try { tick(); } catch (e) { /* no frenar */ } }, 1000);

  const tasa = (c) => (c.x / 10) * 3600 / c.s; // % de nivel por hora
  function ranking(mapa, nivel, top = 5) {
    const b = banda(nivel), pref = mapa + '|';
    return Object.entries(datos)
      .filter(([k, c]) => k.startsWith(pref) && Number(k.split('|')[3]) === b && c.s >= MIN_SEG)
      .map(([k, c]) => { const p = k.split('|'); return { zona: 'x ' + p[1] * 10 + '-' + (p[1] * 10 + 9) + ', y ' + p[2] * 10 + '-' + (p[2] * 10 + 9), tasa: tasa(c), min: Math.round(c.s / 60) }; })
      .sort((a, c) => c.tasa - a.tasa).slice(0, top);
  }
  window.__spots = {
    ranking, datos: () => datos,
    texto: () => { const m = n('GetMapIndex'), nv = n('GetPlayerLevel'); const r = ranking(m, nv); return r.length ? 'Mapa ' + m + ' (nivel ' + banda(nv) * 25 + '+): ' + r.map((e, i) => (i + 1) + '. ' + e.zona + ' → ' + e.tasa.toFixed(1) + '%/h (' + e.min + ' min)').join(' | ') : 'Mapa ' + m + ': todavía no hay zonas con ' + MIN_SEG / 60 + '+ min medidos'; },
    zonaActual: () => (actual && actual.c.s >= 60 ? 'Zona actual: ' + tasa(actual.c).toFixed(1) + '%/h (' + Math.round(actual.c.s / 60) + ' min medidos)' : ''),
    borrar: () => { datos = {}; try { localStorage.removeItem(KEY); } catch (e) { /* nada */ } },
  };
})();
