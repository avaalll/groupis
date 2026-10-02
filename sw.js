/* Service worker: оболочка приложения (app shell) доступна офлайн.
   При изменении файлов увеличьте номер версии, чтобы обновить кеш. */

const VERSION = 'v1.0.93';
const CACHE = `groupis-${VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './three.min.js',
  './manifest.webmanifest',
  './icons/logo.svg',
  './icons/wordmark.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
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
