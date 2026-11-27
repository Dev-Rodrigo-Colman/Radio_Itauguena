// Pantalla de bienvenida con el logo · Radio Itaugüeña 90.9 FM
// Se muestra una vez por visita (no cada vez que se vuelve a la página principal).
(function () {
  try {
    if (sessionStorage.getItem('splash')) {
      document.documentElement.classList.add('sin-splash');
      return;
    }
    sessionStorage.setItem('splash', '1');
  } catch (e) { /* sin almacenamiento: se muestra igual */ }
})();