// PolyBot service worker.
// iOS PWA requirements we satisfy here:
//   1. Must respond to `fetch` events with a real Response (empty handler fails)
//   2. Must show notifications via registration.showNotification (not `new Notification`)
//   3. Must handle notificationclick to focus/open windows

const APP_SHELL = "polybot-shell-v4";
// SW lives under the Pages subpath; scope inherits from location.
const BASE = new URL("./", self.location).pathname;   // e.g. "/polybot-web/"
const PRECACHE = [
  BASE,
  BASE + "index.html",
  BASE + "manifest.webmanifest",
  BASE + "icon-192.png",
  BASE + "icon-512.png",
  BASE + "apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(APP_SHELL);
      // Best-effort precache — if any asset 404s (e.g. in dev), keep going.
      await Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => {})));
    } catch { /* ignore */ }
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== APP_SHELL).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network-first with cache fallback so the app still loads if the tunnel goes
// down, AND so iOS sees the SW actually respond to navigation fetches.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only handle same-origin requests — never intercept Polymarket / Reddit / Anthropic
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      // Keep a copy of successful responses for offline fallback.
      if (fresh && fresh.ok && req.destination !== "audio" && req.destination !== "video") {
        const cache = await caches.open(APP_SHELL);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      // Navigation fallback — serve the SPA shell.
      if (req.mode === "navigate") {
        const shell = await caches.match(BASE + "index.html");
        if (shell) return shell;
      }
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});

// Web Push handler — fired by the Cloudflare Worker when a backend alert
// arrives. Works when the PWA is closed / iPhone is locked.
self.addEventListener("push", (event) => {
  let data = { title: "PolyBot", body: "", url: undefined };
  if (event.data) {
    try { data = { ...data, ...event.data.json() }; }
    catch { data.body = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: "polybot:push",
      icon: BASE + "icon-192.png",
      badge: BASE + "icon-192.png",
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.location.origin)) {
        c.focus();
        if (target) c.postMessage({ type: "openUrl", url: target });
        return;
      }
    }
    if (target) return self.clients.openWindow(target);
    return self.clients.openWindow(self.location.origin);
  })());
});
