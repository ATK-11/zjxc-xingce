/* ===========================================================
   content-patch.js —— 内容热更新（题目/解析补丁）
   -----------------------------------------------------------
   作用：不用重装 APK，也能更新题库。
   机制：补丁以「保留消息」发布到 MQTT 主题（所有设备共用），
         各端启动/定时拉取，rev 比本地新就覆盖并立即生效。
   补丁格式：
     {
       "v": 1,
       "rev": 1793167000000,          // 必须递增（一般用时间戳）
       "note": "2026-10 修正 3 道题",  // 可选，给人看
       "remove": ["gk-2019-fu-q88"],   // 可选，删题
       "patch": {                      // 可选，按题号覆盖字段
         "gk-2019-fu-q12": { "stem": "...", "explain": "..." }
       },
       "add": [                        // 可选，加题（需带 paper 指明属于哪套卷）
         { "paper": "gk-2020-fu", "id": "gk-2020-fu-x1", "module": "judge", ... }
       ]
     }
   存储：localStorage.zjxc.contentpatch（一份最新的完整补丁）
   =========================================================== */
(function () {
  'use strict';

  var KEY = 'zjxc.contentpatch';
  var cfg = window.CONTENT_SYNC || {};
  var TOPIC = cfg.topic || 'zjxc/content/v1';

  var cached = null;      // 已解析的补丁（内存）
  var loading = false;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function save(p) {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
  }

  function get() {
    if (cached === null) cached = load();
    return cached;
  }

  /* 把补丁应用到一套卷（原地修改传入对象） */
  function apply(d) {
    var P = get();
    if (!P || !d || !d.questions) return d;

    if (P.remove && P.remove.length) {
      var rm = {};
      P.remove.forEach(function (id) { rm[id] = 1; });
      d.questions = d.questions.filter(function (q) { return q && !rm[q.id]; });
    }

    if (P.patch) {
      d.questions.forEach(function (q) {
        var p = q && P.patch[q.id];
        if (!p) return;
        for (var k in p) {
          if (Object.prototype.hasOwnProperty.call(p, k)) q[k] = p[k];
        }
      });
    }

    if (P.add && P.add.length) {
      P.add.forEach(function (q) {
        if (!q || !q.id) return;
        if (q.paper && q.paper !== d.id) return;
        var dup = false;
        for (var i = 0; i < d.questions.length; i++) {
          if (d.questions[i].id === q.id) { dup = true; break; }
        }
        if (dup) return;
        var copy = {};
        for (var k in q) {
          if (k !== 'paper' && Object.prototype.hasOwnProperty.call(q, k)) copy[k] = q[k];
        }
        d.questions.push(copy);
      });
    }
    return d;
  }

  function b64ToBytes(s) {
    var bin = atob(String(s || '').replace(/\s/g, ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function decode(env) {
    if (!env || typeof env !== 'object') return Promise.resolve(null);
    if (env.enc === 'gz') {
      if (typeof DecompressionStream !== 'function') return Promise.resolve(null);
      try {
        var stream = new Blob([b64ToBytes(env.d)]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new Response(stream).text().then(function (t) { return JSON.parse(t); }).catch(function () { return null; });
      } catch (e) { return Promise.resolve(null); }
    }
    return Promise.resolve(env.d || null);
  }

  /* 拉取补丁：订阅一次，broker 会把最新的保留消息推过来 */
  function pull() {
    if (loading) return Promise.resolve(false);
    if (!window.ZJXCSync || !window.ZJXCSync.rawSubscribe) return Promise.resolve(false);
    loading = true;
    return window.ZJXCSync.rawSubscribe(TOPIC, function (text) {
      var env;
      try { env = JSON.parse(text); } catch (e) { return; }
      decode(env).then(function (p) {
        loading = false;
        if (!p || !p.rev) return;
        var cur = get();
        if (cur && Number(cur.rev) >= Number(p.rev)) return;
        cached = p;
        save(p);
        document.dispatchEvent(new CustomEvent('zjxc:content', { detail: p }));
      });
    }).then(function (ok) { loading = false; return ok; })
      .catch(function () { loading = false; return false; });
  }

  window.ContentPatch = {
    get: get,
    apply: apply,
    pull: pull,
    topic: TOPIC,
    rev: function () { var p = get(); return p ? Number(p.rev) || 0 : 0; },
    note: function () { var p = get(); return p ? (p.note || '') : ''; },
    clear: function () {
      cached = null;
      try { localStorage.removeItem(KEY); } catch (e) {}
    }
  };
})();
