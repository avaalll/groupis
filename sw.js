/* Service worker: оболочка приложения (app shell) доступна офлайн.
   При изменении файлов увеличьте номер версии, чтобы обновить кеш. */

const VERSION = 'v1.1.2';
const CACHE = `groupis-${VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './three.min.js',
  './img/earth-dark.jpg',
  './manifest.webmanifest',
  './icons/logo.svg',
  './icons/wordmark.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  // иконки и манифесты остальных цветовых схем
  './manifest-acid.webmanifest',
  './icons/acid/logo.svg',
  './icons/acid/wordmark.svg',
  './icons/acid/icon-192.png',
  './icons/acid/icon-512.png',
  './icons/acid/icon-maskable-512.png',
  './icons/acid/apple-touch-icon.png',
  './manifest-ember.webmanifest',
  './icons/ember/logo.svg',
  './icons/ember/wordmark.svg',
  './icons/ember/icon-192.png',
  './icons/ember/icon-512.png',
  './icons/ember/icon-maskable-512.png',
  './icons/ember/apple-touch-icon.png',
  './manifest-frost.webmanifest',
  './icons/frost/logo.svg',
  './icons/frost/wordmark.svg',
  './icons/frost/icon-192.png',
  './icons/frost/icon-512.png',
  './icons/frost/icon-maskable-512.png',
  './icons/frost/apple-touch-icon.png',
];

// Внешние скрипты, без которых приложение не стартует — кешируем их по мере загрузки
const CACHEABLE_EXTERNAL = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function staleWhileRevalidate(event, request) {
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          // opaque — ответ на no-cors запрос <script> к CDN, его статус не виден, но он валиден
          if (response.ok || response.type === 'opaque') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    })
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (CACHEABLE_EXTERNAL.includes(request.url)) staleWhileRevalidate(event, request);
    // Остальные внешние запросы (Supabase API, 2ГИС и т. д.) пропускаем как есть
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  staleWhileRevalidate(event, request);
});
