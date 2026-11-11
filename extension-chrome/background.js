// Service worker: manda los avisos a Discord. Enfriamiento por clave y tope global para que un spam no llene el canal.
const ENFRIAMIENTO_S = {
  muerte: 60, desconexion: 600, vida_baja: 120, trabado: 600, helper_falla: 600, helper_falla2: 600,
  reset: 0, reset_listo: 600, helper_on: 120, ciclo_etapa: 0, ciclo_reset: 0, ciclo_puntos: 0, ciclo_fin: 0, ciclo_falla: 60, stats_auto: 0, agresor: 120, agresor_fin: 60, agresor_foco: 300, ventana_abierta: 180,
};
const ultimo = {};
let ventana = [];

const webhookValido = (u) => /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(u || '');

async function enviarDiscord(texto, grave) {
  const { webhook } = await chrome.storage.local.get('webhook');
  if (!webhookValido(webhook)) return { ok: false, motivo: 'sin webhook válido' };
  const r = await fetch(webhook, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: (grave ? '🔴 ' : '🟢 ') + texto }),
  });
  return { ok: r.ok, motivo: 'HTTP ' + r.status };
}

async function avisar(m) {
  const { avisos } = await chrome.storage.local.get('avisos');
  if (avisos === false) return;
  const ahora = Date.now();
  const cool = (ENFRIAMIENTO_S[m.clave] ?? 300) * 1000;
  if (ultimo[m.clave] && ahora - ultimo[m.clave] < cool) return;
  ventana = ventana.filter((t) => ahora - t < 60000);
  if (ventana.length >= 6) return;
  ultimo[m.clave] = ahora; ventana.push(ahora);
  try { await enviarDiscord(m.texto, m.grave); } catch (e) { /* sin red: se pierde el aviso */ }
}

chrome.runtime.onMessage.addListener((m, _s, responder) => {
  if (m && m.tipo === 'aviso') avisar(m);
  if (m && m.tipo === 'prueba') {
    enviarDiscord('Prueba del Vigía MuMagdalenas: llegó bien.', false)
      .then(responder).catch((e) => responder({ ok: false, motivo: String(e) }));
    return true;
  }
});

// "Bajar caja" (botón del Lab o F9): al terminar la descarga de caja_negra*.json se le pasa a la pestaña del juego la RUTA COMPLETA del archivo
// (chrome.downloads la conoce, la página no) y la pestaña la copia al portapapeles entre comillas, lista para pegarla.
if (chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener((delta) => {
    if (!delta.state || delta.state.current !== 'complete') return;
    chrome.downloads.search({ id: delta.id }, (items) => {
      const it = items && items[0];
      if (!it || !/caja_negra[^\\/]*\.json$/i.test(it.filename || '')) return;
      chrome.tabs.query({ url: 'https://play.mumagdalenas.com/*' }, (tabs) => {
        (tabs || []).forEach((t) => { try { chrome.tabs.sendMessage(t.id, { tipo: 'ruta_caja', ruta: it.filename }, () => void chrome.runtime.lastError); } catch (e) { /* nada */ } });
      });
    });
  });
}

// Recarga en caliente: al recargar la extensión en chrome://extensions (botón de la flecha circular) se reinyectan los módulos en las pestañas
// del juego que ya están abiertas, sin F5 y sin volver a entrar al juego. NO se reinyectan paquetes.js, bichos.js ni vigia.js (envuelven el WebSocket
// de la conexión actual): si cambian, hace falta F5. La primera vez que se instala esta versión también hace falta un F5.
const HOT = ['modo.js', 'mover.js', 'pantalla.js', 'piloto.js', 'caja.js', 'joyas.js', 'hechizo.js', 'ciclo.js', 'stats.js', 'grupo.js', 'golpes.js', 'agresor.js', 'telemetria.js', 'lab.js'];
async function reinyectar() {
  const version = chrome.runtime.getManifest().version;
  const tabs = await chrome.tabs.query({ url: 'https://play.mumagdalenas.com/*' });
  for (const t of tabs) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: t.id }, world: 'MAIN',
        func: (v) => {
          (window.__muIds || []).splice(0).forEach((id) => window.clearInterval(id));
          (window.__muLimpiar || []).splice(0).forEach((f) => { try { f(); } catch (e) { /* nada */ } });
          window.__muVersionHot = v;
        },
        args: [version],
      });
      await chrome.scripting.executeScript({ target: { tabId: t.id }, world: 'MAIN', files: HOT });
      await chrome.scripting.executeScript({ target: { tabId: t.id }, world: 'ISOLATED', files: ['puente.js'] });
    } catch (e) { /* pestaña sin permiso o cerrada */ }
  }
}
chrome.runtime.onInstalled.addListener(() => { reinyectar().catch(() => {}); });
