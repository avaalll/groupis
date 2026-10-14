/* Service worker: оболочка приложения (app shell) доступна офлайн.
   Два кеша:
   — CACHE (VERSION) — страница и манифесты; при изменении index.html увеличьте VERSION;
   — STATIC_CACHE (STATIC_VERSION) — тяжёлые файлы, которые меняются редко (3D-модели, three.js, текстуры,
     иконки, библиотека Supabase, шрифты). Он переживает обновления приложения: иначе каждый выпуск заново
     качал бы ~4 МБ, и первый запуск после обновления тормозил. Поменяли один из этих файлов — увеличьте
     STATIC_VERSION. */

const VERSION = 'v1.1.50';
const CACHE = `groupis-${VERSION}`;
const STATIC_VERSION = 's2';
const STATIC_CACHE = `groupis-static-${STATIC_VERSION}`;

const APP_SHELL = [
  './index.html',
  './manifest.webmanifest',
  './manifest-acid.webmanifest',
  './manifest-ember.webmanifest',
  './manifest-frost.webmanifest',
];

const STATIC_FILES = [
  './three.min.js',
  './supabase.min.js',
  './avatars3d/male.glb',
  './avatars3d/female.glb',
  './img/earth-dark.jpg',
  './icons/logo.svg',
  './icons/wordmark.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  // иконки остальных цветовых схем
  './icons/acid/logo.svg',
  './icons/acid/wordmark.svg',
  './icons/acid/icon-192.png',
  './icons/acid/icon-512.png',
  './icons/acid/icon-maskable-512.png',
  './icons/acid/apple-touch-icon.png',
  './icons/ember/logo.svg',
  './icons/ember/wordmark.svg',
  './icons/ember/icon-192.png',
  './icons/ember/icon-512.png',
  './icons/ember/icon-maskable-512.png',
  './icons/ember/apple-touch-icon.png',
  './icons/frost/logo.svg',
  './icons/frost/wordmark.svg',
  './icons/frost/icon-192.png',
  './icons/frost/icon-512.png',
  './icons/frost/icon-maskable-512.png',
  './icons/frost/apple-touch-icon.png',
];
const STATIC_PATHS = new Set(STATIC_FILES.map((p) => new URL(p, self.location).pathname));

// Внешние скрипты, без которых приложение не стартует. Сейчас таких нет: библиотека Supabase лежит
// рядом (supabase.min.js) — сторонний CDN у части мобильных операторов недоступен
const CACHEABLE_EXTERNAL = [];
// Таблица шрифтов — адрес тот же, что в <link> в index.html
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap';
const FONTS_CSS_ORIGIN = 'https://fonts.googleapis.com';
const FONTS_FILE_ORIGIN = 'https://fonts.gstatic.com';
const FONT_SUBSETS = ['cyrillic', 'latin'];   // остальные наборы символов кешируются, если понадобятся

const SCOPE_PATH = new URL('./', self.location).pathname;
const isShellPage = (url) => url.pathname === SCOPE_PATH || url.pathname === SCOPE_PATH + 'index.html';

// Ответ, пришедший через перенаправление, нельзя отдать на переход по ссылке — пересобираем его
async function cleanResponse(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers });
}

// Страница и манифесты: мимо HTTP-кеша браузера, чтобы новая версия не собралась из старых файлов
function precacheShell(cache) {
  return Promise.all(APP_SHELL.map(async (url) => {
    const response = await fetch(new Request(url, { cache: 'reload' }));
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    await cache.put(url, await cleanResponse(response));
  }));
}

// Тяжёлые файлы качаем, только если их ещё нет в STATIC_CACHE — при обычном обновлении это ноль запросов.
// Из кешей прежних версий не берём: новая STATIC_VERSION как раз значит, что файлы изменились.
function precacheStatic(cache) {
  return Promise.all(STATIC_FILES.map(async (url) => {
    if (await cache.match(url)) return;
    const response = await fetch(new Request(url, { cache: 'reload' }));
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    await cache.put(url, await cleanResponse(response));
  }));
}

