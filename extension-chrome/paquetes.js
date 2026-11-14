// Sonda de paquetes: de todos los paquetes anota solo metadatos (cabecera, código y largo).
// Únicamente de unos pocos tipos (experiencia, drops, juntar, daño, vida y movimiento de objetos; ver MUESTREAR) guarda hasta 6 ejemplos en
// hexadecimal para descubrir su formato. Nunca guarda chat ni nada personal, y no modifica ni envía nada.
(() => {
  'use strict';
  const rx = {}, tx = {};   // "C1:13" -> {n, min, max, suma}
  const ult = [];            // últimos 40 recibidos: [t_ms, cabecera, código, largo]
  const t0 = Date.now();
  const MUESTREAR = new Set(['C3:0x16', 'C2:0x20', 'C2:0x21', 'C2:0x31', 'C1:0x00', 'C3:0x22', 'C1:0x11', 'C1:0x26', 'C1:0xd4', 'C1:0x18', 'C1:0x15', 'C3:0x19', 'C1:0x07', 'C1:0xe7', 'C2:0xe7', 'C1:0xe8', 'C1:0x2f', 'C1:0x44', 'C2:0x65', 'C2:0x12', 'C1:0xf3', 'C2:0xf3', 'C4:0xf3', 'C2:0xe8']);      // v0.96.2: canales raros del servidor (0xE7/0xE8/0xF3/0x2F/0x44/0x65): se guardan ejemplos
  const muestras = {};   // paquete -> lista (máx. 6, con largos distintos) de bytes en hexadecimal
  function guardarMuestra(m, u8) {
    if (!MUESTREAR.has(m.k)) return;
    const l = muestras[m.k] || (muestras[m.k] = []);
    if (l.length >= 6 || l.some((x) => x.largo === u8.length && l.length >= 3)) return;
    l.push({ largo: u8.length, hex: Array.from(u8.slice(0, /^C[24]:0x(e7|f3|e8)$/.test(m.k) ? 256 : 96), (b) => b.toString(16).padStart(2, '0')).join(' ') });
  }
  let total = { rx: 0, tx: 0 }, ventanas = {}, ventanasTx = {};

  function meta(u8) {
    if (!u8 || u8.length < 3) return null;
    const h = u8[0];
    const cod = (h === 0xC1 || h === 0xC3) ? u8[2] : (h === 0xC2 || h === 0xC4) ? u8[3] : u8[1];
    const nombre = { 0xC1: 'C1', 0xC2: 'C2', 0xC3: 'C3', 0xC4: 'C4' }[h] || ('0x' + h.toString(16));
    return { k: nombre + ':' + (cod === undefined ? '?' : '0x' + cod.toString(16).padStart(2, '0')), h: nombre, cod, len: u8.length };
  }
  // ---- RAREZA DE LOS ITEMS (v0.96.0): ¿por qué canal le llega al cliente el texto "Rareza: Épico", "[Raro] Contraataque: 9,3 %..."? ----
  // Solo lectura: de los paquetes recibidos que NO son los frecuentes del combate ni el chat, busca esas palabras (UTF-8 y UTF-16) y guarda hasta 40 aciertos (código, largo, texto cercano y los primeros bytes).
  // Si salen, el texto viaja en un paquete y se puede ver su formato; si no salen, el cliente lo arma con una tabla propia a partir de los bytes del item.
  const FRECUENTES = new Set(['C1:0x48', 'C3:0x1e', 'C1:0x17', 'C2:0x13', 'C3:0x19', 'C1:0x14', 'C3:0x16', 'C1:0x26', 'C1:0x11', 'C1:0xd4', 'C3:0x22', 'C1:0x18', 'C2:0x21', 'C1:0x00', 'C1:0x02', 'C1:0x0d', 'C1:0x07', 'C1:0x15']);
  const PALABRAS = ['Rareza', 'Contraataque', 'Templanza', 'Soplo de', 'Bloqueo', 'Rarity', 'Epic', 'Raro]', 'pico]'];
  const rareza = { hits: [], paquetesRevisados: 0, porCodigo: {} };
  function sniffRareza(m, u8) {
    if (!u8 || u8.length < 24 || FRECUENTES.has(m.k)) return;
    rareza.paquetesRevisados++;
    let s8 = '', s16 = '';
    for (let i = 0; i < u8.length; i++) s8 += String.fromCharCode(u8[i]);
    for (let i = 0; i + 1 < u8.length; i += 2) s16 += String.fromCharCode(u8[i] | (u8[i + 1] << 8));
    let s16b = ''; for (let i = 1; i + 1 < u8.length; i += 2) s16b += String.fromCharCode(u8[i] | (u8[i + 1] << 8));
    for (const w of PALABRAS) {
      const enc = s8.indexOf(w) >= 0 ? 'utf8' : (s16.indexOf(w) >= 0 || s16b.indexOf(w) >= 0) ? 'utf16' : null;
      if (!enc) continue;
      rareza.porCodigo[m.k] = (rareza.porCodigo[m.k] || 0) + 1;
      if (rareza.hits.length < 40) {
        const base = enc === 'utf8' ? s8 : (s16.indexOf(w) >= 0 ? s16 : s16b), i = base.indexOf(w);
        let txt = ''; try { txt = enc === 'utf8' ? decodeURIComponent(escape(base.slice(i, i + 120))) : base.slice(Math.max(0, i - 10), i + 120); } catch (e) { txt = base.slice(i, i + 120); }
        rareza.hits.push({ t_s: Math.round((Date.now() - t0) / 1000), paquete: m.k, largo: u8.length, palabra: w, codificacion: enc, texto: txt.replace(/[^\x20-\x7E\u00A0-\u024F]/g, '·'), hex: Array.from(u8.slice(0, 160), (b) => b.toString(16).padStart(2, '0')).join(' ') });
      }
      return;
    }
  }
  // ---- LECTOR DE MIS ITEMS (v0.97.0): lista de inventario que manda el servidor al entrar (C4 F3 10) ----
  // Solo lectura. Formato visto en la caja 57 (888 B): C4 len len F3 10 cantidad, y después por cada item: casilla (1 B) + item de largo VARIABLE (10 a 19 B). Del item se entiende con seguridad:
  // byte0 = grupo(4 bits altos) | algo, byte1 = índice, byte2 = nivel (+0..+15) -> 7:51 +15 = Paewang Mask +15. El resto (opciones, excelentes, afijos de rareza) todavía no está descifrado: se guarda en hexadecimal.
  // Como el largo varía, el corte entre items es una HEURÍSTICA: la casilla siguiente es un número mayor, seguido de una cabecera plausible. Las casillas 0-11 son el equipo puesto (0 arma, 1 escudo, 2 casco, 3 armadura, 4 pantalón, 5 guantes, 6 botas, 7 alas, 8 mascota, 9-10 anillos...).
  const inv = { visto: false, t_s: null, largo: 0, hex: '', items: [], confiable: null };
  const hex2 = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
  // ---- AFIJOS DE RAREZA (v0.99.0): solo lectura, sacados de los bytes del item que manda el servidor ----
  // Formato (confirmado con el código del cliente, función RenderItemRareAffixLines, y con 9 tooltips): al final del item van 2 PARES de 2 bytes [id][tirada]; `00 00` = hueco vacío.
  //  - id = índice de la tabla de afijos del cliente (registro de 36 bytes: mínimo y máximo del valor, nombre y descripción en es/en/pt). Los afijos de skill/buff no tienen rango.
  //  - rareza según la tirada (igual que el cliente): >252 Mítico, >241 Legendario, >203 Épico, el resto tirada>>7: 0 Común (0-127), 1 Raro (128-203). La del item es la del mejor afijo.
  //  - valor = redondeo a 0.1 de mín + (máx − mín) × tirada / 255.
  // Los nombres (afijos_es.txt, formato id|nombre|descripción) NO están en git: los lee puente.js del archivo local y me los manda; sin el archivo se ven igual los valores, pero con "afijo #id".
  const RANGOS = {1:[5,25],2:[5,25],3:[5,25],4:[5,25],5:[3,15],6:[5,25],12:[2,10],13:[5,30],14:[5,30],15:[10,50],17:[1,5],19:[5,25],20:[5,20],26:[2,10],32:[3,10],33:[2,8],34:[3,12],35:[3,12],36:[3,12],37:[20,60],38:[20,60],39:[5,15],40:[5,15],41:[10,40],42:[10,40],43:[20,50],44:[3,8],46:[1,10],47:[0.5,5],48:[1,8],49:[2,15],50:[2,15],51:[0.5,5],52:[1,8],53:[2,12],54:[1,5],55:[2,15],56:[2,15],57:[1,8],58:[1,10],59:[1,10],60:[1,8],61:[1,8],62:[1,10],63:[1,10],64:[1,5],65:[0.5,4],66:[0.5,3],67:[0.5,3],68:[0.5,3],69:[2,10],70:[3,15],71:[1,5],72:[1,10],73:[1,10],74:[2,10],75:[2,10],76:[1,5],77:[1,5],78:[1,3],79:[0.5,3],80:[2,10],81:[1,8],82:[2,10],83:[1,5],84:[1,5],85:[2,10],86:[1,10],87:[3,20],88:[1,8],89:[1,6],90:[2,12],91:[1,8],92:[0.5,4],93:[1,8],94:[1,8],95:[1,8],96:[1,5],97:[0.5,4],98:[2,12],99:[0.5,3],100:[2,12],101:[1,5],102:[20,80],103:[5,30],104:[2,12],105:[2,10],106:[5,20],107:[1,5],108:[2,10],109:[5,30],110:[5,30],111:[3,15],112:[2,10],113:[1,8],114:[1,5],115:[1,5],116:[10,40],117:[5,25],118:[10,30],119:[5,20],120:[5,20],121:[5,20],122:[5,20],123:[5,20],124:[5,20],125:[2,10],126:[5,20],127:[5,25],128:[5,20],129:[10,40],130:[5,20],131:[5,20],132:[5,20],133:[10,40],134:[10,50],135:[5,20],136:[5,25],137:[5,30],138:[5,25],139:[5,20],140:[2,10],141:[10,40],142:[5,20],143:[5,20],144:[5,20],145:[50,100],146:[5,30],147:[5,25],148:[2,15],149:[5,30],150:[0.5,3],151:[5,30],152:[1,5],153:[5,25],154:[5,20],155:[2,10],156:[5,25],157:[1,5],158:[10,100],159:[5,30],160:[20,100],161:[1,5],162:[5,20],163:[1,3],164:[1,3],165:[5,30],166:[20,50],167:[10,30],168:[20,50],169:[20,60],170:[30,80],171:[10,40],172:[10,30],173:[10,30],174:[20,50],175:[30,60],176:[5,15],177:[20,50],178:[20,50],179:[10,30],180:[30,80],181:[10,50],182:[10,50],183:[10,50],184:[10,50],185:[10,50],186:[10,40],187:[10,40],188:[10,40],189:[10,40],190:[10,40],191:[5,20],192:[50,100],193:[5,20],194:[10,50],195:[5,20],199:[5,20],201:[20,60],202:[5,25],203:[1,5],204:[5,20]};
  let catalogo = null;
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || typeof e.data.__muvigiaAfijos !== 'string') return;
    const c = {};
    for (const l of e.data.__muvigiaAfijos.split('\n')) { const p = l.replace(/\r$/, '').split('|'); if (p.length >= 3 && /^\d+$/.test(p[0])) c[+p[0]] = { n: p[1], d: p.slice(2).join('|') }; }
    catalogo = c;
  });
  try { window.postMessage({ __muvigiaPide: true }, '*'); } catch (e) { /* nada */ }
  const TIERS = ['Común', 'Raro', 'Épico', 'Legendario', 'Mítico'];
  const tierDeTirada = (t) => (t > 252 ? 4 : t > 241 ? 3 : t > 203 ? 2 : t >> 7);
  const valorDeAfijo = (id, t) => { const r = RANGOS[id]; if (!r) return null; const v = Math.round((r[0] + (r[1] - r[0]) * t / 255) * 10) / 10; return Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v) : v; };
  function afijosDe(it) {
    if (!it || it.length < 11) return [];
    const g = it[0] >> 4; if (g > 11 && g !== 13) return [];
    const t = it.slice(it.length - 4), out = [];
    for (let k = 0; k < 4; k += 2) { if (t[k] || t[k + 1]) out.push({ id: t[k], tirada: t[k + 1] }); }
    return out;
  }
  function afijoTexto(a) {
    const c = catalogo && catalogo[a.id], v = valorDeAfijo(a.id, a.tirada);
    let txt = c ? ((c.n ? c.n + ': ' : '') + c.d) : 'afijo #' + a.id;
    txt = v === null ? txt : (/\{v\}/.test(txt) ? txt.replace('{v}', v) : txt + ' (' + v + ')');
    return '[' + TIERS[tierDeTirada(a.tirada)] + '] ' + txt;
  }
  const rarezaDeItem = (afs) => (afs && afs.length ? TIERS[Math.max(...afs.map((a) => tierDeTirada(a.tirada)))] : null);
  const cambios = [];   // últimos items que el servidor volvió a mandar (C3 24: mover / re-roll): casilla + item + afijos
  function leerCambio(m, u8) {
    if (!u8 || m.k !== 'C3:0x24' || u8.length < 16) return;
    const it = u8.slice(5);
    cambios.push({ t_s: Math.round((Date.now() - t0) / 1000), casilla: u8[4], grupo: it[0] >> 4, indice: it[1], nivel: it[2], durabilidad: it[3], afijos: afijosDe(it), hex: hex2(it) });
    if (cambios.length > 20) cambios.shift();
  }
  function parsearInventario(u8) {
    const L = u8.length, out = []; let pos = 6;
    const cab = (j) => j + 3 < L && u8[j + 1] <= 0xFE && (u8[j + 3] <= 15 || u8[j + 3] === 0xFF) && u8[j + 2] < 0x80;
    while (pos < L - 4) {
      const slot = u8[pos]; let fin = L;
      for (let j = pos + 9; j < Math.min(L - 3, pos + 28); j++) { if (u8[j] > slot && u8[j] <= 0x4C && cab(j) && (u8[j + 1] >> 4) <= 15) { fin = j; break; } }
      if (fin === L && L - pos > 28) break;      // no se pudo cortar: se corta acá (lo que sigue no es confiable)
      const it = u8.slice(pos + 1, fin);
      out.push({ casilla: slot, grupo: it[0] >> 4, indice: it[1], nivel: it[2], largo: it.length, durabilidad: it[3], afijos: afijosDe(it), extra: hex2(it.slice(3)) });
      pos = fin;
    }
    return out;
  }
  function leerInventario(m, u8) {
    if (!u8 || u8.length < 40 || m.k !== 'C4:0xf3' || u8[4] !== 0x10) return;
    inv.visto = true; inv.t_s = Math.round((Date.now() - t0) / 1000); inv.largo = u8.length; inv.hex = hex2(u8.slice(0, 1024));
    inv.items = parsearInventario(u8);
    const eq = inv.items.filter((x) => x.casilla <= 11);
    inv.confiable = eq.length >= 6 && eq.every((x, i, a) => i === 0 || x.casilla > a[i - 1].casilla);
  }
  const nombreDeItem = (g, i) => { try { const M = window.Module, p = M && M._MuWebGetItemNameUtf8 ? M._MuWebGetItemNameUtf8(g, i) | 0 : 0; return p ? M.UTF8ToString(p) : ''; } catch (e) { return ''; } };
  const itemTexto = (x) => x.casilla + ': ' + (nombreDeItem(x.grupo, x.indice) || (x.grupo + ':' + x.indice)) + ' +' + x.nivel + (x.afijos && x.afijos.length ? ' {Rareza ' + rarezaDeItem(x.afijos) + ': ' + x.afijos.map(afijoTexto).join(' / ') + '}' : '');
  const equipoTexto = () => (inv.visto
    ? inv.items.filter((x) => x.casilla <= 11).map(itemTexto).join(' · ') + (inv.confiable ? '' : ' (lectura dudosa)') + (catalogo ? '' : ' (sin afijos_es.txt: solo números)') + (cambios.length ? ' · ÚLTIMO CAMBIO: ' + itemTexto(cambios[cambios.length - 1]) : '')
    : 'todavía no vi la lista de inventario (recargá la página con F5 y entrá al juego)');
  // Los últimos 80 paquetes recibidos que NO son los del combate (con sus bytes completos hasta 320): para ver qué manda el servidor justo después de una acción puntual (por ejemplo cambiarle el "rare" a un item) y compararlo con lo de antes.
  const recientesRaros = [];
  function guardarReciente(m, u8) {
    if (!u8 || u8.length < 8 || FRECUENTES.has(m.k) || m.k === 'C1:0xe7' || m.k === 'C2:0x12') return;
    recientesRaros.push({ t_s: Math.round((Date.now() - t0) / 1000), paquete: m.k, largo: u8.length, hex: hex2(u8.slice(0, 320)) });
    if (recientesRaros.length > 80) recientesRaros.shift();
  }
  // Lo que ENVÍA el cliente cuando hacés algo puntual (aplicar una joya, mover un item, usar algo): los últimos 40 paquetes enviados que NO son movimiento ni hechizos, con sus bytes y quién los mandó
  // (la pila de llamadas de JS, por si el nombre de la función aparece). Solo lectura: el paquete lo arma y lo manda el propio juego.
  const FREC_TX = new Set(['C1:0xd4', 'C3:0x19', 'C1:0x00']);
  const enviadosRecientes = [];
  function guardarEnviado(m, u8) {
    if (!u8 || FREC_TX.has(m.k)) return;
    let pila = ''; try { pila = String(new Error().stack || '').split('\n').slice(2, 9).map((x) => x.trim().slice(0, 160)).join(' | '); } catch (e) { /* nada */ }
    enviadosRecientes.push({ t_s: Math.round((Date.now() - t0) / 1000), paquete: m.k, largo: u8.length, hex: hex2(u8.slice(0, 200)), pila });
    if (enviadosRecientes.length > 40) enviadosRecientes.shift();
  }
  const escRx = [], escTx = [];   // oyentes de paquetes (solo lectura): window.__paquetes.alRecibir(fn) / alEnviar(fn)
  function anotar(tabla, m, dir, u8) {
    if (!m) return;
    if (dir === 'rx' && u8) for (const f of escRx) { try { f(u8); } catch (e) { /* nada */ } }
    if (dir === 'rx' && u8) guardarMuestra(m, u8);
    if (dir === 'rx' && u8) { try { sniffRareza(m, u8); } catch (e) { /* nada */ } try { leerInventario(m, u8); } catch (e) { /* nada */ } try { leerCambio(m, u8); } catch (e) { /* nada */ } try { guardarReciente(m, u8); } catch (e) { /* nada */ } }
    const c = tabla[m.k] || (tabla[m.k] = { n: 0, min: 1e9, max: 0, suma: 0 });
    c.n++; c.min = Math.min(c.min, m.len); c.max = Math.max(c.max, m.len); c.suma += m.len;
    total[dir]++;
    if (dir === 'tx') { const w = Math.floor((Date.now() - t0) / 10000); const v = ventanasTx[w] || (ventanasTx[w] = {}); v[m.k] = (v[m.k] || 0) + 1; }
    if (dir === 'rx') {
      ult.push([Date.now() - t0, m.h, m.cod, m.len]); if (ult.length > 40) ult.shift();
      const w = Math.floor((Date.now() - t0) / 10000); // por ventanas de 10 s, para ver qué paquetes son periódicos
      const v = ventanas[w] || (ventanas[w] = {}); v[m.k] = (v[m.k] || 0) + 1;
    }
  }
  const aU8 = (d) => (d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : null);

  // Cada hechizo enviado (C3 0x19: hechizo(2) + blanco(2)): qué bicho eligió y a qué distancia estaba. Sirve para ver cómo ataca el Helper.
  const castsTx = [];
  function logTx(u) {
    if (!u || u.length < 7 || u[0] !== 0xC3 || u[2] !== 0x19) return;
    const skill = (u[3] << 8) | u[4], tid = ((u[5] & 0x7F) << 8) | u[6];
    let mon = null, hx = null, hy = null;
    try { const M = window.Module; hx = M._MuWebGetHeroX(); hy = M._MuWebGetHeroY(); const B = window.__bichos; if (B && B.vista) mon = B.vista().find((v) => v.id === tid) || null; } catch (e) { /* nada */ }
    castsTx.push({ t_ms: Date.now() - t0, hex: Array.from(u, (b) => b.toString(16).padStart(2, '0')).join(' '), skill, tid, conocido: !!mon,
      d: mon ? Math.max(Math.abs(mon.x - hx), Math.abs(mon.y - hy)) : null, mx: mon ? mon.x : null, my: mon ? mon.y : null, hx, hy });
    if (castsTx.length > 800) castsTx.shift();
  }

  try {
    const WS = window.WebSocket;
    const P = function (url, prot) {
      const s = prot !== undefined ? new WS(url, prot) : new WS(url);
      s.addEventListener('message', (e) => {
        try {
          if (e.data instanceof Blob) e.data.arrayBuffer().then((b) => (() => { const u = new Uint8Array(b); anotar(rx, meta(u), 'rx', u); })());
          else { const u = aU8(e.data); anotar(rx, meta(u), 'rx', u); }
        } catch (err) { /* nada */ }
      });
      const send = s.send.bind(s);
      s.send = (d) => { try { const u = aU8(d); anotar(tx, meta(u), 'tx'); logTx(u); try { guardarEnviado(meta(u), u); } catch (e3) { /* nada */ } for (const f of escTx) { try { f(u); } catch (e2) { /* nada */ } } } catch (err) { /* nada */ } return send(d); };
      return s;
    };
    P.prototype = WS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k) => (P[k] = WS[k]));
    window.WebSocket = P;
  } catch (e) { /* nada */ }

  const resumen = (t) => Object.entries(t).sort((a, b) => b[1].n - a[1].n).map(([k, c]) => ({ paquete: k, cuantos: c.n, largoMin: c.min, largoMax: c.max, largoMedio: Math.round(c.suma / c.n) }));
  window.__paquetes = {
    alRecibir: (f) => escRx.push(f), alEnviar: (f) => escTx.push(f),
    cuenta: (dir, k) => ((dir === 'tx' ? tx : rx)[k] || { n: 0 }).n,
    rareza: () => rareza, recientes: () => recientesRaros,
    equipo: () => equipoTexto(),
    inventario: () => ({ ...inv, catalogo_cargado: !!catalogo, items: inv.items.map((x) => ({ ...x, nombre: nombreDeItem(x.grupo, x.indice), afijos_txt: (x.afijos || []).map(afijoTexto) })), cambios: cambios.map((c) => ({ ...c, nombre: nombreDeItem(c.grupo, c.indice), afijos_txt: c.afijos.map(afijoTexto) })) }),
    enviadosRecientes: () => enviadosRecientes,
    informe: () => ({ rareza_sniff: rareza, recientes_raros: recientesRaros, enviados_recientes: enviadosRecientes, hora: new Date().toISOString(), segundos: Math.round((Date.now() - t0) / 1000), total, recibidos: resumen(rx), enviados: resumen(tx), ultimosRecibidos: ult, muestras, castsTx, porVentanaDe10s: ventanas, porVentanaDe10sEnviados: ventanasTx }),
  };
})();
