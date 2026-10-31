// radio-api · Worker de Radio Itaugüeña 90.9 FM
//
// Rutas públicas (las usa la web):
//   GET  /anuncios      lista de anuncios vigentes
//   GET  /img/:n        imagen del espacio n (1 a 9)
//   GET  /visitas       total de visitas
//   POST /visitas       suma una visita y devuelve el total
//   GET  /oyentes       oyentes conectados ahora
//
// Panel del dueño (con contraseña):
//   GET  /admin
//   POST /admin/login · POST /admin/logout
//   GET  /admin/api/estado · POST /admin/api/guardar · POST /admin/api/quitar
//
// Configuración en Cloudflare:
//   Binding KV:  DATOS            (namespace "radio_datos")
//   Secret:      ADMIN_PASSWORD   (la contraseña del panel)

const ESPACIOS = 9;
const MAX_IMAGEN = 500 * 1024;
const SESION_HORAS = 8;
const ORIGENES = ['https://radioitauguena909.com', 'https://www.radioitauguena909.com'];

const enc = new TextEncoder();

// ---------- utilidades ----------

function origenPermitido(origin) {
  if (!origin) return null;
  if (ORIGENES.includes(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function cabeceras(request, extra) {
  const h = { 'Vary': 'Origin' };
  const o = origenPermitido(request.headers.get('Origin'));
  if (o) h['Access-Control-Allow-Origin'] = o;
  return Object.assign(h, extra || {});
}

function json(request, datos, estado, extra) {
  return new Response(JSON.stringify(datos), {
    status: estado || 200,
    headers: cabeceras(request, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, extra || {}))
  });
}

function hoyEnParaguay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
}

function vigente(a) {
  if (!a || !a.activo || !a.v) return false;
  if (a.vence && hoyEnParaguay() > a.vence) return false;
  return true;
}

function numeroEspacio(texto) {
  const n = parseInt(texto, 10);
  return n >= 1 && n <= ESPACIOS && String(n) === String(texto).trim() ? n : null;
}

async function leerMeta(env) {
  const crudo = await env.DATOS.get('anuncios');
  if (!crudo) return {};
  try { return JSON.parse(crudo) || {}; } catch (e) { return {}; }
}

// Acepta un enlace web o un número de WhatsApp y devuelve un enlace seguro (http/https) o ''
function normalizarEnlace(entrada) {
  const t = String(entrada || '').trim();
  if (!t) return '';
  if (/^[\d\s+\-()]+$/.test(t)) {
    let d = t.replace(/\D/g, '');
    if (d.startsWith('0')) d = '595' + d.slice(1);
    else if (!d.startsWith('595')) d = '595' + d;
    if (d.length < 11 || d.length > 14) return null;
    return 'https://wa.me/' + d;
  }
  let url = t;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch (e) {
    return null;
  }
}

// ---------- sesión del panel ----------

function b64url(bytes) {
  let s = '';
  bytes.forEach(function (b) { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function firmar(clave, texto) {
  const k = await crypto.subtle.importKey('raw', enc.encode(clave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, enc.encode(texto));
  return b64url(new Uint8Array(s));
}

async function iguales(a, b) {
  const x = await firmar('comparar', a);
  const y = await firmar('comparar', b);
  let d = x.length ^ y.length;
  for (let i = 0; i < x.length && i < y.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

async function crearSesion(env) {
  const vence = Date.now() + SESION_HORAS * 3600 * 1000;
  return vence + '.' + (await firmar(env.ADMIN_PASSWORD, 'sesion.' + vence));
}

async function sesionValida(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)sesion=([^;]+)/);
  if (!m) return false;
  const partes = m[1].split('.');
  if (partes.length !== 2) return false;
  const vence = parseInt(partes[0], 10);
  if (!vence || vence < Date.now()) return false;
  return iguales(partes[1], await firmar(env.ADMIN_PASSWORD, 'sesion.' + vence));
}

function cookieSesion(valor, segundos) {
  return 'sesion=' + valor + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + segundos;
}

// ---------- oyentes en vivo ----------

async function contarOyentes() {
  const candidatos = [
    'https://stream.radiosenpy.net:10898/7.html',
    'http://stream.radiosenpy.net:8202/7.html',
    'https://stream.radiosenpy.net:10898/stats?sid=1&json=1'
  ];
  for (const u of candidatos) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) });
      if (!r.ok) continue;
      const t = await r.text();
      if (u.includes('json=1')) {
        const j = JSON.parse(t);
        if (typeof j.currentlisteners === 'number') return j.currentlisteners;
        continue;
      }
      const limpio = t.replace(/<[^>]*>/g, '').trim();
      if (/^\d+,\d/.test(limpio)) return parseInt(limpio.split(',')[0], 10);
    } catch (e) { /* probar el siguiente */ }
  }
  return null;
}