// Внешнее — по возможности: без сети к CDN установка всё равно проходит
function precacheExternal(cache) {
  const put = async (url) => {
    const have = (await cache.match(url)) || (await caches.match(url));
    if (have) { await cache.put(url, have.clone()).catch(() => {}); return have; }
    const response = await fetch(url, { mode: 'cors' });
    if (response.ok) await cache.put(url, response.clone());
    return response;
  };
  const fonts = async () => {
    const response = await put(FONTS_CSS);
    if (!response.ok) return;
    const css = await response.clone().text();
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
    Promise.all([
      caches.open(CACHE).then(precacheShell),
      caches.open(STATIC_CACHE).then((cache) => Promise.all([precacheStatic(cache), precacheExternal(cache)])),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('groupis-') && k !== CACHE && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// opaque — ответ на no-cors запрос (<script>, <link>) к CDN, его статус не виден, но он валиден
const cacheable = (response) => response.ok || response.type === 'opaque';

function fetchAndCache(request, cacheName) {
  return fetch(request).then((response) => {
    if (cacheable(response)) {
      const copy = response.clone();
      return caches.open(cacheName).then((cache) => cache.put(request, copy)).catch(() => {}).then(() => response);
    }
    return response;
  });
}

function staleWhileRevalidate(event, request, cacheName) {
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetchAndCache(request, cacheName);
      if (!cached) return network;
      event.waitUntil(network.catch(() => {}));
      return cached;
    })
  );
}

function cacheFirst(event, request, cacheName) {
  event.respondWith(caches.match(request).then((cached) => cached || fetchAndCache(request, cacheName)));
}

/* Страница приложения открывается сразу из кеша, без ожидания сети. Свежая версия проверяется в фоне
   (условный запрос: если страница не менялась, сервер отвечает коротким 304) и откроется при следующем запуске. */
function shellPage(event, request) {
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match('./index.html');
    const network = fetch(request, { cache: 'no-cache' }).then(async (response) => {
      if (response.ok) await cache.put('./index.html', await cleanResponse(response.clone())).catch(() => {});
      return response;
    });
    if (!cached) return network;
    event.waitUntil(network.catch(() => {}));
    return cached;
  })());
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (url.origin === FONTS_FILE_ORIGIN) cacheFirst(event, request, STATIC_CACHE);   // файлы шрифтов не меняются
    else if (url.origin === FONTS_CSS_ORIGIN || CACHEABLE_EXTERNAL.includes(request.url)) staleWhileRevalidate(event, request, STATIC_CACHE);
    // Остальные внешние запросы (Supabase API, 2ГИС и т. д.) пропускаем как есть
    return;
  }

  // Только сама страница: открытый во вкладке файл (иконка, манифест) не должен подменить её в кеше
  if (request.mode === 'navigate' && isShellPage(url)) { shellPage(event, request); return; }
  if (request.headers.has('range')) return;

  // Модели, three.js, текстуры и иконки — только из кеша: перекачивать их при каждом запуске незачем
  if (STATIC_PATHS.has(url.pathname)) { cacheFirst(event, request, STATIC_CACHE); return; }

  staleWhileRevalidate(event, request, CACHE);
});

/* ── Push-уведомления ──
   Сервер (функция send-push в Supabase) присылает { title, body, tag, open, chat }.
   Если приложение открыто и на экране — уведомление не показываем: там всё уже видно.
   На iPhone показываем всегда: за «тихие» push Safari отзывает подписку. */
/* ── Цифра на значке приложения ──
   Сколько чатов с непрочитанным. Пока приложение открыто, список чатов присылает страница (badge-sync);
   пока закрыто — каждый push о сообщении добавляет свой чат в список. Список лежит в отдельном кеше
   (имя не начинается с groupis-, поэтому обновление приложения его не стирает). */
const BADGE_CACHE = 'app-badge';
const BADGE_URL = new URL('./__badge', self.location).href;
async function readBadgeChats() {
  try {
    const res = await (await caches.open(BADGE_CACHE)).match(BADGE_URL);
    const list = res ? await res.json() : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
async function saveBadgeChats(list) {
  try {
    await (await caches.open(BADGE_CACHE)).put(BADGE_URL, new Response(JSON.stringify(list), { headers: { 'content-type': 'application/json' } }));
  } catch {}
}
async function showBadge(n) {
  try {
    if (!self.navigator.setAppBadge) return;
    if (n) await self.navigator.setAppBadge(n); else await self.navigator.clearAppBadge();
  } catch {}
}

self.addEventListener('message', (event) => {
  const d = event.data;
  if (!d || d.type !== 'badge-sync' || !Array.isArray(d.chats)) return;
  const list = [...new Set(d.chats.map(String))].slice(0, 500);
  event.waitUntil(Promise.all([saveBadgeChats(list), showBadge(list.length)]));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const ios = /iPhone|iPad|iPod/.test(self.navigator.userAgent);
    const onScreen = wins.some((c) => c.focused && c.visibilityState === 'visible');
    // приложение на экране — цифру ведёт оно само; иначе чат этого сообщения добавляется к непрочитанным
    if (!onScreen && data.chat) {
      const list = await readBadgeChats();
      if (!list.includes(data.chat)) list.push(data.chat);
      await saveBadgeChats(list);
      await showBadge(list.length);
    }
    if (!ios && onScreen) return;
    await self.registration.showNotification(data.title || 'GroupIS', {
      body: data.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { open: data.open || '', chat: data.chat || '' },
    });
  })());
});

// Нажатие на уведомление: открытое приложение выходит вперёд и показывает нужный раздел или чат, иначе — запускается
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { open = '', chat = '' } = event.notification.data || {};
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((c) => c.url.startsWith(self.registration.scope));
    if (win) {
      try { await win.focus(); } catch {}
      win.postMessage({ type: 'push-open', open, chat });
      return;
    }
    const params = new URLSearchParams();
    if (open) params.set('open', open);
    if (chat) params.set('chat', chat);
    const qs = params.toString();
    await self.clients.openWindow(qs ? `./?${qs}` : './');
  })());
});
