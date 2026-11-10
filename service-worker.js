/* ===========================================================
   service-worker.js 鈥斺€?绂荤嚎缂撳瓨锛圥WA锛?   鏇存柊鍐呭鍚庤鎶?VERSION 鍔?1锛岀敤鎴风浼氳嚜鍔ㄦ崲鏂扮紦瀛?   =========================================================== */
const VERSION = 'zjxc-v51-web';
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

  // 瀵艰埅璇锋眰锛氬缁堝洖钀藉埌棣栭〉缂撳瓨锛屼繚璇佺绾垮彲鎵撳紑
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        // 鎺堟潈杩囨湡鎴栨湇鍔＄寮傚父鏃讹紝鍥炶惤鍒扮紦瀛橀椤碉紝淇濊瘉妗岄潰瀹夎鐗堜粛鍙墦寮€
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
