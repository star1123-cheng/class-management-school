/*
 * Service Worker：讓「班級管理」可以安裝成手機 App。
 * 策略：一律「網路優先」——有網路就抓最新版（GitHub 更新後馬上生效），
 * 沒網路時才用手機上的備份顯示畫面。
 * 只處理本站的 GET 請求；GAS API（POST、script.google.com）與 YouTube 一律不經過快取，資料永遠是即時的。
 */
var CACHE = 'class-mgmt-v6';
var SHELL = [
  './',
  './index.html',
  './settings.html',
  './config.js',
  './css/style.css',
  './js/api.js',
  './js/record.js',
  './js/settings.js',
  './js/pwa.js',
  './js/watermark.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/logo-96.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  // 清掉舊版快取
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || req.headers.get('range')) return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error());
      });
    })
  );
});
