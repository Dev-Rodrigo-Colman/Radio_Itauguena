// Instalar la web como app · Radio Itaugüeña 90.9 FM
(function () {
  // 1) Service worker (necesario para poder instalar la app)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sin soporte: no pasa nada */ });
    });
  }

  var ua = navigator.userAgent;
  var esIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var esAndroid = /android/i.test(ua);
  var evento = null;
  var btn = null;

  function yaInstalada() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }

  // 2) Se escucha desde el principio: Chrome puede avisar antes de que cargue toda la página
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    evento = e;
  });
  window.addEventListener('appinstalled', function () {
    evento = null;
    if (btn) btn.hidden = true;
  });

  document.addEventListener('DOMContentLoaded', function () {
    btn = document.getElementById('instalarBtn');
    if (!btn || yaInstalada()) return;
    btn.hidden = false;

    btn.addEventListener('click', function () {
      if (evento) {
        // Instalación directa (Chrome, Edge, Samsung Internet)
        evento.prompt();
        evento.userChoice.then(function () { evento = null; });
      } else {
        mostrarAyuda();
      }
    });
  });

  // 3) Si el navegador no permite instalar con un toque, se explican los pasos
  function pasos() {
    if (esIOS) {
      return {
        titulo: 'Instalar la app en tu iPhone',
        lista: [
          'Abrí esta página en Safari.',
          'Tocá el botón Compartir (el cuadrado con una flecha hacia arriba).',
          'Elegí "Agregar a pantalla de inicio" y tocá "Agregar".'
        ]
      };
    }
    if (esAndroid) {
      return {
        titulo: 'Instalar la app en tu celular',
        lista: [
          'Tocá el menú ⋮ del navegador (arriba a la derecha).',
          'Elegí "Instalar app" o "Agregar a pantalla de inicio".',
          'Confirmá. Si no ves esa opción, abrí la página en Chrome, no desde WhatsApp o Facebook.'
        ]
      };
    }
    return {
      titulo: 'Instalar la app en tu computadora',
      lista: [
        'Usá Google Chrome o Microsoft Edge.',
        'Buscá el ícono de instalar en la barra de direcciones, a la derecha. Si no está, abrí el menú ⋮ y elegí "Instalar Radio Itaugüeña".'
      ]
    };
  }

  function mostrarAyuda() {
    if (document.getElementById('pwaAyuda')) return;
    var p = pasos();
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
    h.textContent = p.titulo;
    var ol = document.createElement('ol');
    p.lista.forEach(function (t) {
      var li = document.createElement('li');
      li.textContent = t;
      ol.appendChild(li);
    });
    var cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.className = 'ad-btn';
    cerrar.textContent = 'Entendido';
    function quitar() {
      if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
      document.removeEventListener('keydown', tecla);
    }
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