// Versioned cache names and offline assets used by the service worker.
const APP_SHELL_CACHE = "prisq-app-shell-v10";
const RUNTIME_CACHE = "prisq-runtime-v10";
const APP_SHELL_URLS = [
    "./",
    "index.html",
    "about.html",
    "contact.html",
    "info.html",
    "quiz.html",
    "risk.html",
    "team.html",
    "css/style.css",
    "js/site.js",
    "js/quiz.js",
    "fonts/Arima-Thin.ttf",
    "fonts/Arima-ExtraLight.ttf",
    "fonts/Arima-Light.ttf",
    "fonts/Arima-Regular.ttf",
    "fonts/Arima-Medium.ttf",
    "fonts/Arima-SemiBold.ttf",
    "fonts/Arima-Bold.ttf",
    "data/manifest.json",
    "data/quiz_data.json",
    "assets/images/PRISQ_192.png",
    "assets/images/PRISQ_512.png",
    "assets/images/cropped-thumbnail_QCRI-RGB.png",
    "assets/images/QPHI---WHITE-LOGO_Page_2.png"
];

// Small helpers keep cache keys consistent and avoid storing broken responses.
function scopeUrl(path) {
    return new URL(path, self.registration.scope).toString();
}

function canCacheResponse(response) {
    return response && (response.ok || response.type === "opaque");
}

async function putInCache(cacheName, request, response) {
    if (!canCacheResponse(response)) {
        return response;
    }

    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
    return response;
}

function getNavigationCacheKey(requestUrl) {
    const url = new URL(requestUrl);
    const pageName = url.pathname.split("/").pop() || "index.html";
    return scopeUrl(pageName);
}

// Installs the core app shell so the main pages can work offline.
async function installAppShell() {
    const cache = await caches.open(APP_SHELL_CACHE);
    await cache.addAll(APP_SHELL_URLS.map((path) => scopeUrl(path)));
}

// Removes old cache versions whenever the service worker is upgraded.
async function cleanupOldCaches() {
    const validCaches = new Set([APP_SHELL_CACHE, RUNTIME_CACHE]);
    const existingCaches = await caches.keys();

    await Promise.all(existingCaches.map((cacheName) => {
        if (!validCaches.has(cacheName)) {
            return caches.delete(cacheName);
        }

        return Promise.resolve(false);
    }));
}

// Lets navigations start from the network earlier when the browser supports preload.
async function enableNavigationPreload() {
    if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
    }
}

// Cache strategies decide when to prefer speed, freshness, or offline safety.
async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);

    const networkPromise = fetch(request)
        .then((response) => putInCache(cacheName, request, response))
        .catch(() => null);

    if (cachedResponse) {
        return cachedResponse;
    }

    const networkResponse = await networkPromise;
    return networkResponse || Response.error();
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
        return cachedResponse;
    }

    const networkResponse = await fetch(request);
    await putInCache(cacheName, request, networkResponse);
    return networkResponse;
}

async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);

    try {
        const networkResponse = await fetch(request);
        await putInCache(cacheName, request, networkResponse);
        return networkResponse;
    } catch (error) {
        const cachedResponse = await cache.match(request);
        return cachedResponse || Response.error();
    }
}

async function handleNavigationRequest(event) {
    const navigationCacheKey = getNavigationCacheKey(event.request.url);

    try {
        const preloadResponse = await event.preloadResponse;

        if (preloadResponse) {
            await putInCache(APP_SHELL_CACHE, navigationCacheKey, preloadResponse);
            return preloadResponse;
        }

        const networkResponse = await fetch(event.request);
        await putInCache(APP_SHELL_CACHE, navigationCacheKey, networkResponse);
        return networkResponse;
    } catch (error) {
        const cachedPage = await caches.match(navigationCacheKey);

        if (cachedPage) {
            return cachedPage;
        }

        const fallbackPage = await caches.match(scopeUrl("index.html"));
        return fallbackPage || Response.error();
    }
}

// Standard service worker lifecycle events: install, activate, and fetch routing.
self.addEventListener("install", (event) => {
    event.waitUntil(installAppShell());
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        await cleanupOldCaches();
        await enableNavigationPreload();
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") {
        return;
    }

    const requestUrl = new URL(event.request.url);
    const isSameOrigin = requestUrl.origin === self.location.origin;

    if (event.request.mode === "navigate") {
        event.respondWith(handleNavigationRequest(event));
        return;
    }

    if (isSameOrigin && requestUrl.pathname.startsWith(new URL(self.registration.scope).pathname)) {
        if (requestUrl.pathname.endsWith(".html")) {
            event.respondWith(staleWhileRevalidate(event.request, APP_SHELL_CACHE));
            return;
        }

        if (requestUrl.pathname.includes("/data/")) {
            event.respondWith(networkFirst(event.request, APP_SHELL_CACHE));
            return;
        }

        if (["style", "script", "image", "font"].includes(event.request.destination)) {
            event.respondWith(staleWhileRevalidate(event.request, RUNTIME_CACHE));
            return;
        }
    }

    if (requestUrl.origin === "https://cdn.jsdelivr.net"
        || requestUrl.origin === "https://fonts.googleapis.com"
        || requestUrl.origin === "https://fonts.gstatic.com") {
        event.respondWith(staleWhileRevalidate(event.request, RUNTIME_CACHE));
    }
});
