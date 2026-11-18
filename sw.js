// Service worker · Radio Itaugüeña 90.9 FM
// Guarda una copia de los archivos de la web para abrirla más rápido y que la app instalada
// arranque aunque la conexión falle. Siempre intenta primero la versión más nueva de internet.
// No toca el audio en vivo ni nada de otros sitios.
var CACHE = 'radio-itauguena-v1';
var BASICOS = ['./', 'index.html', 'styles.css', 'tema.js', 'pwa.js', 'logo.jpeg', 'icon-192.png', 'icon-512.png', 'favicon-32.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(BASICOS.map(function (u) { return c.add(u).catch(function () {}); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (nombres) {
      return Promise.all(nombres.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copia = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copia); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (r) {
        return r || (req.mode === 'navigate' ? caches.match('index.html') : undefined);
      });
    })
  );
});