/* ===========================================================
   app.js —— 浙考行测训练场 主逻辑
   纯原生 JS，无依赖，file:// 直接可运行
   =========================================================== */
(function () {
  'use strict';

  /* ---------------- 基础常量与工具 ---------------- */
  var MODULES = window.MODULES;
  var ORDER = window.MODULE_ORDER;
  var LS_PROGRESS = 'zjxc.progress.v1';
  var LS_HISTORY = 'zjxc.history.v1';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return pad2(m) + ':' + pad2(s);
  }
  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return h + ' 小时 ' + m + ' 分';
    if (m > 0) return m + ' 分 ' + s + ' 秒';
    return s + ' 秒';
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function rotate(arr, k) {
    if (!arr.length) return arr.slice();
    k = ((k % arr.length) + arr.length) % arr.length;
    return arr.slice(k).concat(arr.slice(0, k));
  }
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }

  /* ---------------- 题库索引 ---------------- */
  var bank = [];
  var ALL = {};
  /* 暴露给 reinforce.js 做「同类题」检索（ALL 是引用，后续 registerReal 加题可见） */
  window.__ZJXC_ALL = ALL;
  var PLANQ = {};
  ORDER.forEach(function (m) {
    (window.BANK[m] || []).forEach(function (q) {
      q.module = m;
      bank.push(q);
      ALL[q.id] = q;
    });
  });
  // 保证每题都有难度、标签
  bank.forEach(function (q) {
    q.difficulty = q.difficulty || 2;
    q.point = q.point || [q.sub || MODULES[q.module].name];
    q.options = q.options || [];
  });

  // 原每日任务的题目并入整卷题池（每日任务已下线，题不能浪费）
  Object.keys(window.PLAN_Q || {}).forEach(function (k) {
    (window.PLAN_Q[k] || []).forEach(function (q) {
      q.difficulty = q.difficulty || 2;
      q.point = q.point || [q.sub || MODULES[q.module].name];
      q.options = q.options || [];
      PLANQ[q.id] = q;
      if (!ALL[q.id]) { ALL[q.id] = q; bank.push(q); }
    });
  });

  /* ---------------- 状态 ---------------- */
  var view = 'home';
  var mode = 'exam';
  var homeExam = (window.EXAMS[0] && window.EXAMS[0].id) || 'gk';
  var homeYear = (window.EXAMS[0] && window.EXAMS[0].years[0]) || 2025;
  var state = null;
  var current = 0;
  var autoNextTimer = null;
  var timerId = null;
  var lastReport = null;
  var modalOpen = false;
  var printOpenState = [];

  /* ---------------- 组卷 ---------------- */
  function moduleGroups(m) {
    var list = bank.filter(function (q) { return q.module === m; });
    var groups = {}, keys = [];
    list.forEach(function (q) {
      var k = q.materialId || String(q.sub || '').split('·')[0];
      if (!groups[k]) { groups[k] = []; keys.push(k); }
      groups[k].push(q);
    });
    return keys.map(function (k) { return groups[k]; });
  }

  function pickModule(m, n, seed, opts) {
    if (!n) return [];
    var groups = moduleGroups(m);

    // 资料分析按整篇材料取用（每篇 4 题），轮换材料顺序
    if (m === 'data') {
      var gi = seed % groups.length;
      var ordered = groups.slice(gi).concat(groups.slice(0, gi));
      var flat = [];
      ordered.forEach(function (g) { flat = flat.concat(g); });
      return flat.slice(0, n);
    }

    // 按 seed 在该模块题库中均匀取起点，尽量降低不同卷别之间的重合
    var len = groups.reduce(function (a, g) { return a + g.length; }, 0);
    var base = Math.round(seed * len / 18);
    var out = [];
    groups.forEach(function (g) { out = out.concat(rotate(g, base)); });

    // 数量关系：数字推理固定排在前 4—5 题，贴近真实卷结构
    if (m === 'quant') {
      var num = [], calc = [];
      out.forEach(function (q) { (String(q.sub).indexOf('数字推理') === 0 ? num : calc).push(q); });
      var nNum = (typeof opts !== 'undefined' && opts && opts.noNumSeq) ? 0 : Math.min(num.length, Math.max(3, Math.min(5, Math.round(n * 0.5))));
      return num.slice(0, nNum).concat(calc.slice(0, n - nNum));
    }

    return out.slice(0, n);
  }

  function buildPaperSession(paper) {
    // 不同年份、不同卷别使用不同起点，避免各卷题目完全重合
    var yearIdx = { 2025: 0, 2024: 1, 2023: 2 }[paper.year] || 0;
    var slugIdx = { fu: 0, di: 1, zf: 2, A: 0, B: 1, C: 2 }[String(paper.id).split('-').pop()] || 0;
    var seed = (yearIdx * 2 + slugIdx * 6) % 18;
    var ids = [];
    ORDER.forEach(function (m) {
      pickModule(m, paper.quota[m] || 0, seed, { noNumSeq: true }).forEach(function (q) { ids.push(q.id); });
    });
    return {
      kind: 'paper',
      ref: paper.id,
      title: paper.year + ' ' + (paper.exam === 'gk' ? '国考' : '浙江省考') + ' · ' + paper.code,
      sub: '行测 · 真题题量 ' + ids.length + ' 题 · 备用卷（真题包未加载）',
      mode: mode,
      minutes: mode === 'exam' ? paper.minutes : 0,
      ids: ids,
      answers: {},
      flags: {},
      startedAt: Date.now(),
      deadline: mode === 'exam' ? Date.now() + paper.minutes * 60000 : 0
    };
  }

  function buildModuleSession(m) {
    var ids = bank.filter(function (q) { return q.module === m; }).map(function (q) { return q.id; });
    var mins = window.modulePracticeMinutes(ids.length);
    return {
      kind: 'module',
      ref: m,
      title: '专项 · ' + MODULES[m].name,
      sub: '模块专项练习 · ' + ids.length + ' 题',
      mode: mode,
      minutes: mode === 'exam' ? mins : 0,
      ids: ids,
      answers: {},
      flags: {},
      startedAt: Date.now(),
      deadline: mode === 'exam' ? Date.now() + mins * 60000 : 0
    };
  }

  /* ---------------- 逐套通关：国考副省级 2016 → 2025 ---------------- */
  function seqDone() {
    try { return JSON.parse(localStorage.getItem('zjxc.seqdone') || '{}'); } catch (e) { return {}; }
  }
  function markSeqDone(paperId) {
    try {
      var m = seqDone();
      m[paperId] = Date.now();
      localStorage.setItem('zjxc.seqdone', JSON.stringify(m));
    } catch (e) {}
  }
  /* 通关顺序：按考试体系各自独立 —— 国考副省级 2016→2025、浙江 A 卷 2016→2025，
     练浙江不必先把国考全部做完。 */
  function seqOrderOf(examId) {
    var all = window.SEQ_ORDER || [];
    if (!examId) return all;
    return all.filter(function (p) { return p.exam === examId; });
  }
  function seqIndex(examId) {
    var order = seqOrderOf(examId), d = seqDone();
    for (var i = 0; i < order.length; i++) { if (!d[order[i].id]) return i; }
    return order.length;
  }
  function seqLabel(p) {
    return p.exam === 'gk' ? (p.year + ' 国考 · ' + p.code) : (p.year + ' 浙江省考 · ' + p.code);
  }
  function seqInfo(examId) {
    examId = examId || homeExam;
    var order = seqOrderOf(examId);
    if (!order.length) return null;
    var i = seqIndex(examId);
    return {
      examId: examId,
      idx: i,
      done: Math.min(i, order.length),
      total: order.length,
      paper: i < order.length ? order[i] : null,
      next: i + 1 < order.length ? order[i + 1] : null,
      allDone: i >= order.length
    };
  }
  function renderDrafts() {
    var box = $("#draftBlock");
    if (!box) return;
    var d = loadDrafts();
    var keys = Object.keys(d);
    if (!keys.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = "<p class=\"draft-title\">未完成的卷（已自动保存）</p>" +
      keys.map(function (k) {
        var it = d[k];
        var total = (it.state.ids || []).length;
        var done = (it.state.ids || []).filter(function (id) { return it.state.answers[id] != null; }).length;
        var when = fmtDate(it.savedAt);
        return "<div class=\"draft-row\">" +
          "<div class=\"draft-main\"><b>" + esc(it.state.title || k) + "</b>" +
          "<span>已答 " + done + " / " + total + " 题 · " + when + "</span></div>" +
          "<button class=\"btn btn-primary btn-sm\" data-draft-go=\"" + esc(k) + "\">继续</button>" +
          "<button class=\"btn btn-outline btn-sm\" data-draft-go=\"" + esc(k) + "\" data-untimed=\"1\">不限时继续</button>" +
          "<button class=\"btn btn-ghost btn-sm\" data-draft-del=\"" + esc(k) + "\">丢弃</button>" +
        "</div>";
      }).join("");
  }

  function healthCard() {
    var hist = loadHistory();
    var snaps = [];
    try { snaps = JSON.parse(localStorage.getItem("zjxc.snapshots") || "[]"); } catch (e) {}
    var drafts = {};
    try { drafts = JSON.parse(localStorage.getItem("zjxc.drafts") || "{}"); } catch (e) {}
    var code = (window.ZJXCSync && window.ZJXCSync.getCode()) || "";
    var cpRev = (window.ContentPatch && window.ContentPatch.rev()) || 0;
    var last = hist[0] ? fmtDate(hist[0].ts) : "—";
    var host = location.hostname;
    return "<div class=\"health\">" +
      "<div class=\"health-row\"><span>当前网址</span><b>" + esc(host) + "</b></div>" +
      "<div class=\"health-row\"><span>交卷记录</span><b>" + hist.length + " 条</b></div>" +
      "<div class=\"health-row\"><span>本机快照</span><b>" + snaps.length + " 份</b></div>" +
      "<div class=\"health-row\"><span>未完成草稿</span><b>" + Object.keys(drafts).length + " 套</b></div>" +
      "<div class=\"health-row\"><span>同步方式</span><b>" + (code ? ("自动同步 " + code.slice(0, 5) + " " + code.slice(5)) : "本机模式") + "</b></div>" +
      "<div class=\"health-row\"><span>题库补丁</span><b>" + (cpRev ? fmtDate(cpRev) : "无（内置版）") + "</b></div>" +
      "<div class=\"health-row\"><span>最近一次</span><b>" + last + "</b></div>" +
      "<p class=\"cloud-tip\">绑定同一个同步码的设备自动共用这份数据；未绑定（或没网）时只存本机。</p>" +
    "</div>";
  }

  function renderRecordHint() {
    var box = $("#recordHint");
    if (!box) return;
    var hist = loadHistory();
    var code = window.ZJXCSync && window.ZJXCSync.getCode();
    if (hist.length || code) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = "<b>本机还没有答题记录。</b>如果你在另一台设备上做过题，点右上角「同步」，用「同步码」或导出的记录文件搬过来即可。";
  }

  /* 顶部卡片：不再闯关，改为「本体系进度概览 + 继续上次/随机一套」 */
  function renderSeqCard() {
    var box = $('#gkDaily');
    if (!box) return;
    var examId = homeExam;
    var order = seqOrderOf(examId);
    if (!order.length) { box.innerHTML = ''; return; }
    var done = seqDone();
    var doneN = order.filter(function (p) { return !!done[p.id]; }).length;
    var examName = examId === 'zj' ? '浙江省考 A 卷' : '国考';
    var pct = (doneN / order.length * 100).toFixed(1);

    // 优先推荐「还没做过的第一套」，全部做过就推荐再做第一套
    var next = null;
    for (var i = 0; i < order.length; i++) { if (!done[order[i].id]) { next = order[i]; break; } }
    if (!next) next = order[0];

    box.innerHTML = '<div class="gk-daily">' +
      '<div class="gk-daily-main">' +
        '<p class="gk-daily-tag">' + examName + ' · 已做 ' + doneN + ' / ' + order.length + ' 套</p>' +
        '<h3>' + (doneN >= order.length ? '全部做过啦' : '还没做：' + seqLabel(next)) + '</h3>' +
        '<p class="gk-daily-sub">所有试卷都可自由选择，随时开始任意一套</p>' +
        '<div class="seq-bar"><i style="width:' + pct + '%"></i></div>' +
      '</div>' +
      '<div class="gk-daily-act">' +
        '<button class="btn btn-primary" id="btnGkDaily">' +
          (doneN >= order.length ? '再做一遍 ' + seqLabel(next) : '开始 ' + seqLabel(next)) +
        '</button>' +
      '</div>' +
    '</div>' +
    '<p class="gk-daily-next">提示：下方「整卷模考」里每一套都能直接点开，不用按顺序</p>';
  }
  function startSeq() {
    var examId = homeExam;
    var order = seqOrderOf(examId);
    if (!order.length) return;
    var done = seqDone();
    var next = null;
    for (var i = 0; i < order.length; i++) { if (!done[order[i].id]) { next = order[i]; break; } }
    if (!next) next = order[0];
    if (next.real) { openRealPaper(next); return; }
    var s = buildPaperSession(next);
    s.kind = 'seq';
    s.seqId = next.id;
    s.title = seqLabel(next);
    s.sub = (next.realCount || next.count) + ' 题 · 真题';
    startSession(s);
  }

  /* ---------------- 首页 ---------------- */
  function renderHome() {
    var total = bank.length;
    $('#headerStat').textContent = window.PAPERS.length + ' 套真题 · 专项题库 ' + total + ' 题';

    // 考试体系 + 年份
    var exam = window.EXAMS.filter(function (e) { return e.id === homeExam; })[0] || window.EXAMS[0];
    if (exam.years.indexOf(homeYear) < 0) homeYear = exam.years[0];

    $('#examTabs').innerHTML = window.EXAMS.map(function (e) {
      var on = e.id === exam.id;
      return '<button class="exam-tab' + (on ? ' is-active' : '') + '" data-exam="' + e.id + '" role="tab" aria-selected="' + on + '">' + esc(e.name) + '</button>';
    }).join('');
    // 只剩国考一个体系时不必显示切换 tab
    $('#examTabs').hidden = window.EXAMS.length < 2;

    $('#yearBar').innerHTML =
      '<span class="year-label">年份</span>' +
      exam.years.map(function (y) {
        return '<button class="year-chip' + (y === homeYear ? ' is-active' : '') + '" data-year="' + y + '" role="tab" aria-selected="' + (y === homeYear) + '">' + y + '</button>';
      }).join('') +
      '<span class="exam-remark">' + esc(exam.full) + ' · ' + esc(exam.remark) + '</span>';

    renderSeqCard();
    renderDrafts();
    renderRecordHint();

    // 整卷卡片
    var papers = exam.papers.filter(function (p) { return p.year === homeYear; });
    var html = papers.map(function (p) {
      var count = p.count;
      var bar = ORDER.map(function (m) {
        var w = (p.quota[m] || 0) / count * 100;
        return '<i style="width:' + w.toFixed(2) + '%;background:' + MODULES[m].color + '"></i>';
      }).join('');
      var legend = ORDER.filter(function (m) { return p.quota[m]; }).map(function (m) {
        return '<span><i style="background:' + MODULES[m].color + '"></i>' +
          MODULES[m].short + ' ' + (p.quota[m] || 0) + '</span>';
      }).join('');
      // 不再锁卷：所有试卷随时可做，只标记做过的
      var seqOrder = seqOrderOf(p.exam);
      var seqPos = -1;
      for (var qi = 0; qi < seqOrder.length; qi++) { if (seqOrder[qi].id === p.id) { seqPos = qi; break; } }
      var doneAlready = seqPos >= 0 && !!seqDone()[p.id];

      return '<article class="paper-card">' +
        '<div class="paper-top"><div>' +
          '<span class="paper-code">' + p.year + ' · ' + esc(p.code) + (p.real ? ' · <b class="paper-real-tag">真题</b>' : '') + (doneAlready ? ' · 已做过' : '') + '</span>' +
          '<h3 class="paper-name">' + esc(p.name) + '</h3>' +
        '</div></div>' +
        '<p class="paper-desc">' + esc(p.desc) + '</p>' +
        '<div class="paper-facts">' +
          '<div><b>' + (p.realCount || (p.real ? p.realTotal : count)) + '</b><span>本卷题量</span></div>' +
          '<div><b>' + p.minutes + '</b><span>限时（分钟）</span></div>' +
          '<div><b>' + p.realTotal + '</b><span>真题题量</span></div>' +
        '</div>' +
        '<div class="comp-bar">' + bar + '</div>' +
        '<div class="comp-legend">' + legend + '</div>' +
        '<p class="paper-real">真题结构：' + esc(p.realDetail) + '</p>' +
        '<button class="btn btn-primary" data-paper="' + p.id + '">' + (doneAlready ? '再做一遍' : '开始答题') + '</button>' +
      '</article>';
    }).join('');
    $('#paperGrid').innerHTML = html;
    $('#paperNote').textContent = exam.id === 'zj'
      ? '浙江省考 A 卷 2015—2025 共 ' + exam.papers.length + ' 套真题（考生回忆版，公开整理），行测 120 分钟。' +
        '各年份题量不同（100—140 题），题量与当年回忆版实际收录一致。任意一套都可直接开始。'
      : '国考行测 2016—2026 共 ' + exam.papers.length + ' 套真题（考生回忆版，公开整理），120 分钟。' +
        '副省级 135 题、2026 行政执法 130 题。任意一套都可直接开始。';

    // 专项卡片
    $('#moduleGrid').innerHTML = ORDER.map(function (m) {
      var n = bank.filter(function (q) { return q.module === m; }).length;
      var M = MODULES[m];
      return '<button class="module-card" data-module="' + m + '">' +
        '<span class="module-icon" style="background:' + M.color + '">' + M.char + '</span>' +
        '<span class="module-info"><strong>' + M.name + '</strong>' +
          '<span>随机 ' + ((m === "quant" || m === "politics") ? 10 : 20) + ' 题 · 真题抽取</span></span>' +
        '<span class="module-arrow">›</span>' +
      '</button>';
    }).join('');

    // 历史记录
    var hist = loadHistory();
    if (hist.length) {
      $('#historyBlock').hidden = false;
      $('#historyTable').innerHTML =
        '<thead><tr><th>时间</th><th>试卷</th><th>模式</th><th>折算得分</th><th>正确率</th><th>用时</th><th></th></tr></thead><tbody>' +
        hist.map(function (h, i) {
          return '<tr><td>' + fmtDate(h.ts) + '</td><td>' + esc(h.title) + '</td>' +
            '<td>' + (h.mode === 'exam' ? '考试' : '练习') + '</td>' +
            '<td><b>' + h.score.toFixed(1) + '</b></td>' +
            '<td>' + h.rate + '%</td><td>' + fmtDuration(h.used) + '</td>' +
            '<td><button class="btn btn-ghost" style="padding:2px 8px" data-hist-view="' + i + '">详情</button>' +
            '<button class="btn btn-ghost" style="padding:2px 8px" data-hist-retry="' + i + '">重做</button></td></tr>';
        }).join('') + '</tbody>';
    } else {
      $('#historyBlock').hidden = false;
      $("#historyTable").innerHTML = '<tr><td class="empty-line" colspan="7">本机还没有交卷记录。如果刚交过卷却没看到，说明那次是在另一台设备/另一个浏览器里做的（两者存储独立），用同步码可合并。</td></tr>';
    }

    $('#printHomeBtn').hidden = true;
  }

  /* ---------------- 进入 / 退出答题 ---------------- */
  function setView(v) {
    view = v;
    ['home', 'exam', 'report', 'plan'].forEach(function (k) {
      var el = document.getElementById('view-' + k);
      if (el) el.hidden = (k !== v);
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function startSession(s) {
    state = s;
    current = 0;
    closeSheet();
    setView('exam');
    $('#examTitle').textContent = s.title;
    $('#examSub').textContent = s.sub + (s.mode === 'exam' && s.minutes ? ' · 限时 ' + s.minutes + ' 分钟' : ' · 正计时');
    $('#qCount').textContent = s.ids.length;
    $('#totalNum').textContent = '/' + s.ids.length;
    $("#btnPause").hidden = false;        // 练习模式也能暂停
    beginElapsed();
    renderQuestion();
    renderSheet();
    $("#pauseMask").hidden = true;
    document.body.style.overflow = "";
    startTimer();
    saveProgress();
  }

  function resumeDraft(s0, cur, untimed) {
    var ids = s0.ids || [];
    var need = ids.some(function (id) { return !ALL[id]; });
    var done = ids.filter(function (id) { return s0.answers[id] != null; }).length;
    if (need && s0.ref) {
      toast('正在载入真题…');
      loadRealPaper(s0.ref).then(function (pack) {
        registerReal(pack);
        enterSession(s0, cur, { untimed: untimed });
        toast((untimed ? '已转为不限时 · ' : '') + '已答 ' + done + ' 题');
      }).catch(function () {
        toast('真题包加载失败，检查网络后重试');
      });
      return;
    }
    enterSession(s0, cur, { untimed: untimed });
    toast((untimed ? '已转为不限时 · ' : '') + '已答 ' + done + ' 题');
  }

  function enterSession(s0, cur, opts) {
    if (opts && opts.untimed) {
      s0.mode = "practice";
      s0.minutes = 0;
      s0.deadline = 0;
      s0.paused = false;
      s0.pausedRemain = 0;
    }
    state = s0;    current = Math.min(cur || 0, s0.ids.length - 1);
    setView('exam');
    $("#examTitle").textContent = s0.title;
    $("#examSub").textContent = s0.sub + (s0.mode === "exam" && s0.minutes ? " · 限时 " + s0.minutes + " 分钟" : " · 正计时");
    $("#qCount").textContent = s0.ids.length;
    $("#totalNum").textContent = "/" + s0.ids.length;
    $("#btnPause").hidden = false;              // 练习模式也能暂停
    $("#btnUntimed").hidden = (s0.mode !== "exam");
    $("#timer").hidden = false;                 // 练习模式显示正计时
    $("#pauseMask").hidden = true;
    document.body.style.overflow = "";
    // 恢复时接续累计计时：暂停状态就不再起表，否则从现在继续累加
    beginElapsed();
    renderQuestion();
    renderSheet();
    if (s0.paused) {
      syncPauseUI();
      $("#timerLabel").textContent = "已暂停";
      $("#timerValue").textContent = s0.mode === "exam"
        ? fmtClock(s0.pausedRemain || 0)
        : fmtClock(elapsedNow());
    } else startTimer();
    saveProgress();
  }

  /* ---------------- 真题包 ---------------- */
  var REAL_CACHE = {};
  var REAL_IDS = {};   // paperId -> 已注册进 ALL 的题号，补丁更新时用来清理

  /* 应用内容补丁（深拷贝，避免改到内联包原件） */
  function withPatch(d) {
    if (!window.ContentPatch || !window.ContentPatch.rev || !window.ContentPatch.rev()) return d;
    try {
      var copy = JSON.parse(JSON.stringify(d));
      return window.ContentPatch.apply(copy);
    } catch (e) { return d; }
  }

  function loadRealPaper(id) {
    if (REAL_CACHE[id]) return Promise.resolve(REAL_CACHE[id]);
    // 优先用内联包：离线 / file:// 打开也能做题，不依赖服务器
    var B = window.REAL_BUNDLE;
    if (B && B[id]) { REAL_CACHE[id] = withPatch(B[id]); return Promise.resolve(REAL_CACHE[id]); }
    return fetch("assets/data/real/" + id + ".json", { cache: "force-cache" })
      .then(function (r) { if (!r.ok) throw new Error("404"); return r.json(); })
      .then(function (d) { REAL_CACHE[id] = withPatch(d); return REAL_CACHE[id]; });
  }

  function realFix(html) {
    if (!html) return html;
    return String(html).replace(/src="img\//g, 'src="assets/data/real/img/');
  }

  function registerReal(d) {
    var ids = REAL_IDS[d.id] || (REAL_IDS[d.id] = []);
    (d.materials || []).forEach(function (m) {
      window.MATERIALS[m.id] = { title: m.title, html: realFix(m.html) };
    });
    d.questions.forEach(function (q) {
      ALL[q.id] = {
        id: q.id, module: q.module, sub: q.qtype, stem: realFix(q.stem),
        options: (q.options || []).map(realFix).concat(["", "", "", ""]).slice(0, 4),
        answer: q.answer, explain: realFix(q.explain) || "",
        materialId: q.materialId || null,
        point: q.qtype ? [q.qtype] : [],
        difficulty: 2, real: true
      };
      if (ids.indexOf(q.id) < 0) ids.push(q.id);
    });
  }

  function startPaper(id) {
    var paper = window.PAPERS.filter(function (p) { return p.id === id; })[0];
    if (!paper) return;
    if (paper.real) { openRealPaper(paper); return; }
    startSession(buildPaperSession(paper));
  }

  function openRealPaper(paper, prefix) {
    toast("正在加载真题…");
    loadRealPaper(paper.id).then(function (d) {
      registerReal(d);
      var qs = d.questions.slice();
      startSession({
        kind: "real", ref: paper.id,
        title: (prefix || "") + paper.year + " " + (paper.exam === "gk" ? "国考" : "浙江省考") + " · " + paper.code,
        sub: "考生回忆版 · " + qs.length + " 题 · 真题",
        mode: mode, minutes: mode === "exam" ? paper.minutes : 0,
        ids: qs.map(function (q) { return q.id; }),
        answers: {}, flags: {}, startedAt: Date.now(),
        deadline: mode === "exam" ? Date.now() + paper.minutes * 60000 : 0
      });
    }).catch(function () {
      toast("真题包加载失败，先用结构卷");
      startSession(buildPaperSession(paper));
    });
  }
  function startModule(m, want) {
    if (!MODULES[m]) return;
    var n = want || (m === "quant" || m === "politics" ? 10 : 20);
    var pool = (window.PAPERS || []).filter(function (p) { return p.real; });
    var order = pool.slice().sort(function () { return Math.random() - 0.5; });
    var i = 0;
    function next() {
      if (i >= order.length || i >= 8) {
        toast("真题加载失败，先用仿真题库");
        startSession(buildModuleSession(m));
        return;
      }
      var paper = order[i++];
      loadRealPaper(paper.id).then(function (d) {
        var qs = d.questions.filter(function (q) { return q.module === m; });
        if (qs.length < 5) { next(); return; }
        registerReal(d);
        qs = qs.slice().sort(function () { return Math.random() - 0.5; }).slice(0, Math.min(n, qs.length));
        startSession({
          kind: "module", ref: m,
          title: "专项 · " + MODULES[m].name,
          sub: "真题随机 " + qs.length + " 题 · " + paper.year + " " + (paper.exam === "gk" ? "国考" : "浙江省考") + " " + paper.code,
          mode: mode, minutes: mode === "exam" ? (window.modulePracticeMinutes ? window.modulePracticeMinutes(qs.length) : 0) : 0,
          ids: qs.map(function (q) { return q.id; }),
          answers: {}, flags: {}, startedAt: Date.now(),
          deadline: mode === "exam" ? Date.now() + ((window.modulePracticeMinutes ? window.modulePracticeMinutes(qs.length) : 0) || 15) * 60000 : 0
        });
        toast("本组来自 " + paper.year + " " + paper.code);
      }).catch(next);
    }
    next();
  }

  function startSubset(ids, title, minutes) {
    startSession({
      kind: 'subset', ref: 'subset', title: title,
      sub: '错题针对练习 · ' + ids.length + ' 题',
      mode: mode, minutes: mode === 'exam' ? (minutes || Math.max(5, Math.ceil(ids.length * 1.1))) : 0,
      ids: ids, answers: {}, flags: {}, startedAt: Date.now(),
      deadline: mode === 'exam' ? Date.now() + (minutes || Math.max(5, Math.ceil(ids.length * 1.1))) * 60000 : 0
    });
  }

  function quitExam() {
    var done = answeredCount();
    confirmDialog('退出本次作答？', '<p>已答 <b>' + done + '</b> 题。退出会<b>保存为草稿</b>，下次可从首页「未完成的卷」继续，答案都在。</p>',
      '保存并退出', function () {
        saveDraft();
        if (window.ZJXCSync) window.ZJXCSync.snapshot("退出");
        stopTimer();
        state = null;
        clearProgress();
        setView('home');
        renderHome();
        toast('已保存草稿（已答 ' + done + ' 题），可从「未完成的卷」继续');
      });
  }

  /* ---------------- 暂停 ---------------- */
  /* 练习模式的正计时用「累计秒数 + 本段起点」表示：
       state.elapsedSec  已累计的秒数（暂停/退出时结算）
       state.runSince    本段开始计时的时间戳（运行中才有）
     这样暂停、退出、换设备继续都能接着累加，不会丢时间也不会多算。 */
  function elapsedNow() {
    if (!state) return 0;
    var base = state.elapsedSec || 0;
    if (state.paused) return base;
    if (state.runSince) return base + Math.max(0, Math.floor((Date.now() - state.runSince) / 1000));
    return base;
  }

  /* 结算当前这段计时，写进 elapsedSec。
     keepRunning=true 时结算完立刻开新的一段（存草稿用，不能把表停掉） */
  function settleElapsed(keepRunning) {
    if (!state) return;
    if (state.runSince && !state.paused) {
      state.elapsedSec = elapsedNow();
      state.runSince = keepRunning ? Date.now() : 0;
    }
  }

  /* 开始（或恢复）计时：练习模式打上 runSince，考试模式本来就有 deadline */
  function beginElapsed() {
    if (!state) return;
    if (state.mode === 'exam') return;      // 考试用倒计时，不走这套
    if (!state.elapsedSec) state.elapsedSec = 0;
    if (!state.paused) state.runSince = Date.now();
  }

  function syncPauseUI() {
    var mask = $("#pauseMask");
    if (!mask) return;
    var paused = !!(state && state.paused);
    mask.hidden = !paused;
    $("#btnPause").textContent = paused ? "继续" : "暂停";
    $("#timer").classList.toggle("is-paused", paused);
    var pt = $("#pauseTimer");
    if (pt) {
      if (state && state.mode === 'exam') {
        pt.textContent = "剩余 " + fmtClock(state.pausedRemain || 0);
      } else {
        pt.textContent = "已用 " + fmtClock(elapsedNow());
      }
    }
    document.body.style.overflow = paused ? "hidden" : "";
  }

  function pauseExam() {
    if (!state || state.paused) return;
    if (state.mode === 'exam') {
      state.pausedRemain = Math.max(0, Math.round((state.deadline - Date.now()) / 1000));
    } else {
      // 练习模式：把当前这段结算掉，冻结时间
      settleElapsed();
    }
    state.paused = true;
    stopTimer();
    $("#timerLabel").textContent = "已暂停";
    $("#timerValue").textContent = state.mode === 'exam'
      ? fmtClock(state.pausedRemain)
      : fmtClock(elapsedNow());
    $("#timer").classList.remove("is-warn", "is-danger");
    syncPauseUI();
    saveProgress();
    saveDraft();
  }

  function resumeExam() {
    if (!state || !state.paused) return;
    if (state.mode === 'exam') {
      state.deadline = Date.now() + (state.pausedRemain || 0) * 1000;
      delete state.pausedRemain;
    } else {
      // 练习模式：从现在起继续累加
      state.runSince = Date.now();
    }
    state.paused = false;
    syncPauseUI();
    startTimer();
    saveProgress();
  }

  function togglePause() {
    if (!state) return;
    if (state.paused) resumeExam(); else pauseExam();
  }

  /* ---------------- 计时 ---------------- */
  function startTimer() {
    stopTimer();
    tick();
    timerId = setInterval(tick, 500);
  }
  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }
  function tick() {
    if (!state) return;
    if (state.paused) { stopTimer(); return; }
    var el = $('#timer');
    if (state.mode === 'exam') {
      var remain = Math.max(0, Math.round((state.deadline - Date.now()) / 1000));
      $('#timerLabel').textContent = '剩余';
      $('#timerValue').textContent = fmtClock(remain);
      el.classList.toggle('is-warn', remain <= 600 && remain > 300);
      el.classList.toggle('is-danger', remain <= 300);
      if (remain <= 0) {
        stopTimer();
        doSubmit(true);
      }
    } else {
      // 练习模式：正计时，按累计秒数显示（暂停时不走这里）
      $('#timerLabel').textContent = '已用';
      $('#timerValue').textContent = fmtClock(elapsedNow());
      el.classList.remove('is-warn', 'is-danger');
    }
  }

  /* ---------------- 答题渲染 ---------------- */
  function q() { return ALL[state.ids[current]]; }

  function renderQuestion() {
    var item = q();
    var M = MODULES[item.module];
    $('#qModule').textContent = M.name;
    $('#qModule').style.background = M.color;
    $('#qSub').textContent = item.sub || '—';
    $('#qDiff').textContent = '难度 ' + '●●●'.slice(0, item.difficulty) + '○○○'.slice(0, 3 - item.difficulty);
    $('#qIndex').textContent = current + 1;

    // 材料
    var mat = item.materialId ? window.MATERIALS[item.materialId] : null;
    var matEl = $('#qMaterial');
    if (mat) {
      matEl.hidden = false;
      matEl.innerHTML = '<h4>' + esc(mat.title) + '</h4>' + mat.html;
    } else {
      matEl.hidden = true;
      matEl.innerHTML = '';
    }

    // 题干
    $('#qStem').innerHTML = '<span class="stem-num">' + (current + 1) + '.</span>' + (item.real ? item.stem : nl2br(item.stem));

    // 图形
    var figEl = $('#qFigure');
    if (item.figure) { figEl.hidden = false; figEl.innerHTML = item.figure; }
    else { figEl.hidden = true; figEl.innerHTML = ''; }

    // 选项
    var picked = state.answers[item.id];
    var excluded = (state.excluded && state.excluded[item.id]) || [];
    $('#qOptions').innerHTML = '<div class="opt-hint">长按选项可排除，再长按取消</div>' + item.options.map(function (opt, i) {
      var isFig = /^<svg/i.test(String(opt).trim());
      var ex = excluded.indexOf(i) >= 0;
      return '<button class="opt' + (picked === i ? ' is-picked' : '') + (ex ? ' is-excluded' : '') + '" data-opt="' + i + '" role="radio" aria-checked="' + (picked === i) + '" aria-disabled="' + ex + '">' +
        '<span class="opt-key">' + 'ABCD'[i] + '</span>' +
        (isFig ? '<span class="opt-fig">' + opt + '</span>' : '<span class="opt-text">' + (item.real ? opt : nl2br(opt)) + '</span>') +
        (ex ? '<span class="opt-ex">排除</span>' : '') +
      '</button>';
    }).join('');

    // 标记
    var flagBtn = $('#btnFlag');
    var flagged = !!state.flags[item.id];
    flagBtn.setAttribute('aria-pressed', flagged ? 'true' : 'false');
    $('#flagText').textContent = flagged ? '已标记' : '标记';

    $('#btnPrev').disabled = current === 0;
    $('#btnNext').disabled = current === state.ids.length - 1;

    updateProgress();
    renderSheet();
    saveProgress();
  }

  function updateProgress() {
    var done = answeredCount(), total = state.ids.length;
    $('#answeredNum').textContent = done;
    $('#examProgressBar').style.width = (total ? done / total * 100 : 0) + '%';
    $('#sheetDone').textContent = done;
    $('#sheetFlag').textContent = Object.keys(state.flags).filter(function (k) { return state.flags[k]; }).length;
    $('#sheetTodo').textContent = total - done;
  }

  function answeredCount() {
    if (!state) return 0;
    return state.ids.filter(function (id) { return state.answers[id] != null; }).length;
  }

  function excludedOf(id) {
    if (!state.excluded) state.excluded = {};
    if (!state.excluded[id]) state.excluded[id] = [];
    return state.excluded[id];
  }

  function toggleExclude(i) {
    if (!state || state.paused) return;
    var item = q();
    var arr = excludedOf(item.id);
    var pos = arr.indexOf(i);
    if (pos >= 0) arr.splice(pos, 1);
    else {
      arr.push(i);
      // 被排除的选项不能同时是答案
      if (state.answers[item.id] === i) delete state.answers[item.id];
    }
    if (!arr.length) delete state.excluded[item.id];
    renderQuestion();
    if (navigator.vibrate) { try { navigator.vibrate(pos >= 0 ? 8 : 14); } catch (e) {} }
    toast(pos >= 0 ? "已取消排除" : "已排除 " + "ABCD"[i]);
  }

  var pressTimer = null, pressIdx = -1, pressX = 0, pressY = 0, suppressClickUntil = 0;

  function bindOptionPress() {
    var box = $("#qOptions");
    if (!box) return;
    box.addEventListener("pointerdown", function (e) {
      var b = e.target.closest("[data-opt]");
      if (!b) return;
      pressIdx = parseInt(b.getAttribute("data-opt"), 10);
      pressX = e.clientX; pressY = e.clientY;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(function () {
        suppressClickUntil = Date.now() + 700;
        toggleExclude(pressIdx);
      }, 460);
    });
    box.addEventListener("pointermove", function (e) {
      if (!pressTimer) return;
      if (Math.abs(e.clientX - pressX) > 10 || Math.abs(e.clientY - pressY) > 10) {
        clearTimeout(pressTimer); pressTimer = null;
      }
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
      box.addEventListener(ev, function () { clearTimeout(pressTimer); pressTimer = null; });
    });
    box.addEventListener("contextmenu", function (e) {
      if (e.target.closest("[data-opt]")) e.preventDefault();
    });
  }

  function selectOption(i) {
    if (!state || state.paused) return;
    var item = q();
    if (i < 0 || i >= item.options.length) return;

    // 再点一次同一项 = 取消选择，不前进
    if (state.answers[item.id] === i) {
      delete state.answers[item.id];
      renderQuestion();
      return;
    }

    state.answers[item.id] = i;
    renderQuestion();
    if (answeredCount() % 10 === 0 && window.ZJXCSync) window.ZJXCSync.snapshot("作答中");
    if (state.ref && state.kind !== "seq") saveDraft();

    // 选完短暂停留（看得见选中反馈）后自动跳到下一题
    var from = current;
    var last = state.ids.length - 1;
    clearTimeout(autoNextTimer);
    if (from < last) {
      autoNextTimer = setTimeout(function () {
        if (current === from) goto(from + 1);
      }, 220);
    }
  }

  function goto(i) {
    if (!state || state.paused) return;
    if (i < 0 || i >= state.ids.length) return;
    clearTimeout(autoNextTimer);
    current = i;
    renderQuestion();
    var pane = $('#qPane');
    if (pane && window.innerWidth < 861) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    closeSheet();
  }

  function toggleFlag() {
    if (!state || state.paused) return;
    clearTimeout(autoNextTimer);
    var id = q().id;
    state.flags[id] = !state.flags[id];
    renderQuestion();
  }

  function renderSheet() {
    if (!state) return;
    var groups = {};
    var order = [];
    state.ids.forEach(function (id, idx) {
      var m = ALL[id].module;
      if (!groups[m]) { groups[m] = []; order.push(m); }
      groups[m].push({ id: id, idx: idx });
    });
    var html = order.map(function (m) {
      var items = groups[m];
      var first = items[0].idx + 1, last = items[items.length - 1].idx + 1;
      var done = items.filter(function (it) { return state.answers[it.id] != null; }).length;
      return '<div class="sheet-group">' +
        '<h4><span>' + MODULES[m].name + '</span><em>' + first + (last !== first ? '-' + last : '') + '　' + done + '/' + items.length + '</em></h4>' +
        '<div class="nums">' + items.map(function (it) {
          var cls = 'num';
          if (state.answers[it.id] != null) cls += ' is-done';
          if (state.flags[it.id]) cls += ' is-flag';
          if (it.idx === current) cls += ' is-cur';
          return '<button class="' + cls + '" data-jump="' + it.idx + '">' + (it.idx + 1) + '</button>';
        }).join('') + '</div></div>';
    }).join('');
    $('#sheetBody').innerHTML = html;
    updateProgress();
  }

  /* ---------------- 交卷与批改 ---------------- */
  function askSubmit() {
    if (!state) return;
    var done = answeredCount(), total = state.ids.length;
    confirmDialog('确认提交答题卡？',
      '<p>已答 <b>' + done + '</b> 题，未答 <b>' + (total - done) + '</b> 题。</p>' +
      '<p style="margin-top:8px;color:#6b7b74">提交后立即批改并生成分析报告，本次作答不可再修改。</p>',
      '提交批改', doSubmit);
  }

  function doSubmit(auto) {
    if (!state) return;
    stopTimer();
    // 练习模式用累计秒数（暂停的时间不算）；考试模式用墙钟时间，并封顶到限时
    var used;
    if (state.mode === 'exam') {
      used = Math.min(
        state.minutes ? state.minutes * 60 : 1e9,
        Math.round((Date.now() - state.startedAt) / 1000)
      );
    } else {
      used = elapsedNow();
      // 兜底：老草稿没有 elapsedSec 字段时退回墙钟时间
      if (!used) used = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
    }
    var report = grade(used);
    lastReport = report;
    saveHistory(report);
    if (state.kind === 'day' && state.dayId) saveDayLog(state.dayId, report);
    if (window.SEQ_ORDER && window.SEQ_ORDER.some(function (pp) { return pp.id === state.ref; })) markSeqDone(state.ref);
    if (window.ZJXCSync) { window.ZJXCSync.snapshot("交卷"); window.ZJXCSync.markDirty(); window.ZJXCSync.schedule(1200); }
    clearProgress();
    renderReport(report);
    setView('report');
    if (auto) toast('答题时间到，已自动交卷');
  }

  function grade(used) {
    var per = {};
    ORDER.forEach(function (m) {
      per[m] = { module: m, total: 0, correct: 0, wrong: 0, blank: 0, score: 0, max: 0 };
    });
    var points = {};

    state.ids.forEach(function (id) {
      var item = ALL[id];
      var M = MODULES[item.module];
      var p = per[item.module];
      var a = state.answers[id];
      var w = M.weight;

      p.total++;
      p.max += w;

      var correct = (a === item.answer);
      if (a == null) p.blank++;
      else if (correct) { p.correct++; p.score += w; }
      else p.wrong++;

      (item.point || []).forEach(function (tag) {
        if (tag === MODULES[item.module].name) return; // 模块名本身不作为知识点统计，避免重复计数
        var o = points[tag] || (points[tag] = { tag: tag, module: item.module, total: 0, wrong: 0, blank: 0 });
        o.total++;
        if (a == null) o.blank++;
        else if (!correct) o.wrong++;
      });
    });

    var maxScore = 0, got = 0, correctN = 0, wrongN = 0, blankN = 0;
    ORDER.forEach(function (m) {
      maxScore += per[m].max;
      got += per[m].score;
      correctN += per[m].correct;
      wrongN += per[m].wrong;
      blankN += per[m].blank;
    });

    return {
      ts: Date.now(),
      title: state.title,
      kind: state.kind,
      ref: state.ref,
      ref: state.ref,
      mode: state.mode,
      ids: state.ids.slice(),
      answers: JSON.parse(JSON.stringify(state.answers)),
      flags: JSON.parse(JSON.stringify(state.flags)),
      minutes: state.minutes,
      used: used,
      per: per,
      points: points,
      correct: correctN,
      wrong: wrongN,
      blank: blankN,
      total: state.ids.length,
      got: got,
      maxScore: maxScore,
      percent: maxScore ? got / maxScore * 100 : 0
    };
  }

  /* ---------------- 题型方法库 ---------------- */
  function methodFor(item) {
    // 优先走「题型映射」：题库是粗分类（片段阅读/数学运算），方法库是细分类
    // （主旨概括/工程问题），由 Reinforce 把两边接起来
    if (window.Reinforce) {
      var list = window.Reinforce.methodsFor(item.sub || item.qtype, item.module);
      if (list.length) return list[0].method;
    }
    var M = window.METHODS || {};
    var sub = String(item.sub || "");
    var tail = sub.indexOf("·") >= 0 ? sub.split("·")[1] : sub;
    if (tail && M[tail]) return M[tail];
    var pts = item.point || [];
    for (var i = 0; i < pts.length; i++) {
      if (M[pts[i]]) return M[pts[i]];
    }
    if (sub && M[sub]) return M[sub];
    return (window.METHOD_FALLBACK || {})[item.module] || null;
  }

  function methodCard(item) {
    var m = methodFor(item);
    var tip = window.Reinforce ? window.Reinforce.tipFor(item.sub || item.qtype, item.module) : '';
    if (!m && !tip) return "";
    var typeName = (MODULES[item.module] ? MODULES[item.module].name : "") +
      (item.sub ? " · " + String(item.sub).replace(/^[^·]+·/, "") : "");
    var h = "<div class=\"wi-method\">" +
      "<div class=\"wm-head\">题型：<b>" + esc(typeName) + "</b></div>";
    // 这一类怎么下手（点对点补强的关键：先给通用打法，再给具体方法）
    if (tip) h += "<div class=\"wm-sec\"><span class=\"wm-tag\">这类怎么下手</span><p>" + esc(tip) + "</p></div>";
    if (!m) return h + "</div>";
    if (m.idea) h += "<div class=\"wm-sec\"><span class=\"wm-tag\">思路</span><p>" + esc(m.idea) + "</p></div>";
    if (m.formulas && m.formulas.length) {
      h += "<div class=\"wm-sec\"><span class=\"wm-tag\">关键公式</span><ul>" +
        m.formulas.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>";
    }
    if (m.steps && m.steps.length) {
      h += "<div class=\"wm-sec\"><span class=\"wm-tag\">解题步骤</span><ol>" +
        m.steps.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol></div>";
    }
    if (m.traps && m.traps.length) {
      h += "<div class=\"wm-sec\"><span class=\"wm-tag warn\">易错点</span><ul>" +
        m.traps.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>";
    }
    return h + "</div>";
  }

  /* ---------------- 点对点补强 ---------------- */
  /* 点开某个失分题型：给出「这类怎么下手」+ 相关细方法 + 一键专项补强 */
  function renderReinforce(type, module, label) {
    var box = $('#reinforceBox');
    if (!box || !window.Reinforce) return;
    label = label || type;
    var tip = window.Reinforce.tipFor(type, module);
    var methods = window.Reinforce.methodsFor(type, module);
    var pool = window.Reinforce.poolFor(type, module, { onlyReal: true });
    var poolMode = 'type';
    // 小题型题池太小时，退到模块级题池，保证「专项补强」有题可做
    if (pool.length < 8) {
      var mp = window.Reinforce.poolFor('', module, { onlyReal: true });
      if (mp.length > pool.length) { pool = mp; poolMode = 'module'; }
    }
    var want = Math.min(20, pool.length);

    var h = '<div class="rf-head"><b>' + esc(label) + '</b>' +
      '<span class="rf-meta">' +
        (poolMode === 'type' ? '题库同类 ' + pool.length + ' 题'
          : '同类题偏少，改用整模块 ' + pool.length + ' 题') +
      '</span></div>';

    if (tip) {
      h += '<div class="rf-tip"><span class="wm-tag">这类怎么下手</span><p>' + esc(tip) + '</p></div>';
    }

    if (methods.length) {
      h += '<details class="rf-methods"><summary>相关方法 ' + methods.length + ' 个</summary><ul>';
      methods.slice(0, 6).forEach(function (o) {
        var m = o.method || {};
        h += '<li><b>' + esc(o.name) + '</b>';
        if (m.idea) h += '<span>' + esc(String(m.idea).slice(0, 130)) + '</span>';
        h += '</li>';
      });
      h += '</ul></details>';
    }

    if (pool.length) {
      h += '<div class="rf-actions">' +
        '<button class="btn btn-primary btn-sm" id="btnReinforceDrill">专项补强 · ' + want + ' 题</button>' +
        '<span class="rf-hint">从题库同类真题里抽题，避开刚做错的这套</span>' +
        '</div>';
    } else {
      h += '<p class="rf-hint">题库里这类题不够，先多做几套整卷积累错题。</p>';
    }

    box.innerHTML = h;
    box.hidden = false;

    var drill = $('#btnReinforceDrill');
    if (drill) {
      drill.addEventListener('click', function () {
        startSubset(pool.slice(0, want), label + ' · 专项补强', 0);
      });
    }
  }

  /* ---------------- 报告 ---------------- */
  function adviceFor(m) {
    var map = {
      politics: '政治理论题量小、性价比高。重点抓党的二十届三中全会精神，以及"八八战略""千万工程""共同富裕示范区"等浙江特色表述，建议每天用 10 分钟做时政积累。',
      common: '常识判断不宜死记硬背。按法律、科技、人文、省情四条线各建一份错题清单；法律部分优先掌握《宪法》《民法典》《行政处罚法》的高频条文。',
      verbal: '言语理解占分最重。选词填空建立"成语、实词、关联词"三张积累表；片段阅读先练结构分析，再练主旨概括，单题控制在 50 秒以内。',
      quant: '数量关系不要整体放弃。数字推理优先练多级数列与递推数列；数学运算主攻工程、行程、概率、几何、经济利润五类，用赋值法和方程法提速。',
      judge: '判断推理题量最大。图形推理按"点、线、面、角、素"顺序排查；定义判断抓主体、条件、结果三个要件；逻辑判断重点练削弱加强与翻译推理（"只有…才…"后推前）。',
      data: '资料分析是提分最快的模块。熟记基期量、增长量、比重、倍数四个公式，练截位直除；每篇材料先看问题再定位数据，单题控制在 90 秒内。'
    };
    return map[m] || '';
  }

  function levelOf(rate) {
    if (rate >= 0.85) return { cls: 'good', label: '良好' };
    if (rate >= 0.6) return { cls: 'mid', label: '待强化' };
    return { cls: 'bad', label: '薄弱' };
  }

  function renderLessons(r) {
    var card = $("#lessonCard"), box = $("#lessonList");
    if (!card || !box) return;
    var VM = window.VIDEO_MODULE || {}, V = window.VIDEOS || {};
    var groups = {};
    r.ids.forEach(function (id) {
      var it = ALL[id];
      if (!it) return;
      if (r.answers[id] === it.answer) return;
      var sub = String(it.sub || "");
      var tail = sub.indexOf("·") >= 0 ? sub.split("·")[1] : sub;
      var k = it.module + "|" + tail;
      if (!groups[k]) groups[k] = { module: it.module, sub: tail, n: 0 };
      groups[k].n++;
    });
    var rows = Object.keys(groups).map(function (k) { return groups[k]; })
      .filter(function (g) { return VM[g.module] && V[VM[g.module]]; })
      .sort(function (a, b) { return b.n - a.n; });
    if (!rows.length) { card.hidden = true; return; }
    card.hidden = false;
    var rowsHtml = rows.map(function (g) {
      var cfg = V[VM[g.module]];
      var p = (cfg.parts && cfg.parts[g.sub]) || cfg.start || 1;
      var url, label;
      if (cfg.bvid) {
        url = "https://www.bilibili.com/video/" + cfg.bvid + "/?p=" + p;
        label = cfg.teacher + " · 第 " + p + " 讲";
      } else {
        url = "https://search.bilibili.com/all?keyword=" + encodeURIComponent(cfg.search + " " + g.sub);
        label = "去 B 站搜 " + cfg.teacher;
      }
      return "<div class=\"lesson-row\">" +
        "<div class=\"lesson-main\"><b>" + esc(g.sub || "综合") + "</b>" +
        "<span>错 " + g.n + " 题 · " + esc(MODULES[g.module].name) + "</span></div>" +
        "<a class=\"btn btn-outline btn-sm\" href=\"" + url + "\" target=\"_blank\" rel=\"noopener\">" + esc(label) + "</a>" +
      "</div>";
    }).join("");

    var ref = String(r.ref || "");
    var m2 = ref.match(/^(gk|zj)-(\d{4})/);
    var realKey = m2 ? (m2[1] + "-" + m2[2]) : "";
    var reals = (window.REAL_VIDEOS || {})[realKey] || [];
    var wrongN = r.ids.filter(function (id) { return r.answers[id] !== ALL[id].answer; }).length;
    var realHtml = reals.length ? "<div class=\"lesson-real\"><b>同年国考真题逐题讲解（B 站）</b>" +
      reals.map(function (x) {
        return "<a class=\"chip-link\" href=\"https://www.bilibili.com/video/" + x.bvid + "/?p=" + x.p + "\" target=\"_blank\" rel=\"noopener\">" + esc(x.t) + "</a>";
      }).join("") +
      "<p class=\"lesson-tip\">真题原文受版权限制未收录；这里是同年国考各卷别的逐题讲解，副省差异题单独标注，听完对着本套错题复盘最快。</p></div>" : "";
    box.innerHTML = rowsHtml + realHtml +
      "<div class=\"lesson-act\"><button class=\"btn btn-primary btn-sm\" id=\"btnLessonRetry\">看完重做本套错题（" + wrongN + " 题）</button></div>" +
      "<p class=\"lesson-tip\">刘文超讲资料分析/数量关系/判断推理，章晓铭讲言语理解。链接直达 B 站对应分 P。</p>";
  }

  document.addEventListener("click", function (e) {
    if (!e.target.closest("#btnLessonRetry")) return;
    var btn = $("#btnRetryWrong");
    if (btn) btn.click();
  });

  function renderReport(r) {
    var hist = r.fromHistory ? r.histSource : null;
    if ($('#btnResumeEdit')) $('#btnResumeEdit').hidden = !hist;
    var pct = r.percent;
    var scoreColor = pct >= 75 ? '#15803d' : pct >= 60 ? '#146b58' : '#b91c1c';
    var r0 = 62, c = 2 * Math.PI * r0, len = pct / 100 * c;

    $('#scoreRing').innerHTML =
      '<svg viewBox="0 0 148 148">' +
        '<circle class="ring-bg" cx="74" cy="74" r="' + r0 + '"></circle>' +
        '<circle class="ring-fg" cx="74" cy="74" r="' + r0 + '" stroke="' + scoreColor + '" stroke-dasharray="0 ' + c + '"></circle>' +
      '</svg>' +
      '<div class="ring-in"><b style="color:' + scoreColor + '">' + pct.toFixed(1) + '</b><span>折算得分</span></div>';
    requestAnimationFrame(function () {
      var fg = $('#scoreRing .ring-fg');
      if (fg) fg.setAttribute('stroke-dasharray', len.toFixed(2) + ' ' + c.toFixed(2));
    });

    var histAll = loadHistory();
    var nth = histAll.length ? ('第 ' + histAll.length + ' 次记录 · ' + '共 ' + histAll.length + ' 条') : '';
    renderLessons(r);
    $('#reportEyebrow').textContent = (r.mode === 'exam' ? '考试模式 · 已自动批改' : '练习模式 · 已批改') + (nth ? ' · ' + nth : '');
    $('#reportTitle').textContent = r.title + ' 作答报告';
    var rate = r.total ? (r.correct / r.total * 100) : 0;
    $('#reportLine').innerHTML = '答对 <b>' + r.correct + '</b> / ' + r.total + ' 题，正确率 <b>' + rate.toFixed(1) + '%</b>' +
      '　·　加权得分 <b>' + r.got.toFixed(1) + '</b> / ' + r.maxScore.toFixed(1);
    $('#reportTime').textContent = '用时 ' + fmtDuration(r.used) + '　·　' + fmtDate(r.ts) +
      (r.mode === 'exam' && r.minutes ? '　·　限时 ' + r.minutes + ' 分钟' : '　·　不限时');

    // 统计卡
    var avgSec = r.total ? r.used / r.total : 0;
    var avgText = avgSec < 0.1 ? '&lt;0.1' : avgSec < 10 ? avgSec.toFixed(1) : String(Math.round(avgSec));
    $('#statGrid').innerHTML = [
      { k: '答对', v: r.correct, e: '题' },
      { k: '答错', v: r.wrong, e: '题' },
      { k: '未答', v: r.blank, e: '题' },
      { k: '平均每题', v: avgText, e: '秒 / 题' }
    ].map(function (s) {
      return '<div class="stat-card"><span>' + s.k + '</span><b>' + s.v + '</b><em>' + s.e + '</em></div>';
    }).join('');

    // 错题集合（含未答）
    var wrongIds = r.ids.filter(function (id) {
      var a = r.answers[id];
      return a == null || a !== ALL[id].answer;
    });

    // 错题类型分布（按题型聚合）
    var typeMap = {}, typeList = [];
    wrongIds.forEach(function (id) {
      var it = ALL[id];
      var parts = String(it.sub || '').split('·');
      var type = parts.length > 1 ? (parts[0] === '图形推理' ? parts.join('·') : parts[1]) : parts[0];
      if (!typeMap[type]) {
        // 数据里有些题没有题型（qtype 为空），用模块名兜底显示
        typeMap[type] = {
          type: type,
          label: type || (MODULES[it.module] ? MODULES[it.module].name : it.module),
          module: it.module,
          n: 0
        };
        typeList.push(typeMap[type]);
      }
      typeMap[type].n++;
    });
    typeList.sort(function (a, b) { return b.n - a.n; });
    $('#typeChips').innerHTML = typeList.length ? typeList.map(function (o) {
      return '<button class="type-chip" type="button" data-rf-type="' + esc(o.type) +
        '" data-rf-module="' + esc(o.module) + '" data-rf-label="' + esc(o.label) + '" ' +
        'title="点开看这类题怎么下手，并能直接专项补强">' +
        '<i style="background:' + MODULES[o.module].color + '"></i>' +
        esc(o.label) + '<b>' + o.n + '</b><em>题</em></button>';
    }).join('') : '<p class="empty-line">没有错题，无需分析错题类型。</p>';

    // 点题型 → 展开「这一类怎么下手 + 专项补强」
    (function bindReinforce() {
      var box = $('#reinforceBox');
      var chips = $('#typeChips');
      if (!box || !chips) return;
      box.hidden = true;
      box.innerHTML = '';
      Array.prototype.forEach.call(chips.querySelectorAll('[data-rf-type]'), function (btn) {
        btn.addEventListener('click', function () {
          var type = btn.getAttribute('data-rf-type');
          var mod = btn.getAttribute('data-rf-module');
          var label = btn.getAttribute('data-rf-label') || type;
          var wasOn = btn.classList.contains('is-on');
          Array.prototype.forEach.call(chips.querySelectorAll('.type-chip'), function (b) {
            b.classList.remove('is-on');
          });
          if (wasOn) { box.hidden = true; box.innerHTML = ''; return; }
          btn.classList.add('is-on');
          renderReinforce(type, mod, label);
        });
      });
    })();

    // 模块得分
    $('#moduleBars').innerHTML = ORDER.filter(function (m) { return r.per[m].total > 0; }).map(function (m) {
      var p = r.per[m];
      var rt = p.total ? p.correct / p.total : 0;
      return '<div class="mb-row">' +
        '<span class="mb-name">' + MODULES[m].short + '</span>' +
        '<span class="mb-track"><i class="mb-fill" style="width:' + (rt * 100).toFixed(1) + '%;background:' + MODULES[m].color + '"></i></span>' +
        '<span class="mb-val">' + p.correct + '/' + p.total + ' · ' + Math.round(rt * 100) + '%</span>' +
      '</div>';
    }).join('');

    // 薄弱知识点
    var weak = Object.keys(r.points).map(function (k) { return r.points[k]; })
      .filter(function (o) { return (o.wrong + o.blank) > 0; })
      .sort(function (a, b) {
        var la = a.wrong + a.blank, lb = b.wrong + b.blank;
        if (lb !== la) return lb - la;
        return (b.wrong + b.blank) / b.total - (a.wrong + a.blank) / a.total;
      }).slice(0, 9);

    $('#weakList').innerHTML = weak.length ? weak.map(function (o, i) {
      var lost = o.wrong + o.blank;
      var rt = lost / o.total;
      return '<div class="weak-row">' +
        '<span class="weak-rank">' + (i + 1) + '</span>' +
        '<span class="weak-name" title="' + esc(o.tag) + '">' + esc(o.tag) + '</span>' +
        '<span class="weak-track"><i style="width:' + Math.round(rt * 100) + '%"></i></span>' +
        '<span class="weak-meta">失分 ' + lost + '/' + o.total + '</span>' +
      '</div>';
    }).join('') : '<p class="empty-line">本次没有失分知识点，继续保持。</p>';

    // 诊断
    var diag = [];
    var badModules = [];
    ORDER.forEach(function (m) {
      var p = r.per[m];
      if (!p.total) return;
      var rt = p.correct / p.total;
      var lv = levelOf(rt);
      if (rt < 0.6) badModules.push(MODULES[m].short);
      diag.push('<div class="diag-item">' +
        '<span class="diag-badge ' + lv.cls + '">' + lv.label + '</span>' +
        '<p><strong>' + MODULES[m].name + '</strong>　正确率 ' + Math.round(rt * 100) + '%（' + p.correct + '/' + p.total + '）。' +
        (rt >= 0.85 ? '该模块已具备稳定得分能力，维持手感即可。' : adviceFor(m)) + '</p></div>');
    });

    var overall;
    if (pct >= 80) {
      overall = '整体掌握扎实。建议转入限时套卷训练，把单题节奏压到 50 秒以内，并针对下列薄弱考点做专项突破。';
    } else if (pct >= 60) {
      overall = '基础题型已能应对，主要失分来自' + (badModules.length ? badModules.join('、') + ' 模块以及' : '') + '答题节奏。建议按薄弱知识点清单逐项补漏，每周完成 2 套整卷并复盘错题。';
    } else {
      overall = '当前处于基础构建阶段，不建议盲目刷整卷。先按模块专项练习，把每个模块正确率提到 60% 以上，再回到整卷模考。';
    }
    diag.unshift('<div class="diag-item">' +
      '<span class="diag-badge ' + (pct >= 80 ? 'good' : pct >= 60 ? 'mid' : 'bad') + '">总评</span>' +
      '<p><strong>折算 ' + pct.toFixed(1) + ' 分</strong>（参考权重，非官方分值）。' + overall + '</p></div>');
    $('#diagnosis').innerHTML = '<div class="diag-grid">' + diag.join('') + '</div>';

    // 错题
    $('#wrongCount').textContent = wrongIds.length + ' 题';
    $('#wrongList').innerHTML = wrongIds.length ? wrongIds.map(function (id, i) {
      var item = ALL[id];
      var a = r.answers[id];
      var globalIdx = r.ids.indexOf(id) + 1;
      var mat = item.materialId ? window.MATERIALS[item.materialId] : null;
      var isFig = /^<svg/i.test(String(item.options[0] || '').trim());
      return '<details class="wrong-item">' +
        '<summary>' +
          '<span class="wi-no">' + globalIdx + '.</span>' +
          '<span class="wi-mod" style="background:' + MODULES[item.module].color + '">' + MODULES[item.module].short + '</span>' +
          '<span class="wi-text">' + esc(String(item.stem).replace(/\n/g, ' ').slice(0, 40)) + '…</span>' +
          '<span class="wi-type">' + esc(String(item.sub || '').replace(/^[^·]+·/, '')) + '</span>' +
          '<span class="wi-state' + (a == null ? ' miss' : '') + '">' +
            (a == null ? '未作答' : '你选 ' + 'ABCD'[a]) + ' → 正确 ' + 'ABCD'[item.answer] + '</span>' +
        '</summary>' +
        '<div class="wi-body">' +
          (mat ? '<div class="wi-material"><strong>' + esc(mat.title) + '</strong>' + mat.html + '</div>' : '') +
          '<div class="wi-stem">' + (item.real ? item.stem : nl2br(item.stem)) + '</div>' +
          (item.figure ? '<div class="q-figure">' + item.figure + '</div>' : '') +
          '<div class="wi-opts">' + item.options.map(function (opt, oi) {
            var cls = 'wi-opt';
            if (oi === item.answer) cls += ' correct';
            else if (a === oi) cls += ' wrong';
            var content = isFig ? opt : (item.real ? opt : nl2br(opt));
            return '<div class="' + cls + '"><i>' + 'ABCD'[oi] + '.</i><span>' + content + '</span></div>';
          }).join('') + '</div>' +
          methodCard(item) +
          '<div class="wi-exp"><b>解析：</b>' + (item.real ? item.explain : nl2br(item.explain)) + '</div>' +
          '<div class="wi-exp" style="border-left-color:#cbd5d1;margin-top:8px"><b>考点：</b>' +
            (item.point || []).map(esc).join(' · ') + '　|　难度 ' + item.difficulty + '/3</div>' +
        '</div>' +
      '</details>';
    }).join('') : '<p class="empty-line">全部答对，没有错题。</p>';
  }

  /* ---------------- 每日任务（备考计划） ---------------- */
  function isDayReady(day) {
    return !!(day.paperId || (window.PLAN_Q && window.PLAN_Q[day.id]) || (window.PLAN_REUSE && window.PLAN_REUSE[day.id]));
  }

  function dayQuestionCount(day) {
    if (day.paperId) {
      var p = window.PAPERS.filter(function (x) { return x.id === day.paperId; })[0];
      return p ? p.count : day.count;
    }
    if (window.PLAN_REUSE && window.PLAN_REUSE[day.id]) return window.PLAN_REUSE[day.id].length;
    return (window.PLAN_Q && window.PLAN_Q[day.id]) ? window.PLAN_Q[day.id].length : 0;
  }

  function loadDayLog() {
    try { return JSON.parse(localStorage.getItem('zjxc.daylog') || '{}'); } catch (e) { return {}; }
  }
  function saveDayLog(dayId, report) {
    try {
      var log = loadDayLog();
      log[dayId] = {
        ts: report.ts,
        correct: report.correct,
        total: report.total,
        pct: report.maxScore ? Math.round(report.got / report.maxScore * 1000) / 10 : 0,
        used: report.used
      };
      localStorage.setItem('zjxc.daylog', JSON.stringify(log));
    } catch (e) {}
  }

  function buildDaySession(day) {
    var qs = window.PLAN_Q[day.id] || [];
    var reuse = (window.PLAN_REUSE && window.PLAN_REUSE[day.id]) || [];
    return {
      kind: 'day',
      ref: day.id,
      dayId: day.id,
      title: 'D' + day.no + ' · ' + day.focus,
      sub: day.md + '（' + day.wd + '）· ' + day.point,
      mode: mode,
      minutes: mode === 'exam' ? day.minutes : 0,
      ids: qs.length ? qs.map(function (q) { return q.id; }) : reuse.slice(),
      answers: {},
      flags: {},
      startedAt: Date.now(),
      deadline: mode === 'exam' ? Date.now() + day.minutes * 60000 : 0
    };
  }

  function startDay(day) {
    if (!day) return;
    var s;
    if (day.paperId) {
      var p = window.PAPERS.filter(function (x) { return x.id === day.paperId; })[0];
      if (!p) return;
      s = buildPaperSession(p);
      s.sub = 'D' + day.no + ' · ' + day.focus + ' · 共 ' + s.ids.length + ' 题';
    } else if ((window.PLAN_Q && window.PLAN_Q[day.id]) || (window.PLAN_REUSE && window.PLAN_REUSE[day.id])) {
      s = buildDaySession(day);
    } else {
      toast('该日题目尚未投放');
      return;
    }
    s.kind = 'day';
    s.dayId = day.id;
    s.title = 'D' + day.no + ' · ' + day.focus;
    startSession(s);
  }

  function renderPlan() {
    if (!document.getElementById('planWeeks')) return;
    var days = window.PLAN_DAYS || [];
    var log = loadDayLog();

    var exam = new Date(window.PLAN.examDate + 'T00:00:00');
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var left = Math.max(0, Math.round((exam - today) / 86400000));

    var readyDays = days.filter(isDayReady);
    var doneDays = days.filter(function (d) { return !!log[d.id]; });
    var readyQ = readyDays.reduce(function (a, d) { return a + dayQuestionCount(d); }, 0);

    $('#planSub').textContent = window.PLAN.start.replace(/-/g, '/') + ' 启动 → ' +
      window.PLAN.examDate.replace(/-/g, '/') + ' 考试 · 共 ' + (window.PLAN.weeks.length) + ' 周 ' + days.length + ' 天';

    $('#planCountdown').innerHTML = '<span>距考试</span><b>' + left + '</b><em>天</em>';

    $('#planStats').innerHTML = [
      { k: '计划天数', v: days.length, e: '天' },
      { k: '已投放', v: readyDays.length, e: '天' },
      { k: '已完成', v: doneDays.length, e: '天' },
      { k: '可练题目', v: readyQ, e: '题' }
    ].map(function (s) {
      return '<div class="stat-card"><span>' + s.k + '</span><b>' + s.v + '</b><em>' + s.e + '</em></div>';
    }).join('');

    $('#planNote').textContent = window.PLAN.note + ' 题目按周投放，未投放日期显示为"待投放"。';

    $('#planWeeks').innerHTML = window.PLAN.weeks.map(function (w) {
      var wDone = w.days.filter(function (d) { return !!log[d.id]; }).length;
      var wReady = w.days.filter(isDayReady).length;
      return '<section class="week-block">' +
        '<div class="week-head">' +
          '<span class="week-id">' + esc(w.id) + '</span>' +
          '<div class="week-title"><strong>' + esc(w.name) + '</strong>' +
            '<span>' + esc(w.range) + ' · ' + esc(w.goal) + '</span></div>' +
          '<div class="week-prog"><b>' + wDone + '</b>/' + w.days.length + ' 天' +
            '<em>可练 ' + wReady + ' 天</em></div>' +
        '</div>' +
        '<div class="week-days">' + w.days.map(function (d) { return dayRow(d, log); }).join('') + '</div>' +
      '</section>';
    }).join('');
  }

  function dayRow(d, log) {
    var ready = isDayReady(d);
    var rec = log[d.id];
    var essay = window.PLAN_ESSAY && window.PLAN_ESSAY[d.id];
    var lv = d.level === '基础' ? 'lv-basic' : d.level === '进阶' ? 'lv-mid' : 'lv-hard';

    var stateHtml, actHtml;
    if (rec) {
      stateHtml = '<span class="day-state is-done">已完成 · ' + rec.pct + ' 分</span>';
      actHtml = ready
        ? '<button class="btn btn-outline btn-sm" data-start="' + d.id + '">再做一遍</button>'
        : '';
    } else if (ready) {
      stateHtml = '<span class="day-state is-ready">可练习</span>';
      actHtml = '<button class="btn btn-primary btn-sm" data-start="' + d.id + '">开始练习</button>';
    } else {
      stateHtml = '<span class="day-state is-wait">待投放</span>';
      actHtml = '';
    }
    if (essay) {
      actHtml += '<button class="btn btn-ghost btn-sm" data-essay="' + d.id + '">申论题</button>';
    }

    return '<div class="day-row' + (rec ? ' is-done' : '') + (ready ? '' : ' is-wait') + '">' +
      '<div class="day-date"><b>' + esc(d.md) + '</b><span>周' + esc(d.wd) + ' · D' + d.no + '</span></div>' +
      '<div class="day-main">' +
        '<div class="day-title">' + esc(d.focus) + '<span class="lv ' + lv + '">' + esc(d.level) + '</span>' + (window.PLAN_REUSE && window.PLAN_REUSE[d.id] ? '<span class="lv lv-reuse">二刷</span>' : '') + '</div>' +
        '<div class="day-point">' + esc(d.point) + '</div>' +
        '<div class="day-meta">' +
          '<span>' + d.count + ' 题</span><span>' + d.minutes + ' 分钟</span><span>' + esc(d.type) + '</span>' +
        '</div>' +
        '<div class="day-src">知识点来源：' + esc(d.source) + '</div>' +
        (d.essayNote ? '<div class="day-essay-note">' + esc(d.essayNote) + '</div>' : '') +
      '</div>' +
      '<div class="day-act">' + stateHtml + actHtml + '</div>' +
    '</div>';
  }

  function openEssay(dayId) {
    var e = window.PLAN_ESSAY && window.PLAN_ESSAY[dayId];
    if (!e) return;
    var day = (window.PLAN_DAYS || []).filter(function (d) { return d.id === dayId; })[0];
    openModal('申论 · ' + e.type + '（' + e.minutes + ' 分钟）',
      '<div class="essay-box">' +
        '<div class="essay-material">' + nl2br(e.material) + '</div>' +
        '<div class="essay-ask"><b>作答要求：</b>' + nl2br(e.ask) + '</div>' +
        '<details class="essay-points"><summary>展开参考要点与评分标准</summary>' +
          '<ol>' + e.points.map(function (p) { return '<li>' + nl2br(p) + '</li>'; }).join('') + '</ol>' +
          '<p class="essay-std"><b>评分标准：</b>' + nl2br(e.standard) + '</p>' +
        '</details>' +
      '</div>',
      [{ label: '关闭', cls: 'btn-primary' }], true);
    if (day) $('#modalTitle').textContent = 'D' + day.no + ' ' + day.md + ' · 申论 · ' + e.type;
  }

  /* ---------------- 存储 ---------------- */
  /* ---------------- 未交卷草稿 ---------------- */
  var LS_DRAFTS = 'zjxc.drafts';

  function loadDrafts() {
    try { return JSON.parse(localStorage.getItem(LS_DRAFTS) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveDraft() {
    if (!state) return;
    try {
      // 存草稿前先结算累计计时：否则练习模式运行中 elapsedSec 一直是 0，
      // 下次恢复会从 0 重新计时，把之前做的时间丢掉。
      // 传 true 表示结算完继续计时，不能把表停掉。
      if (state.mode !== 'exam' && !state.paused) settleElapsed(true);
      var d = loadDrafts();
      var key = state.ref || state.title;
      d[key] = { state: state, current: current, savedAt: Date.now() };
      var keys = Object.keys(d).sort(function (a, b) { return d[b].savedAt - d[a].savedAt; }).slice(0, 10);
      var out = {};
      keys.forEach(function (k) { out[k] = d[k]; });
      localStorage.setItem(LS_DRAFTS, JSON.stringify(out));
      // 做题中途也同步：草稿随云端走，换设备能接着做
      if (window.ZJXCSync && window.ZJXCSync.scheduleDraft) window.ZJXCSync.scheduleDraft();
    } catch (e) {}
  }
  function removeDraft(key) {
    try {
      var d = loadDrafts();
      delete d[key];
      localStorage.setItem(LS_DRAFTS, JSON.stringify(d));
    } catch (e) {}
  }

  function saveProgress() {
    if (!state) return;
    try {
      localStorage.setItem(LS_PROGRESS, JSON.stringify({ state: state, current: current, savedAt: Date.now() }));
    } catch (e) { /* 忽略容量/隐私模式错误 */ }
  }
  function clearProgress() {
    try { localStorage.removeItem(LS_PROGRESS); } catch (e) {}
  }
  function loadProgress() {
    try {
      var raw = localStorage.getItem(LS_PROGRESS);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.state || !o.state.ids || !o.state.ids.length) return null;
      if (Date.now() - (o.savedAt || 0) > 12 * 3600 * 1000) { clearProgress(); return null; }
      return o;
    } catch (e) { return null; }
  }
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(LS_HISTORY) || '[]'); } catch (e) { return []; }
  }
  function openHistoryDetail(h) {
    function go() {
      var saved = state;
      state = {
        kind: h.kind, ref: h.ref || '', title: h.title, mode: h.mode,
        ids: h.ids, answers: h.answers || {}, flags: {},
        minutes: h.minutes || 0, startedAt: h.ts, deadline: 0, sub: h.sub || ''
      };
      var r;
      try {
        r = grade(h.used || 0);
        r.ts = h.ts;
      } finally {
        state = saved;
      }
      lastReport = r;
      r.fromHistory = true;
      r.histSource = h;
      renderReport(r);
      setView('report');
    }
    var need = (h.ids || []).some(function (id) { return !ALL[id]; });
    if (need && h.ref) {
      toast('正在载入真题…');
      loadRealPaper(h.ref).then(function (pack) {
        registerReal(pack);
        go();
      }).catch(function () { toast('真题包加载失败，检查网络'); });
      return;
    }
    go();
  }

  function saveHistory(r) {
    if (state && state.ref) removeDraft(state.ref);
    try {
      var list = loadHistory();
      list.unshift({
        ts: r.ts, title: r.title, mode: r.mode, kind: r.kind, ref: state ? state.ref : '',
        ids: r.ids,
        answers: r.answers || {},
        minutes: state ? state.minutes : 0,
        sub: state ? state.sub : '',
        score: r.maxScore ? r.got / r.maxScore * 100 : 0,
        rate: r.total ? Math.round(r.correct / r.total * 1000) / 10 : 0,
        used: r.used
      });
      localStorage.setItem(LS_HISTORY, JSON.stringify(list.slice(0, 30)));
    } catch (e) {}
  }

  /* ---------------- 历史记录重新评分 ----------------
     题库答案修正后（如国考 2025 q98/q111、2026 行政执法 q1），
     旧记录里存的是「当时按错答案算的分数」，需要在本地按新答案重算一遍。
     用记录级的 AGV 标记做幂等：云端同步回来的旧记录（没有 AGV）也会被重新评分。 */
  var AGV = 'ans-2026-11-10';   // 答案代次：以后再有答案修正，改这一行即可触发全量重算

  function regradeOne(h) {
    if (!h || !h.ids || !h.ids.length) return -1;
    var answers = h.answers || {};
    var correct = 0, wrong = 0, blank = 0, got = 0, max = 0, total = 0;
    for (var i = 0; i < h.ids.length; i++) {
      var it = ALL[h.ids[i]];
      if (!it) return -1;                        // 题目还没注册进来，跳过、不标记，下次再试
      var w = (MODULES[it.module] && MODULES[it.module].weight) || 1;
      total++; max += w;
      var a = answers[h.ids[i]];
      if (a == null) blank++;
      else if (a === it.answer) { correct++; got += w; }
      else wrong++;
    }
    if (!total || !max) return -1;
    var rate = Math.round(correct / total * 1000) / 10;
    var score = Math.round(got / max * 1000) / 10;
    var changed = (Math.abs((h.rate || 0) - rate) > 0.05) || (Math.abs((h.score || 0) - score) > 0.05);
    h.rate = rate; h.score = score; h.agv = AGV;
    return changed ? 1 : 0;
  }

  function regradeHistory(force) {
    var list = loadHistory();
    if (!list.length) return;
    var pending = list.filter(function (h) {
      return h && h.ids && h.ids.length && (force || h.agv !== AGV);
    });
    if (!pending.length) return;
    var refs = [];
    pending.forEach(function (h) {
      if (h.ref && h.ids.some(function (id) { return !ALL[id]; }) && refs.indexOf(h.ref) < 0) refs.push(h.ref);
    });
    var seq = Promise.resolve();
    refs.forEach(function (ref) {
      seq = seq.then(function () {
        return loadRealPaper(ref).then(function (d) { registerReal(d); }).catch(function () {});
      });
    });
    seq.then(function () {
      var now = loadHistory();       // 重新读：期间可能被云端同步覆盖过
      var touched = 0;
      now.forEach(function (h) { if (regradeOne(h) === 1) touched++; });
      try { localStorage.setItem(LS_HISTORY, JSON.stringify(now.slice(0, 30))); } catch (e) {}
      if (touched) {
        if (window.ZJXCSync) { window.ZJXCSync.markDirty(); window.ZJXCSync.schedule(1500); }
        if (view === 'home') renderHome();
        toast('已按修正后的答案重新评分 ' + touched + ' 条记录');
      }
    });
  }

  /* ---------------- 对话框 ---------------- */
  function confirmDialog(title, html, okLabel, onOk) {
    openModal(title, html, [
      { label: '取消', cls: 'btn-ghost', close: true },
      { label: okLabel || '确定', cls: 'btn-primary', onClick: onOk }
    ]);
  }
  function openModal(title, html, actions, wide) {
    modalOpen = true;
    var box = document.querySelector("#modal .modal-box");
    if (box) box.classList.toggle("is-wide", !!wide);
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    var wrap = $('#modalActions');
    wrap.innerHTML = '';
    (actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'btn ' + (a.cls || 'btn-outline');
      b.textContent = a.label;
      b.addEventListener('click', function () {
        if (a.onClick) a.onClick();
        if (a.close !== false) closeModal();
      });
      wrap.appendChild(b);
    });
    $('#modal').hidden = false;
  }
  function closeModal() {
    modalOpen = false;
    $('#modal').hidden = true;
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    // 首页
    $('#btnRegrade') && $('#btnRegrade').addEventListener('click', function () {
      toast('正在按最新答案重算…');
      regradeHistory(true);
    });
    $('#examTabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-exam]');
      if (!b) return;
      homeExam = b.getAttribute('data-exam');
      var ex = window.EXAMS.filter(function (x) { return x.id === homeExam; })[0];
      if (ex && ex.years.indexOf(homeYear) < 0) homeYear = ex.years[0];
      renderHome();
    });
    $('#yearBar').addEventListener('click', function (e) {
      var b = e.target.closest('[data-year]');
      if (!b) return;
      homeYear = parseInt(b.getAttribute('data-year'), 10);
      renderHome();
    });
    $('#paperGrid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-paper]');
      if (b) startPaper(b.getAttribute('data-paper'));
    });
    $('#moduleGrid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-module]');
      if (b) startModule(b.getAttribute('data-module'));
    });
    $('#modeSwitch').addEventListener('click', function (e) {
      var b = e.target.closest('.seg');
      if (!b) return;
      mode = b.getAttribute('data-mode');
      $$('.seg').forEach(function (s) {
        var on = s === b;
        s.classList.toggle('is-active', on);
        s.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      $('#modeHint').textContent = mode === 'exam'
        ? '考试模式：固定倒计时，到时自动交卷'
        : '练习模式：正计时，不限时，随时可交卷';
    });
    $('#brandHome').addEventListener('click', function (e) {
      e.preventDefault();
      if (view === 'exam' && state) { quitExam(); return; }
      renderHome();
      setView('home');
    });

    // 答题
    $('#qOptions').addEventListener('click', function (e) {
      var b = e.target.closest('[data-opt]');
      if (!b) return;
      if (Date.now() < suppressClickUntil) return;
      var oi = parseInt(b.getAttribute('data-opt'), 10);
      var ex = excludedOf(q().id);
      if (ex.indexOf(oi) >= 0) { toast('该选项已排除，长按可取消'); return; }
      selectOption(oi);
    });
    bindOptionPress();
    $('#btnPrev').addEventListener('click', function () { goto(current - 1); });
    $('#btnNext').addEventListener('click', function () { goto(current + 1); });
    $('#btnFlag').addEventListener('click', toggleFlag);
    $('#btnQuit').addEventListener('click', quitExam);
    $('#btnPause').addEventListener('click', togglePause);
    $('#btnResume').addEventListener('click', resumeExam);
    $('#btnSubmit').addEventListener('click', askSubmit);
    $('#btnUntimed').addEventListener('click', function () {
      if (!state || state.mode !== 'exam') return;
      state.mode = 'practice';
      state.minutes = 0;
      state.deadline = 0;
      state.paused = false;
      state.pausedRemain = 0;
      stopTimer();
      $('#timer').hidden = true;
      $('#btnPause').hidden = true;
      $('#btnUntimed').hidden = true;
      $('#pauseMask').hidden = true;
      document.body.style.overflow = '';
      $('#examSub').textContent = state.sub + ' · 不计时';
      saveProgress();
      if (window.ZJXCSync) window.ZJXCSync.markDirty();
      toast('已改为不限时，可慢慢做');
    });
    $('#btnQuickSubmit').addEventListener('click', askSubmit);
    $('#sheetBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-jump]');
      if (b) goto(parseInt(b.getAttribute('data-jump'), 10));
    });
    $('#btnSheetOpen').addEventListener('click', function () { $('#sheet').classList.add('is-open'); });
    $('#btnSheetClose').addEventListener('click', closeSheet);

    $('#navSync').addEventListener('click', openSync);
    $('#draftBlock').addEventListener('click', function (e) {
      var go = e.target.closest('[data-draft-go]');
      if (go) {
        var key = go.getAttribute('data-draft-go');
        var d = loadDrafts()[key];
        if (!d) { toast('草稿不存在'); return; }
        var untimed = go.getAttribute('data-untimed') === '1';
        resumeDraft(d.state, d.current, untimed);
        return;
      }
      var del = e.target.closest('[data-draft-del]');
      if (del) {
        var k2 = del.getAttribute('data-draft-del');
        if (!confirm('丢弃这份草稿？答案将不再保留。')) return;
        removeDraft(k2);
        renderDrafts();
        toast('已丢弃');
      }
    });

    $('#gkDaily').addEventListener('click', function (e) {
      if (e.target.closest('#btnGkDaily')) startSeq();
    });
    document.addEventListener('zjxc:synced', function () {
      if (view === 'home') renderHome();
      if (view === 'plan') renderPlan();
    });
    $('#btnInstall').addEventListener('click', installApp);

    // 每日任务

    var backHome = $('#btnBackHome');
    if (backHome) backHome.addEventListener('click', function () { renderHome(); setView('home'); });
    var planWeeks = $('#planWeeks');
    if (planWeeks) planWeeks.addEventListener('click', function (e) {
      var s = e.target.closest('[data-start]');
      if (s) {
        var id = s.getAttribute('data-start');
        var d = (window.PLAN_DAYS || []).filter(function (x) { return x.id === id; })[0];
        startDay(d);
        return;
      }
      var es = e.target.closest('[data-essay]');
      if (es) openEssay(es.getAttribute('data-essay'));
    });

    // 报告
    $('#btnHome').addEventListener('click', function () { renderHome(); setView('home'); });
    $('#btnRetryAll').addEventListener('click', function () {
      if (!lastReport) return;
      startSession({
        kind: lastReport.kind, ref: 'retry',
        title: lastReport.title.replace(' 作答报告', '') + '（重做）',
        sub: '重新作答 · ' + lastReport.total + ' 题',
        mode: mode, minutes: mode === 'exam' && lastReport.minutes ? lastReport.minutes : 0,
        ids: lastReport.ids.slice(), answers: {}, flags: {}, startedAt: Date.now(),
        deadline: mode === 'exam' && lastReport.minutes ? Date.now() + lastReport.minutes * 60000 : 0
      });
    });
    $('#btnResumeEdit').addEventListener('click', function () {
      var h = lastReport && lastReport.histSource;
      if (!h) return;
      startSession({
        kind: 'edit', ref: h.ref || '',
        title: (h.title || '').replace(' 作答报告', ''),
        sub: '继续作答 · ' + (h.ids || []).length + ' 题 · 原答案已带入，可改可提交',
        mode: 'practice', minutes: 0,
        ids: (h.ids || []).slice(),
        answers: JSON.parse(JSON.stringify(h.answers || {})),
        flags: {}, startedAt: Date.now(), deadline: 0
      });
      toast('已载入上次的选项，改完可直接交卷');
    });
    $('#btnRetryWrong').addEventListener('click', function () {
      if (!lastReport) return;
      var ids = lastReport.ids.filter(function (id) {
        var a = lastReport.answers[id];
        return a == null || a !== ALL[id].answer;
      });
      if (!ids.length) { toast('本次没有错题'); return; }
      startSubset(ids, '错题重练 · ' + lastReport.title.replace(' 作答报告', ''));
    });

    // 历史重做
    $('#historyTable').addEventListener('click', function (e) {
      var v = e.target.closest('[data-hist-view]');
      if (v) {
        var hv = loadHistory()[parseInt(v.getAttribute('data-hist-view'), 10)];
        if (hv) openHistoryDetail(hv);
        return;
      }
      var b = e.target.closest('[data-hist-retry]');
      if (!b) return;
      var h = loadHistory()[parseInt(b.getAttribute('data-hist-retry'), 10)];
      if (h && h.ids && h.ids.length) startSubset(h.ids.slice(), '重做 · ' + h.title, h.mode === 'exam' ? Math.ceil(h.used / 60) : undefined);
    });

    // 模态框关闭
    $('#modal').addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-modal-close')) closeModal();
    });

    // 键盘
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (modalOpen) closeModal(); else closeSheet(); return; }
      if (view !== 'exam' || modalOpen || !state) return;
      var k = e.key;
      if (k >= '1' && k <= '4') { selectOption(parseInt(k, 10) - 1); e.preventDefault(); return; }
      var idx = 'abcdef'.indexOf(k.toLowerCase());
      if (idx >= 0 && idx < 4) { selectOption(idx); e.preventDefault(); return; }
      if (k === 'ArrowRight' || k === 'PageDown') { goto(current + 1); e.preventDefault(); }
      if (k === 'ArrowLeft' || k === 'PageUp') { goto(current - 1); e.preventDefault(); }
      if (k === 'f' || k === 'F') { toggleFlag(); e.preventDefault(); }
    });

    // 打印前展开全部错题解析，打印后恢复原状
    window.addEventListener('beforeprint', preparePrint);
    window.addEventListener('afterprint', restorePrint);
    $('#btnPrint').addEventListener('click', function () {
      preparePrint();
      setTimeout(function () { window.print(); }, 60);
    });

    // 注：作答进度已实时写入 localStorage，刷新或关闭页面后会自动恢复，
    // 因此不再使用 beforeunload 拦截，避免打断正常浏览。
  }

  function closeSheet() {
    var s = $('#sheet');
    if (s) s.classList.remove('is-open');
  }

  function preparePrint() {
    if (printOpenState.length) return;
    printOpenState = $$('.wrong-item').map(function (d) { return d.open; });
    $$('.wrong-item').forEach(function (d) { d.open = true; });
  }
  function restorePrint() {
    if (!printOpenState.length) return;
    $$('.wrong-item').forEach(function (d, i) { d.open = !!printOpenState[i]; });
    printOpenState = [];
  }

  /* ---------------- PWA：安装与离线 ---------------- */
  var deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  function setupPWA() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('service-worker.js').catch(function () {});
    }
    if (isStandalone()) return;

    var ua = navigator.userAgent || '';
    var mobile = isIOS() || /Android|HarmonyOS|Mobile/i.test(ua) || window.innerWidth < 1024;
    if (!mobile) return;

    $('#installHint').textContent = isIOS()
      ? 'Safari：点「分享」→「添加到主屏幕」，可全屏离线使用'
      : '浏览器菜单 →「添加到桌面 / 安装应用」，可全屏离线使用';
    $('#installBar').hidden = false;
  }

  function installApp() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () { deferredPrompt = null; });
      return;
    }
    var body = isIOS()
      ? '<p>当前环境无法直接调起安装。</p><p style="margin-top:8px">请用 <b>Safari</b> 打开本页 → 点击底部<b>分享</b>按钮 → 选择<b>「添加到主屏幕」</b>。</p>'
      : '<p>当前浏览器未提供安装入口，可任选一种方式：</p>' +
        '<p style="margin-top:8px">1. 用 <b>Chrome / Edge</b> 打开本页，右上角菜单选<b>「安装应用」</b>；</p>' +
        '<p>2. 或用系统浏览器菜单选<b>「添加到桌面」</b>。</p>' +
        '<p style="margin-top:8px;color:#6b7b74">添加后图标出现在桌面，全屏运行，断网也能做题。</p>';
    openModal('安装到手机 / 平板', body, [{ label: '知道了', cls: 'btn-primary' }]);
  }

  /* ---------------- 跨设备同步 ---------------- */
  function syncSnapshot() {
    var data = {};
    ['zjxc.history.v1', 'zjxc.daylog', 'zjxc.seqdone', 'zjxc.drafts'].forEach(function (k) {
      var raw = null;
      try { raw = localStorage.getItem(k); } catch (e) {}
      if (raw) { try { data[k] = JSON.parse(raw); } catch (e) {} }
    });
    return { app: 'zjxc', v: 2, ts: Date.now(), data: data };
  }

  function toB64(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }
  function fromB64(b64) {
    var bin = atob(String(b64).replace(/\s/g, '')), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function mergeSnapshot(obj) {
    if (!obj || obj.app !== 'zjxc' || !obj.data) throw new Error('同步码格式不正确');
    var incHist = obj.data['zjxc.history.v1'] || [];
    var byTs = {};
    loadHistory().concat(incHist).forEach(function (h) {
      if (h && h.ts) byTs[h.ts] = h;
    });
    var merged = Object.keys(byTs).map(function (k) { return byTs[k]; })
      .sort(function (a, b) { return b.ts - a.ts; }).slice(0, 30);
    localStorage.setItem(LS_HISTORY, JSON.stringify(merged));

    var log = loadDayLog(), incLog = obj.data['zjxc.daylog'] || {};
    Object.keys(incLog).forEach(function (k) {
      if (!log[k] || (incLog[k].ts || 0) > (log[k].ts || 0)) log[k] = incLog[k];
    });
    localStorage.setItem('zjxc.daylog', JSON.stringify(log));

    // 通关进度：取并集
    var incSeq = obj.data['zjxc.seqdone'] || {};
    var seq = seqDone();
    Object.keys(incSeq).forEach(function (k) { if (!seq[k]) seq[k] = incSeq[k]; });
    localStorage.setItem('zjxc.seqdone', JSON.stringify(seq));

    // 未交卷草稿：同一套卷取 savedAt 更新的一份，保留最近 10 套
    var incDrafts = obj.data['zjxc.drafts'] || {};
    var drafts = loadDrafts();
    Object.keys(incDrafts).forEach(function (k) {
      var r = incDrafts[k];
      if (!r || !r.state || !r.state.ids) return;
      if (!drafts[k] || (r.savedAt || 0) > (drafts[k].savedAt || 0)) drafts[k] = r;
    });
    var dk = Object.keys(drafts)
      .sort(function (a, b) { return (drafts[b].savedAt || 0) - (drafts[a].savedAt || 0); })
      .slice(0, 10);
    var dOut = {};
    dk.forEach(function (k) { dOut[k] = drafts[k]; });
    localStorage.setItem(LS_DRAFTS, JSON.stringify(dOut));

    return { history: merged.length, days: Object.keys(log).length, seq: Object.keys(seq).length, drafts: dk.length };
  }

  function openSync() {
    var hist = loadHistory(), log = loadDayLog();
    var body = '<div class="sync-box">' +
      '<div id="cloudSyncBox"></div>' +
      '<div class="sync-sep"></div>' +
      '<div class="sync-stat">' +
        '<span>历史记录 <b>' + hist.length + '</b> 次</span>' +
        '<span>已通关 <b>' + Object.keys(seqDone()).length + '</b> 套</span>' +
        '<span>整卷 <b>' + window.PAPERS.length + '</b> 套</span>' +
      '</div>' +
      '<p class="sync-desc">' + (window.SYNC_MODE === 'mqtt'
        ? '默认自动同步：上面那个码是两台设备共用的钥匙，绑定后自动上传/拉取。下面这组是<b>离线搬运</b>，没网或想手动备份时用。'
        : '记录只存这台设备（不联网、不依赖账号）。换设备时用下面的「离线同步码」或导出文件搬一次。') + '</p>' +
      '<div class="sync-row">' +
        '<button class="btn btn-primary" data-sync="export">导出记录文件</button>' +
        '<button class="btn btn-outline" data-sync="code">生成离线同步码</button>' +
      '</div>' +
      '<textarea class="sync-code" id="syncCode" spellcheck="false" placeholder="点「生成离线同步码」后在此显示；也可粘贴另一台设备的码再点「导入」"></textarea>' +
      '<div class="sync-row">' +
        '<button class="btn btn-outline" data-sync="copy">复制同步码</button>' +
        '<button class="btn btn-outline" data-sync="import">从上方文本导入</button>' +
        '<label class="btn btn-ghost" style="cursor:pointer;border-color:var(--line-2)">选择文件导入' +
          '<input type="file" id="syncFile" accept=".json,application/json" hidden></label>' +
      '</div>' +
      '<div class="sync-sep"></div>' +
      '<p class="cloud-sub2">本机数据体检</p>' +
      healthCard() +
      '<div class="sync-row"><button class="btn btn-ghost" data-sync="clear">清空本机记录</button></div>' +
    '</div>';

    openModal('数据同步', body, [{ label: '关闭', cls: 'btn-primary' }], true);
    if (window.ZJXCSync) window.ZJXCSync.renderBar();

    var box = $('#modalBody');
    var ta = $('#syncCode');

    box.onclick = function (e) {
      var b = e.target.closest('[data-sync]');
      if (!b) return;
      var act = b.getAttribute('data-sync');

      if (act === 'export') {
        var blob = new Blob([JSON.stringify(syncSnapshot(), null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        var d = new Date();
        a.href = URL.createObjectURL(blob);
        a.download = '浙考行测-学习记录-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        toast('已导出记录文件');
        return;
      }
      if (act === 'code') {
        ta.value = 'ZJXC1:' + toB64(JSON.stringify(syncSnapshot()));
        ta.select();
        toast('同步码已生成，可复制到另一台设备');
        return;
      }
      if (act === 'copy') {
        if (!ta.value) { toast('请先生成同步码'); return; }
        ta.select();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ta.value).then(function () { toast('已复制'); }, function () { toast('复制失败，请长按手动复制'); });
        } else {
          document.execCommand('copy');
          toast('已复制');
        }
        return;
      }
      if (act === 'import') {
        var txt = String(ta.value || '').trim();
        if (!txt) { toast('请先粘贴同步码'); return; }
        try {
          if (txt.indexOf('ZJXC1:') === 0) txt = fromB64(txt.slice(6));
          var res = mergeSnapshot(JSON.parse(txt));
          toast('已合并：历史 ' + res.history + ' 次 / 通关 ' + res.seq + ' 套 / 草稿 ' + res.drafts + ' 份');
          renderHome(); renderPlan();
        } catch (err) {
          toast('导入失败：' + (err.message || '格式不正确'));
        }
        return;
      }
      if (act === 'clear') {
        confirmDialog('清空本机记录？', '<p>将删除全部作答历史、未完成草稿与通关进度，题库与套卷不受影响。</p>', '确认清空', function () {
          try {
            localStorage.removeItem(LS_HISTORY);
            localStorage.removeItem('zjxc.daylog');
            localStorage.removeItem('zjxc.seqdone');
            localStorage.removeItem(LS_PROGRESS);
            localStorage.removeItem(LS_DRAFTS);
          } catch (e) {}
          renderHome(); renderPlan();
          toast('已清空');
        });
        return;
      }
    };

    var fileInput = $('#syncFile');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var res = mergeSnapshot(JSON.parse(String(reader.result)));
            toast('已合并：历史 ' + res.history + ' 次 / 通关 ' + res.seq + ' 套 / 草稿 ' + res.drafts + ' 份');
            renderHome(); renderPlan();
          } catch (err) {
            toast('文件解析失败');
          }
        };
        reader.readAsText(f);
      });
    }
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    // 真题里的公式图若缺失，别显示破图标，直接给一行提示
    document.addEventListener("error", function (e) {
      var t = e.target;
      if (!t || t.tagName !== "IMG") return;
      if (!/assets\/data\/real\/img\//.test(t.getAttribute("src") || "")) return;
      t.style.display = "none";
      var tip = document.createElement("span");
      tip.className = "img-miss";
      tip.textContent = "（原卷公式图缺失）";
      if (t.parentNode) t.parentNode.insertBefore(tip, t.nextSibling);
    }, true);

    // 默认打开当前待通关那一套所在的年份
    var seq0 = seqInfo();
    if (seq0 && seq0.paper) homeYear = seq0.paper.year;

    // 内容热更新：启动拉一次补丁；拿到新补丁就清缓存、下次开卷用新题
    document.addEventListener('zjxc:content', function () {
      // 把已注册进 ALL 的真题条目清掉，否则草稿恢复时还用旧题目对象
      Object.keys(REAL_IDS).forEach(function (pid) {
        (REAL_IDS[pid] || []).forEach(function (qid) { delete ALL[qid]; });
        delete REAL_IDS[pid];
      });
      REAL_CACHE = {};
      // 正在作答的卷：立刻重载，题目当场更新
      var activeRef = state && state.ref;
      var isPaper = activeRef && (window.PAPERS || []).some(function (p) { return p.id === activeRef; });
      if (isPaper) {
        loadRealPaper(activeRef).then(function (d) {
          registerReal(d);
          if (view === 'exam') renderQuestion();
        }).catch(function () {});
      }
      if (view === 'home') renderHome();
    });
    if (window.ContentPatch) window.ContentPatch.pull();

    renderHome();
    bind();
    if (window.ZJXCSync) window.ZJXCSync.snapshot("启动");
    setupPWA();

    // 答案修正后，把历史记录按新答案重算一遍（幂等，只改分数不改作答）
    setTimeout(function () { regradeHistory(); }, 1200);
    document.addEventListener('zjxc:synced', function () { regradeHistory(); });

    var prog = loadProgress();
    if (prog) {
      var s = prog.state;
      if (s.mode === 'exam' && s.deadline && s.deadline <= Date.now()) {
        s.mode = 'practice'; s.minutes = 0; s.deadline = 0; s.paused = false; s.pausedRemain = 0;
      }
      resumeDraft(s, prog.current || 0, false);
    }
    setView(view);

    // 桌面快捷方式：?view=plan 已停用，统一回首页
    try {
      if (!state && new URLSearchParams(location.search).get('view') === 'plan') {
        setView('home');
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
