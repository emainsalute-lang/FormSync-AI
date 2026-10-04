const CACHE = "formsync-offline-v5";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll([
          "/offline.html",
          "/training",
          "/brand/logo-black.png",
          "/brand/icon-192.png",
        ]),
      )
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("formsync-offline-") && key !== CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    request.headers.has("range")
  )
    return;
  const asset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/pose/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname.startsWith("/app-icon");
  const page = request.mode === "navigate";
  if (!asset && !page) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok && (asset || page))
          await cache.put(request, response.clone());
        return response;
      } catch {
        const stored = await cache.match(request);
        if (stored) return stored;
        if (page)
          return (await cache.match("/offline.html")) || Response.error();
        return Response.error();
      }
    })(),
  );
});
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "FormSync AI", {
      body: payload.body || "Your training reminder is here.",
      icon: "/app-icon-192.png",
      badge: "/app-icon-192.png",
      data: { url: payload.url || "/training" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url || "/training",
    self.location.origin,
  );
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find(
          (client) => new URL(client.url).origin === target.origin,
        );
        if (existing)
          return existing.navigate(target.href).then(() => existing.focus());
        return self.clients.openWindow(target.href);
      }),
  );
});
