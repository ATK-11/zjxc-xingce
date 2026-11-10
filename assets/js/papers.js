/* ===========================================================
   papers.js —— 考试体系、年份、卷别、模块配额
   -----------------------------------------------------------
   本站收录：国考行测副省级 2016—2025（10 套）+ 2026 行政执法（1 套）；浙江 A 卷 2015—2025（11 套）
   年份范围：国考 2016—2025 + 浙江 2015—2025

   结构依据（公开考情整理，已核实）：
   · 国考行测 120 分钟，副省级 135 题
       2016—2021：常识 20 + 言语 40 + 数量 15 + 判断 40 + 资料 20
       2022—2024：同上
       2025     ：政治理论 20 + 常识 15 + 言语 30 + 数量 15 + 判断 35 + 资料 20

   说明：题量与模块分布与当年真题一致（完整 135 题），题目为真题（考生回忆版，
         公开整理），卷面与报告均标注来源；个别年份缺 1—2 题。
   =========================================================== */
window.MODULES = {
  politics: { name: '政治理论', short: '政治', char: '政', color: '#c2410c', weight: 0.5,
              desc: '党的创新理论、时政与浙江省情' },
  common:   { name: '常识判断', short: '常识', char: '常', color: '#7c3aed', weight: 0.5,
              desc: '法律、科技、人文、经济、地理' },
  verbal:   { name: '言语理解与表达', short: '言语', char: '言', color: '#0e7490', weight: 0.9,
              desc: '选词填空、片段阅读、语句表达' },
  quant:    { name: '数量关系', short: '数量', char: '数', color: '#be123c', weight: 1.0,
              desc: '数学运算' },
  judge:    { name: '判断推理', short: '判断', char: '判', color: '#15803d', weight: 0.8,
              desc: '图形、定义、类比、逻辑判断' },
  data:     { name: '资料分析', short: '资料', char: '资', color: '#1d4ed8', weight: 1.0,
              desc: '增长率、比重、平均数、倍数' }
};

window.MODULE_ORDER = ['politics', 'common', 'verbal', 'quant', 'judge', 'data'];

/* 配额数组顺序：政治、常识、言语、数量、判断、资料 */
function makeQuota(arr) {
  var q = {};
  window.MODULE_ORDER.forEach(function (m, i) { q[m] = arr[i] || 0; });
  return q;
}

/* ---------------- 国考副省级：2016—2025 ---------------- */
var GK_FU_OLD = [0, 20, 40, 15, 40, 20];   // 135 题，与真题同量
var GK_FU_2025 = [20, 15, 30, 15, 35, 20]; // 135 题

var DETAIL_OLD = '常识20 · 言语40 · 数量15 · 判断40 · 资料20';
var DETAIL_2025 = '政治20 · 常识15 · 言语30 · 数量15 · 判断35 · 资料20';

function gkPaper(year, quota, realTotal, realDetail, desc) {
  return {
    slug: 'fu',
    code: '副省级',
    name: '副省级以上（含副省级）',
    desc: desc,
    realTotal: realTotal,
    realDetail: realDetail,
    quota: quota
  };
}

var GK_BY_YEAR = [];
(function buildGK() {
  for (var y = 2016; y <= 2026; y++) {
    if (y === 2026) {
      // 2026 国考：目前只上线行政执法卷（由官方 PDF 还原，130 题）
      GK_BY_YEAR.push({
        year: y,
        papers: [{
          slug: 'zf',
          code: '行政执法',
          name: '行政执法类',
          desc: '2026 年国考行政执法卷。政治理论 19 · 常识 16 · 言语 30 · 数量 10 · 判断 35 · 资料 20。',
          realTotal: 130,
          realDetail: '政治理论19 · 常识16 · 言语30 · 数量10 · 判断35 · 资料20',
          quota: [19, 16, 30, 10, 35, 20]
        }]
      });
    } else if (y >= 2025) {
      GK_BY_YEAR.push({
        year: y,
        papers: [gkPaper(y, GK_FU_2025, 135, DETAIL_2025,
          '省级以上机关职位。2025 年起单设政治理论 20 题，常识压缩至 15 题。')]
      });
    } else if (y === 2022) {
      // 2022 副省级回忆版缺 1 题（常识 19 题），quota 按实际
      GK_BY_YEAR.push({
        year: y,
        papers: [gkPaper(y, [0, 19, 40, 15, 40, 20], 135, DETAIL_OLD,
          '省级以上机关职位。数量关系 15 题，当年未单设政治理论。回忆版缺 1 题。')]
      });
    } else {
      GK_BY_YEAR.push({
        year: y,
        papers: [gkPaper(y, GK_FU_OLD, 135, DETAIL_OLD,
          '省级以上机关职位。数量关系 15 题，当年未单设政治理论。')]
      });
    }
  }
})();

