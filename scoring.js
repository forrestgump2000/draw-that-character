// Similarity scoring between a player's drawing and the reference character image.
// Everything runs in the browser: both images are cropped to their subject,
// normalised to the same size, then compared on silhouette, line work and colour.
(function () {
  const W = 160;      // working resolution for subject detection
  const N = 64;       // normalised comparison grid

  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function rgbDist(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db) * 1.4;
  }

  // Fill enclosed holes: anything not reachable from the border without crossing the mask.
  function fillHoles(mask, w, h) {
    const outside = new Uint8Array(w * h);
    const stack = [];
    const push = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
    }
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = outside[i] ? 0 : 1;
    return out;
  }

  function dilate(mask, w, h, r) {
    let cur = mask;
    for (let k = 0; k < r; k++) {
      const nx = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        nx[i] = cur[i] || (x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) ||
          (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w]) ? 1 : 0;
      }
      cur = nx;
    }
    return cur;
  }

  // 3-4 chamfer distance transform
  function distTransform(edges, w, h) {
    const INF = 1e9;
    const d = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) d[i] = edges[i] ? 0 : INF;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) d[i] = Math.min(d[i], d[i - 1] + 3);
      if (y > 0) {
        d[i] = Math.min(d[i], d[i - w] + 3);
        if (x > 0) d[i] = Math.min(d[i], d[i - w - 1] + 4);
        if (x < w - 1) d[i] = Math.min(d[i], d[i - w + 1] + 4);
      }
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) d[i] = Math.min(d[i], d[i + 1] + 3);
      if (y < h - 1) {
        d[i] = Math.min(d[i], d[i + w] + 3);
        if (x < w - 1) d[i] = Math.min(d[i], d[i + w + 1] + 4);
        if (x > 0) d[i] = Math.min(d[i], d[i + w - 1] + 4);
      }
    }
    for (let i = 0; i < w * h; i++) d[i] /= 3;
    return d;
  }

  function colorBin(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 510;
    const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
    if (s < 0.22 || max < 40) {
      if (l < 0.22) return 12;      // black
      if (l > 0.86) return 14;      // white
      return 13;                     // grey
    }
    let hue;
    const d = max - min;
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
    return Math.floor(((hue + 15) % 360) / 30); // 12 hue bins
  }

  // Analyse any drawable source into normalised features.
  function analyze(source, isDrawing) {
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    const sc = W / Math.max(sw, sh);
    const w = Math.max(8, Math.round(sw * sc)), h = Math.max(8, Math.round(sh * sc));
    const c = mk(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;

    // Background colour estimate from border pixels
    let bg = [255, 255, 255];
    let busy = false;
    if (!isDrawing) {
      const border = [];
      for (let x = 0; x < w; x++) { border.push(x); border.push((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { border.push(y * w); border.push(y * w + w - 1); }
      const ch = [[], [], []];
      for (const i of border) for (let k = 0; k < 3; k++) ch[k].push(px[i * 4 + k]);
      bg = ch.map(a => a.sort((p, q) => p - q)[a.length >> 1]);
      let close = 0;
      for (const i of border) if (rgbDist(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], bg[0], bg[1], bg[2]) < 40) close++;
      busy = close / border.length < 0.55;
    }

    let mask = new Uint8Array(w * h);
    let count = 0;
    for (let i = 0; i < w * h; i++) {
      const d = rgbDist(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], bg[0], bg[1], bg[2]);
      if (busy || d > (isDrawing ? 30 : 38)) { mask[i] = 1; count++; }
    }
    if (count < (isDrawing ? 6 : 20)) return null;
    if (!busy) mask = fillHoles(dilate(mask, w, h, 1), w, h);

    // Bounding box of the subject
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const s2 = (N - 4) / Math.max(bw, bh);
    const dw = bw * s2, dh = bh * s2;
    const dx = (N - dw) / 2, dy = (N - dh) / 2;

    // Normalised colour image
    const nc = mk(N, N);
    const nctx = nc.getContext('2d', { willReadFrequently: true });
    nctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    nctx.fillRect(0, 0, N, N);
    nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(c, x0, y0, bw, bh, dx, dy, dw, dh);
    const npx = nctx.getImageData(0, 0, N, N).data;

    // Normalised mask
    const mc = mk(w, h);
    const mctx = mc.getContext('2d', { willReadFrequently: true });
    const mid = mctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = mask[i] ? 0 : 255; mid.data[i * 4] = v; mid.data[i * 4 + 1] = v; mid.data[i * 4 + 2] = v; mid.data[i * 4 + 3] = 255; }
    mctx.putImageData(mid, 0, 0);
    const nm = mk(N, N);
    const nmctx = nm.getContext('2d', { willReadFrequently: true });
    nmctx.fillStyle = '#fff'; nmctx.fillRect(0, 0, N, N);
    nmctx.drawImage(mc, x0, y0, bw, bh, dx, dy, dw, dh);
    const nmpx = nmctx.getImageData(0, 0, N, N).data;
    const m = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) m[i] = nmpx[i * 4] < 128 ? 1 : 0;

    // Edges: Sobel on luminance + silhouette outline
    const lum = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) lum[i] = 0.3 * npx[i * 4] + 0.59 * npx[i * 4 + 1] + 0.11 * npx[i * 4 + 2];
    const e = new Uint8Array(N * N);
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      const gx = -lum[i - N - 1] - 2 * lum[i - 1] - lum[i + N - 1] + lum[i - N + 1] + 2 * lum[i + 1] + lum[i + N + 1];
      const gy = -lum[i - N - 1] - 2 * lum[i - N] - lum[i - N + 1] + lum[i + N - 1] + 2 * lum[i + N] + lum[i + N + 1];
      if (Math.hypot(gx, gy) > 140) e[i] = 1;
      if (m[i] && (!m[i - 1] || !m[i + 1] || !m[i - N] || !m[i + N])) e[i] = 1;
    }

    // Colour histogram + coarse colour layout of the subject
    const hist = new Float32Array(15);
    const G = 6, cell = N / G;
    const grid = Array.from({ length: G * G }, () => [0, 0, 0, 0]);
    let total = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const r = npx[i * 4], g = npx[i * 4 + 1], b = npx[i * 4 + 2];
      const isBg = rgbDist(r, g, b, bg[0], bg[1], bg[2]) < 30;
      if (!m[i] || isBg) continue;
      hist[colorBin(r, g, b)]++;
      total++;
      const gi = Math.floor(y / cell) * G + Math.floor(x / cell);
      grid[gi][0] += r; grid[gi][1] += g; grid[gi][2] += b; grid[gi][3]++;
    }
    if (total) for (let k = 0; k < 15; k++) hist[k] /= total;

    // Interior lines (eyes, mouths, clothing…) = edges away from the silhouette outline
    const rim = new Uint8Array(N * N);
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      if (m[i] && (!m[i - 1] || !m[i + 1] || !m[i - N] || !m[i + N])) rim[i] = 1;
    }
    const rimD = dilate(rim, N, N, 2);
    const inner = new Uint8Array(N * N);
    let edgeCount = 0, innerCount = 0;
    for (let i = 0; i < N * N; i++) {
      edgeCount += e[i];
      if (e[i] && m[i] && !rimD[i]) { inner[i] = 1; innerCount++; }
    }
    return {
      mask: m, edges: e, hist, grid, aspect: bw / bh, coverage: count / (w * h),
      extent: Math.max(bw / w, bh / h), // how much of the canvas the subject spans
      edgeCount, inner, innerCount,
    };
  }

  function compare(a, b) {
    // Silhouette overlap, tolerant of small offsets
    const am = dilate(a.mask, N, N, 2), bm = dilate(b.mask, N, N, 2);
    let inter = 0, uni = 0;
    for (let i = 0; i < N * N; i++) { if (am[i] && bm[i]) inter++; if (am[i] || bm[i]) uni++; }
    const iou = uni ? inter / uni : 0;
    const aspect = Math.min(a.aspect, b.aspect) / Math.max(a.aspect, b.aspect);
    const shape = 0.75 * iou + 0.25 * aspect;

    // Line work: symmetric chamfer distance
    const da = distTransform(a.edges, N, N), db = distTransform(b.edges, N, N);
    let s1 = 0, n1 = 0, s2 = 0, n2 = 0;
    for (let i = 0; i < N * N; i++) {
      if (a.edges[i]) { s1 += Math.min(db[i], 20); n1++; }
      if (b.edges[i]) { s2 += Math.min(da[i], 20); n2++; }
    }
    const cd = ((n1 ? s1 / n1 : 20) + (n2 ? s2 / n2 : 20)) / 2;
    let detail = Math.exp(-cd / 4.2);

    // Interior line work: does the drawing have features where the character has them?
    if (b.innerCount >= 12) {
      const ia = distTransform(a.inner, N, N), ib = distTransform(b.inner, N, N);
      let p1 = 0, m1 = 0, p2 = 0, m2 = 0;
      for (let i = 0; i < N * N; i++) {
        if (b.inner[i]) { p1 += Math.min(ia[i], 20); m1++; }
        if (a.inner[i]) { p2 += Math.min(ib[i], 20); m2++; }
      }
      const icd = ((m1 ? p1 / m1 : 20) + (m2 ? p2 / m2 : 20)) / 2;
      detail = 0.5 * detail + 0.5 * Math.exp(-icd / 4.2);
    }

    // Colour palette similarity (histogram intersection)
    let hi = 0;
    for (let k = 0; k < 15; k++) hi += Math.min(a.hist[k], b.hist[k]);

    // Where colours sit
    let ls = 0, ln = 0;
    for (let k = 0; k < a.grid.length; k++) {
      const p = a.grid[k], q = b.grid[k];
      if (!p[3] && !q[3]) continue;
      ln++;
      if (!p[3] || !q[3]) continue;
      const d = rgbDist(p[0] / p[3], p[1] / p[3], p[2] / p[3], q[0] / q[3], q[1] / q[3], q[2] / q[3]);
      ls += Math.max(0, 1 - d / 200);
    }
    const layout = ln ? ls / ln : 0;
    const color = 0.6 * hi + 0.4 * layout;

    return { shape, detail, color };
  }

  // Generic "zero-effort" drawings. Whatever these score against a character is
  // treated as chance level, so a dot or a circle can't earn points on its own.
  let baselineShapes;
  function genericShapes() {
    if (baselineShapes) return baselineShapes;
    const S = 240;
    const draw = (fn) => { const c = mk(S, S); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, S, S); x.strokeStyle = x.fillStyle = '#111'; x.lineWidth = 6; x.lineCap = 'round'; fn(x); return analyze(c, true); };
    baselineShapes = [
      draw((x) => { x.beginPath(); x.arc(120, 120, 90, 0, 7); x.fill(); }),                 // blob / dot
      draw((x) => { x.beginPath(); x.arc(120, 120, 90, 0, 7); x.stroke(); }),               // circle outline
      draw((x) => { x.beginPath(); x.ellipse(120, 120, 60, 100, 0, 0, 7); x.fill(); }),     // tall blob
      draw((x) => { x.beginPath(); x.ellipse(120, 120, 60, 100, 0, 0, 7); x.stroke(); }),   // tall outline
      draw((x) => { x.fillRect(30, 30, 180, 180); }),                                       // square
      draw((x) => { x.strokeRect(30, 30, 180, 180); }),                                     // box outline
      draw((x) => { x.beginPath(); x.arc(120, 80, 45, 0, 7); x.moveTo(120, 125); x.lineTo(120, 190); x.moveTo(70, 150); x.lineTo(170, 150); x.moveTo(120, 190); x.lineTo(85, 230); x.moveTo(120, 190); x.lineTo(155, 230); x.stroke(); }), // stick figure
      draw((x) => { x.beginPath(); x.arc(120, 120, 90, 0, 7); x.moveTo(95, 100); x.arc(90, 100, 5, 0, 7); x.moveTo(155, 100); x.arc(150, 100, 5, 0, 7); x.moveTo(80, 140); x.quadraticCurveTo(120, 180, 160, 140); x.stroke(); }), // smiley
    ];
    return baselineShapes;
  }

  // Rescale a raw similarity so chance level -> 0 and a near-perfect match -> 1.
  function rel(v, base, ceil) {
    const lo = Math.min(base, ceil - 0.05);
    return Math.min(1, Math.max(0, (v - lo) / (ceil - lo)));
  }

  window.Scoring = {
    analyze,
    score(drawingCanvas, refImg) {
      const d = analyze(drawingCanvas, true);
      if (!d) return { total: 0, shape: 0, detail: 0, color: 0, empty: true };
      const r = analyze(refImg, false);
      if (!r) return { total: 0, shape: 0, detail: 0, color: 0 };
      const raw = compare(d, r);

      // Chance level for this character = best a generic doodle achieves
      const base = { shape: 0, detail: 0, color: 0 };
      for (const g of genericShapes()) {
        const b = compare(g, r);
        for (const k in base) base[k] = Math.max(base[k], b[k]);
      }
      // Never let chance level drop below a sensible floor
      base.shape = Math.max(base.shape, 0.45);
      base.detail = Math.max(base.detail, 0.35);
      base.color = Math.max(base.color, 0.1);

      // Line work is the gate: it is the one thing a blob, dot or scribble can't fake.
      // Outline shape and colours only boost a drawing that already has the right lines.
      const de = rel(raw.detail, base.detail, 0.9);
      const s = rel(raw.shape, base.shape - 0.2, 0.97);
      const c = rel(raw.color, base.color, 0.75);
      let t = Math.pow(de, 1.3) * (0.55 + 0.25 * s + 0.2 * c);

      // Effort: tiny drawings and drawings with far less line work than the character lose points
      const sizeF = Math.min(1, d.extent / 0.35);
      const inkF = Math.min(1, (d.edgeCount / Math.max(1, r.edgeCount)) / 0.35);
      t *= Math.pow(sizeF, 1.5) * (0.4 + 0.6 * inkF);

      const pct = (v) => Math.round(100 * Math.pow(v, 0.8));
      const total = Math.max(0, Math.min(100, pct(t)));
      return { total, shape: pct(s), detail: pct(de), color: pct(c), raw, base };
    },
  };
})();
