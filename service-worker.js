/* ===========================================================
   service-worker.js —— 离线缓存（PWA）
   更新内容后请把 VERSION 加 1，用户端会自动换新缓存
   =========================================================== */
const VERSION = 'zjxc-v52-web';
const CACHE = VERSION;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/style.css',
  './assets/icons/icon-180.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-512-maskable.png',
  './assets/js/svgkit.js',
  './assets/js/papers.js',
  './assets/js/plan.js',
  './assets/js/cloud-config.js',
  './assets/js/gist-sync.js',
  './assets/js/sync.js',
  './assets/js/content-patch.js',
  './assets/js/methods.js',
  './assets/js/reinforce.js',
  './assets/js/videos.js',
  './assets/vendor/workbuddy-cloud.global.js',
  './assets/vendor/mqtt.min.js',
  './assets/vendor/qrcode.js',
  './assets/js/app.js',
  './assets/js/data/politics.js',
  './assets/js/data/common.js',
  './assets/js/data/verbal.js',
  './assets/js/data/quant.js',
  './assets/js/data/judge.js',
  './assets/js/data/dataanalysis.js',
  './assets/js/data/politics-extra.js',
  './assets/js/data/common-extra.js',
  './assets/js/data/verbal-extra.js',
  './assets/js/data/quant-extra.js',
  './assets/js/data/judge-extra.js',
  './assets/js/data/dataanalysis-extra.js',
  './assets/js/data/plan-w1.js',
  './assets/js/data/plan-w2.js',
  './assets/js/data/plan-w3.js',
  './assets/js/data/plan-w4.js',
  './assets/js/data/plan-w5.js',
  './assets/js/data/plan-w67.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 导航请求：始终回落到首页缓存，保证离线可打开
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        // 授权过期或服务端异常时，回落到缓存首页，保证桌面安装版仍可打开
        if (!res || res.status >= 400) return caches.match('./index.html');
        return res;
      }).catch(function () { return caches.match('./index.html'); })
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html');
      });
    })
  );
});
