// Mundo aislado: único con acceso a chrome.*. Pasa avisos de la página al background y la config al revés.
// El webhook de Discord se queda en chrome.storage: nunca se envía a la página.
(() => {
  const mandarCfg = () => {
    try {
      chrome.storage.local.get(['vigia', 'avisos', 'joyas', 'hechizo'], (c) =>
        window.postMessage({ __muvigiaCfg: true, cfg: { vigia: !!c.vigia, avisos: c.avisos !== false, joyas: !!c.joyas, hechizo: c.hechizo !== false } }, '*'));
    } catch (e) { /* extensión recargada */ }
  };
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.__muvigiaPide) return mandarCfg();
    if (e.data.__muvigia) {
      try {
        chrome.runtime.sendMessage({
          tipo: 'aviso',
          clave: String(e.data.clave || 'x').slice(0, 30),
          texto: String(e.data.texto || '').slice(0, 300),
          grave: !!e.data.grave,
        });
      } catch (err) { /* nada */ }
    }
  });
  try { chrome.storage.onChanged.addListener(mandarCfg); } catch (e) { /* nada */ }
  try {
    chrome.runtime.onMessage.addListener((m) => { if (m && m.tipo === 'ruta_caja' && m.ruta) window.postMessage({ __muvigiaRuta: String(m.ruta).slice(0, 600) }, '*'); });
  } catch (e) { /* nada */ }
})();
