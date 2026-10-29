/* MomoPet service worker — app shell only, API is always live. */
const CACHE = "momo-shell-v12";
const ASSETS = [
  "/",
  "/index.html",
  "/profile.html",
  "/friend.html",
  "/manifest.webmanifest",
  "/css/theme.css",
  "/css/app.css",
  "/css/profile.css",
  "/js/app.js",
  "/js/api.js",
  "/js/shell.js",
  "/js/fx.js",
  "/js/util.js",
  "/js/profile.js",
  "/js/friend-page.js",
  "/css/friend.css",
  "/shared/content.js",
  "/shared/engine.js",
  "/assets/pet.png",
  "/assets/pet-560.png",
  "/assets/avatar-round.png",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/maskable-192.png",
  "/assets/maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(ASSETS.map((url) => cache.add(new Request(url, { cache: "reload" })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