function expand(examId, year, specs) {
  return specs.map(function (s) {
    var count = s.quota.reduce(function (a, b) { return a + b; }, 0);
    return {
      real: true,
      id: examId + '-' + year + '-' + s.slug,
      exam: examId,
      year: year,
      code: s.code,
      name: s.name,
      desc: s.desc,
      minutes: 120,
      realTotal: s.realTotal,
      realCount: s.realCount,
      realDetail: s.realDetail,
      count: count,
      quota: makeQuota(s.quota)
    };
  });
}

var GK_PAPERS = [];
GK_BY_YEAR.forEach(function (g) {
  GK_PAPERS = GK_PAPERS.concat(expand('gk', g.year, g.papers));
});

/* 个别年份回忆版缺题，卡片按实际题量显示（2022 副省缺 1 题） */
var REAL_MISSING = { 2022: 134 };
GK_PAPERS.forEach(function (p) {
  if (REAL_MISSING[p.year]) p.realCount = REAL_MISSING[p.year];
});

/* ---------------- 浙江省考 A 卷：2015—2025 ---------------- */
/* 浙江行测 120 分钟。quota 已按实际抓到的题目分布校准（考生回忆版，与当年真题结构偶有出入）。 */
/* 由官方 PDF 题库还原（tools/parse-zj-pdf.py），quota 与每卷实际题量一致 */
var ZJ_2015 = { slug: 'A', code: 'A卷', name: '综合类',
  desc: '常识20 · 言语30 · 数量25 · 判断35 · 资料15',
  realTotal: 125, realCount: 125, realDetail: '常识20 · 言语30 · 数量25 · 判断35 · 资料15',
  quota: [0,20,30,25,35,15] };
var ZJ_2016 = { slug: 'A', code: 'A卷', name: '综合类',
  desc: '常识20 · 言语30 · 数量20 · 判断40 · 资料15',
  realTotal: 125, realCount: 125, realDetail: '常识20 · 言语30 · 数量20 · 判断40 · 资料15',
  quota: [0,20,30,20,40,15] };
var ZJ_2017 = { slug: 'A', code: 'A卷', name: '综合类',
  desc: '常识20 · 言语30 · 数量20 · 判断40 · 资料15',
  realTotal: 125, realCount: 125, realDetail: '常识20 · 言语30 · 数量20 · 判断40 · 资料15',
  quota: [0,20,30,20,40,15] };
var ZJ_2018 = { slug: 'A', code: 'A卷', name: '综合类',
  desc: '常识20 · 言语35 · 数量25 · 判断40 · 资料20',
  realTotal: 140, realCount: 140, realDetail: '常识20 · 言语35 · 数量25 · 判断40 · 资料20',
  quota: [0,20,35,25,40,20] };
var ZJ_2019 = { slug: 'A', code: 'A卷', name: '综合类',
  desc: '常识20 · 言语35 · 数量25 · 判断35 · 资料15',
  realTotal: 130, realCount: 130, realDetail: '常识20 · 言语35 · 数量25 · 判断35 · 资料15',
  quota: [0,20,35,25,35,15] };
var ZJ_2020 = { slug: 'A', code: 'A卷', name: '综合类',
  desc: '常识15 · 言语25 · 数量20 · 判断25 · 资料15',
  realTotal: 100, realCount: 100, realDetail: '常识15 · 言语25 · 数量20 · 判断25 · 资料15',
  quota: [0,15,25,20,25,15] };
