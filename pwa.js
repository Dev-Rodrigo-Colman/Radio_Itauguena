// Instalar la web como app · Radio Itaugüeña 90.9 FM
(function () {
  // 1) Service worker (necesario para poder instalar la app)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sin soporte: no pasa nada */ });
    });
  }

  function yaInstalada() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }
  var esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var evento = null;

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('instalarBtn');
    if (!btn || yaInstalada()) return;

    // 2) Android y PC (Chrome, Edge, Samsung Internet): instalación directa
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      evento = e;
      btn.hidden = false;
    });
    window.addEventListener('appinstalled', function () {
      evento = null;
      btn.hidden = true;
    });

    // 3) iPhone y iPad: no hay instalación directa, se muestran los pasos
    if (esIOS) btn.hidden = false;

    btn.addEventListener('click', function () {
      if (evento) {
        evento.prompt();
        evento.userChoice.then(function () { evento = null; btn.hidden = true; });
      } else if (esIOS) {
        mostrarAyuda();
      }
    });
  });

  function mostrarAyuda() {
    if (document.getElementById('pwaAyuda')) return;
    var fondo = document.createElement('div');
    fondo.className = 'pwa-ayuda';
    fondo.id = 'pwaAyuda';
    fondo.setAttribute('role', 'dialog');
    fondo.setAttribute('aria-modal', 'true');
    fondo.setAttribute('aria-labelledby', 'pwaAyudaTitulo');

    var caja = document.createElement('div');
    caja.className = 'pwa-ayuda-caja';
    var h = document.createElement('h3');
    h.id = 'pwaAyudaTitulo';
    h.textContent = 'Instalar la app en tu iPhone';
    var ol = document.createElement('ol');
    ['Tocá el botón Compartir (el cuadrado con una flecha hacia arriba) en la barra de Safari.',
     'Elegí "Agregar a pantalla de inicio".',
     'Tocá "Agregar". Listo: la radio queda como una app en tu pantalla.'].forEach(function (t) {
      var li = document.createElement('li');
      li.textContent = t;
      ol.appendChild(li);
    });
    var cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.className = 'ad-btn';
    cerrar.textContent = 'Entendido';
    function quitar() { if (fondo.parentNode) fondo.parentNode.removeChild(fondo); document.removeEventListener('keydown', tecla); }
    function tecla(ev) { if (ev.key === 'Escape') quitar(); }
    cerrar.onclick = quitar;
    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) quitar(); });
    document.addEventListener('keydown', tecla);

    caja.appendChild(h); caja.appendChild(ol); caja.appendChild(cerrar);
    fondo.appendChild(caja);
    document.body.appendChild(fondo);
    cerrar.focus();
  }
})();