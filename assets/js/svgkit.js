/* ===========================================================
   svgkit.js —— 图形推理题所需的内联 SVG 生成器
   所有图形统一 100×100 视口、居中绘制，保证选项之间可比
   =========================================================== */
(function () {
  const INK = '#1b2b26';
  const ACCENT = '#146b58';

  function frame(inner, opt) {
    opt = opt || {};
    const bg = opt.bg ? `<rect x="1" y="1" width="98" height="98" rx="8" fill="${opt.bg}"/>` : '';
    const stroke = opt.stroke || INK;
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="图形">
      ${bg}
      <g fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">${inner}</g>
    </svg>`;
  }

  /* 圆点阵：n=1..7 */
  const DOT_POS = {
    1: [[50, 50]],
    2: [[34, 50], [66, 50]],
    3: [[34, 34], [66, 34], [50, 66]],
    4: [[34, 34], [66, 34], [34, 66], [66, 66]],
    5: [[34, 34], [66, 34], [50, 50], [34, 66], [66, 66]],
    6: [[28, 32], [50, 32], [72, 32], [28, 68], [50, 68], [72, 68]],
    7: [[28, 28], [50, 28], [72, 28], [28, 50], [72, 50], [39, 72], [61, 72]]
  };

  function dots(n, color) {
    const pos = DOT_POS[n] || [];
    const inner = pos.map(function (p) {
      return `<circle cx="${p[0]}" cy="${p[1]}" r="7.5" fill="${color || INK}" stroke="none"/>`;
    }).join('');
    return frame(inner);
  }

  /* 正多边形：n=3..8 */
  function polygon(n) {
    const R = 36;
    let d = '';
    for (let i = 0; i < n; i++) {
      const a = (-90 + i * 360 / n) * Math.PI / 180;
      const x = 50 + R * Math.cos(a);
      const y = 50 + R * Math.sin(a);
      d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
    }
    return frame(`<path d="${d}Z"/>`);
  }

  /* 封闭区域：总数 n（含外部大圆），即内部 n-1 个小圆 */
  function rings(n) {
    const R = 27;
    let inner = '<circle cx="50" cy="50" r="43"/>';
    const k = Math.max(0, n - 1);
    if (k === 1) {
      inner += '<circle cx="50" cy="50" r="13"/>';
    } else if (k > 1) {
      for (let i = 0; i < k; i++) {
        const a = (-90 + i * 360 / k) * Math.PI / 180;
        inner += `<circle cx="${(50 + R * Math.cos(a)).toFixed(2)}" cy="${(50 + R * Math.sin(a)).toFixed(2)}" r="10"/>`;
      }
    }
    return frame(inner);
  }

  /* 元素种类：k 种不同图形，共 5 个图形 */
  const SHAPES = ['tri', 'sq', 'cir', 'dia', 'pen', 'star'];
  function shapePath(kind, cx, cy, r) {
    if (kind === 'cir') return `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
    if (kind === 'sq') return `<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" rx="2"/>`;
    const pts = kind === 'tri' ? 3 : kind === 'pen' ? 5 : kind === 'star' ? 10 : 4;
    let d = '';
    for (let i = 0; i < pts; i++) {
      const rr = kind === 'star' && i % 2 === 1 ? r * 0.46 : r;
      const a = (-90 + i * 360 / pts) * Math.PI / 180;
      d += (i === 0 ? 'M' : 'L') + (cx + rr * Math.cos(a)).toFixed(2) + ' ' + (cy + rr * Math.sin(a)).toFixed(2) + ' ';
    }
    return `<path d="${d}Z"/>`;
  }

  /* k 种图形，排布为 2 行 */
  function kinds(k) {
    const slots = [[30, 32], [66, 32], [48, 60], [22, 74], [74, 74]];
    let inner = '';
    for (let i = 0; i < 5; i++) {
      const kind = SHAPES[i % k];
      const s = slots[i];
      inner += shapePath(kind, s[0], s[1], i === 2 ? 13 : 12);
    }
    return frame(inner);
  }

  /* 指针：deg=0 指向上方，顺时针递增 */
  function needle(deg) {
    const a = (deg - 90) * Math.PI / 180;
    const x = 50 + 33 * Math.cos(a);
    const y = 50 + 33 * Math.sin(a);
    const bx = 50 - 9 * Math.cos(a);
    const by = 50 - 9 * Math.sin(a);
    const inner = `<circle cx="50" cy="50" r="41"/>
      <line x1="${bx.toFixed(2)}" y1="${by.toFixed(2)}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}" stroke-width="3"/>
      <circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4.6" fill="${ACCENT}" stroke="none"/>`;
    return frame(inner);
  }

  /* 直线条数：n=1..6，线条均经过中心、方向不同，便于计数 */
  const LINE_ANGLES = {
    1: [0], 2: [0, 55], 3: [0, 60, 120],
    4: [0, 45, 90, 135], 5: [0, 36, 72, 108, 144], 6: [0, 30, 60, 90, 120, 150]
  };
  function lines(n) {
    const arr = LINE_ANGLES[n] || [];
    const inner = arr.map(function (deg) {
      const r = deg * Math.PI / 180;
      const x1 = 50 - 38 * Math.cos(r), y1 = 50 - 38 * Math.sin(r);
      const x2 = 50 + 38 * Math.cos(r), y2 = 50 + 38 * Math.sin(r);
      return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
    }).join('');
    return frame(inner);
  }

  /* 图形序列：items 为若干 SVG 字符串，末尾补一个问号格 */
  function seq(items, withQuestion) {
    const cells = items.map(function (s) { return `<div class="fig-cell">${s}</div>`; });
    if (withQuestion !== false) cells.push('<div class="fig-cell fig-q">?</div>');
    return `<div class="fig-row">${cells.join('<span class="fig-sep">→</span>')}</div>`;
  }

  window.SVGKIT = { dots, polygon, rings, kinds, needle, lines, seq };
})();
