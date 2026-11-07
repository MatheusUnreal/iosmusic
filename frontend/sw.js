// Service worker: deixa o app abrir instantâneo (e sem internet).
const SHELL = 'iosmusic-shell-v3';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'vendor/supabase.min.js', 'manifest.json',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('iosmusic-shell') && k !== SHELL).map((k) => caches.delete(k)),
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Capas salvas para offline
  if (url.pathname.includes('/offline-cover/')) {
    e.respondWith(caches.match(url.href).then((r) => r || new Response('', { status: 404 })));
    return;
  }

  // App: responde do cache e atualiza em segundo plano
  const key = e.request.mode === 'navigate' ? self.registration.scope : url.origin + url.pathname;
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const cached = await c.match(key);
    const fresh = fetch(e.request).then((r) => { if (r.ok) c.put(key, r.clone()); return r; }).catch(() => cached);
    return cached || fresh;
  }));
});
