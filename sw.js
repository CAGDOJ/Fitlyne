const CACHE = "fitlyne-v3-cart";
const ASSETS = ["./","./index.html","./styles.css","./app.js","./config.js","./manifest.webmanifest","./assets/icon.svg","./catalog.html","./catalog.css","./catalog.js"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
