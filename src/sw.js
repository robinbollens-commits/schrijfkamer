/* Schrijfkamer op het web: werkt offline. De app zelf staat in een cache per versie;
   afbeeldingen ("_blob/<id>") komen uit een eigen cache die de pagina vult vanuit je account. */
const VERSION = '__VERSION__';
const FILES = __FILES__;
const APP = 'sk-app-' + VERSION, BLOBS = 'sk-blobs';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('sk-app-') && k !== APP).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  const blob = url.pathname.match(/_blob\/([0-9a-f]{32})$/);
  if (blob) {
    e.respondWith(caches.open(BLOBS).then(c => c.match(blob[1])).then(r => r || new Response('', { status: 404 })));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
