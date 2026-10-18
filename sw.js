/*
 * CCAW service worker: lets the web version start and play without a network.
 *   - install: downloads the whole build (listed in precache.json, written at export time) into a cache named after the build.
 *     The app itself must arrive complete (otherwise the install fails and is tried again at the next visit); card art is best effort;
 *   - navigation: the stored page first (the game starts at once, network or not), the network only when nothing is stored;
 *   - everything else of the same origin: stored copy first, filled as it is used.
 *   Other origins, non-GET requests and the trade server (/v1/) are left alone.
 * Every build stamps its own id over the marker of the cache name below (scripts/pwa-postexport.ts), hence a new worker: it installs
 * beside the old one and waits. It takes over once the last page of the old build is closed, or when a page asks it to (message
 * SKIP_WAITING, sent by the "update now" button, which reloads the page as soon as the worker has taken over). It never skips the
 * waiting by itself: a page never mixes files of two builds.
 */
const CACHE = 'ccaw-bc198dd2';
const SHELL = ['./', './manifest.webmanifest'];

async function precache() {
  const cache = await caches.open(CACHE);
  let list = { core: SHELL, extra: [] };
  try {
    const response = await fetch('./precache.json', { cache: 'no-store' });
    if (response.ok) list = await response.json();
  } catch {
    // without the list only the shell is stored; the rest is stored as it is used
  }
  await cache.addAll(list.core);
  await Promise.allSettled(list.extra.map((url) => cache.add(url)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

/** The page offers the update and the player took it: this worker takes over now. */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('ccaw-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/** What to do with a request: 'page', 'asset' or null (leave it alone). */
function kindOf(request, origin) {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.origin !== origin) return null;
  if (url.pathname.startsWith('/v1/')) return null; // the trade server API, if it is served from the same origin
  return request.mode === 'navigate' ? 'page' : 'asset';
}

/** Returns the stored copy of `key` or, failing that, the network's answer (stored when it is a plain success). */
async function storedFirst(key, request) {
  const cache = await caches.open(CACHE);
  const stored = await cache.match(key);
  if (stored) return stored;
  const response = await fetch(request);
  if (response.status === 200) void cache.put(key, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const kind = kindOf(event.request, self.location.origin);
  if (kind === null) return;
  // every address of the app is the same single page: the router reads the path
  event.respondWith(storedFirst(kind === 'page' ? './' : event.request, event.request));
});