var ZJ_2021 = { slug: 'A', code: 'A卷', name: '综合类',
  desc: '常识20 · 言语30 · 数量25 · 判断40 · 资料15',
  realTotal: 130, realCount: 130, realDetail: '常识20 · 言语30 · 数量25 · 判断40 · 资料15',
  quota: [0,20,30,25,40,15] };
var ZJ_2022 = { slug: 'A', code: 'A卷', name: '综合类',
  desc: '常识20 · 言语30 · 数量20 · 判断40 · 资料15',
  realTotal: 125, realCount: 125, realDetail: '常识20 · 言语30 · 数量20 · 判断40 · 资料15',
  quota: [0,20,30,20,40,15] };
var ZJ_2023 = { slug: 'A', code: 'A卷', name: '综合类',
  desc: '常识20 · 言语30 · 数量20 · 判断40 · 资料15',
  realTotal: 125, realCount: 125, realDetail: '常识20 · 言语30 · 数量20 · 判断40 · 资料15',
  quota: [0,20,30,20,40,15] };
var ZJ_2024 = { slug: 'A', code: 'A卷', name: '综合类',
  desc: '常识20 · 言语30 · 数量20 · 判断40 · 资料15',
  realTotal: 125, realCount: 125, realDetail: '常识20 · 言语30 · 数量20 · 判断40 · 资料15',
  quota: [0,20,30,20,40,15] };
var ZJ_2025 = { slug: 'A', code: 'A卷', name: '综合类',
  desc: '常识20 · 言语30 · 数量20 · 判断40 · 资料15',
  realTotal: 125, realCount: 125, realDetail: '常识20 · 言语30 · 数量20 · 判断40 · 资料15',
  quota: [0,20,30,20,40,15] };

window.EXAMS = [
  {
    id: 'gk',
    name: '国考',
    full: '国家公务员考试',
    remark: '2016—2026 · 副省级 135 题 / 行政执法 130 题 · 行测 120 分钟 · 真题',
    years: [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016],
    papers: GK_PAPERS
  },
  {
    id: 'zj',
    name: '浙江省考',
    full: '浙江省公务员考试',
    remark: '2015—2025 A 卷 · 行测 120 分钟 · 真题（PDF 还原）',
    years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015],
    papers: [].concat(
      expand('zj', 2025, [ZJ_2025]),
      expand('zj', 2024, [ZJ_2024]),
      expand('zj', 2023, [ZJ_2023]),
      expand('zj', 2022, [ZJ_2022]),
      expand('zj', 2021, [ZJ_2021]),
      expand('zj', 2020, [ZJ_2020]),
      expand('zj', 2019, [ZJ_2019]),
      expand('zj', 2018, [ZJ_2018]),
      expand('zj', 2017, [ZJ_2017]),
      expand('zj', 2016, [ZJ_2016]),
      expand('zj', 2015, [ZJ_2015]),
    )
  }
];

/* 扁平列表，便于按 id 查找 */
window.PAPERS = window.EXAMS.reduce(function (acc, e) { return acc.concat(e.papers); }, []);

/* 逐套通关顺序：
   · 国考：最新年份优先（2026 → 2016），先把当年的卷练掉
   · 浙江：2015 → 2025
   两科各自独立计算进度（见 app.js 的 seqOrderOf/seqIndex） */
var GK_SEQ = GK_PAPERS.slice().sort(function (a, b) {
  if (b.year !== a.year) return b.year - a.year;
  return 0;
});
var ZJ_A_ASC = window.EXAMS[1].papers.slice().sort(function (a, b) { return a.year - b.year; });
window.SEQ_ORDER = GK_SEQ.concat(ZJ_A_ASC);

/* 兼容旧代码 */
window.GK_DAILY_ORDER = GK_PAPERS.slice();

/* 专项建议时长：按每分钟约 0.9 题的考场节奏，向上取整 */
window.modulePracticeMinutes = function (count) {
  return Math.max(8, Math.ceil(count / 0.9));
};
