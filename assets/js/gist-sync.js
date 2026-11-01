/* ===========================================================
   gist-sync.js —— 用 GitHub 私有 Gist 做持久化同步（可选功能）
   -----------------------------------------------------------
   为什么需要：
     MQTT 公开 broker 的「保留消息」不是永久存储，broker 重启会清空。
     新设备（如 iPhone）在 broker 被清空后加入，就会拉不到任何记录。
     GitHub Gist 不会清理，适合做「不会丢」的主存储，MQTT 退为快速通道。

   安全边界：
     · token 只存在本机 localStorage，绝不上传、绝不写进代码
     · 建议 token 只勾 gist 权限（碰不到代码仓库）
     · Gist 设为 secret（不公开列出），地址含随机 ID
     · 用户可随时在 GitHub 页面删除 token，立即失效

   用法：
     window.GistSync.setToken('ghp_xxx')      保存 token
     window.GistSync.verify()                 → Promise<{ok, login}>
     window.GistSync.pullPayload()            → Promise<{ok, env}|{ok:false,reason}>
     window.GistSync.pushPayload(env)         → Promise<{ok, pushed}>
   =========================================================== */
(function () {
  'use strict';

  var API = 'https://api.github.com';
  var FILE = 'zjxc-sync.json';          // Gist 里的文件名
  var LS_TOKEN = 'zjxc.gh.token';
  var LS_GIST = 'zjxc.gh.gistid';
  var LS_SEEN = 'zjxc.gh.last';

  function ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lss(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} }

  function getToken() { return ls(LS_TOKEN); }
  function setToken(t) {
    t = String(t || '').trim();
    if (!t) { clearToken(); return; }
    lss(LS_TOKEN, t);
    // token 变了，之前缓存的 gist id 可能属于别的账号，清掉重新找
    lss(LS_GIST, '');
  }
  function clearToken() { lss(LS_TOKEN, ''); lss(LS_GIST, ''); lss(LS_SEEN, ''); }
  function isOn() { return !!getToken(); }
  function getLast() { try { return JSON.parse(ls(LS_SEEN) || 'null'); } catch (e) { return null; } }
  function setLast(o) { lss(LS_SEEN, JSON.stringify(o)); }

  function headers() {
    return {
      'Authorization': 'Bearer ' + getToken(),
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    };
  }

  function req(url, opts) {
    opts = opts || {};
    opts.headers = headers();
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    return fetch(url, opts).then(function (r) {
      return r.text().then(function (txt) {
        var body = null;
        try { body = txt ? JSON.parse(txt) : null; } catch (e) {}
        if (!r.ok) {
          var err = new Error((body && body.message) || ('HTTP ' + r.status));
          err.status = r.status;
          throw err;
        }
        return body;
      });
    });
  }

  /* 验证 token 是否有效 → {ok, login} */
  function verify(token) {
    var useToken = token ? String(token).trim() : getToken();
    if (!useToken) return Promise.resolve({ ok: false, reason: 'notoken' });
    return fetch(API + '/user', {
      headers: {
        'Authorization': 'Bearer ' + useToken,
        'Accept': 'application/vnd.github+json'
      }
    }).then(function (r) {
      if (r.status === 401) return { ok: false, reason: 'badtoken' };
      if (!r.ok) return { ok: false, reason: 'http' + r.status };
      return r.json().then(function (u) { return { ok: true, login: u.login }; });
    }).catch(function () { return { ok: false, reason: 'network' }; });
  }

  /* 找到存数据的 Gist；没有就新建 */
  function ensureGist() {
    var cached = ls(LS_GIST);
    if (cached) return Promise.resolve(cached);

    // 先在自己已有的 gist 里找带 FILE 的那个
    return req(API + '/gists?per_page=100').then(function (list) {
      if (Array.isArray(list)) {
        for (var i = 0; i < list.length; i++) {
          var f = list[i] && list[i].files;
          if (f && f[FILE]) {
            lss(LS_GIST, list[i].id);
            return list[i].id;
          }
        }
      }
      // 没找到 → 新建 secret gist
      return req(API + '/gists', {
        method: 'POST',
        body: {
          description: '浙考行测 · 答题记录同步（请勿删除）',
          public: false,
          files: (function () {
            var o = {};
            o[FILE] = { content: JSON.stringify({ v: 2, empty: true, ts: Date.now() }) };
            return o;
          })()
        }
      }).then(function (g) {
        lss(LS_GIST, g.id);
        return g.id;
      });
    });
  }

  /* 读 Gist 里的载荷 → {ok, env} | {ok:false, reason} */
  function pullPayload() {
    if (!isOn()) return Promise.resolve({ ok: false, reason: 'notoken' });
    return ensureGist().then(function (id) {
      return req(API + '/gists/' + id);
    }).then(function (g) {
      var file = g && g.files && g.files[FILE];
      if (!file) return { ok: false, reason: 'nofile' };
      var raw = file.content;
      // 文件较大时 GitHub 返回 truncated + raw_url
      if (file.truncated && file.raw_url) {
        return fetch(file.raw_url, { headers: { 'Accept': 'application/vnd.github+json' } })
          .then(function (r) { return r.text(); })
          .then(function (t) { return parseEnv(t); });
      }
      return parseEnv(raw);
    }).catch(function (e) {
      if (e && e.status === 401) { lss(LS_GIST, ''); return { ok: false, reason: 'badtoken' }; }
      if (e && e.status === 404) { lss(LS_GIST, ''); return { ok: false, reason: 'nogist' }; }
      return { ok: false, reason: 'network', message: (e && e.message) || '' };
    });
  }

  function parseEnv(txt) {
    var env;
    try { env = JSON.parse(txt); } catch (e) { return { ok: false, reason: 'badjson' }; }
    if (!env || env.empty) return { ok: false, reason: 'empty' };
    return { ok: true, env: env };
  }

  /* 写载荷 → {ok, pushed} */
  function pushPayload(env) {
    if (!isOn()) return Promise.resolve({ ok: false, reason: 'notoken' });
    var content = JSON.stringify(env);
    var body = { files: {} };
    body.files[FILE] = { content: content };

    return ensureGist().then(function (id) {
      return req(API + '/gists/' + id, { method: 'PATCH', body: body });
    }).then(function (g) {
      setLast({ ts: Date.now(), ok: true });
      return { ok: true, pushed: true, id: g && g.id };
    }).catch(function (e) {
      if (e && e.status === 404) {
        // gist 被删了 → 清缓存，下次重新建
        lss(LS_GIST, '');
        setLast({ ts: Date.now(), ok: false, msg: 'Gist 已删除' });
        return { ok: false, reason: 'nogist' };
      }
      if (e && e.status === 401) {
        setLast({ ts: Date.now(), ok: false, msg: 'token 失效' });
        return { ok: false, reason: 'badtoken' };
      }
      setLast({ ts: Date.now(), ok: false, msg: (e && e.message) || '写入失败' });
      return { ok: false, reason: 'network', message: (e && e.message) || '' };
    });
  }

  window.GistSync = {
    API: API,
    FILE: FILE,
    isOn: isOn,
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
    verify: verify,
    pullPayload: pullPayload,
    pushPayload: pushPayload,
    getLast: getLast,
    gistUrl: function () {
      var id = ls(LS_GIST);
      return id ? 'https://gist.github.com/' + id : '';
    }
  };
})();