// Modo claro / oscuro · Radio Itaugüeña 90.9 FM
// Guarda la elección de la persona en su navegador (localStorage, clave "tema").
(function () {
  var raiz = document.documentElement;

  function guardado() {
    try { return localStorage.getItem('tema'); } catch (e) { return null; }
  }
  function guardar(t) {
    try { localStorage.setItem('tema', t); } catch (e) { /* sin almacenamiento: no pasa nada */ }
  }
  function esOscuro() { return raiz.getAttribute('data-tema') === 'oscuro'; }
  function aplicar(t) {
    if (t === 'oscuro') raiz.setAttribute('data-tema', 'oscuro');
    else raiz.removeAttribute('data-tema');
  }

  // Se aplica enseguida, antes de pintar la página, para evitar el parpadeo
  aplicar(guardado());

  document.addEventListener('DOMContentLoaded', function () {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tema-btn';

    function actualizar() {
      var o = esOscuro();
      b.setAttribute('aria-pressed', o ? 'true' : 'false');
      b.setAttribute('aria-label', o ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
      b.title = o ? 'Modo claro' : 'Modo oscuro';
      b.innerHTML = '<i class="fa-solid ' + (o ? 'fa-sun' : 'fa-moon') + '" aria-hidden="true"></i>';
    }

    b.addEventListener('click', function () {
      var nuevo = esOscuro() ? 'claro' : 'oscuro';
      aplicar(nuevo);
      guardar(nuevo);
      actualizar();
    });

    actualizar();
    document.body.appendChild(b);
  });
})();