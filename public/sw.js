/*
 * Service worker mínimo y deliberadamente conservador.
 *
 * Sólo guarda en caché archivos estáticos (que tienen hash en el nombre, así que
 * nunca quedan viejos) y una pantalla de "sin conexión". Las páginas y las
 * respuestas de la API NO se cachean: tienen datos privados de cada usuario y
 * el celular puede ser compartido.
 */
const VERSION = "v1";
const STATIC = `estaticos-${VERSION}`;
const SHELL = `base-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC, SHELL].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // datos privados y enlaces firmados

  // Estáticos con hash: primero la caché, y si no está se guarda al vuelo.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(STATIC).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Navegación: siempre de la red; si no hay internet, la pantalla de cortesía.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
  }
});
