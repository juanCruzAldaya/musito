// Pantalla: convierte casillas del mapa en píxeles de la pantalla del juego y hace clic/atacar con eventos POINTER
// (el cliente usa SDL3, que escucha PointerEvents; los eventos de mouse se ignoran).
// calibrar(): hace 4 clics de caminar (±160 px en cada eje), mide a qué casilla fue el personaje cada vez y obtiene la matriz
// pantalla->casillas y dónde está el personaje en la pantalla. pixelDe(): inversa. atacar(): clic sostenido sobre un bicho.
(() => {
  'use strict';
  const KEY = 'muPantallaV1';
  const M = () => window.Module;
  const call = (n, ...a) => { try { const f = M()['_MuWeb' + n]; return typeof f === 'function' ? f(...a) : null; } catch (e) { return null; } };
  const pos = () => ({ x: call('GetHeroX'), y: call('GetHeroY') });
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const canvas = () => document.getElementById('canvas');
  let cal = null; try { cal = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { cal = null; }

  // buttons: máscara de botones apretados (1 = izquierdo, 2 = derecho). 'boton' es el que cambia en pointerdown/pointerup.
  function ptr(c, tipo, x, y, buttons, boton = 0) {
    return c.dispatchEvent(new PointerEvent(tipo, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: buttons ? 0.5 : 0, button: tipo === 'pointermove' ? -1 : boton, buttons }));
  }
  async function clic(x, y, mantenerMs = 90) {
    const c = canvas(); if (!c) return false;
    ptr(c, 'pointermove', x, y, 0); await dormir(50); ptr(c, 'pointerdown', x, y, 1);
    await dormir(mantenerMs); ptr(c, 'pointerup', x, y, 0); return true;
  }
  const centro = () => { const r = canvas().getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const inv2 = (a, b, c, d) => { const det = a * d - b * c; return Math.abs(det) < 1e-9 ? null : [d / det, -b / det, -c / det, a / det]; };

  async function esperarQuieto(maxMs = 4000) {
    const t0 = Date.now(); let p = pos(), t = Date.now();
    while (Date.now() - t0 < maxMs) { await dormir(150); const q = pos(); if (q.x !== p.x || q.y !== p.y) { p = q; t = Date.now(); } else if (Date.now() - t > 700) break; }
    return pos();
  }

  // Regresión de 3 parámetros: v = p0*ox + p1*oy + p2 (cuadrados mínimos, por Cramer)
  function ajustar(pts, k) {
    let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = pts.length, bx = 0, by = 0, b1 = 0;
    for (const p of pts) { const [ox, oy] = p.o, v = p.d[k]; sxx += ox * ox; sxy += ox * oy; sx += ox; syy += oy * oy; sy += oy; bx += ox * v; by += oy * v; b1 += v; }
    const M3 = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], R = [bx, by, b1];
    const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det3(M3); if (Math.abs(D) < 1e-9) return null;
    return [0, 1, 2].map((j) => det3(M3.map((fila, i) => fila.map((v, c) => (c === j ? R[i] : v)))) / D);
  }

  // 8 clics de caminar (4 direcciones x 2 distancias): d_i = A (o_i - h). Se ajusta A y el desfase h con todos los puntos.
  async function calibrar(radios = [110, 160, 110, 160], forzar = false) {   // clics CORTOS: el juego limita cuánto camina por clic
    if (!M() || call('GetSceneFlag') !== 5 || call('HelperIsActive') === 1) return { ok: false, motivo: 'tenés que estar en el juego con el Helper apagado' };
    if (!(call('GetPlayerLife') > 0)) return { ok: false, motivo: 'estás muerto' };
    const B = window.__bichos;
    if (B) { const o = pos(); const n = B.vista().filter((v) => Math.max(Math.abs(v.x - o.x), Math.abs(v.y - o.y)) <= 9).length; if (n > 0) return { ok: false, motivo: 'hay ' + n + ' bichos a 9 casillas o menos: un clic sobre un bicho lo ataca en vez de caminar. Calibrá en un lugar SIN bichos (por ejemplo en un pueblo)' }; }
    const c0 = centro(), pts = [];
    for (const r of radios) {
      for (const [ox, oy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const a = pos(); await clic(c0.x + ox, c0.y + oy); const b = await esperarQuieto(4500);
        pts.push({ o: [ox, oy], d: [b.x - a.x, b.y - a.y] });
      }
    }
    const movieron = pts.filter((p) => Math.max(Math.abs(p.d[0]), Math.abs(p.d[1])) >= 1).length;
    if (movieron < Math.ceil(pts.length * 0.7)) return { ok: false, motivo: 'solo ' + movieron + ' de ' + pts.length + ' clics hicieron caminar al personaje (¿clics sobre bichos o terreno bloqueado?). No guardo la calibración', pts };
    // Ajuste robusto: si el error es alto, descarta los clics que no llegaron (pared, bicho en el camino) y vuelve a ajustar.
    const modelo = (puntos) => {
      const fx = ajustar(puntos, 0), fy = ajustar(puntos, 1); if (!fx || !fy) return null;
      const A = [fx[0], fx[1], fy[0], fy[1]], bv = [fx[2], fy[2]], Ai = inv2(A[0], A[1], A[2], A[3]); if (!Ai) return null;
      const h = [-(Ai[0] * bv[0] + Ai[1] * bv[1]), -(Ai[2] * bv[0] + Ai[3] * bv[1])];
      const res = puntos.map((p) => Math.hypot(A[0] * (p.o[0] - h[0]) + A[1] * (p.o[1] - h[1]) - p.d[0], A[2] * (p.o[0] - h[0]) + A[3] * (p.o[1] - h[1]) - p.d[1]));
      return { A, Ai, h, res, err: res.reduce((x, y) => x + y, 0) / res.length };
    };
    let usados = pts.slice(), m = modelo(usados);
    for (let i = 0; i < 3 && m && m.err > 0.7 && usados.length > 5; i++) {   // descartar el peor punto y reajustar
      let peor = 0; m.res.forEach((e, j) => { if (e > m.res[peor]) peor = j; });
      usados.splice(peor, 1); const m2 = modelo(usados); if (!m2) break; m = m2;
    }
    if (!m) return { ok: false, motivo: 'no se pudo ajustar (el personaje no se movió lo suficiente)', pts };
    const nueva = { A: m.A, Ai: m.Ai, h: m.h, err: m.err, n: usados.length, de: pts.length };
    if (cal && cal.err <= nueva.err && cal.n >= 12 && !forzar) return { ok: true, conservada: true, cal, nueva, pts };   // no pisar una buena con una peor
    cal = nueva; try { localStorage.setItem(KEY, JSON.stringify(cal)); } catch (e) { /* nada */ }
    return { ok: true, cal, pts };
  }

  const enPantalla = (p) => { if (!p) return false; const r = canvas().getBoundingClientRect(); return p.x >= r.left + 20 && p.x <= r.right - 20 && p.y >= r.top + 20 && p.y <= r.bottom - 20; };
  // píxel de la pantalla donde se ve la casilla (tx,ty) (alturaPx: subir el punto hacia el cuerpo del bicho)
  function pixelDe(tx, ty, alturaPx = 40) {
    if (!cal) return null;
    const p = pos(), dt = [tx - p.x, ty - p.y], c0 = centro();
    return { x: c0.x + cal.h[0] + cal.Ai[0] * dt[0] + cal.Ai[1] * dt[1], y: c0.y + cal.h[1] + cal.Ai[2] * dt[0] + cal.Ai[3] * dt[1] - alturaPx };
  }
  // Clic sostenido sobre un bicho (como mantener el botón izquierdo). Si el clic NO dispara un hechizo (se envía 0x19), prueba puntos
  // cercanos hasta acertar y recuerda la corrección ('sesgo') para el próximo bicho. Un clic que cae en el piso hace caminar un poco.
  const BUSQUEDA = [[0, 0], [0, -35], [40, 0], [-40, 0], [0, 35], [60, -35], [-60, -35], [60, 35], [-60, 35], [0, -70], [90, 0], [-90, 0]];
  let sesgo = [0, 0];
  // CLIC DERECHO mantenido sobre el bicho: lanza el hechizo seleccionado sin caminar hacia él (el izquierdo camina). Si no sale un
  // hechizo (0x19), prueba puntos cercanos hasta acertar y recuerda la corrección ('sesgo').
  async function atacar(bicho, ms = 3000, alturaPx = 40) {
    const P = window.__paquetes; const px0 = pixelDe(bicho.x, bicho.y, alturaPx); if (!px0) return { ok: false, motivo: 'falta calibrar pantalla' };
    if (!enPantalla(px0)) return { ok: false, motivo: 'el bicho queda fuera de la pantalla (píxel ' + Math.round(px0.x) + ',' + Math.round(px0.y) + ')', hechizos: 0, pasos: 0 };
    if (!P) return { ok: false, motivo: 'falta paquetes.js' };
    const c = canvas(), cast = () => P.cuenta('tx', 'C3:0x19'), paso = () => P.cuenta('tx', 'C1:0xd4');
    const c19 = cast(), d4 = paso(); let acierto = null, intentos = 0;
    for (const [bx, by] of BUSQUEDA) {
      if (call('GetPlayerLife') / call('GetPlayerLifeMax') < 0.4) return { ok: false, motivo: 'vida baja, corto', hechizos: cast() - c19, pasos: paso() - d4 };
      const base = pixelDe(bicho.x, bicho.y, alturaPx);
      const x = base.x + sesgo[0] + bx, y = base.y + sesgo[1] + by, antes = cast(); intentos++;
      ptr(c, 'pointermove', x, y, 0); await dormir(70); ptr(c, 'pointerdown', x, y, 2, 2);
      await dormir(450);
      if (cast() > antes) { acierto = { x, y, bx, by }; sesgo = [sesgo[0] + bx, sesgo[1] + by]; break; }
      ptr(c, 'pointerup', x, y, 0, 2); await dormir(120);
    }
    if (!acierto) return { ok: false, motivo: 'ningún punto cercano disparó un hechizo (' + intentos + ' intentos)', hechizos: cast() - c19, pasos: paso() - d4 };
    const t0 = Date.now(); while (Date.now() - t0 < ms && call('GetPlayerLife') / call('GetPlayerLifeMax') >= 0.4) { await dormir(150); ptr(c, 'pointermove', acierto.x, acierto.y, 2); }
    ptr(c, 'pointerup', acierto.x, acierto.y, 0, 2);
    return { ok: true, intentos, sesgo: sesgo.slice(), hechizos: cast() - c19, pasos: paso() - d4 };
  }

  // Clic derecho mantenido en sesión: el piloto lo deja apretado y solo mueve el puntero de un bicho al siguiente.
  const pixelAtaque = (b, alturaPx = 40) => { const q = pixelDe(b.x, b.y, alturaPx); return q ? { x: q.x + sesgo[0], y: q.y + sesgo[1] } : null; };
  const derecho = {
    iniciar: (x, y) => { const c = canvas(); ptr(c, 'pointermove', x, y, 0); setTimeout(() => ptr(c, 'pointerdown', x, y, 2, 2), 60); },
    mover: (x, y) => ptr(canvas(), 'pointermove', x, y, 2),
    soltar: (x, y) => ptr(canvas(), 'pointerup', x, y, 0, 2),
  };
  window.__pantalla = { calibrar, pixelDe, enPantalla, clic, atacar, cal: () => cal, ptr, sesgo: () => sesgo, pixelAtaque, derecho, ajustarSesgo: (dx, dy) => { sesgo = [Math.max(-220, Math.min(220, sesgo[0] + dx)), Math.max(-220, Math.min(220, sesgo[1] + dy))]; } };
})();
