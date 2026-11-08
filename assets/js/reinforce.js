/* ===========================================================
   reinforce.js —— 点对点补强（错题 → 题型方法 → 同类题专项）
   -----------------------------------------------------------
   为什么需要：
     题库数据里的题型是「粗分类」（片段阅读、数学运算、图形推理…），
     而 methods.js 的方法库是「细分类」（主旨概括、工程问题、位置类…）。
     两边粒度对不上，methodFor() 只能匹配到 5/22 类，其余全部掉到模块兜底，
     用户看到的「方法」很泛，起不到点对点作用。

   本模块做三件事：
     1. TYPE_MAP：粗题型 → 细方法（可一对多），把方法库真正接上题库
     2. TIP：每个粗题型补充「这一类怎么下手」的通用要点
     3. poolFor()：按题型捞同类题，供「专项补强」组卷

   热更新：
     补强内容可通过 MQTT 主题 zjxc/content/v1 下发的补丁里
     `reinforce: { typeMap, tips }` 字段覆盖，不用重装 APK。
     见 tools/publish-reinforce.js
   =========================================================== */
(function () {
  'use strict';

  /* ---------- 粗题型 → 细方法 key（对应 window.METHODS） ---------- */
  var TYPE_MAP = {
    /* 言语理解 */
    '片段阅读': ['主旨概括', '细节理解', '意图判断', '标题填入', '词句理解', '下文推断'],
    '逻辑填空': ['成语', '实词', '关联词'],
    '语句表达': ['语句排序', '语句衔接'],

    /* 数量关系 */
    '数学运算': ['工程问题', '行程问题', '经济利润', '几何问题', '最值问题',
      '概率问题', '排列组合', '容斥原理', '浓度问题', '方程问题'],
    '数字推理': ['多级数列', '递推数列', '多重数列', '幂次数列', '分数数列', '等比数列'],

    /* 判断推理 */
    '图形推理': ['位置类', '数量类'],
    '定义判断': ['定义判断'],
    '类比推理': ['类比推理'],
    '逻辑判断': ['翻译推理', '削弱论证', '加强论证', '真假推理', '原因解释'],

    /* 资料分析 */
    '增长': ['增长量', '增长量比较', '基期量', '增速比较'],
    '比重': ['比重', '比重变化'],
    '平均数': ['平均数', '两期平均数'],
    '倍数': ['倍数', '比值', '比值变化'],
    '综合': ['综合分析', '综合速算'],
    '基期量': ['基期量', '基期差值'],

    /* 常识判断 */
    '人文常识': ['人文', '文学'],
    '科技常识': ['科技', '物理'],
    '法律常识': ['宪法', '法律', '民法', '行政法'],
    '经济常识': ['经济'],
    '地理国情': ['地理'],
    '省情': ['省情'],
    '常识判断': ['常识判断'],

    /* 政治理论 */
    '新思想': ['政治理论'],
    '时事政治': ['政治理论'],
    '毛中特': ['政治理论'],
    '马克思主义': ['政治理论'],
    '政治理论': ['政治理论']
  };

  /* ---------- 每个粗题型的通用下手要点（方法库不够细时兜底） ---------- */
  var TIPS = {
    '片段阅读': '先看问题问什么，再回原文定位。主旨题找「总—分」的总句；细节题逐项比对原文；意图题选「言外之意」不选原句复述。',
    '逻辑填空': '先通读全句定语境（褒贬、轻重、搭配），再看选项差异。两空以上时先定一个最有把握的空，用排除法收敛。',
    '语句表达': '排序题先找首句（引出话题）和尾句（总结），再抓指代词与时间线索；衔接题看横线前后的主语是否一致。',
    '数学运算': '先判断题型（工程/行程/利润/几何/概率），能赋值就赋值（取最小公倍数或 100），避免列复杂方程。',
    '数字推理': '先看相邻项差，差无规律看商，再试平方立方、递推（前两项运算得第三项）、分数分子分母分开看。',
    '图形推理': '按「点、线、面、角、素」顺序排查：数量变化→位置移动→样式叠加→对称性→封闭区域。',
    '定义判断': '抓定义里的主体、条件、结果三个要件，逐项比对，缺一要件即排除。',
    '类比推理': '先看语义关系（近义/反义/种属），再看逻辑关系（因果/并列），最后看语法结构。',
    '逻辑判断': '翻译推理记「只有…才…后推前」「如果…那么…前推后」；削弱加强先找论点论据，再看他因/断开联系。',
    '增长': '增长量 = 现期 − 基期 = 现期 × 增长率/(1+增长率)。比较增长量优先用「现期×增长率」估算。',
    '比重': '比重 = 部分/整体。两期比重变化看「部分增速 vs 整体增速」：部分快则比重上升，慢则下降。',
    '平均数': '平均数 = 总量/份数。两期平均数变化看「总量增速 vs 份数增速」。',
    '倍数': '倍数 = A/B。求「是几倍」直接除，求「多几倍」要减 1。',
    '综合': '先看问题再定位数据，能用截位直除就别精算。四个选项都要验的题，从最容易判的选项入手。',
    '人文常识': '优先抓朝代顺序、作者作品对应、成语典故出处三条线；不会的先排除明显时空错位的选项。',
    '科技常识': '记生活化原理（物态变化、光的反射折射、电磁应用）与近年重大科技成就，避开纯背参数的题。',
    '法律常识': '《宪法》《民法典》《行政处罚法》是高频。注意「可以/应当」「以上/以下」的表述差异。',
    '经济常识': '抓供求与价格、宏观调控手段（财政/货币）、常见经济指标含义。',
    '地理国情': '记气候类型分布、地形三级阶梯、主要河流与省区特征。',
    '省情': '浙江重点：八八战略、千万工程、共同富裕示范区、数字经济、山海协作。',
    '新思想': '抓党的最新会议精神与重要论述，注意「根本」「首要」「核心」这类限定词。',
    '时事政治': '按时间线记近一年重大会议、政策文件与重要讲话。',
    '毛中特': '抓理论形成阶段与核心命题的对应关系。',
    '马克思主义': '抓唯物论（物质与意识）、辩证法（三大规律）、认识论（实践与认识）三大块。',
    '政治理论': '按「是什么—为什么—怎么办」组织记忆，注意限定词与表述顺序。'
  };

  /* 无题型时按模块兜底 */
  var MODULE_TIP = {
    politics: '政治理论题量小、性价比高，重点抓最新会议精神与浙江特色表述。',
    common: '常识不靠死记，按法律、科技、人文、省情四条线各建错题清单。',
    verbal: '言语占分最重：选词建三张积累表（成语/实词/关联词），片段阅读先练结构分析。',
    quant: '数量别整体放弃，主攻工程、行程、概率、几何、经济利润五类，用赋值法提速。',
    judge: '判断推理题量最大：图形按点线面角素排查，定义抓三要件，逻辑练翻译与削弱加强。',
    data: '资料分析提分最快：熟记基期量、增长量、比重、倍数四公式，练截位直除。'
  };

  /* ---------- 热更新覆盖 ---------- */
  function overlay() {
    try {
      var P = window.ContentPatch && window.ContentPatch.get && window.ContentPatch.get();
      return (P && P.reinforce) || null;
    } catch (e) { return null; }
  }

  function typeMap() {
    var o = overlay();
    if (!o || !o.typeMap) return TYPE_MAP;
    var out = {};
    for (var k in TYPE_MAP) if (Object.prototype.hasOwnProperty.call(TYPE_MAP, k)) out[k] = TYPE_MAP[k];
    for (var k2 in o.typeMap) if (Object.prototype.hasOwnProperty.call(o.typeMap, k2)) out[k2] = o.typeMap[k2];
    return out;
  }

  function tips() {
    var o = overlay();
    if (!o || !o.tips) return TIPS;
    var out = {};
    for (var k in TIPS) if (Object.prototype.hasOwnProperty.call(TIPS, k)) out[k] = TIPS[k];
    for (var k2 in o.tips) if (Object.prototype.hasOwnProperty.call(o.tips, k2)) out[k2] = o.tips[k2];
    return out;
  }

  /* ---------- 题型归一化 ---------- */
  /* 数据里 qtype 可能是：
       "片段阅读"               → 片段阅读
       "图形推理·位置类"         → 图形推理（粗）、位置类（细）
       "言语理解·逻辑填空"       → 逻辑填空
       ""                       → 空（用模块兜底）
  */
  function normalize(qtype) {
    var raw = String(qtype || '').trim();
    if (!raw) return { coarse: '', fine: '' };
    var parts = raw.split('·').map(function (s) { return s.trim(); }).filter(Boolean);
    if (parts.length === 1) return { coarse: parts[0], fine: '' };
    // 「图形推理·位置类」：第一段是模块内大类，第二段是细类
    if (parts[0] === '图形推理' || parts[0] === '数字推理') {
      return { coarse: parts[0], fine: parts[1] || '' };
    }
    return { coarse: parts[parts.length - 1], fine: '' };
  }

  /* ---------- 对外：取这道题对应的方法列表 ---------- */
  /* 返回 [{ key, name, method }]，优先精确细类，其次粗类映射，最后空 */
  function methodsFor(qtype, module) {
    var n = normalize(qtype);
    var M = window.METHODS || {};
    var map = typeMap();
    var out = [];
    var seen = {};

    function push(key) {
      if (!key || seen[key]) return;
      var m = M[key];
      if (!m) return;
      seen[key] = 1;
      out.push({ key: key, name: key, method: m });
    }

    // 1) 细类直接命中
    if (n.fine) push(n.fine);
    // 2) 粗类命中方法库
    if (n.coarse) push(n.coarse);
    // 3) 粗类 → 映射到细方法
    var keys = map[n.coarse];
    if (keys && keys.length) keys.forEach(push);

    // 4) 兜底：没有题型（题库存量题约半数 qtype 为空）时给模块级方法
    if (!out.length && module) {
      var fb = (window.METHOD_FALLBACK || {})[module];
      if (fb) {
        out.push({
          key: 'module:' + module,
          name: fb.module || module,
          method: fb,
          fallback: true
        });
      }
    }

    return out;
  }

  /* ---------- 对外：取这一类的方法要点 ---------- */
  function tipFor(qtype, module) {
    var n = normalize(qtype);
    var T = tips();
    if (n.coarse && T[n.coarse]) return T[n.coarse];
    if (n.fine && T[n.fine]) return T[n.fine];
    return MODULE_TIP[module] || '';
  }

  /* ---------- 对外：按题型捞同类题 ---------- */
  /* opts: { module, exclude: [ids], limit, onlyReal } */
  function poolFor(qtype, module, opts) {
    opts = opts || {};
    var n = normalize(qtype);
    var exclude = {};
    (opts.exclude || []).forEach(function (id) { exclude[id] = 1; });
    var limit = opts.limit || 0;
    // ALL 是 app.js 的题库索引（挂在 window.__ZJXC_ALL 上）
    var ALL = window.__ZJXC_ALL || window.ALL || {};
    var out = [];

    for (var id in ALL) {
      if (!Object.prototype.hasOwnProperty.call(ALL, id)) continue;
      if (exclude[id]) continue;
      var it = ALL[id];
      if (!it) continue;
      if (opts.onlyReal && !it.real) continue;

      var nn = normalize(it.sub || it.qtype || '');
      var sameType = n.coarse && (nn.coarse === n.coarse || nn.fine === n.coarse);
      var sameModule = module && it.module === module;

      // 有粗题型时按题型匹配；没有时退化到模块
      if (n.coarse) {
        if (!sameType) continue;
      } else {
        if (!sameModule) continue;
      }
      out.push(id);
    }

    // 打散，避免总抽到同一套卷的前几题
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return limit ? out.slice(0, limit) : out;
  }

  /* ---------- 对外：从一份报告生成补强计划 ---------- */
  /* 输入 grade() 产出的 report，输出按失分排序的题型列表 */
  function planFromReport(r) {
    if (!r || !r.ids) return [];
    var ALL = window.__ZJXC_ALL || window.ALL || {};
    var byType = {};
    var list = [];

    r.ids.forEach(function (id) {
      var it = ALL[id];
      if (!it) return;
      var a = r.answers[id];
      var isWrong = (a == null || a !== it.answer);
      if (!isWrong) return;

      var n = normalize(it.sub || '');
      var key = n.coarse || ('模块:' + it.module);
      if (!byType[key]) {
        byType[key] = {
          type: key, module: it.module, wrong: 0, ids: []
        };
        list.push(byType[key]);
      }
      byType[key].wrong++;
      byType[key].ids.push(id);
    });

    list.sort(function (a, b) { return b.wrong - a.wrong; });
    list.forEach(function (o) {
      o.methods = methodsFor(o.type, o.module).slice(0, 4).map(function (x) { return x.name; });
      o.tip = tipFor(o.type, o.module);
      o.pool = poolFor(o.type, o.module, { exclude: [], onlyReal: true }).length;
    });
    return list;
  }

  window.Reinforce = {
    TYPE_MAP: TYPE_MAP,
    TIPS: TIPS,
    MODULE_TIP: MODULE_TIP,
    normalize: normalize,
    methodsFor: methodsFor,
    tipFor: tipFor,
    poolFor: poolFor,
    planFromReport: planFromReport
  };
})();