// ---------- panel: acciones ----------

async function guardarAnuncio(request, env) {
  let form;
  try { form = await request.formData(); } catch (e) { return { error: 'Datos inválidos.', estado: 400 }; }

  const slot = numeroEspacio(form.get('slot'));
  if (!slot) return { error: 'Espacio inválido.', estado: 400 };

  const nombre = String(form.get('nombre') || '').trim().slice(0, 60);
  const enlace = normalizarEnlace(form.get('enlace'));
  if (enlace === null) return { error: 'El enlace no es válido. Escribí una dirección web o un número de WhatsApp.', estado: 400 };

  const vence = String(form.get('vence') || '').trim();
  if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) return { error: 'La fecha de vencimiento no es válida.', estado: 400 };

  const meta = await leerMeta(env);
  const previo = meta[slot] || {};
  let version = previo.v || 0;

  const archivo = form.get('imagen');
  if (archivo && typeof archivo !== 'string' && archivo.size > 0) {
    if (archivo.size > MAX_IMAGEN) return { error: 'La imagen es muy pesada (máximo 500 KB).', estado: 413 };
    const datos = await archivo.arrayBuffer();
    const b = new Uint8Array(datos);
    if (!(b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF)) return { error: 'La imagen tiene que ser JPG.', estado: 415 };
    await env.DATOS.put('img:' + slot, datos);
    version = Date.now();
  }
  if (!version) return { error: 'Falta la imagen del anuncio.', estado: 400 };

  meta[slot] = { nombre: nombre, enlace: enlace, activo: form.get('activo') === '1', vence: vence, v: version };
  await env.DATOS.put('anuncios', JSON.stringify(meta));
  return { ok: true };
}

async function quitarAnuncio(request, env) {
  let cuerpo;
  try { cuerpo = await request.json(); } catch (e) { return { error: 'Datos inválidos.', estado: 400 }; }
  const slot = numeroEspacio(cuerpo && cuerpo.slot);
  if (!slot) return { error: 'Espacio inválido.', estado: 400 };
  const meta = await leerMeta(env);
  delete meta[slot];
  await env.DATOS.put('anuncios', JSON.stringify(meta));
  await env.DATOS.delete('img:' + slot);
  return { ok: true };
}

