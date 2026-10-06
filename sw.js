/* Service worker: оболочка приложения (app shell) доступна офлайн.
   При изменении файлов увеличьте номер версии, чтобы обновить кеш. */

const VERSION = 'v1.1.10';
const CACHE = `groupis-${VERSION}`;

const APP_SHELL = [
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

// Внешние скрипты, без которых приложение не стартует
const CACHEABLE_EXTERNAL = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];
// Таблица шрифтов — адрес тот же, что в <link> в index.html
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Unbounded:wght@500;600&family=JetBrains+Mono:wght@500&display=swap';
const FONTS_CSS_ORIGIN = 'https://fonts.googleapis.com';
const FONTS_FILE_ORIGIN = 'https://fonts.gstatic.com';
const FONT_SUBSETS = ['cyrillic', 'latin'];   // остальные наборы символов кешируются, если понадобятся

// Сколько ждём страницу из сети, прежде чем показать сохранённую (медленная или «зависшая» связь)
const NAV_TIMEOUT = 3500;

const SCOPE_PATH = new URL('./', self.location).pathname;
const isShellPage = (url) => url.pathname === SCOPE_PATH || url.pathname === SCOPE_PATH + 'index.html';

// Ответ, пришедший через перенаправление, нельзя отдать на переход по ссылке — пересобираем его
async function cleanResponse(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers });
}

// Оболочка: мимо HTTP-кеша браузера, чтобы новая версия не собралась из старых файлов
function precacheShell(cache) {
  return Promise.all(APP_SHELL.map(async (url) => {
    const response = await fetch(new Request(url, { cache: 'reload' }));
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    await cache.put(url, await cleanResponse(response));
  }));
}

// Внешнее — по возможности: без сети к CDN установка всё равно проходит
function precacheExternal(cache) {
  const put = async (url) => {
    const response = await fetch(url, { mode: 'cors' });
    if (response.ok) await cache.put(url, response.clone());
    return response;
  };
  const fonts = async () => {
    const response = await put(FONTS_CSS);
    if (!response.ok) return;
    const css = await response.text();
    const files = new Set();
    for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{[^}]*?url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)) {
      if (FONT_SUBSETS.includes(m[1])) files.add(m[2]);
    }
    await Promise.all([...files].map((url) => put(url).catch(() => {})));
  };
  return Promise.all([...CACHEABLE_EXTERNAL.map(put), fonts()].map((p) => p.catch(() => {})));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all([precacheShell(cache), precacheExternal(cache)]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('groupis-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// opaque — ответ на no-cors запрос (<script>, <link>) к CDN, его статус не виден, но он валиден
const cacheable = (response) => response.ok || response.type === 'opaque';

function fetchAndCache(request) {
  return fetch(request).then((response) => {
    if (cacheable(response)) {
      const copy = response.clone();
      return caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {}).then(() => response);
    }
    return response;
  });
}

function staleWhileRevalidate(event, request) {
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetchAndCache(request);
      if (!cached) return network;
      event.waitUntil(network.catch(() => {}));
      return cached;
    })
  );
}

function cacheFirst(event, request) {
  event.respondWith(caches.match(request).then((cached) => cached || fetchAndCache(request)));
}

/* Страница приложения: свежая из сети, а если сети нет, она не отвечает за NAV_TIMEOUT
   или сервер вернул ошибку — сохранённая. Так же открываются ярлыки (./?open=…). */
function shellPage(event, request) {
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match('./index.html');
    const network = fetch(request).then(async (response) => {
      if (response.ok) {
        const copy = await cleanResponse(response.clone());
        await cache.put('./index.html', copy).catch(() => {});
      }
      return response;
    });
    if (!cached) return network;
    event.waitUntil(network.catch(() => {}));
    const fresh = await Promise.race([
      network.catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT)),
    ]);
    return fresh && fresh.ok ? fresh : cached;
  })());
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (url.origin === FONTS_FILE_ORIGIN) cacheFirst(event, request);   // файлы шрифтов не меняются
    else if (url.origin === FONTS_CSS_ORIGIN || CACHEABLE_EXTERNAL.includes(request.url)) staleWhileRevalidate(event, request);
    // Остальные внешние запросы (Supabase API, 2ГИС и т. д.) пропускаем как есть
    return;
  }

  // Только сама страница: открытый во вкладке файл (иконка, манифест) не должен подменить её в кеше
  if (request.mode === 'navigate' && isShellPage(url)) { shellPage(event, request); return; }
  if (request.headers.has('range')) return;

  staleWhileRevalidate(event, request);
});
