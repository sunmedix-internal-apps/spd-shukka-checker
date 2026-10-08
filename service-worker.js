"use strict";

const CACHE_NAME = "spd-shipping-checker-v31";
const APP_VERSION = "20261008-1";
// 本体キャッシュの更新・削除と独立して、正常に検証できた表を保持する。
const ALTERNATE_JAN_CACHE_NAME = "spd-alternate-jans-v1";
const ALTERNATE_JAN_URL = "./alternate-jans.js";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=20261008-1",
  "./app.js?v=20261008-1",
  "./pdf-report.js?v=20261008-1",
  "./vendor/pdf-lib.min.js",
  "./vendor/fontkit.umd.min.js",
  "./vendor/pdf-font-data.js",
  "./vendor/NotoSansCJKjp-PdfCommon.ttf",
  "./vendor/NotoSansCJKjp-Regular.ttf",
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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== ALTERNATE_JAN_CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "GET_APP_VERSION") event.ports[0]?.postMessage({ version: APP_VERSION });
  if (event.data?.type === "SAVE_ALTERNATE_JANS") {
    const table = event.data.table;
    if (!table || typeof table !== "object" || Array.isArray(table)
      || !Object.values(table).every((item) => item && Array.isArray(item.alternateJans)
        && item.alternateJans.every((jan) => typeof jan === "string" && /^\d{12,13}$/.test(jan)))) return;
    const body = `"use strict"; globalThis.ALTERNATE_JAN_BY_PRODUCT_CODE = ${JSON.stringify(table)};`;
    event.waitUntil(caches.open(ALTERNATE_JAN_CACHE_NAME).then((cache) => cache.put(ALTERNATE_JAN_URL,
      new Response(body, { headers: { "Content-Type": "text/javascript; charset=utf-8" } }))));
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;

  // 通常資材と違い、必ず先にネットワークを確認する。通信失敗時だけ検証済みの表へ戻る。
  if (new URL(event.request.url).pathname === new URL(ALTERNATE_JAN_URL, self.location.href).pathname) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("追加JAN表を取得できません。");
      return response;
    }).catch(async () => {
      const cache = await caches.open(ALTERNATE_JAN_CACHE_NAME);
      const saved = await cache.match(ALTERNATE_JAN_URL);
      return saved || new Response("", { status: 503 });
    }));
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
