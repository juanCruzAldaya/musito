// Sonda de solo lectura. No envía nada a ningún lado: el informe queda en pantalla / portapapeles / archivo.
(() => {
  'use strict';
  const VERSION = '0.2.0';

  // Cuenta de mensajes del websocket (solo largos y primer byte, nunca el contenido).
  const ws = { abiertos: 0, urls: [], rx: 0, tx: 0, rxBytes: 0, txBytes: 0, cabeceras: {} };
  try {
    const WS = window.WebSocket;
    const P = function (url, prot) {
      const s = prot !== undefined ? new WS(url, prot) : new WS(url);
      ws.abiertos++; ws.urls.push(String(url).replace(/[?#].*$/, ''));
      s.addEventListener('message', (e) => {
        ws.rx++;
        const n = e.data && (e.data.byteLength || e.data.length || e.data.size) || 0;
        ws.rxBytes += n;
        if (e.data instanceof ArrayBuffer && n) {
          const k = '0x' + new Uint8Array(e.data)[0].toString(16);
          ws.cabeceras[k] = (ws.cabeceras[k] || 0) + 1;
        }
      });
      const send = s.send.bind(s);
      s.send = (d) => { ws.tx++; ws.txBytes += (d && (d.byteLength || d.length)) || 0; return send(d); };
      return s;
    };
    P.prototype = WS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k) => (P[k] = WS[k]));
    window.WebSocket = P;
  } catch (e) { /* nada */ }

  const seguro = (f, def) => { try { return f(); } catch (e) { return def; } };

  function informe() {
    const o = { sonda: VERSION, hora: new Date().toISOString(), url: location.origin + location.pathname };
    // Globales propias del sitio (nombres solamente)
    const base = new Set(Object.getOwnPropertyNames(Object.getPrototypeOf(window)).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(Object.getPrototypeOf(window)))));
    o.globalesInteresantes = Object.keys(window).filter((k) => /^(MU|mu|Module|helper|auto|game|client|wasm|_?mu)/i.test(k) || /helper|auto|pickup|caceria|bot/i.test(k)).slice(0, 200);
    o.globalesMU = Object.keys(window).filter((k) => /^MU_/.test(k)).map((k) => [k, typeof window[k], typeof window[k] === 'boolean' || typeof window[k] === 'number' ? window[k] : undefined]);
    const M = window.Module;
    o.Module = !M ? null : {
      claves: Object.keys(M).slice(0, 300),
      exportados: Object.keys(M).filter((k) => /^_/.test(k)).slice(0, 400),
      ccall: typeof M.ccall, cwrap: typeof M.cwrap,
      heap: seguro(() => (M.HEAPU8 && M.HEAPU8.length) || null, null),
    };
    // Valores reales de funciones de SOLO LECTURA y sin argumentos (lista fija; no se llama nada que mueva o cambie algo).
    const LEER = ['PlayerLife', 'PlayerLifeMax', 'PlayerMana', 'PlayerManaMax', 'PlayerShield', 'PlayerShieldMax', 'PlayerLevel', 'PlayerZen',
      'PlayerStrength', 'PlayerDexterity', 'PlayerVitality', 'PlayerEnergy', 'PlayerCommand', 'PlayerLevelUpPoints', 'MasterLevel', 'MasterSkillPoints',
      'ExperiencePermille', 'HeroX', 'HeroY', 'MapIndex', 'HeroPk', 'PkMode', 'HeroBaseClass', 'CombatMode', 'PlayerAttackMode', 'BlockingUiOpen',
      'SkillListCount', 'CaceriaActive', 'CaceriaBotCount', 'HotkeyItemCount', 'SceneFlag', 'GroundItemsVisible', 'HeroAvatarScreenX', 'HeroAvatarScreenY'];
    const IS = ['HelperIsActive', 'HelperIsSafeZone', 'HelperGetPickupMask', 'HelperGetPickupNamesEnabled', 'HasCurrentSkill', 'HasNearbyManualPickup', 'MsgVisible', 'MsgCode', 'MsgType'];
    o.valores = {};
    if (M) {
      for (const n of LEER.map((x) => 'MuWebGet' + x).concat(IS.map((x) => 'MuWeb' + x))) {
        const f = M['_' + n];
        o.valores[n] = typeof f === 'function' ? seguro(() => f(), 'ERROR') : 'no existe';
      }
    }
    o.helperUI = seguro(() => ({
      estado: (document.getElementById('mu-mobile-helper-status') || {}).textContent,
      botonHud: (document.getElementById('mu-mobile-helper-hud-btn') || {}).className,
      autoAtk: (document.getElementById('mu-mobile-autoatk-btn') || {}).className,
      habilidades: [...document.querySelectorAll('.skill-slot,.helper-chip')].map((e) => (e.innerText || e.title || '').trim().slice(0, 40)),
      mapa: (document.querySelector('[id*=map-name i],[class*=map-name i]') || {}).textContent,
    }), null);
    o.mensajeVisible = seguro(() => document.getElementById('mu-mobile-message-title') ? document.getElementById('mu-mobile-message-title').textContent : null, null);
    o.canvas =[...document.querySelectorAll('canvas')].map((c) => ({ id: c.id, w: c.width, h: c.height }));
    o.scriptsPropios = [...document.querySelectorAll('script')].map((s) => s.id || s.getAttribute('src')).filter(Boolean);
    o.botones = [...document.querySelectorAll('button,[role=button],[id*=helper i],[id*=auto i],[class*=helper i],[class*=auto i]')]
      .slice(0, 150).map((b) => ({ tag: b.tagName.toLowerCase(), id: b.id, cls: String(b.className).slice(0, 80), txt: (b.innerText || b.title || b.getAttribute('aria-label') || '').trim().slice(0, 40), visible: !!(b.offsetWidth || b.offsetHeight) }));
    o.idsDelDOM = [...document.querySelectorAll('[id]')].map((e) => e.id).filter((i) => /helper|auto|hp|mana|mp|pick|inv|char|map|chat|menu|reset|stat|zen|skill|pot/i.test(i)).slice(0, 200);
    o.localStorageClaves = seguro(() => Object.keys(localStorage), []); // solo nombres
    o.websocket = ws;
    o.nodoRaiz = document.body ? [...document.body.children].map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')).slice(0, 60) : [];
    return o;
  }

  function panel() {
    if (document.getElementById('sonda-panel')) return;
    const b = document.createElement('div');
    b.id = 'sonda-panel';
    b.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647;font:12px sans-serif;background:#111c;color:#fff;padding:6px 8px;border-radius:6px;display:flex;gap:6px;align-items:center';
    b.innerHTML = '<span>Sonda</span><button id="sonda-go" style="cursor:pointer">Generar informe</button><span id="sonda-msg"></span>';
    document.body.appendChild(b);
    b.querySelector('#sonda-go').onclick = async () => {
      const txt = JSON.stringify(informe(), null, 1);
      const msg = b.querySelector('#sonda-msg');
      try { await navigator.clipboard.writeText(txt); msg.textContent = 'Copiado al portapapeles'; }
      catch (e) { msg.textContent = 'Se bajó como archivo'; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' }));
      a.download = 'informe_sonda.json';
      a.click();
    };
  }
  window.__sonda = informe;
  const ini = () => setTimeout(panel, 1500);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ini); else ini();
})();
