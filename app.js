(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const ALL = window.CHARACTERS;
  const ROUND_SECONDS = 60;
  const STORE = 'dtc:v1';

  // ---------- persistent state ----------
  const store = (() => {
    let s;
    try { s = JSON.parse(localStorage.getItem(STORE)) || {}; } catch { s = {}; }
    s.played ||= 0; s.best ||= 0; s.sum ||= 0; s.history ||= []; s.recent ||= [];
    s.cats ||= []; s.muted ||= false; s.daily ||= {};
    return s;
  })();
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(store)); } catch { store.history = store.history.slice(0, 8); try { localStorage.setItem(STORE, JSON.stringify(store)); } catch {} } };

  // ---------- sound ----------
  let actx;
  function tone(freq, dur = 0.12, type = 'sine', vol = 0.15, delay = 0, slide) {
    if (store.muted) return;
    try {
      actx ||= new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime + delay;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch {}
  }
  const sfx = {
    click: () => tone(660, 0.06, 'triangle', 0.08),
    tick: () => tone(1200, 0.05, 'square', 0.05),
    count: () => tone(520, 0.15, 'triangle', 0.15),
    go: () => { tone(784, 0.12, 'triangle', 0.18); tone(1046, 0.25, 'triangle', 0.18, 0.1); },
    buzzer: () => { tone(220, 0.5, 'sawtooth', 0.12, 0, 110); },
    whoosh: () => tone(300, 0.35, 'sine', 0.12, 0, 900),
    blip: (p) => tone(300 + p * 9, 0.04, 'square', 0.035),
    fanfare: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.14, i * 0.11)),
    sad: () => [392, 349, 311].forEach((f, i) => tone(f, 0.3, 'triangle', 0.12, i * 0.2)),
    land: () => tone(880, 0.2, 'triangle', 0.15, 0, 1320),
  };
  const muteBtn = $('#muteBtn');
  const syncMute = () => { muteBtn.textContent = store.muted ? '🔇' : '🔊'; };
  muteBtn.onclick = () => { store.muted = !store.muted; save(); syncMute(); sfx.click(); };
  syncMute();

  // ---------- screens ----------
  function show(id) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    window.scrollTo(0, 0);
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200);
  }

  // ---------- home ----------
  const CATS = [...new Set(ALL.map((c) => c.c))];
  const CAT_EMOJI = { 'Classic Cartoons': '📺', 'Disney & Pixar': '🏰', 'TV Cartoons': '🛋️', Anime: '🌸', 'Video Games': '🎮' };
  function renderCats() {
    const box = $('#cats');
    box.innerHTML = '';
    const mk = (label, on, fn) => {
      const b = document.createElement('button');
      b.className = 'chip' + (on ? ' on' : '');
      b.textContent = label; b.onclick = () => { fn(); sfx.click(); renderCats(); };
      box.appendChild(b);
    };
    mk(`✨ Everything (${ALL.length})`, store.cats.length === 0, () => (store.cats = []));
    for (const c of CATS) {
      const n = ALL.filter((x) => x.c === c).length;
      mk(`${CAT_EMOJI[c] || ''} ${c} (${n})`, store.cats.includes(c), () => {
        store.cats = store.cats.includes(c) ? store.cats.filter((x) => x !== c) : [...store.cats, c];
        if (store.cats.length === CATS.length) store.cats = [];
      });
    }
    save();
  }
  function renderStats() {
    const avg = store.played ? Math.round(store.sum / store.played) : 0;
    $('#stats').innerHTML = store.played
      ? `<div class="stat"><b>${store.played}</b><span>Drawn</span></div>
         <div class="stat"><b>${store.best}%</b><span>Best</span></div>
         <div class="stat"><b>${avg}%</b><span>Average</span></div>`
      : '';
    const today = todayKey();
    const d = store.daily[today];
    $('#dailyBtn').textContent = d != null ? `📅 Daily done: ${d}%` : '📅 Daily Challenge';
  }
  function renderGallery() {
    const g = $('#gallery');
    $('#galleryWrap').hidden = !store.history.length;
    g.innerHTML = '';
    store.history.forEach((h) => {
      const b = document.createElement('button');
      b.className = 'g-item';
      b.innerHTML = `<img alt="" /><div class="g-meta"><span></span><span>${h.score}%</span></div>`;
      b.querySelector('img').src = h.drawing;
      b.querySelector('.g-meta span').textContent = h.name;
      b.onclick = () => openModal(h);
      g.appendChild(b);
    });
  }
  function openModal(h) {
    $('#modalTitle').textContent = h.name;
    $('#modalYour').src = h.drawing;
    $('#modalRef').src = h.img;
    $('#modalScore').textContent = `${h.score}% match`;
    $('#modal').hidden = false;
  }
  $('#modalClose').onclick = () => ($('#modal').hidden = true);
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; };
  function goHome() {
    stopTimer();
    renderCats(); renderStats(); renderGallery();
    show('home');
  }

  // ---------- picking characters ----------
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function pool() { return store.cats.length ? ALL.filter((c) => store.cats.includes(c.c)) : ALL; }
  function pickRandom(exclude = []) {
    const p = pool();
    const fresh = p.filter((c) => !store.recent.includes(c.n) && !exclude.includes(c.n));
    const from = fresh.length ? fresh : p;
    return from[Math.floor(Math.random() * from.length)];
  }

  function loadImg(url) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.decoding = 'async';
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
      setTimeout(() => rej(new Error('timeout')), 12000);
    });
  }
  async function loadCharImage(ch) {
    try { return await loadImg(ch.img); } catch {}
    // fall back to asking Wikipedia for the current page image
    const api = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&redirects=1&prop=pageimages&pilicense=any&pithumbsize=480&titles=${encodeURIComponent(ch.w)}`;
    const j = await (await fetch(api)).json();
    const src = j?.query?.pages?.[0]?.thumbnail?.source;
    if (!src) throw new Error('no image');
    return loadImg(src);
  }

  // ---------- round flow ----------
  const game = { ch: null, img: null, daily: false, attempt: 0 };

  async function startRound(daily = false) {
    game.daily = daily;
    show('intro');
    $('#introActions').classList.remove('show');
    $('#rerollBtn').hidden = daily;
    $('#introLabel').textContent = daily ? `Daily challenge · ${todayKey()}` : 'Your character is…';
    $('#introCat').textContent = '';
    const slot = $('#slotName');
    slot.classList.remove('landed'); slot.classList.add('spinning');

    // spin names while the reference image preloads
    let spinning = true;
    const names = pool();
    (async function spin() {
      let delay = 55;
      while (spinning) {
        slot.textContent = names[Math.floor(Math.random() * names.length)].n;
        sfx.blip(20 + Math.random() * 30);
        await new Promise((r) => setTimeout(r, delay));
      }
    })();
    const started = performance.now();
    const tried = [];
    let ch, img;
    for (let i = 0; i < 6 && !img; i++) {
      if (daily && i === 0) ch = ALL[hash('dtc-' + todayKey()) % ALL.length];
      else ch = pickRandom(tried);
      tried.push(ch.n);
      try { img = await loadCharImage(ch); } catch { img = null; }
    }
    const wait = 1300 - (performance.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    spinning = false;
    if (!$('#intro').classList.contains('active')) return; // user left
    slot.classList.remove('spinning');
    if (!img) {
      slot.textContent = 'Connection trouble 😵';
      $('#introCat').textContent = 'Could not reach Wikipedia — check your internet';
      $('#introActions').classList.add('show');
      $('#readyBtn').hidden = true;
      return;
    }
    $('#readyBtn').hidden = false;
    game.ch = ch; game.img = img;
    slot.textContent = ch.n;
    void slot.offsetWidth; slot.classList.add('landed');
    $('#introCat').textContent = `${CAT_EMOJI[ch.c] || ''} ${ch.c}`;
    sfx.land();
    $('#introActions').classList.add('show');
  }

  $('#playBtn').onclick = () => { sfx.click(); startRound(false); };
  $('#dailyBtn').onclick = () => {
    sfx.click();
    const d = store.daily[todayKey()];
    if (d != null) { toast(`You scored ${d}% today. New character tomorrow!`); return; }
    startRound(true);
  };
  $('#rerollBtn').onclick = () => { sfx.whoosh(); startRound(false); };
  $('#introHome').onclick = goHome;
  $('#readyBtn').onclick = () => { sfx.click(); countdown(); };

  async function countdown() {
    const cd = $('#countdown'), num = $('#countNum');
    resetCanvas();
    $('#drawName').textContent = game.ch.n;
    show('draw');
    setTimerUI(ROUND_SECONDS);
    cd.hidden = false;
    for (const n of ['3', '2', '1', 'GO!']) {
      num.textContent = n;
      num.style.animation = 'none'; void num.offsetWidth; num.style.animation = '';
      n === 'GO!' ? sfx.go() : sfx.count();
      await new Promise((r) => setTimeout(r, n === 'GO!' ? 550 : 750));
    }
    cd.hidden = true;
    startTimer();
  }

  // ---------- timer ----------
  let timerRaf = 0, endAt = 0, lastSec = 0, drawing = false;
  const RING = 276.46;
  function setTimerUI(left) {
    const s = Math.ceil(left);
    $('#timerText').textContent = s;
    $('#timerRing').style.strokeDashoffset = RING * (1 - left / ROUND_SECONDS);
    const t = $('#timer');
    t.classList.toggle('warn', s <= 20 && s > 10);
    t.classList.toggle('danger', s <= 10);
  }
  function startTimer() {
    drawing = true;
    endAt = performance.now() + ROUND_SECONDS * 1000;
    lastSec = ROUND_SECONDS;
    const loop = () => {
      const left = Math.max(0, (endAt - performance.now()) / 1000);
      setTimerUI(left);
      const s = Math.ceil(left);
      if (s !== lastSec) { lastSec = s; if (s <= 10 && s > 0) sfx.tick(); }
      if (left <= 0) { finish(true); return; }
      timerRaf = requestAnimationFrame(loop);
    };
    timerRaf = requestAnimationFrame(loop);
  }
  function stopTimer() { cancelAnimationFrame(timerRaf); drawing = false; }

  async function finish(timeUp) {
    if (!drawing) return;
    stopTimer();
    endStroke();
    const stamp = $('#stamp');
    stamp.textContent = timeUp ? "TIME'S UP!" : 'DONE!';
    stamp.classList.add('show');
    timeUp ? sfx.buzzer() : sfx.go();
    await new Promise((r) => setTimeout(r, 1100));
    stamp.classList.remove('show');
    reveal();
  }
  $('#doneBtn').onclick = () => finish(false);

  // ---------- canvas ----------
  const pad = $('#pad');
  const ctx = pad.getContext('2d', { willReadFrequently: true });
  const COLORS = ['#111111', '#ffffff', '#7a7a7a', '#e53935', '#ff8a3d', '#ffd23f', '#fff3a0', '#43c463',
    '#1e7a3c', '#3ddcff', '#1e5fd6', '#13235e', '#9b6bff', '#ff5c8a', '#f7c6a5', '#8b5a2b'];
  const brush = { tool: 'pen', size: 10, color: '#111111' };
  const undo = [];
  function resetCanvas() {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, pad.width, pad.height);
    undo.length = 0;
    $('#stamp').classList.remove('show');
  }
  function pushUndo() {
    undo.push(ctx.getImageData(0, 0, pad.width, pad.height));
    if (undo.length > 25) undo.shift();
  }
  const palette = $('#palette');
  COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (c === brush.color ? ' active' : '');
    b.style.background = c; b.title = c; b.setAttribute('aria-label', 'Color ' + c);
    b.onclick = () => {
      brush.color = c;
      if (brush.tool === 'eraser') setTool('pen');
      $$('.swatch').forEach((s) => s.classList.toggle('active', s === b));
      sfx.click();
    };
    palette.appendChild(b);
  });
  function setTool(t) {
    brush.tool = t;
    $$('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  }
  $$('.tool[data-tool]').forEach((b) => (b.onclick = () => { setTool(b.dataset.tool); sfx.click(); }));
  $$('.size').forEach((b) => (b.onclick = () => {
    brush.size = +b.dataset.size;
    $$('.size').forEach((x) => x.classList.toggle('active', x === b));
    if (brush.tool === 'fill') setTool('pen');
    sfx.click();
  }));
  function doUndo() { if (!drawing || !undo.length) return; ctx.putImageData(undo.pop(), 0, 0); sfx.click(); }
  $('#undoBtn').onclick = doUndo;
  $('#clearBtn').onclick = () => { if (!drawing) return; pushUndo(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pad.width, pad.height); sfx.whoosh(); };
  document.addEventListener('keydown', (e) => {
    if (!$('#draw').classList.contains('active')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
    else if (e.key === 'b') setTool('pen');
    else if (e.key === 'e') setTool('eraser');
    else if (e.key === 'f') setTool('fill');
  });

  let stroke = null;
  function pos(e) {
    const r = pad.getBoundingClientRect();
    return [(e.clientX - r.left) * (pad.width / r.width), (e.clientY - r.top) * (pad.height / r.height)];
  }
  function seg(a, b) {
    ctx.strokeStyle = brush.tool === 'eraser' ? '#ffffff' : brush.color;
    ctx.lineWidth = brush.size * (brush.tool === 'eraser' ? 2 : 1);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  pad.addEventListener('pointerdown', (e) => {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    pushUndo();
    if (brush.tool === 'fill') { floodFill(Math.floor(p[0]), Math.floor(p[1]), brush.color); sfx.click(); return; }
    pad.setPointerCapture(e.pointerId);
    stroke = { last: p };
    seg(p, [p[0] + 0.01, p[1]]);
  });
  pad.addEventListener('pointermove', (e) => {
    if (!stroke || !drawing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = pos(ev);
      // light smoothing
      const q = [stroke.last[0] * 0.25 + p[0] * 0.75, stroke.last[1] * 0.25 + p[1] * 0.75];
      seg(stroke.last, q);
      stroke.last = q;
    }
  });
  function endStroke() { stroke = null; }
  pad.addEventListener('pointerup', endStroke);
  pad.addEventListener('pointercancel', endStroke);

  function floodFill(x, y, hex) {
    const W = pad.width, H = pad.height;
    const id = ctx.getImageData(0, 0, W, H), d = id.data;
    const fr = parseInt(hex.slice(1, 3), 16), fg = parseInt(hex.slice(3, 5), 16), fb = parseInt(hex.slice(5, 7), 16);
    const i0 = (y * W + x) * 4;
    const sr = d[i0], sg = d[i0 + 1], sb = d[i0 + 2];
    if (Math.abs(sr - fr) + Math.abs(sg - fg) + Math.abs(sb - fb) < 10) return;
    const tol = 90;
    const match = (i) => Math.abs(d[i] - sr) + Math.abs(d[i + 1] - sg) + Math.abs(d[i + 2] - sb) <= tol;
    const seen = new Uint8Array(W * H);
    const stack = [[x, y]];
    const filled = [];
    while (stack.length) {
      let [cx, cy] = stack.pop();
      let i = cy * W + cx;
      while (cx >= 0 && !seen[i] && match(i * 4)) { cx--; i--; }
      cx++; i++;
      let up = false, down = false;
      while (cx < W && !seen[i] && match(i * 4)) {
        seen[i] = 1; filled.push(i);
        d[i * 4] = fr; d[i * 4 + 1] = fg; d[i * 4 + 2] = fb;
        if (cy > 0) { const u = i - W; const ok = !seen[u] && match(u * 4); if (ok && !up) { stack.push([cx, cy - 1]); up = true; } else if (!ok) up = false; }
        if (cy < H - 1) { const v = i + W; const ok = !seen[v] && match(v * 4); if (ok && !down) { stack.push([cx, cy + 1]); down = true; } else if (!ok) down = false; }
        cx++; i++;
      }
    }
    // grow 1px into anti-aliased edges so fills don't leave halos
    for (const i of filled) {
      for (const n of [i - 1, i + 1, i - W, i + W]) {
        if (n < 0 || n >= W * H || seen[n]) continue;
        const k = n * 4;
        const lum = d[k] + d[k + 1] + d[k + 2];
        if (lum > 200) { d[k] = fr; d[k + 1] = fg; d[k + 2] = fb; seen[n] = 1; }
      }
    }
    ctx.putImageData(id, 0, 0);
  }

  // ---------- reveal ----------
  const VERDICTS = [
    [92, 'Are you an animator?! 🤯'],
    [80, 'Nailed it! 🎯'],
    [68, 'Super recognizable! 🔥'],
    [55, 'Yeah, we see it! 👀'],
    [42, 'Squint and it works 😅'],
    [30, 'Abstract interpretation 🎨'],
    [18, 'A bold artistic choice… 🫠'],
    [0, 'Who is that?! 😂'],
  ];
  async function reveal() {
    const drawingURL = pad.toDataURL('image/png');
    $('#yourImg').src = drawingURL;
    $('#refImg').src = game.img.src;
    $('#refName').textContent = game.ch.n;
    $('#refLink').href = `https://en.wikipedia.org/wiki/${encodeURIComponent(game.ch.w.replace(/ /g, '_'))}`;
    $('#revealTitle').textContent = 'The moment of truth…';
    const card = $('#refCard'); card.classList.remove('open');
    const box = $('#scoreBox'); box.classList.remove('show');
    $('#bestFlag').hidden = true;
    ['Shape', 'Detail', 'Color'].forEach((k) => { $('#bar' + k).style.width = '0'; $('#val' + k).textContent = '0'; });
    $('#scoreNum').textContent = '0'; $('#verdict').innerHTML = '&nbsp;';
    $$('.reveal-actions .btn').forEach((b) => (b.disabled = true));
    show('reveal');

    let result;
    try { result = Scoring.score(pad, game.img); } catch (e) { console.error(e); result = { total: 0, shape: 0, detail: 0, color: 0 }; }
    const s = result.total;
    window.__lastResult = result;

    await sleep(700);
    sfx.whoosh(); card.classList.add('open');
    $('#revealTitle').textContent = `It's ${game.ch.n}!`;
    await sleep(900);
    box.classList.add('show');
    await sleep(300);
    // count up
    const dur = 1400 + s * 12, t0 = performance.now();
    let lastShown = -1;
    await new Promise((res) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / dur);
        const v = Math.round(s * (1 - Math.pow(1 - t, 3)));
        if (v !== lastShown) { lastShown = v; $('#scoreNum').textContent = v; if (v % 2 === 0) sfx.blip(v); }
        t < 1 ? requestAnimationFrame(step) : res();
      };
      requestAnimationFrame(step);
    });
    $('#barShape').style.width = result.shape + '%'; $('#valShape').textContent = result.shape;
    $('#barDetail').style.width = result.detail + '%'; $('#valDetail').textContent = result.detail;
    $('#barColor').style.width = result.color + '%'; $('#valColor').textContent = result.color;
    $('#verdict').textContent = result.empty ? 'You… didn\'t draw anything 🙃' : VERDICTS.find(([min]) => s >= min)[1];

    // record
    const prevBest = store.best;
    store.played++; store.sum += s; store.best = Math.max(store.best, s);
    store.recent = [game.ch.n, ...store.recent.filter((n) => n !== game.ch.n)].slice(0, 60);
    if (game.daily) store.daily = { [todayKey()]: s };
    store.history.unshift({ name: game.ch.n, score: s, img: game.img.src, drawing: thumb(), t: Date.now() });
    store.history = store.history.slice(0, 24);
    save();

    if (s > prevBest && store.played > 1) $('#bestFlag').hidden = false;
    if (s >= 55) { sfx.fanfare(); confetti(s >= 75 ? 220 : 110); } else if (s < 30) sfx.sad(); else sfx.land();
    $$('.reveal-actions .btn').forEach((b) => (b.disabled = false));
    $('#nextBtn').textContent = game.daily ? 'Keep playing ▶' : 'Next character ▶';
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function thumb() {
    const c = document.createElement('canvas'); c.width = c.height = 220;
    c.getContext('2d').drawImage(pad, 0, 0, 220, 220);
    return c.toDataURL('image/jpeg', 0.75);
  }
  $('#nextBtn').onclick = () => { sfx.click(); startRound(false); };
  $('#homeBtn').onclick = () => { sfx.click(); goHome(); };

  // ---------- share card ----------
  $('#shareBtn').onclick = async () => {
    sfx.click();
    const last = store.history[0];
    const c = document.createElement('canvas'); c.width = 1200; c.height = 630;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 1200, 630); g.addColorStop(0, '#3a1f9a'); g.addColorStop(1, '#16103f');
    x.fillStyle = g; x.fillRect(0, 0, 1200, 630);
    const frame = (img, fx, fy, rot) => {
      x.save(); x.translate(fx + 200, fy + 200); x.rotate(rot);
      x.fillStyle = '#160f33'; roundRect(x, -192, -192, 400, 400, 28); x.fill();
      x.fillStyle = '#fff'; roundRect(x, -200, -200, 400, 400, 28); x.fill();
      x.lineWidth = 6; x.strokeStyle = '#160f33'; x.stroke();
      const sc = Math.min(370 / (img.naturalWidth || img.width), 370 / (img.naturalHeight || img.height));
      const w = (img.naturalWidth || img.width) * sc, h = (img.naturalHeight || img.height) * sc;
      x.save(); roundRect(x, -194, -194, 388, 388, 24); x.clip();
      x.drawImage(img, -w / 2, -h / 2, w, h); x.restore();
      x.restore();
    };
    frame(pad, 70, 150, -0.04);
    frame(game.img, 730, 150, 0.04);
    x.textAlign = 'center';
    x.font = '700 54px Fredoka, sans-serif'; x.fillStyle = '#ffd23f';
    x.lineWidth = 8; x.strokeStyle = '#160f33';
    x.strokeText('Draw That Character!', 600, 82); x.fillText('Draw That Character!', 600, 82);
    x.font = '700 30px Nunito, sans-serif'; x.fillStyle = '#fff8ec';
    x.fillText(`I drew ${game.ch.n} from memory in 60s`, 600, 128);
    x.font = '700 120px Fredoka, sans-serif'; x.fillStyle = '#ff5c8a';
    x.strokeText(`${last.score}%`, 600, 400); x.fillText(`${last.score}%`, 600, 400);
    x.font = '800 26px Nunito, sans-serif'; x.fillStyle = '#fff8ec';
    x.fillText('match', 600, 440);
    x.font = '800 24px Nunito, sans-serif'; x.fillStyle = 'rgba(255,248,236,.7)';
    x.fillText('Can you beat me? ' + location.host, 600, 600);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'draw-that-character.png', { type: 'image/png' });
    const text = `I drew ${game.ch.n} from memory and got ${last.score}% 🎨 Can you beat me?`;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text, url: location.origin }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Saved your side-by-side image!');
  };
  function roundRect(x, X, Y, w, h, r) {
    x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r);
    x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath();
  }

  // ---------- confetti ----------
  const cv = $('#confetti'), cx = cv.getContext('2d');
  let parts = [], confRaf = 0;
  function confetti(n) {
    cv.width = innerWidth; cv.height = innerHeight;
    const cols = ['#ffd23f', '#ff5c8a', '#3ddcff', '#5ce39a', '#9b6bff', '#ff8a3d'];
    for (let i = 0; i < n; i++) parts.push({
      x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.55,
      vx: (Math.random() - 0.5) * 18, vy: -Math.random() * 18 - 6, r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4, w: 6 + Math.random() * 8, h: 4 + Math.random() * 6, c: cols[i % cols.length], life: 0,
    });
    cancelAnimationFrame(confRaf);
    const tick = () => {
      cx.clearRect(0, 0, cv.width, cv.height);
      parts = parts.filter((p) => p.y < cv.height + 40 && p.life < 400);
      for (const p of parts) {
        p.vy += 0.45; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); cx.restore();
      }
      if (parts.length) confRaf = requestAnimationFrame(tick); else cx.clearRect(0, 0, cv.width, cv.height);
    };
    tick();
  }

  // warn before leaving mid-drawing
  window.addEventListener('beforeunload', (e) => { if (drawing) { e.preventDefault(); e.returnValue = ''; } });

  goHome();
})();
