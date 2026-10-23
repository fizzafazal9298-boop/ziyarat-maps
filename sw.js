"use strict";
/*
 * Ziyarat Maps — service worker
 * Strategy:
 *  - App shell (index, manifest, icon): cache-first, populated on install.
 *  - Leaflet CDN assets: cache-first at runtime (library code rarely changes).
 *  - Map tiles (OpenStreetMap): network-only — never cached.
 *  - APIs (Aladhan) and everything else: network-first with cache fallback
 *    for navigations only.
 */
const CACHE = "ziyarat-maps-v3-r1";
const IMGCACHE = "ziyarat-maps-v3-images";
const SHELL = ["./", "./index.html", "./manifest.json", "./icon.svg", "./quran.json", "./duas.json"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== IMGCACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Map tiles: network-only (never stored).
  if (url.hostname.endsWith("tile.openstreetmap.org") || url.hostname.endsWith(".tile.openstreetmap.org")) {
    event.respondWith(fetch(req));
    return;
  }

  // Leaflet CDN: cache-first, fill cache at runtime.
  if (url.hostname === "unpkg.com") {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // Site photos: cache-first in their own runtime cache.
  if (url.origin === self.location.origin && url.pathname.includes("/images/")) {
    event.respondWith(
      caches.open(IMGCACHE).then(cache => cache.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        cache.put(req, copy).catch(() => {});
        return res;
      })))
    );
    return;
  }

  // App shell & same-origin files: cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match("./index.html", { ignoreSearch: true })))
    );
    return;
  }

  // Everything else (e.g. Aladhan API): network-first; navigations fall back
  // to the cached shell, other requests simply fail when offline.
  event.respondWith(
    fetch(req).catch(() => {
      if (req.mode === "navigate") return caches.match("./index.html", { ignoreSearch: true });
      return Response.error();
    })
  );
});
