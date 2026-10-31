/* ===========================================================
   sync.js —— 云同步（网页版与 App 共用一份数据）
   -----------------------------------------------------------
   · 同步码即账号：任意一端生成，另一端输入即绑定
   · 换设备：用「绑定链接 / 二维码」打开即自动绑定
   · 云端备份：每次推送留档（最多 20 份），可回滚到任一时刻
   =========================================================== */
(function () {
  'use strict';

  var LS_CODE = 'zjxc.synccode';
  var LS_LAST = 'zjxc.synclast';
  var LS_SIG = 'zjxc.syncsig';
  var HISTORY_KEY = 'zjxc.history.v1';
  var DAYLOG_KEY = 'zjxc.daylog';
  var DRAFTS_KEY = 'zjxc.drafts';
  var HIST_MAX = 30;
  var DRAFT_MAX = 10;

  var cloud = null;
  var busy = false;
  var pending = null;

  function $(id) { return document.getElementById(id); }

  /* 是否启用云同步：默认本机模式，不联网、不依赖账号 */
  function cloudOn() {
    var cfg = window.CLOUD_CONFIG;
    return !!(cfg && cfg.enabled !== false && cfg.endpoint && window.SYNC_MODE === 'cloud');
  }

  /* 是否启用 MQTT 自动同步（免账号，公开 broker 中转） */
  function mqttOn() {
    return window.SYNC_MODE === 'mqtt' && !!window.MQTT_SYNC && !!window.mqtt;
  }

  function note(msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(note._t);
    note._t = setTimeout(function () { t.hidden = true; }, 2200);
  }

  function getCode() {
    try { return localStorage.getItem(LS_CODE) || ''; } catch (e) { return ''; }
  }
  function setCode(v) {
    try { v ? localStorage.setItem(LS_CODE, v) : localStorage.removeItem(LS_CODE); } catch (e) {}
  }
  function getLast() {
    try { return JSON.parse(localStorage.getItem(LS_LAST) || 'null'); } catch (e) { return null; }
  }
  function setLast(o) {
    try { localStorage.setItem(LS_LAST, JSON.stringify(o)); } catch (e) {}
  }

  function newCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '';
    var buf = new Uint8Array(10);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < 10; i++) out += chars[buf[i] % chars.length];
    return out;
  }
  function normalizeCode(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  }

  /* ---------- 本机快照（防误清/防跨端丢失） ---------- */
  var SNAP_KEY = "zjxc.snapshots";

  function readSnaps() {
    try { var a = JSON.parse(localStorage.getItem(SNAP_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function writeSnaps(list) {
    try { localStorage.setItem(SNAP_KEY, JSON.stringify(list.slice(0, 10))); } catch (e) {}
  }
  function snapshot(reason) {
    try {
      var cur = readLocal();
      var h = cur[HISTORY_KEY] || [], d = cur[DAYLOG_KEY] || {};
      if (!h.length && !Object.keys(d).length) return;
      var sign = JSON.stringify([h.length, Object.keys(d).length, h[0] && h[0].ts]);
      var list = readSnaps();
      if (list.length && list[0].sign === sign) return;   // 没变化就不重复存
      list.unshift({ ts: Date.now(), reason: reason || "自动", sign: sign, history: h, daylog: d });
      writeSnaps(list);
    } catch (e) {}
  }
  function restoreSnapshot(ts) {
    var list = readSnaps();
    var hit = null;
    for (var i = 0; i < list.length; i++) { if (String(list[i].ts) === String(ts)) { hit = list[i]; break; } }
    if (!hit) return false;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hit.history || []));
    localStorage.setItem(DAYLOG_KEY, JSON.stringify(hit.daylog || {}));
    document.dispatchEvent(new CustomEvent("zjxc:synced", { detail: { changed: 99 } }));
    return true;
  }

  function readLocal() {
    var out = {};
    try {
      var h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      if (Array.isArray(h)) out[HISTORY_KEY] = h;
    } catch (e) {}
    try {
      var d = JSON.parse(localStorage.getItem(DAYLOG_KEY) || '{}');
      if (d && typeof d === 'object') out[DAYLOG_KEY] = d;
    } catch (e) {}
    try {
      var sq = JSON.parse(localStorage.getItem('zjxc.seqdone') || '{}');
      if (sq && Object.keys(sq).length) out['zjxc.seqdone'] = sq;
    } catch (e) {}
    // 未交卷草稿：换设备/换浏览器也能接着做
    try {
      var dr = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
      if (dr && Object.keys(dr).length) out[DRAFTS_KEY] = dr;
    } catch (e) {}
    try {
      var r = Number(localStorage.getItem('zjxc.restoreat') || 0);
      if (r) out.__restoreAt = r;
    } catch (e) {}
    return out;
  }

  function mergeIntoLocal(remote) {
    if (!remote || typeof remote !== 'object') return 0;
    var changed = 0;

    // 云端发生过回滚（时间戳更新）→ 本机整体覆盖，而不是增量合并
    var lR = 0, rR = Number(remote.__restoreAt || 0);
    try { lR = Number(localStorage.getItem('zjxc.restoreat') || 0); } catch (e) {}
    if (rR > lR) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(remote[HISTORY_KEY] || []));
      localStorage.setItem(DAYLOG_KEY, JSON.stringify(remote[DAYLOG_KEY] || {}));
      try {
        if (remote[DRAFTS_KEY]) localStorage.setItem(DRAFTS_KEY, JSON.stringify(remote[DRAFTS_KEY]));
        else localStorage.removeItem(DRAFTS_KEY);
      } catch (e) {}
      try { localStorage.setItem('zjxc.restoreat', String(rR)); } catch (e) {}
      return 99;
    }

    var incHist = remote[HISTORY_KEY];
    if (Array.isArray(incHist) && incHist.length) {
      var byTs = {};
      var localHist = readLocal()[HISTORY_KEY] || [];
      localHist.concat(incHist).forEach(function (h) { if (h && h.ts) byTs[h.ts] = h; });
      var merged = Object.keys(byTs).map(function (k) { return byTs[k]; })
        .sort(function (a, b) { return b.ts - a.ts; }).slice(0, HIST_MAX);
      if (JSON.stringify(merged) !== JSON.stringify(localHist)) {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
        changed++;
      }
    }

    var incSeq = remote['zjxc.seqdone'];
    if (incSeq && typeof incSeq === 'object') {
      var seq = {};
      try { seq = JSON.parse(localStorage.getItem('zjxc.seqdone') || '{}') || {}; } catch (e) {}
      var added = 0;
      Object.keys(incSeq).forEach(function (k) { if (!seq[k]) { seq[k] = incSeq[k]; added++; } });
      if (added) { localStorage.setItem('zjxc.seqdone', JSON.stringify(seq)); changed += added; }
    }

    var incLog = remote[DAYLOG_KEY];
    if (incLog && typeof incLog === 'object') {
      var log = readLocal()[DAYLOG_KEY] || {};
      Object.keys(incLog).forEach(function (k) {
        if (!log[k] || (incLog[k].ts || 0) > (log[k].ts || 0)) { log[k] = incLog[k]; changed++; }
      });
      localStorage.setItem(DAYLOG_KEY, JSON.stringify(log));
    }

    // 未交卷草稿：同一套卷取 savedAt 更新的一份，保留最近 DRAFT_MAX 套
    var incDrafts = remote[DRAFTS_KEY];
    if (incDrafts && typeof incDrafts === 'object') {
      var drafts = {};
      try { drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}') || {}; } catch (e) {}
      // 已经交过卷的，草稿作废——否则云端旧草稿会把刚交完的卷"复活"
      var histNow = readLocal()[HISTORY_KEY] || [];
      function submittedAfter(ref, savedAt) {
        for (var i = 0; i < histNow.length; i++) {
          var h = histNow[i];
          if (h && h.ref === ref && (h.ts || 0) >= (savedAt || 0)) return true;
        }
        return false;
      }
      var dDirty = false;
      Object.keys(incDrafts).forEach(function (k) {
        var r = incDrafts[k], l = drafts[k];
        if (!r || !r.state || !r.state.ids) return;
        if (submittedAfter(k, r.savedAt)) {
          if (l) { delete drafts[k]; dDirty = true; }   // 本机若还留着也一并清掉
          return;
        }
        if (!l || (r.savedAt || 0) > (l.savedAt || 0)) { drafts[k] = r; dDirty = true; }
      });
      if (dDirty) {
        var dk = Object.keys(drafts)
          .sort(function (a, b) { return (drafts[b].savedAt || 0) - (drafts[a].savedAt || 0); })
          .slice(0, DRAFT_MAX);
        var dOut = {};
        dk.forEach(function (k) { dOut[k] = drafts[k]; });
        localStorage.setItem(DRAFTS_KEY, JSON.stringify(dOut));
        changed++;
      }
    }
    return changed;
  }

  function ensureClient() {
    if (cloud) return cloud;
    var cfg = window.CLOUD_CONFIG;
    if (!cfg) throw new Error('缺少云配置');
    if (!window.WorkBuddyCloud || !window.WorkBuddyCloud.createWorkBuddyCloud) {
      throw new Error('云 SDK 未加载');
    }
    cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: cfg.endpoint,
      oauthRelayBaseUrl: cfg.oauthRelayBaseUrl,
      publishableKey: cfg.publishableKey
    });
    return cloud;
  }

  /** 统一 RPC：返回 data，出错抛异常 */
  function rpc(name, params) {
    var c = ensureClient();
    return c.database.rpc(name, params || {}).then(function (res) {
      if (res && res.error) throw new Error(res.error.message || '云端返回错误');
      return res ? res.data : null;
    });
  }

  /* ================= MQTT 自动同步（免账号，公开 broker 中转） ================= */
  var mq = { client: null, connecting: null, state: 'idle', lastErr: '', brokerIdx: 0 };

  function mqttTopic() {
    var code = getCode();
    return code ? (window.MQTT_SYNC.topicPrefix + code) : '';
  }

  function b64FromBytes(bytes) {
    var bin = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }
  function bytesFromB64(s) {
    var bin = atob(String(s || '').replace(/\s/g, ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* 压缩：JSON → gzip → base64（实测压缩比约 1/6，稳在 broker 上限内） */
  function packPayload(obj) {
    var json = JSON.stringify(obj);
    if (typeof CompressionStream !== 'function') return Promise.resolve({ v: 2, d: obj });
    try {
      var stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
      return new Response(stream).arrayBuffer().then(function (buf) {
        return { v: 2, enc: 'gz', d: b64FromBytes(new Uint8Array(buf)) };
      }).catch(function () { return { v: 2, d: obj }; });
    } catch (e) { return Promise.resolve({ v: 2, d: obj }); }
  }
  function unpackPayload(p) {
    if (!p || typeof p !== 'object') return Promise.resolve(null);
    if (p.enc === 'gz') {
      if (typeof DecompressionStream !== 'function') return Promise.resolve(null);
      try {
        var stream = new Blob([bytesFromB64(p.d)]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new Response(stream).text().then(function (t) { return JSON.parse(t); }).catch(function () { return null; });
      } catch (e) { return Promise.resolve(null); }
    }
    return Promise.resolve(p.d || null);
  }

  function mqttConnect() {
    if (!mqttOn()) return Promise.resolve(null);
    if (mq.client) return Promise.resolve(mq.client);
    if (mq.connecting) return mq.connecting;

    var cfg = window.MQTT_SYNC;
    var url = cfg.brokers[mq.brokerIdx % cfg.brokers.length];
    mq.state = 'connecting';

    mq.connecting = new Promise(function (resolve) {
      var client;
      try {
        client = window.mqtt.connect(url, {
          clientId: 'zjxc_' + Math.random().toString(16).slice(2, 10),
          clean: true, keepalive: 30, connectTimeout: 12000, reconnectPeriod: 0
        });
      } catch (e) {
        mq.lastErr = (e && e.message) || 'connect failed';
        mq.state = 'offline'; mq.connecting = null;
        resolve(null); return;
      }
      var done = false;
      function finish(v) { if (done) return; done = true; mq.connecting = null; resolve(v); }
      client.on('connect', function () {
        mq.client = client; mq.state = 'online'; mq.lastErr = '';
        renderBar();
        finish(client);
      });
      client.on('error', function (e) { mq.lastErr = (e && e.message) || 'error'; });
      client.on('close', function () {
        if (mq.client === client) { mq.client = null; mq.state = 'offline'; renderBar(); }
      });
      setTimeout(function () {
        if (done) return;
        try { client.end(true); } catch (e) {}
        mq.state = 'offline';
        finish(null);
      }, 13000);
    });
    return mq.connecting;
  }

  /* 拉取：订阅一次，broker 会把「保留消息」（最新一份）立刻推过来 */
  function mqttPull() {
    return mqttConnect().then(function (client) {
      if (!client) return { ok: false, reason: 'offline' };
      var topic = mqttTopic();
      if (!topic) return { ok: false, reason: 'nocode' };
      return new Promise(function (resolve) {
        var settled = false;
        var timer = setTimeout(function () { settle({ ok: true, got: false }); }, 6000);
        function settle(v) {
          if (settled) return;
          settled = true; clearTimeout(timer);
          try { client.removeListener('message', onMsg); } catch (e) {}
          resolve(v);
        }
        function onMsg(t, payload) {
          if (t !== topic) return;
          var env;
          try { env = JSON.parse(payload.toString('utf8')); } catch (e) { return settle({ ok: true, got: false }); }
          unpackPayload(env).then(function (data) {
            if (!data) return settle({ ok: true, got: false });
            var changed = mergeIntoLocal(data);
            if (changed > 0) document.dispatchEvent(new CustomEvent('zjxc:synced', { detail: { changed: changed } }));
            settle({ ok: true, got: true, changed: changed, remote: data });
          });
        }
        client.on('message', onMsg);
        client.subscribe(topic, { qos: 1 }, function () {});
      });
    });
  }

  /* 推送：保留消息 + QoS1 */
  function mqttPush() {
    return mqttConnect().then(function (client) {
      if (!client) return { ok: false, reason: 'offline' };
      var data = readLocal();
      var hasData = (data[HISTORY_KEY] || []).length ||
        Object.keys(data[DAYLOG_KEY] || {}).length ||
        Object.keys(data['zjxc.seqdone'] || {}).length ||
        Object.keys(data[DRAFTS_KEY] || {}).length;
      // 本机空数据不覆盖云端，避免误清把别处记录冲掉
      if (!hasData) return { ok: true, skipped: true };

      var max = window.MQTT_SYNC.maxPayload;
      function shrink(level) {
        var slim = JSON.parse(JSON.stringify(data));
        if (level >= 1) slim[DRAFTS_KEY] = {};
        if (level >= 2) slim[HISTORY_KEY] = (slim[HISTORY_KEY] || []).slice(0, 8);
        return slim;
      }
      function attempt(level) {
        return packPayload(shrink(level)).then(function (env) {
          var text = JSON.stringify(env);
          if (text.length <= max || level >= 2) return text;
          return attempt(level + 1);
        });
      }
      return attempt(0).then(function (text) {
        return new Promise(function (resolve) {
          client.publish(mqttTopic(), text, { qos: 1, retain: true }, function (err) {
            resolve(err ? { ok: false, reason: 'publish', message: err.message } : { ok: true });
          });
        });
      });
    });
  }

  /* 规范化比较：避免"远端空数组 vs 本机缺键"这类假差异导致来回推送 */
  function canon(o) {
    var out = {};
    [HISTORY_KEY, DAYLOG_KEY, 'zjxc.seqdone', DRAFTS_KEY].forEach(function (k) {
      var v = o && o[k];
      if (Array.isArray(v)) out[k] = v;
      else if (v && typeof v === 'object') out[k] = v;
      else out[k] = (k === HISTORY_KEY ? [] : {});
    });
    return out;
  }

  function mqttSync(opts) {
    opts = opts || {};
    if (busy) { pending = opts; return Promise.resolve({ ok: false, reason: 'busy' }); }
    busy = true;

    var needPush = !!opts.forcePush || isDirty() || sigOf(canon(readLocal())) !== getSig();

    return mqttPull().then(function (r) {
      if (!r.ok) throw new Error(r.reason === 'nocode' ? '没有同步码' : '连接失败');
      var localSig = sigOf(canon(readLocal()));
      var remoteSig = r.remote ? sigOf(canon(r.remote)) : '';
      // 刚拉下来的内容与本机一致 → 不需要回推
      if (!needPush || (r.got && localSig === remoteSig)) {
        setSig(localSig);
        return { ok: true, pushed: false };
      }
      return mqttPush().then(function (p) {
        if (p.ok && !p.skipped) setSig(sigOf(canon(readLocal())));
        return { ok: true, pushed: !!p.ok && !p.skipped };
      });
    }).then(function (res) {
      clearDirty();
      setLast({ ts: Date.now(), ok: true });
      mq.state = 'online';
      busy = false;
      if (pending) { var p = pending; pending = null; mqttSync(p); }
      renderBar();
      return res;
    }).catch(function (e) {
      busy = false;
      mq.state = 'offline';
      setLast({ ts: Date.now(), ok: false, msg: (e && e.message) || '同步失败' });
      renderBar();
      return { ok: false, reason: 'error', message: (e && e.message) || '' };
    });
  }

  /* ---------- 自动同步：内容签名 + 定时拉取 ---------- */
  var LS_DIRTY = "zjxc.dirty";
  function markDirty() { try { localStorage.setItem(LS_DIRTY, "1"); } catch (e) {} }
  function isDirty() { try { return localStorage.getItem(LS_DIRTY) === "1"; } catch (e) { return false; } }
  function clearDirty() { try { localStorage.removeItem(LS_DIRTY); } catch (e) {} }

  /* 内容签名：本地内容一变就能发现，不依赖调用方记得 markDirty */
  function sigOf(o) {
    var s = JSON.stringify(o), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return s.length + '.' + (h >>> 0).toString(36);
  }
  function getSig() { try { return localStorage.getItem(LS_SIG) || ''; } catch (e) { return ''; } }
  function setSig(v) { try { localStorage.setItem(LS_SIG, v); } catch (e) {} }

  function syncNow(opts) {
    opts = opts || {};
    if (mqttOn()) return mqttSync(opts);
    if (!cloudOn()) return Promise.resolve({ ok: false, reason: 'local' });
    var code = getCode();
    if (!code) return Promise.resolve({ ok: false, reason: 'nocode' });
    if (busy) { pending = opts; return Promise.resolve({ ok: false, reason: 'busy' }); }
    busy = true;

    // 推送判断要在合并之前算：合并进来的云端数据不需要再回推
    var needPush = !!opts.forcePush || isDirty() || sigOf(readLocal()) !== getSig();

    return rpc('sync_get', { p_code: code })
      .then(function (remote) {
        var changed = mergeIntoLocal(remote);
        if (changed > 0) {
          document.dispatchEvent(new CustomEvent('zjxc:synced', { detail: { changed: changed } }));
        }
        var payload = readLocal();
        if (!needPush) { setSig(sigOf(payload)); return null; }
        return rpc('sync_put', { p_code: code, p_payload: payload }).then(function () {
          setSig(sigOf(payload));
        });
      })
      .then(function () {
        var ts = Date.now();
        lastPushAt = ts;
        clearDirty();
        setLast({ ts: ts, ok: true });
        busy = false;
        if (pending) { var p = pending; pending = null; syncNow(p); }
        renderBar();
        return { ok: true, ts: ts };
      })
      .catch(function (e) {
        busy = false;
        setLast({ ts: Date.now(), ok: false, msg: e && e.message ? e.message : '同步失败' });
        renderBar();
        return { ok: false, reason: 'error', message: e && e.message };
      });
  }

  var timer = null;
  var lastPushAt = 0;
  function schedule(delay) {
    if (!getCode()) return;
    clearTimeout(timer);
    timer = setTimeout(function () { syncNow(); }, delay == null ? 1500 : delay);
  }
  /* 草稿（做题中途）自动同步：最多每 2 分钟推一次，避免每答一题就上传 */
  function scheduleDraft() {
    if (!getCode()) return;
    markDirty();
    var wait = Math.max(5000, 120000 - (Date.now() - lastPushAt));
    schedule(wait);
  }

  function fmtTime(v) {
    var d = new Date(v);
    var p = function (n) { return n < 10 ? '0' + n : n; };
    return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /** 带 sharecode 的绑定链接，新设备打开即自动绑定 */
  function bindLink(code) {
    var q = new URLSearchParams(location.search);
    q.set('sync', code);
    return location.origin + location.pathname + '?' + q.toString();
  }

  function renderQR(link) {
    var box = $('cloudQr');
    if (!box) return;
    if (!window.qrcode) { box.innerHTML = '<span class="cloud-tip">二维码库未加载，可用下方链接</span>'; return; }
    try {
      var qr = window.qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1 });
    } catch (e) {
      box.innerHTML = '<span class="cloud-tip">二维码生成失败，可用下方链接</span>';
    }
  }

  function renderBar() {
    var box = $('cloudSyncBox');
    if (!box) return;

    // MQTT 自动同步（免账号）
    if (mqttOn()) {
      var mc = getCode();
      var mlast = getLast();
      if (!mc) {
        box.innerHTML =
          '<div class="cloud-head">' +
            '<div><b>自动同步</b><span class="cloud-sub">还没有同步码</span></div>' +
            '<button class="btn btn-primary btn-sm" id="cloudGen">生成同步码</button>' +
          '</div>' +
          '<div class="cloud-row">' +
            '<input class="cloud-input" id="cloudInput" maxlength="14" placeholder="已有同步码？输入后接入" />' +
            '<button class="btn btn-outline btn-sm" id="cloudBind">接入</button>' +
          '</div>';
        bindBar();
        return;
      }
      var st = mq.state === 'online' ? '已连接'
        : (mq.state === 'connecting' ? '连接中…' : '离线，联网后自动重连');
      var st2 = mlast
        ? (mlast.ok ? '上次同步 ' + fmtTime(mlast.ts) : '上次失败：' + (mlast.msg || '未知'))
        : '尚未同步';
      box.innerHTML =
        '<div class="cloud-head">' +
          '<div><b>自动同步 · 已开启</b><span class="cloud-sub">' + st + '　·　' + st2 + '</span></div>' +
          '<span class="cloud-code" id="cloudCode">' + mc.slice(0, 5) + ' ' + mc.slice(5) + '</span>' +
        '</div>' +
        '<p class="cloud-auto">答题即上传 · 打开就拉取 · 每 4 分钟检查一次。' +
          '另一台设备在「同步」里输入上面这个码即接入，之后两端自动同步（含作答明细、通关进度、未交卷草稿）。</p>' +
        '<div class="cloud-row">' +
          '<button class="btn btn-primary btn-sm" id="cloudNow">立即同步</button>' +
          '<button class="btn btn-outline btn-sm" id="cloudCopy">复制码</button>' +
          '<button class="btn btn-ghost btn-sm" id="cloudUnbind">解除绑定</button>' +
        '</div>' +
        '<details class="cloud-fold">' +
          '<summary>本机备份（最近 10 份，自动保存）</summary>' +
          '<div id="localSnaps" class="cloud-backups">—</div>' +
        '</details>';
      bindBar();
      return;
    }

    // 本机模式：不联网、不依赖账号，说明清楚怎么搬数据
    if (!cloudOn()) {
      box.innerHTML =
        '<div class="cloud-head">' +
          '<div><b>数据同步 · 本机模式</b><span class="cloud-sub">不联网 · 不依赖任何账号</span></div>' +
        '</div>' +
        '<p class="cloud-auto">记录只存在这台设备里（浏览器一份、安装版各一份）。' +
          '换设备时用下面的「生成同步码」复制粘贴，或「导出记录文件」再导入，一次搬完。</p>' +
        '<details class="cloud-fold">' +
          '<summary>本机备份（最近 10 份，自动保存）</summary>' +
          '<div id="localSnaps" class="cloud-backups">—</div>' +
        '</details>';
      bindBar();
      return;
    }

    var code = getCode();
    var last = getLast();

    if (!code) {
      box.innerHTML =
        '<div class="cloud-head">' +
          '<div><b>云同步</b><span class="cloud-sub">生成一个码，两台设备输入同一个码即可互通</span></div>' +
          '<button class="btn btn-primary btn-sm" id="cloudGen">生成同步码</button>' +
        '</div>' +
        '<div class="cloud-row">' +
          '<input class="cloud-input" id="cloudInput" maxlength="12" placeholder="已有同步码？输入后绑定" />' +
          '<button class="btn btn-outline btn-sm" id="cloudBind">绑定</button>' +
        '</div>' +
        '<details class="cloud-fold">' +
          '<summary>本机备份（最近 10 份，自动保存）</summary>' +
          '<div id="localSnaps" class="cloud-backups">—</div>' +
        '</details>';
    } else {
      var status = last
        ? (last.ok ? '上次同步 ' + fmtTime(last.ts) : '上次失败：' + (last.msg || '未知错误'))
        : '尚未同步';
      var link = bindLink(code);
      box.innerHTML =
        '<div class="cloud-head">' +
          '<div><b>云同步 · 自动</b><span class="cloud-sub">' + status + '　·　答题后自动上传</span></div>' +
          '<span class="cloud-code" id="cloudCode">' + code.slice(0, 4) + ' ' + code.slice(4) + '</span>' +
        '</div>' +
        '<p class="cloud-auto">双向自动同步：答题即传 · 每 4 分钟自动拉取 · 打开或切回页面即同步 · 含作答明细与未交卷草稿</p>' +
        '<div class="cloud-row">' +
          '<button class="btn btn-primary btn-sm" id="cloudNow">立即同步</button>' +
          '<button class="btn btn-outline btn-sm" id="cloudCopyLink">复制绑定链接</button>' +
          '<button class="btn btn-ghost btn-sm" id="cloudCopy">复制码</button>' +
          '<button class="btn btn-ghost btn-sm" id="cloudUnbind">解除绑定</button>' +
        '</div>' +
        '<details class="cloud-fold">' +
          '<summary>二维码（另一台设备扫码即绑定）</summary>' +
          '<div class="cloud-qr" id="cloudQr"></div>' +
          '<input class="cloud-input" id="cloudLink" readonly value="' + link + '" />' +
          '<div class="cloud-row"><button class="btn btn-outline btn-sm" id="cloudCopyLink">复制链接</button></div>' +
        '</details>' +
        '<details class="cloud-fold">' +
          '<summary>备份与恢复（本机 10 份 + 云端 20 份）</summary>' +
          '<p class="cloud-sub2">本机快照：每次交卷自动存，防误清</p>' +
          '<div id="localSnaps" class="cloud-backups">—</div>' +
          '<p class="cloud-sub2">云端备份：需绑定同步码</p>' +
          '<div id="cloudBackups" class="cloud-backups">—</div>' +
        '</details>';
    }
    bindBar();
  }

  function renderLocalSnaps() {
    var box = document.getElementById("localSnaps");
    if (!box) return;
    var list = readSnaps();
    if (!list.length) { box.innerHTML = "<p class=\"cloud-tip\">暂无本机快照，交卷后会自动生成。</p>"; return; }
    box.innerHTML = list.map(function (b) {
      return "<div class=\"cloud-bk\">" +
        "<span class=\"cloud-bk-time\">" + fmtTime(b.ts) + "</span>" +
        "<span class=\"cloud-bk-meta\">记录 " + (b.history || []).length + " 次 · 完成 " + Object.keys(b.daylog || {}).length + " 天 · " + (b.reason || "自动") + "</span>" +
        "<button class=\"btn btn-ghost btn-sm\" data-snap=\"" + b.ts + "\">恢复</button>" +
      "</div>";
    }).join("");
    Array.prototype.forEach.call(box.querySelectorAll("[data-snap]"), function (btn) {
      btn.onclick = function () {
        if (!confirm("用本机快照覆盖当前记录？（当前状态会先存一份快照）")) return;
        snapshot("恢复前");
        if (restoreSnapshot(btn.getAttribute("data-snap"))) {
          note("已恢复本机快照");
          renderBar();
          if (getCode()) syncNow();
        } else note("快照不存在");
      };
    });
  }

  function loadBackups() {
    var box = $('cloudBackups');
    if (!box) return;
    var code = getCode();
    rpc('sync_backups', { p_code: code }).then(function (list) {
      if (!Array.isArray(list) || !list.length) {
        box.innerHTML = '<p class="cloud-tip">暂无备份，同步一次后自动生成。</p>';
        return;
      }
      box.innerHTML = list.map(function (b) {
        return '<div class="cloud-bk">' +
          '<span class="cloud-bk-time">' + fmtTime(b.at) + '</span>' +
          '<span class="cloud-bk-meta">完成 ' + (b.days || 0) + ' 天 · 记录 ' + (b.hist || 0) + ' 次</span>' +
          '<button class="btn btn-ghost btn-sm" data-restore="' + b.id + '">恢复</button>' +
        '</div>';
      }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('[data-restore]'), function (btn) {
        btn.onclick = function () { restore(btn.getAttribute('data-restore'), btn); };
      });
    }).catch(function (e) {
      box.innerHTML = '<p class="cloud-tip">备份列表读取失败：' + (e.message || '网络错误') + '</p>';
    });
  }

  function restore(id, btn) {
    if (!confirm('用这份备份覆盖本机记录？当前记录会先上传到云端留档，可再恢复回来。')) return;
    var code = getCode();
    btn.disabled = true;
    btn.textContent = '恢复中…';
    rpc('sync_backup_get', { p_code: code, p_id: Number(id) }).then(function (payload) {
      if (!payload) throw new Error('备份不存在');
      // 覆盖前先把当前状态留档，方便再恢复回来
      return rpc('sync_put', { p_code: code, p_payload: readLocal() }).then(function () {
      var stamp = Date.now();
      try { localStorage.setItem('zjxc.restoreat', String(stamp)); } catch (e) {}
      localStorage.setItem(HISTORY_KEY, JSON.stringify(payload[HISTORY_KEY] || []));
      localStorage.setItem(DAYLOG_KEY, JSON.stringify(payload[DAYLOG_KEY] || {}));
      document.dispatchEvent(new CustomEvent('zjxc:synced', { detail: { changed: 99 } }));
      // 回滚是全局动作：直接推送带标记的快照，不再合并云端新数据
      return rpc('sync_put', { p_code: code, p_payload: readLocal() }).then(function () {
        setLast({ ts: stamp, ok: true });
        renderBar();
      });
      });
    }).then(function () {
      btn.textContent = '已恢复';
      loadBackups();
      setTimeout(function () { btn.textContent = '恢复'; btn.disabled = false; }, 1500);
    }).catch(function (e) {
      alert('恢复失败：' + (e.message || '未知错误'));
      btn.textContent = '恢复';
      btn.disabled = false;
    });
  }

  function bindBar() {
    var box = $('cloudSyncBox');
    if (!box) return;

    var gen = $('cloudGen');
    if (gen) gen.onclick = function () {
      var c = newCode();
      setCode(c);
      renderBar();
      syncNow({ silent: true });
    };

    var bind = $('cloudBind');
    if (bind) bind.onclick = function () {
      var input = $('cloudInput');
      var c = normalizeCode(input && input.value);
      if (c.length < 8) { alert('同步码至少 8 位字母数字（新版是 10 位）'); return; }
      setCode(c);
      renderBar();
      syncNow({ silent: true });
    };

    var now = $('cloudNow');
    if (now) now.onclick = function () {
      now.textContent = '同步中…';
      now.disabled = true;
      syncNow().then(function (r) {
        now.textContent = r.ok ? '已同步' : '重试';
        now.disabled = false;
        setTimeout(renderBar, 1200);
      });
    };

    var copy = $('cloudCopy');
    if (copy) copy.onclick = function () { copyText(getCode(), copy, '复制码'); };

    var copyLink = $('cloudCopyLink');
    if (copyLink) copyLink.onclick = function () { copyText(bindLink(getCode()), copyLink, '复制链接'); };

    var unbind = $('cloudUnbind');
    if (unbind) unbind.onclick = function () {
      if (!confirm('解除绑定后，本机不再自动同步（记录仍保留在本机）。确定？')) return;
      setCode('');
      renderBar();
    };

    Array.prototype.forEach.call(box.querySelectorAll('details.cloud-fold'), function (d) {
      d.addEventListener('toggle', function () {
        if (!d.open) return;
        if (d.querySelector('#cloudQr')) renderQR(bindLink(getCode()));
        if (d.querySelector('#localSnaps')) renderLocalSnaps();
        if (d.querySelector('#cloudBackups')) {
          if (getCode()) loadBackups();
          else {
            var cb = d.querySelector('#cloudBackups');
            cb.innerHTML = '<p class="cloud-tip">未绑定同步码，云端备份不可用。</p>';
          }
        }
      });
    });
  }

  function copyText(text, btn, resetLabel) {
    var done = function () {
      btn.textContent = '已复制';
      setTimeout(function () { btn.textContent = resetLabel || '复制'; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      done();
    }
  }

  /* ---------- 换设备：URL 带 ?sync=CODE 自动绑定 ---------- */
  function consumeUrlCode() {
    try {
      var q = new URLSearchParams(location.search);
      var c = normalizeCode(q.get('sync'));
      if (!c || c.length < 8) return false;
      if (c !== getCode()) setCode(c);
      q.delete('sync');
      var qs = q.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
      return true;
    } catch (e) { return false; }
  }

  function autoBoot() {
    if (!cloudOn() && !mqttOn()) return;
    if (getCode()) return;
    var c = newCode();
    setCode(c);
    try { localStorage.setItem("zjxc.autocode", "1"); } catch (e) {}
  }

  /* 定时拉取：4 分钟一次。以前只在"脏"时同步，导致另一台设备的记录要重开页面才看得到 */
  setInterval(function () {
    if (!cloudOn() && !mqttOn()) return;
    if (!getCode() || !navigator.onLine || busy) return;
    if (document.visibilityState === 'hidden') return;
    syncNow({ silent: true });
  }, 240000);

  /* 切到后台先推、切回前台先拉；断网恢复、窗口重新获得焦点也立刻同步一次 */
  document.addEventListener("visibilitychange", function () {
    if ((!cloudOn() && !mqttOn()) || !getCode()) return;
    if (document.visibilityState === "hidden") {
      if (isDirty()) syncNow({ silent: true });
    } else {
      syncNow({ silent: true });
    }
  });
  window.addEventListener("online", function () {
    if ((cloudOn() || mqttOn()) && getCode()) syncNow({ silent: true });
  });
  var lastFocusAt = 0;
  window.addEventListener("focus", function () {
    if ((!cloudOn() && !mqttOn()) || !getCode() || busy) return;
    if (Date.now() - lastFocusAt < 30000) return;
    lastFocusAt = Date.now();
    syncNow({ silent: true });
  });

  window.ZJXCSync = {
    getCode: getCode,
    syncNow: syncNow,
    schedule: schedule,
    scheduleDraft: scheduleDraft,
    renderBar: renderBar,
    loadBackups: loadBackups,
    snapshot: snapshot,
    markDirty: markDirty,
    isDirty: isDirty,
    restoreSnapshot: restoreSnapshot,
    hasCode: function () { return !!getCode(); },
    /* 裸通道：给「内容热更新」用（订阅/发布任意主题） */
    rawSubscribe: function (topic, onMessage) {
      return mqttConnect().then(function (client) {
        if (!client) return false;
        client.on('message', function (t, payload) {
          if (t !== topic) return;
          try { onMessage(payload.toString('utf8')); } catch (e) {}
        });
        return new Promise(function (res) {
          client.subscribe(topic, { qos: 1 }, function (err) { res(!err); });
        });
      });
    },
    rawPublish: function (topic, text) {
      return mqttConnect().then(function (client) {
        if (!client) return false;
        return new Promise(function (res) {
          client.publish(topic, text, { qos: 1, retain: true }, function (err) { res(!err); });
        });
      });
    }
  };

  /* shareId（分享链接带的 32 位 id）→ 取末 8 位作同步码，实现「同一条链接、任何设备同一份记录」 */
  function consumeShareId() {
    try {
      var q = new URLSearchParams(location.search);
      var sid = String(q.get('shareId') || '').replace(/[^a-fA-F0-9]/g, '');
      if (sid.length < 8) return false;
      var c = sid.slice(-8).toUpperCase();
      if (c !== getCode()) setCode(c);
      return true;
    } catch (e) { return false; }
  }

  /* 预置同步码（打包时由 tools/preset-code.js 写入 cloud-config.js）：
     首次启动直接用，省得在平板上手输 10 位码；用户手动改过则以手动为准 */
  function applyPresetCode() {
    var c = normalizeCode(window.PRESET_SYNC_CODE);
    if (c.length < 8) return false;
    if (getCode()) return false;
    setCode(c);
    return true;
  }

  var fromUrl = consumeUrlCode();
  consumeShareId();
  applyPresetCode();
  autoBoot();
  window.addEventListener('load', function () {
    if ((cloudOn() || mqttOn()) && getCode()) {
      setTimeout(function () { syncNow({ silent: true }); }, fromUrl ? 600 : 1200);
    }
  });
})();
