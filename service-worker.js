"use strict";

// importScriptsの依存ファイルもupdateViaCache:noneで更新確認される。
importScripts("./alternate-jans.js?v=20261006-7");
const ALTERNATE_JAN_SIGNATURE = JSON.stringify(globalThis.ALTERNATE_JAN_BY_PRODUCT_CODE);
const CACHE_NAME = "spd-shipping-checker-v28";
const APP_VERSION = "20261006-7";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=20261006-7",
  "./app.js?v=20261006-7",
  "./alternate-jans.js?v=20261006-7",
  "./manifest.webmanifest",
  "./icons/favicon-32.png",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./ok.wav",
  "./product-ok.wav",
  "./alert.wav",
  "./complete.wav"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "GET_APP_VERSION") event.ports[0]?.postMessage({ version: APP_VERSION, alternateJanSignature: ALTERNATE_JAN_SIGNATURE });
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;

  // 対応表だけの更新では資材URL・キャッシュ名が同じでも、制御中SWと同じ表を確実に返す。
  // 作業中のページの表は書き換えず、安全な再読込後に新しい表を読み込ませる。
  if (new URL(event.request.url).pathname === new URL("./alternate-jans.js", self.location.href).pathname) {
    event.respondWith(Promise.resolve(new Response(`"use strict"; globalThis.ALTERNATE_JAN_BY_PRODUCT_CODE = ${ALTERNATE_JAN_SIGNATURE};`,
      { headers: { "Content-Type": "text/javascript; charset=utf-8" } })));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-cache" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => {
    const networkRequest = fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    });
    if (cached) {
      event.waitUntil(networkRequest.catch(() => undefined));
      return cached;
    }
    return networkRequest;
  }));
});
