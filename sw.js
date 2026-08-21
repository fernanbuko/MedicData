const CACHE_NAME = "medidata-v1";

// Los scripts de Firebase y las librerías de React/Babel/Tailwind se cargan
// desde CDNs externos, no desde este mismo sitio — por eso hay que guardarlos
// aparte a propósito. Sin ellos guardados, sin internet la app se queda
// pegada para siempre esperándolos.
const ASSETS_EXTERNOS = [
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js",
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://cdn.tailwindcss.com",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache
        .addAll(["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"])
        .catch(() => {});
      // Uno por uno: si alguno fallara al guardarse, no debe tumbar el
      // guardado de todo lo demás — mejor guardar los que sí se puedan.
      await Promise.all(ASSETS_EXTERNOS.map((url) => cache.add(url).catch(() => {})));
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Notificaciones push (citas próximas) enviadas por el robot de GitHub
// Actions vía Firebase Cloud Messaging.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {}
  const title = data.notification?.title || data.title || "MediData";
  const body = data.notification?.body || data.body || "";
  const url = data.data?.url || "./index.html";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "./index.html";
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) {
        if (c.url.includes(url) && "focus" in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
