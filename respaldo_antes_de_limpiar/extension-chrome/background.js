// Service worker: manda los avisos a Discord. Enfriamiento por clave y tope global para que un spam no llene el canal.
const ENFRIAMIENTO_S = {
  muerte: 60, desconexion: 600, vida_baja: 120, trabado: 600, helper_falla: 600, helper_falla2: 600,
  reset: 0, reset_listo: 600, helper_on: 120,
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
