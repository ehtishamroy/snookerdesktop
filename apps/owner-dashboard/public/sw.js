// Minimal hand-written service worker (no external PWA plugin dependency —
// see README "PWA approach" for the reasoning).
//
// Strategy:
//  - Precache the app shell (root document + manifest + icons) on install.
//  - Never intercept API calls: this dashboard is a pure read client of the
//    cloud backend and must always show live data when online. We do NOT
//    want a stale service-worker cache silently serving yesterday's revenue.
//  - For same-origin navigation/static requests, use stale-while-revalidate
//    so the shell loads instantly offline/on flaky connections, then updates
//    in the background.
const CACHE_NAME = "snooker-owner-dashboard-shell-v1";
const APP_SHELL = ["/", "/manifest.json", "/icons/icon.svg", "/icons/icon-maskable.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  // Never cache calls to the cloud backend API (any absolute cross-origin
  // request, or anything under /api on this origin) — always go to network.
  return url.pathname.startsWith("/api") || url.origin !== self.location.origin;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isApiRequest(url)) {
    return; // let the browser handle it normally (network only)
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