// ---------- enrutador ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ruta = url.pathname.replace(/\/+$/, '') || '/';
    const metodo = request.method;

    if (metodo === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: cabeceras(request, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' })
      });
    }

    // --- públicas ---
    if (ruta === '/anuncios' && metodo === 'GET') {
      const meta = await leerMeta(env);
      const lista = [];
      for (let n = 1; n <= ESPACIOS; n++) {
        const a = meta[n];
        if (vigente(a)) lista.push({ slot: n, nombre: a.nombre, enlace: a.enlace, imagen: url.origin + '/img/' + n + '?v=' + a.v });
      }
      return json(request, lista, 200, { 'Cache-Control': 'public, max-age=60' });
    }

    const mImg = ruta.match(/^\/img\/(\d+)$/);
    if (mImg && metodo === 'GET') {
      const n = numeroEspacio(mImg[1]);
      const datos = n ? await env.DATOS.get('img:' + n, 'arrayBuffer') : null;
      if (!datos) return new Response('No encontrada', { status: 404 });
      return new Response(datos, {
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'Cross-Origin-Resource-Policy': 'cross-origin' }
      });
    }

    if (ruta === '/visitas' && (metodo === 'GET' || metodo === 'POST')) {
      let total = parseInt((await env.DATOS.get('visitas')) || '0', 10) || 0;
      if (metodo === 'POST') {
        total += 1;
        await env.DATOS.put('visitas', String(total));
      }
      return json(request, { total: total }, 200, { 'Cache-Control': 'no-store' });
    }

    if (ruta === '/oyentes' && metodo === 'GET') {
      return json(request, { oyentes: await contarOyentes() }, 200, { 'Cache-Control': 'public, max-age=15' });
    }

    // --- panel ---
    if (ruta === '/admin' || ruta.startsWith('/admin/')) {
      if (!env.ADMIN_PASSWORD) return new Response('Falta configurar ADMIN_PASSWORD en el Worker.', { status: 503 });

      if (ruta === '/admin' && metodo === 'GET') {
        return new Response(PANEL_HTML, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex',
            'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
          }
        });
      }

      const origen = request.headers.get('Origin');
      if (metodo === 'POST' && origen && origen !== url.origin) return new Response('Origen no permitido', { status: 403 });

      if (ruta === '/admin/login' && metodo === 'POST') {
        let cuerpo = {};
        try { cuerpo = await request.json(); } catch (e) { /* vacío */ }
        if (await iguales(String(cuerpo.password || ''), env.ADMIN_PASSWORD)) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookieSesion(await crearSesion(env), SESION_HORAS * 3600) }
          });
        }
        await new Promise(function (r) { setTimeout(r, 800); });
        return new Response(JSON.stringify({ error: 'Contraseña incorrecta.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }

      if (ruta === '/admin/logout' && metodo === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookieSesion('', 0) } });
      }

      if (!(await sesionValida(request, env))) {
        return new Response(JSON.stringify({ error: 'Sesión vencida. Ingresá de nuevo.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }

      if (ruta === '/admin/api/estado' && metodo === 'GET') {
        const meta = await leerMeta(env);
        const espacios = [];
        for (let n = 1; n <= ESPACIOS; n++) {
          const a = meta[n];
          espacios.push(a ? { slot: n, nombre: a.nombre, enlace: a.enlace, activo: a.activo, vence: a.vence, vigente: vigente(a), imagen: '/img/' + n + '?v=' + a.v } : { slot: n, vacio: true });
        }
        const visitas = parseInt((await env.DATOS.get('visitas')) || '0', 10) || 0;
        return new Response(JSON.stringify({ espacios: espacios, visitas: visitas }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      }

      if ((ruta === '/admin/api/guardar' || ruta === '/admin/api/quitar') && metodo === 'POST') {
        const r = ruta.endsWith('guardar') ? await guardarAnuncio(request, env) : await quitarAnuncio(request, env);
        return new Response(JSON.stringify(r.error ? { error: r.error } : { ok: true }), { status: r.estado || 200, headers: { 'Content-Type': 'application/json' } });
      }
    }

    return new Response('No encontrado', { status: 404 });
  }
};

// ---------- página del panel ----------

const PANEL_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Publicidad · Radio Itaugüeña</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --marino:#0a2558; --marino-oscuro:#06183b; --dorado:#d4af37; --dorado-claro:#f3e5ab; --fondo:#eef1f6; --texto:#1b2433; --suave:#5b6577; --ok:#1d7a46; --error:#b3261e; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:'Poppins', system-ui, sans-serif; background:var(--fondo); color:var(--texto); }
  header { background:var(--marino); color:#fff; padding:16px 20px; display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom:3px solid var(--dorado); }
  header h1 { font-size:1.05rem; font-weight:600; margin:0; }
  header small { display:block; color:var(--dorado-claro); font-weight:400; font-size:.78rem; }
  button { font:inherit; cursor:pointer; }
  button:focus-visible, input:focus-visible { outline:3px solid var(--dorado); outline-offset:2px; }
  .salir { background:transparent; color:#fff; border:1px solid rgba(255,255,255,.5); border-radius:8px; padding:6px 12px; }
  main { max-width:760px; margin:0 auto; padding:18px 14px 60px; }
  .resumen { color:var(--suave); font-size:.9rem; margin:4px 2px 14px; }
  #aviso { display:none; position:sticky; top:8px; z-index:5; padding:12px 14px; border-radius:10px; font-weight:500; margin-bottom:12px; box-shadow:0 4px 14px rgba(0,0,0,.15); }
  #aviso.ok { background:#e3f4ea; color:var(--ok); border:1px solid #b6e0c6; }
  #aviso.error { background:#fdecea; color:var(--error); border:1px solid #f3c1bc; }
  details { background:#fff; border-radius:12px; margin-bottom:10px; border:1px solid #dbe1ec; overflow:hidden; }
  summary { list-style:none; cursor:pointer; padding:14px 16px; display:flex; align-items:center; gap:12px; }
  summary::-webkit-details-marker { display:none; }
  summary .mini { width:54px; height:45px; border-radius:6px; background:#e6eaf2; object-fit:cover; flex:none; }
  summary .titulo { flex:1; min-width:0; }
  summary .titulo strong { display:block; font-weight:600; }
  summary .titulo span { display:block; font-size:.82rem; color:var(--suave); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .estado { font-size:.78rem; font-weight:600; padding:3px 10px; border-radius:20px; flex:none; }
  .estado.activo { background:#e3f4ea; color:var(--ok); }
  .estado.vencido { background:#fdf0d5; color:#8a5a00; }
  .estado.oculto { background:#e6eaf2; color:var(--suave); }
  .estado.vacio { background:#fff; color:var(--suave); border:1px dashed #b8c1d3; }
  .cuerpo { padding:4px 16px 18px; border-top:1px solid #e6eaf2; }
  .vista { margin:14px 0 8px; aspect-ratio:6/5; max-width:300px; width:100%; border:2px dashed var(--dorado); border-radius:12px; display:flex; align-items:center; justify-content:center; background:#fafbfd; overflow:hidden; color:var(--suave); font-size:.85rem; text-align:center; }
  .vista img { width:100%; height:100%; object-fit:contain; background:#fff; }
  label { display:block; font-weight:500; font-size:.88rem; margin:14px 0 5px; }
  input[type=text], input[type=date] { width:100%; padding:11px 12px; border:1.5px solid #c8d0df; border-radius:8px; font:inherit; background:#fff; }
  .ayuda { font-size:.78rem; color:var(--suave); margin-top:4px; }
  .fila-check { display:flex; align-items:center; gap:10px; margin-top:16px; font-weight:500; }
  .fila-check input { width:20px; height:20px; accent-color:var(--marino); }
  .botones { display:flex; flex-wrap:wrap; gap:10px; margin-top:20px; }
  .btn { border-radius:10px; padding:11px 18px; font-weight:600; border:2px solid transparent; }
  .btn.primario { background:var(--marino); color:#fff; border-color:var(--dorado); }
  .btn.secundario { background:#fff; color:var(--marino); border-color:#c8d0df; }
  .btn.peligro { background:#fff; color:var(--error); border-color:#f0c4bf; }
  .btn:disabled { opacity:.55; cursor:wait; }
  #login { max-width:380px; margin:70px auto; padding:0 18px; }
  #login .caja { background:#fff; border-radius:14px; padding:26px 22px; border:1px solid #dbe1ec; }
  #login h2 { margin:0 0 4px; font-size:1.2rem; color:var(--marino); }
  #login p { margin:0 0 6px; color:var(--suave); font-size:.9rem; }
  .oculto-js { display:none; }
  @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
</style>
</head>
<body>

<section id="login" class="oculto-js">
  <div class="caja">
    <h2>Publicidad de la radio</h2>
    <p>Ingresá con la contraseña para editar los anuncios de la web.</p>
    <label for="clave">Contraseña</label>
    <input type="password" id="clave" autocomplete="current-password" style="width:100%;padding:11px 12px;border:1.5px solid #c8d0df;border-radius:8px;font:inherit;">
    <div class="botones"><button class="btn primario" id="entrar">Ingresar</button></div>
    <div id="errorLogin" class="ayuda" style="color:var(--error);min-height:1.2em;margin-top:10px;"></div>
  </div>
</section>

<section id="panel" class="oculto-js">
  <header>
    <h1>Publicidad de la web<small>Radio Itaugüeña 90.9 FM</small></h1>
    <button class="salir" id="salir">Salir</button>
  </header>
  <main>
    <div id="aviso" role="status"></div>
    <p class="resumen" id="resumen"></p>
    <div id="lista"></div>
  </main>
</section>

<script>
var $ = function (id) { return document.getElementById(id); };
var pendientes = {};

function aviso(texto, tipo) {
  var a = $('aviso');
  a.textContent = texto;
  a.className = tipo;
  a.style.display = 'block';
  clearTimeout(aviso.t);
  aviso.t = setTimeout(function () { a.style.display = 'none'; }, 5000);
}

function mostrar(seccion) {
  $('login').className = seccion === 'login' ? '' : 'oculto-js';
  $('panel').className = seccion === 'panel' ? '' : 'oculto-js';
}

function pedir(ruta, opciones) {
  opciones = opciones || {};
  opciones.credentials = 'same-origin';
  return fetch(ruta, opciones).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (datos) {
      if (r.status === 401 && ruta.indexOf('/admin/login') === -1) { mostrar('login'); }
      if (!r.ok) { throw new Error(datos.error || 'Ocurrió un error. Probá de nuevo.'); }
      return datos;
    });
  });
}

function fechaLinda(iso) {
  if (!iso) return '';
  var p = iso.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

function redimensionar(archivo, listo) {
  var img = new Image();
  var url = URL.createObjectURL(archivo);
  img.onload = function () {
    var r = Math.min(600 / img.width, 500 / img.height, 1);
    var w = Math.round(img.width * r), h = Math.round(img.height * r);
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    var calidad = 0.86;
    (function intentar() {
      c.toBlob(function (b) {
        if (b && b.size > 450 * 1024 && calidad > 0.4) { calidad -= 0.12; intentar(); return; }
        URL.revokeObjectURL(url);
        listo(b);
      }, 'image/jpeg', calidad);
    })();
  };
  img.onerror = function () { URL.revokeObjectURL(url); listo(null); };
  img.src = url;
}

function etiquetaEstado(e) {
  if (e.vacio) return ['vacio', 'Libre'];
  if (!e.activo) return ['oculto', 'Oculto'];
  if (!e.vigente) return ['vencido', 'Vencido'];
  return ['activo', 'Activo'];
}

function crearTarjeta(e) {
  var det = document.createElement('details');
  var est = etiquetaEstado(e);

  var sum = document.createElement('summary');
  var mini = document.createElement('img');
  mini.className = 'mini';
  mini.alt = '';
  if (!e.vacio) mini.src = e.imagen;
  sum.appendChild(mini);
  var tit = document.createElement('div');
  tit.className = 'titulo';
  var s1 = document.createElement('strong');
  s1.textContent = 'Espacio ' + e.slot;
  var s2 = document.createElement('span');
  s2.textContent = e.vacio ? 'Sin anuncio' : ((e.nombre || 'Sin nombre') + (e.vence ? ' · vence el ' + fechaLinda(e.vence) : ''));
  tit.appendChild(s1); tit.appendChild(s2);
  sum.appendChild(tit);
  var chip = document.createElement('span');
  chip.className = 'estado ' + est[0];
  chip.textContent = est[1];
  sum.appendChild(chip);
  det.appendChild(sum);

  var cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';

  var vista = document.createElement('div');
  vista.className = 'vista';
  if (e.vacio) vista.textContent = 'Todavía no hay imagen';
  else { var vi = document.createElement('img'); vi.src = e.imagen; vi.alt = e.nombre || ''; vista.appendChild(vi); }
  cuerpo.appendChild(vista);

  var archivo = document.createElement('input');
  archivo.type = 'file';
  archivo.accept = 'image/*';
  archivo.style.display = 'none';
  var btnImg = document.createElement('button');
  btnImg.type = 'button';
  btnImg.className = 'btn secundario';
  btnImg.textContent = e.vacio ? 'Elegir imagen' : 'Cambiar imagen';
  btnImg.onclick = function () { archivo.click(); };
  archivo.onchange = function () {
    if (!archivo.files[0]) return;
    redimensionar(archivo.files[0], function (blob) {
      if (!blob) { aviso('No se pudo leer esa imagen. Probá con otra.', 'error'); return; }
      pendientes[e.slot] = blob;
      vista.textContent = '';
      var im = document.createElement('img');
      im.src = URL.createObjectURL(blob);
      vista.appendChild(im);
    });
  };
  cuerpo.appendChild(btnImg);
  cuerpo.appendChild(archivo);

  function campo(texto, tipo, valor, ayuda) {
    var l = document.createElement('label');
    l.textContent = texto;
    var i = document.createElement('input');
    i.type = tipo;
    i.value = valor || '';
    l.appendChild(i);
    if (ayuda) { var a = document.createElement('div'); a.className = 'ayuda'; a.textContent = ayuda; l.appendChild(a); }
    cuerpo.appendChild(l);
    return i;
  }
  var nombre = campo('Nombre del anunciante', 'text', e.nombre, '');
  var enlace = campo('Enlace o WhatsApp', 'text', e.enlace, 'Una página web, o un número de WhatsApp como 0984 123 456.');
  var vence = campo('Se muestra hasta', 'date', e.vence, 'Dejalo vacío si no tiene fecha de fin.');

  var fc = document.createElement('label');
  fc.className = 'fila-check';
  var chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.checked = e.vacio ? true : !!e.activo;
  fc.appendChild(chk);
  fc.appendChild(document.createTextNode('Mostrar en la web'));
  cuerpo.appendChild(fc);

  var botones = document.createElement('div');
  botones.className = 'botones';
  var guardar = document.createElement('button');
  guardar.type = 'button';
  guardar.className = 'btn primario';
  guardar.textContent = 'Guardar cambios';
  guardar.onclick = function () {
    var fd = new FormData();
    fd.append('slot', e.slot);
    fd.append('nombre', nombre.value);
    fd.append('enlace', enlace.value);
    fd.append('vence', vence.value);
    fd.append('activo', chk.checked ? '1' : '0');
    if (pendientes[e.slot]) fd.append('imagen', pendientes[e.slot], 'anuncio.jpg');
    guardar.disabled = true;
    pedir('/admin/api/guardar', { method: 'POST', body: fd }).then(function () {
      delete pendientes[e.slot];
      aviso('Cambios guardados. En un minuto se ven en la web.', 'ok');
      cargar(e.slot);
    }).catch(function (err) { aviso(err.message, 'error'); }).then(function () { guardar.disabled = false; });
  };
  botones.appendChild(guardar);

  if (!e.vacio) {
    var quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.className = 'btn peligro';
    quitar.textContent = 'Quitar anuncio';
    quitar.onclick = function () {
      if (!confirm('¿Quitar el anuncio del espacio ' + e.slot + '? Se borra la imagen.')) return;
      pedir('/admin/api/quitar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot: e.slot }) })
        .then(function () { delete pendientes[e.slot]; aviso('Anuncio quitado.', 'ok'); cargar(); })
        .catch(function (err) { aviso(err.message, 'error'); });
    };
    botones.appendChild(quitar);
  }
  cuerpo.appendChild(botones);
  det.appendChild(cuerpo);
  return det;
}

function cargar(abrir) {
  return pedir('/admin/api/estado').then(function (d) {
    var lista = $('lista');
    lista.textContent = '';
    d.espacios.forEach(function (e) {
      var t = crearTarjeta(e);
      if (abrir && e.slot === abrir) t.open = true;
      lista.appendChild(t);
    });
    var activos = d.espacios.filter(function (e) { return !e.vacio && e.vigente; }).length;
    $('resumen').textContent = activos + ' de ' + d.espacios.length + ' espacios con anuncio activo · ' + d.visitas.toLocaleString('es-PY') + ' visitas a la web';
    mostrar('panel');
  }).catch(function () { mostrar('login'); });
}

$('entrar').onclick = function () {
  $('errorLogin').textContent = '';
  pedir('/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('clave').value }) })
    .then(function () { $('clave').value = ''; cargar(); })
    .catch(function (err) { $('errorLogin').textContent = err.message; });
};
$('clave').onkeydown = function (ev) { if (ev.key === 'Enter') $('entrar').click(); };
$('salir').onclick = function () { pedir('/admin/logout', { method: 'POST' }).then(function () { mostrar('login'); }); };

cargar();
</script>
</body>
</html>`;