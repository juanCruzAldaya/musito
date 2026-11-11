const $ = (id) => document.getElementById(id);
const msg = (t) => { $('msg').textContent = t; };
const valido = (u) => /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(u);

chrome.storage.local.get(['vigia', 'avisos', 'joyas', 'hechizo', 'webhook'], (c) => {
  $('vigia').checked = !!c.vigia;
  $('hechizo').checked = c.hechizo !== false;
  $('joyas').checked = !!c.joyas;
  $('avisos').checked = c.avisos !== false;
  if (c.webhook) $('webhook').placeholder = '(ya hay uno guardado; pegá otro para cambiarlo)';
});

$('guardar').onclick = () => {
  const datos = { vigia: $('vigia').checked, avisos: $('avisos').checked, joyas: $('joyas').checked, hechizo: $('hechizo').checked };
  const w = $('webhook').value.trim();
  if (w) {
    if (!valido(w)) return msg('Ese webhook no parece válido.');
    datos.webhook = w;
  }
  chrome.storage.local.set(datos, () => { $('webhook').value = ''; msg('Guardado.'); });
};
$('prueba').onclick = () => {
  msg('Enviando…');
  chrome.runtime.sendMessage({ tipo: 'prueba' }, (r) => msg(r && r.ok ? 'Llegó a Discord.' : 'No se pudo: ' + ((r && r.motivo) || 'sin respuesta')));
};
$('borrar').onclick = () => chrome.storage.local.remove('webhook', () => msg('Webhook borrado.'));
