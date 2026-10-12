(() => {
  'use strict';

  /* Endereços a definir. Enquanto checkoutUrl for null, os botões de compra mostram um aviso de prévia. */
  const CONFIG = { checkoutUrl: null, siteUrl: null };

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const smoothstep = (p, e0, e1) => { const t = clamp((p - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const root = document.documentElement;
  /* Movimento reduzido: o Windows (ou o celular) pode pedir menos movimento. O site respeita,
     mas mostra um botão para a pessoa ligar as animações se quiser; a escolha fica guardada.
     mqRM.matches = o sistema pede menos movimento E a pessoa não ligou as animações. */
  const mqOS = matchMedia('(prefers-reduced-motion: reduce)');
  const MOTION_KEY = 'geraenem-animacoes';
  let motionOptIn = false;
  try { motionOptIn = localStorage.getItem(MOTION_KEY) === '1'; } catch (_) {}
  const mqRM = { _l: [], get matches() { return mqOS.matches && !motionOptIn; }, addEventListener(t, f) { this._l.push(f); } };
  const fireRM = () => mqRM._l.forEach(f => f({ matches: mqRM.matches }));
  if (mqOS.addEventListener) mqOS.addEventListener('change', fireRM); else if (mqOS.addListener) mqOS.addListener(fireRM);
  root.classList.toggle('motion-on', motionOptIn);
  function setMotion(on) {
    motionOptIn = on;
    try { if (on) localStorage.setItem(MOTION_KEY, '1'); else localStorage.removeItem(MOTION_KEY); } catch (_) {}
    root.classList.toggle('motion-on', on);
    fireRM();
  }
  const FINE = matchMedia('(pointer: fine)').matches;
  const shareUrl = () => CONFIG.siteUrl || location.href.split('#')[0];

  /* Diagnóstico: abra o site com ?diag=1 no fim do endereço para ver, no próprio aparelho,
     por que alguma animação não roda. Invisível para os visitantes. */
  const DIAG = /[?&]diag=1/.test(location.search);
  const diagErrs = [];
  if (DIAG) {
    addEventListener('error', e => diagErrs.push((e.message || 'erro') + ' (linha ' + (e.lineno || '?') + ')'));
    addEventListener('unhandledrejection', e => diagErrs.push('promessa: ' + ((e.reason && e.reason.message) || e.reason)));
    const box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:9999;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.86);color:#fff;font:12px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap;pointer-events:none';
    const yes = v => (v ? 'sim' : 'não');
    const val = f => { try { return f(); } catch (_) { return '?'; } };
    const draw = () => {
      if (!box.isConnected && document.body) document.body.appendChild(box);
      box.textContent = [
        'DIAGNÓSTICO GERA ENEM',
        'Sistema pede menos movimento: ' + val(() => yes(matchMedia('(prefers-reduced-motion: reduce)').matches)),
        'Animações ligadas pelo botão: ' + val(() => yes(motionOptIn)),
        'Filme da abertura ligado: ' + val(() => yes(scrubOn)),
        'Quadros: ' + val(() => H.set + ' ' + H.loaded + '/' + N + (H.failed ? ' (' + H.failed + ' falharam)' : '')),
        'Quadro na tela: ' + val(() => H.drawn) + ' · rolagem ' + val(() => Math.round(H.shown * 100)) + '%',
        'Palco preso na tela: ' + val(() => { const r = pin.getBoundingClientRect(); return r.top < -10 && r.bottom > innerHeight ? yes(Math.abs(stage.getBoundingClientRect().top) < 2) : 'fora da abertura'; }),
        'Entradas nativas por rolagem: ' + val(() => yes(RV_NATIVE)),
        'Tela: ' + innerWidth + '×' + innerHeight + ' · densidade ' + (devicePixelRatio || 1),
        'Navegador: ' + navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 120),
        'Erros: ' + (diagErrs.length ? diagErrs.slice(-3).join(' | ') : 'nenhum')
      ].join('\n');
    };
    setInterval(draw, 400);
  }
  // altura real do menu (cresceu com o logo maior): medida na tela e passada ao CSS em --nav-h
  let NAV_H = 68;
  const measureNav = () => {
    const n = document.getElementById('nav');
    if (!n) return;
    const h = Math.round(n.getBoundingClientRect().height) || 68;
    if (h !== NAV_H || !root.style.getPropertyValue('--nav-h')) { NAV_H = h; root.style.setProperty('--nav-h', h + 'px'); }
  };
  measureNav();
  addEventListener('resize', measureNav);
  addEventListener('load', measureNav);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureNav);

  /* ================= laço único que descansa ================= */
  const P = { x: -1, y: -1, t: 0 };
  let rafId = null, lastTick = 0;
  const tickers = [];
  function kick() { if (rafId === null) rafId = requestAnimationFrame(tick); }
  function tick(now) {
    const dt = Math.min(100, now - (lastTick || now)); lastTick = now;
    let busy = false;
    for (const f of tickers) busy = f(now, dt) || busy;
    if (busy) rafId = requestAnimationFrame(tick); else { rafId = null; lastTick = 0; }
  }
  const follow = (k, dt) => 1 - Math.pow(1 - k, dt / 16.667);
  addEventListener('scroll', kick, { passive: true });
  addEventListener('pointermove', e => { P.x = e.clientX; P.y = e.clientY; P.t = performance.now(); kick(); }, { passive: true });
  addEventListener('resize', () => { heroSize(); kick(); });
  document.addEventListener('visibilitychange', () => document.body.classList.toggle('paused', document.hidden));

  /* ================= divisão de texto (uma vez) ================= */
  function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  function splitText(el, mode, seed) {
    const r = rng(seed);
    const full = el.textContent.replace(/\s+/g, ' ').trim();
    const words = [];
    el.childNodes.forEach(n => {
      const em = n.nodeType === 1 && n.classList.contains('em');
      (n.textContent || '').split(/\s+/).filter(Boolean).forEach(w => words.push({ w, em }));
    });
    const vis = document.createElement('span'); vis.className = 'vis'; vis.setAttribute('aria-hidden', 'true');
    let charTotal = words.reduce((s, x) => s + x.w.length, 0), ci = 0;
    words.forEach((x, i) => {
      const ws = document.createElement('span'); ws.className = 'w' + (x.em ? ' em' : '');
      if (mode === 'scatter') {
        [...x.w].forEach(ch => {
          const c = document.createElement('span'); c.className = 'c'; c.textContent = ch;
          c.style.setProperty('--th', (r() * 0.55).toFixed(3));
          c.style.setProperty('--jx', ((r() - 0.5) * 120).toFixed(1) + 'px');
          c.style.setProperty('--jy', ((r() - 0.5) * 90).toFixed(1) + 'px');
          c.style.setProperty('--jr', ((r() - 0.5) * 50).toFixed(1) + 'deg');
          ws.appendChild(c); ci++;
        });
      } else {
        ws.textContent = x.w;
        const spread = mode === 'rise' ? 0.5 : mode === 'punch' ? 0.42 : 0.45;
        ws.style.setProperty('--th', (i / Math.max(1, words.length) * spread + r() * 0.04).toFixed(3));
      }
      vis.appendChild(ws);
      if (i < words.length - 1) vis.appendChild(document.createTextNode(' '));
    });
    const sr = document.createElement('span'); sr.className = 'sr'; sr.textContent = full;
    el.textContent = ''; el.appendChild(sr); el.appendChild(vis);
  }

  /* ================= entradas ao rolar onde não há animação por rolagem no CSS ================= */
  // iPhone antes do iOS 26 e Firefox não têm animation-timeline: as seções entravam paradas.
  // Aqui um observador marca .in quando cada bloco entra na tela e o CSS faz a transição.
  const RV_NATIVE = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: view()'));
  // Só em celular e tablet (tela de toque): no computador o site fica exatamente como era.
  const RV_FALLBACK = !RV_NATIVE && matchMedia('(pointer: coarse)').matches;
  if (RV_FALLBACK) {
    const rvIO = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); rvIO.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px', threshold: 0 });
    $$('.rv, .kicker--q').forEach(el => rvIO.observe(el));
  }
  const syncRvIO = () => root.classList.toggle('rv-io', RV_FALLBACK && !mqRM.matches);
  syncRvIO();

  /* ================= imagens: prévia borrada, prioridade e aquecimento ================= */
  // As fotos abaixo do hero mostram uma prévia borrada na hora e trocam pela foto quando ela chega.
  // Elas são pedidas com prioridade alta quando faltam ~3 telas para chegar nelas, e todas são
  // aquecidas logo depois do começo do filme do hero. Se a pessoa rolou para longe do hero, os
  // quadros do filme esperam as fotos terminarem para não disputar a conexão com elas.
  const lazyImgs = $$('img.lz');
  // No celular as fotos de "Professor e aluno" ficam escondidas: não são baixadas nem esperadas.
  const PHONE = matchMedia('(max-width: 640px)');
  const hiddenOnPhone = img => PHONE.matches && !!img.closest('.person__img');
  let imgPending = lazyImgs.filter(img => !hiddenOnPhone(img)).length, heroParked = 0, warmed = false;
  const imgDone = img => {
    if (img.dataset.ok) return; img.dataset.ok = '1'; img.classList.add('in');
    if (--imgPending <= 0) resumeHero();
  };
  const boostImg = img => {
    if (img.dataset.go || hiddenOnPhone(img)) return; img.dataset.go = '1';
    try { img.fetchPriority = 'high'; } catch (_) {}
    img.loading = 'eager';
  };
  lazyImgs.forEach(img => {
    if (img.complete && img.naturalWidth) imgDone(img);
    else { img.addEventListener('load', () => imgDone(img), { once: true }); img.addEventListener('error', () => imgDone(img), { once: true }); }
  });
  const imgIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { boostImg(e.target); imgIO.unobserve(e.target); } }), { rootMargin: '2400px 0px' });
  lazyImgs.forEach(img => imgIO.observe(img));
  function warmImages() { if (warmed) return; warmed = true; lazyImgs.forEach(boostImg); }
  setTimeout(warmImages, 2000);
  const heroFar = () => imgPending > 0 && hero.getBoundingClientRect().bottom < -innerHeight * 0.5;
  function resumeHero() { if (!heroParked || !H.next) return; const n = heroParked; heroParked = 0; for (let k = 0; k < n; k++) H.next(); }
  addEventListener('scroll', () => { if (heroParked && !heroFar()) resumeHero(); }, { passive: true });

  /* ================= HERO: quadros guiados pela rolagem ================= */
  const hero = $('#topo'), pin = $('.hero__pin'), stage = $('.hero__stage');
  const cv = $('.hero__cv'), ctx = cv.getContext('2d');
  const cue = $('.hero__cue'), ringP = $('.ring__p'), cueT = $('.cue__t');
  const bands = $$('.band').map((el, i) => {
    const t = $('.band__t', el);
    splitText(t, el.dataset.fx, 7 + i * 31);
    return { el, a: +el.dataset.a, b: +el.dataset.b, ramp: el.dataset.ramp ? +el.dataset.ramp : 0, op: -1, k: -1, on: null, first: i === 0, last: false };
  });
  bands[bands.length - 1].last = true;
  const N = 145;
  const LUT = [0.0,3.1,6.46,10.48,15.18,21.31,27.99,34.45,40.41,45.74,50.96,55.59,60.02,64.3,68.55,72.87,77.1,81.09,84.73,88.37,91.88,95.49,99.03,102.52,105.96,109.13,112.18,114.95,117.53,120.06,122.56,125.06,127.52,129.97,132.17,134.27,136.28,138.29,140.14,142.12,144.0];
  const H = { set: '', target: 0, shown: 0, imgs: new Array(N), loaded: 0, failed: 0, drawn: -1, w: 0, h: 0, started: false, loadK: 0, loadStart: 0, edge: -1, cueOp: -1, ld: -1 };
  /* Portões do hero estático (iguais aos do CSS). Celulares em pé agora rolam o filme com quadros verticais. */
  const GATES = [
    '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)'
  ];
  const PORTRAIT = matchMedia('(max-aspect-ratio: 9/10)');
  const frameSet = () => (PORTRAIT.matches ? 'hero-m' : 'hero');
  const MQLS = GATES.map(q => matchMedia(q));
  let scrubOn = false;

  function heroProgress() {
    const r = pin.getBoundingClientRect();
    const span = Math.max(1, pin.offsetHeight - stage.offsetHeight);
    return clamp(-r.top / span, 0, 1);
  }
  function frameFor(p) {
    const q = clamp(p / 0.95, 0, 1);
    const x = q * (LUT.length - 1), i = Math.floor(x), f = x - i;
    const motion = i >= LUT.length - 1 ? LUT[LUT.length - 1] : lerp(LUT[i], LUT[i + 1], f);
    return clamp(Math.round(lerp(q * (N - 1), motion, 0.5)), 0, N - 1);
  }
  function heroSize() {
    if (!scrubOn) return;
    const set = frameSet();
    if (set !== H.set) {
      H.set = set; H.imgs = new Array(N); H.loaded = 0; H.failed = 0; H.started = false; H.drawn = -1; H.ld = -1;
      cv.classList.remove('ready'); loadFrames();
    }
    const dpr = Math.min(1.5, devicePixelRatio || 1);
    const w = stage.clientWidth, h = stage.clientHeight;
    if (w === H.w && h === H.h) return;
    H.w = w; H.h = h; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); H.drawn = -1;
  }
  function drawFrame(idx) {
    let im = H.imgs[idx];
    if (!im) for (let d = 1; d < N && !im; d++) im = H.imgs[idx - d] || H.imgs[idx + d];
    if (!im) return false;
    const cw = cv.width, ch = cv.height, s = Math.max(cw / im.naturalWidth, ch / im.naturalHeight);
    const w = im.naturalWidth * s, h = im.naturalHeight * s;
    ctx.drawImage(im, (cw - w) / 2, (ch - h) / 2, w, h);
    if (!cv.classList.contains('ready')) cv.classList.add('ready');
    return true;
  }
  function loadFrames() {
    if (H.started) return; H.started = true;
    const order = [];
    for (const step of [16, 8, 4, 2, 1]) for (let i = 0; i < N; i += step) if (!order.includes(i)) order.push(i);
    if (!order.includes(N - 1)) order.splice(1, 0, N - 1);
    let q = 0; heroParked = 0;
    const next = () => {
      if (q >= order.length) return;
      if (heroFar()) { heroParked++; return; }
      const i = order[q++], im = new Image();
      im.decoding = 'async';
      const set = H.set;
      im.onerror = () => { if (set !== H.set) return; H.failed++; H.loaded++; kick(); next(); };
      im.onload = () => { if (set !== H.set) return; H.imgs[i] = im; H.loaded++; H.drawn = -1; if (H.loaded >= 30) warmImages(); kick(); next(); };
      im.src = 'assets/' + set + '/' + String(i).padStart(3, '0') + '.webp';
    };
    H.next = next;
    for (let k = 0; k < 6; k++) next();
  }
  function updateBands(p, now) {
    for (const b of bands) {
      const len = b.b - b.a, f = Math.min(0.035, len / 3);
      let op = (b.first ? 1 : smoothstep(p, b.a, b.a + f)) * (b.last ? 1 : 1 - smoothstep(p, b.b - f, b.b));
      if (p < b.a - 0.001 || p > b.b + 0.001) op = (b.first && p <= b.a) ? 1 : (b.last && p >= b.b ? 1 : 0);
      const ramp = b.ramp || Math.min(0.045, len * 0.35);
      let k = clamp((p - b.a) / ramp, 0, 1);
      if (b.first) k = Math.max(k, H.loadK);
      if (Math.abs(op - b.op) > 0.004 || (op === 0) !== (b.op === 0)) { b.el.style.opacity = op.toFixed(3); b.op = op; }
      const on = op > 0.001;
      if (on !== b.on) { b.el.classList.toggle('on', on); b.on = on; }
      if (Math.abs(k - b.k) > 0.008 || (k === 1 && b.k !== 1) || (k === 0 && b.k !== 0)) { b.el.style.setProperty('--k', k.toFixed(3)); b.k = k; }
    }
  }
  function heroTick(now, dt) {
    if (!scrubOn) return false;
    const r = pin.getBoundingClientRect();
    if (r.bottom < -40 || r.top > innerHeight) return H.loadK < 1;
    let busy = false;
    H.target = heroProgress();
    const d = H.target - H.shown;
    if (Math.abs(d) < 0.0005) H.shown = H.target; else { H.shown += d * follow(0.16, dt); busy = true; }
    if (H.loadK < 1) { if (!H.loadStart) H.loadStart = now; H.loadK = clamp((now - H.loadStart) / 1300, 0, 1); busy = true; }
    const idx = frameFor(H.shown);
    if (idx !== H.drawn) { if (drawFrame(idx)) H.drawn = idx; }
    updateBands(H.shown, now);
    const edge = smoothstep(H.shown, 0.7, 0.92);
    if (Math.abs(edge - H.edge) > 0.01) { stage.style.setProperty('--edge', edge.toFixed(3)); H.edge = edge; }
    const frac = H.loaded / N, ld = Math.round(126 * (1 - frac));
    if (ld !== H.ld) { ringP.style.setProperty('--ld', ld); H.ld = ld; if (frac >= 1) cueT.textContent = 'Role a página'; else cueT.textContent = 'Carregando o filme'; }
    const cueOp = H.shown > 0.04 ? 0 : 1;
    if (cueOp !== H.cueOp) { cue.style.opacity = cueOp; H.cueOp = cueOp; }
    return busy;
  }
  tickers.push(heroTick);

  function enableScrub() {
    if (scrubOn) return; scrubOn = true;
    root.classList.add('scrub');
    H.w = H.h = 0; heroSize();
    bands.forEach(b => { b.op = -1; b.k = -1; b.on = null; });
    H.shown = H.target = heroProgress(); H.drawn = -1;
    kick();
  }
  function disableScrub() {
    if (!scrubOn) return; scrubOn = false;
    root.classList.remove('scrub');
    bands.forEach(b => { b.el.style.opacity = ''; b.el.style.removeProperty('--k'); b.el.classList.remove('on'); });
  }
  function applyHeroMode() { if (mqRM.matches || MQLS.some(m => m.matches)) disableScrub(); else enableScrub(); }
  MQLS.forEach(m => m.addEventListener ? m.addEventListener('change', applyHeroMode) : m.addListener(applyHeroMode));
  applyHeroMode();

  /* ================= 02 O GABARITO: a caneta marca, a conferência passa e o carimbo desce, tudo pela rolagem ================= */
  const gpin = $('.gab__pin'), gsticky = $('.gab__sticky');
  const desk = $('#desk'), card = $('#card'), pen = $('#pen');
  const zz = $$('.zz', card), dots = $$('.dot', card), rings = $$('.ring', card), stampEl = $('.stamp', card);
  const chip = $('#hudChip'), hudBar = $('#hudBar'), hudN = $('#hudN'), checks = $('#checks');
  const NQ = zz.length, RB = 13, SW = 600, SH = 800, UNITS = NQ + 2.4;
  const centers = zz.map(p => ({ x: +p.dataset.cx, y: +p.dataset.cy, l: p.dataset.l }));
  const REST0 = { x: 176, y: 214 }, REST1 = { x: 560, y: 186 };
  const G = { D: 0, nx: 0, ny: 0, tx: 0, ty: 0, label: '', lit: null, live: false };

  function zzPoint(q, f) {
    const c = centers[q], s = clamp(f, 0, 1) * 8, k = Math.min(7, Math.floor(s)), t = s - k;
    const px = j => c.x - RB + j * (2 * RB / 8), py = j => (j % 2 ? c.y + RB : c.y - RB);
    const x = lerp(px(k), px(k + 1), t), y = lerp(py(k), py(k + 1), t);
    return { x: c.x + (x - c.x) * 0.8, y: c.y + (y - c.y) * 0.8 };
  }
  function penState(D) {
    if (D >= NQ) { const c = ease(clamp((D - NQ) / 0.6, 0, 1)), a = zzPoint(NQ - 1, 1); return { x: lerp(a.x, REST1.x, c), y: lerp(a.y, REST1.y, c), lift: c, w: 0 }; }
    const q = Math.max(0, Math.floor(D)), u = D - q, st = zzPoint(q, 0);
    if (u < 0.35) { const s = ease(u / 0.35), prev = q === 0 ? REST0 : zzPoint(q - 1, 1); return { x: lerp(prev.x, st.x, s), y: lerp(prev.y, st.y, s), lift: q === 0 ? 1 - s : Math.sin(Math.PI * s) * 0.9, w: 0 }; }
    const f = (u - 0.35) / 0.65, p = zzPoint(q, f);
    return { x: p.x, y: p.y, lift: 0, w: f };
  }
  function gabRender() {
    const D = G.D;
    for (let q = 0; q < NQ; q++) {
      const f = clamp((clamp(D - q, 0, 1) - 0.35) / 0.65, 0, 1);
      zz[q].style.strokeDashoffset = (1 - f).toFixed(4);
      dots[q].style.opacity = clamp((f - 0.82) / 0.18, 0, 1).toFixed(3);
    }
    const c = clamp((D - NQ - 0.4) / 1.2, 0, 1);            // conferência: círculos verdes
    for (let q = 0; q < NQ; q++) {
      const k = clamp((c - q * 0.036) / 0.28, 0, 1);
      rings[q].style.strokeDashoffset = (1 - k).toFixed(4);
      rings[q].style.opacity = k > 0 ? '1' : '0';
    }
    const s = clamp((D - (NQ + 1.7)) / 0.6, 0, 1);         // o carimbo desce
    const e = ease(s);
    stampEl.style.opacity = clamp(s * 2.2, 0, 1).toFixed(3);
    stampEl.style.transform = 'scale(' + (1 + 0.7 * (1 - e)).toFixed(3) + ')';
    card.style.setProperty('--press', (Math.sin(Math.PI * clamp((s - 0.7) / 0.3, 0, 1)) * 0.012).toFixed(4));
    const ps = penState(D), L = ps.lift, st = pen.style;
    const wob = ps.w > 0 && ps.w < 1 ? Math.sin(ps.w * Math.PI * 8) * 1.4 : 0;
    st.setProperty('--x', (ps.x / SW * 100).toFixed(3)); st.setProperty('--y', (ps.y / SH * 100).toFixed(3));
    st.setProperty('--lx', (L * 16).toFixed(1) + 'px'); st.setProperty('--ly', (-L * 22).toFixed(1) + 'px');
    st.setProperty('--lz', (L * 40 + 6).toFixed(1) + 'px'); st.setProperty('--pr', (wob + L * 3).toFixed(2) + 'deg');
    st.setProperty('--sx', (6 + L * 2).toFixed(1) + 'px'); st.setProperty('--sy', (4 + L * 42).toFixed(1) + 'px');
    st.setProperty('--sb', (2 + L * 6).toFixed(1) + 'px'); st.setProperty('--so', (0.28 - L * 0.12).toFixed(3));
    let label, n, ok = false;
    if (D < NQ - 0.02) { const q = clamp(Math.floor(D), 0, NQ - 1); label = 'Questão ' + String(q + 1).padStart(2, '0') + ' · ' + centers[q].l; n = Math.min(NQ, Math.floor(D + 0.0001)); }
    else if (s < 0.6) { label = 'Conferindo o gabarito'; n = NQ; }
    else { label = NQ + ' de ' + NQ + ' certas'; n = NQ; ok = true; }
    if (label !== G.label) { G.label = label; chip.textContent = label; chip.classList.toggle('ok', ok); hudN.textContent = String(n).padStart(2, '0') + '/' + NQ; }
    hudBar.style.setProperty('--m', (Math.min(D, NQ) / NQ).toFixed(4));
    const lit = s >= 0.6;
    if (lit !== G.lit) { checks.classList.toggle('lit', lit); G.lit = lit; }
  }
  function gabTick(now, dt) {
    if (!G.live) return false;
    const r = gpin.getBoundingClientRect();
    if (r.bottom < -40 || r.top > innerHeight + 40) return false;
    let busy = false;
    // medidas visuais (getBoundingClientRect): continuam certas com a seção reduzida (zoom)
    const span = Math.max(1, r.height - gsticky.getBoundingClientRect().height);
    const p = clamp((NAV_H - r.top) / span, 0, 1);
    const T = clamp((p - 0.03) / 0.84, 0, 1) * UNITS;
    const d = T - G.D;
    if (Math.abs(d) > 0.002) { G.D += d * follow(0.13, dt); busy = true; } else G.D = T;
    if (FINE && P.t) {
      const dr = desk.getBoundingClientRect();
      G.tx = clamp((P.x - (dr.left + dr.width / 2)) / (dr.width / 2), -1, 1);
      G.ty = clamp((P.y - (dr.top + dr.height / 2)) / (dr.height / 2), -1, 1);
    } else if (!FINE) { G.tx = Math.sin(G.D * 0.55) * 0.35; G.ty = -0.15; }
    const k = follow(0.08, dt);
    G.nx = lerp(G.nx, G.tx, k); G.ny = lerp(G.ny, G.ty, k);
    if (Math.abs(G.nx - G.tx) > 0.002 || Math.abs(G.ny - G.ty) > 0.002) busy = true;
    card.style.setProperty('--rx', (-G.ny * 6).toFixed(2) + 'deg');
    card.style.setProperty('--ry', (G.nx * 8).toFixed(2) + 'deg');
    card.style.setProperty('--gl', (60 - G.nx * 45).toFixed(1) + '%');
    desk.style.setProperty('--hx', (62 + G.nx * 25).toFixed(1) + '%');
    desk.style.setProperty('--hy', (30 + G.ny * 20).toFixed(1) + '%');
    gabRender();
    return busy;
  }
  tickers.push(gabTick);
  function gabArm() {
    G.live = !mqRM.matches;
    root.classList.toggle('scrub-gab', G.live);
    G.label = ''; G.lit = null;
    if (G.live) { G.D = 0; gabRender(); kick(); }
    else { G.D = UNITS; gabRender(); }
  }
  gabArm();

  /* ================= 03 O TEMPO: a luz do abajur segue o cursor ================= */
  const tempo = $('#tempo'), lampDark = $('.tempo__dark');
  const L = { x: 18, y: 26, tx: 18, ty: 26, over: 0, vis: false };
  tempo.addEventListener('pointermove', e => {
    const r = tempo.getBoundingClientRect();
    L.tx = clamp((e.clientX - r.left) / r.width * 100, 0, 100);
    L.ty = clamp((e.clientY - r.top) / r.height * 100, 0, 100);
    L.over = performance.now(); kick();
  });
  function lampTick(now, dt) {
    if (mqRM.matches || !L.vis) return false;
    if (now - L.over > 2000) { const t = now / 1000; L.tx = 22 + Math.sin(t * 0.45) * 12; L.ty = 30 + Math.sin(t * 0.7) * 10; }
    const k = follow(0.1, dt); L.x = lerp(L.x, L.tx, k); L.y = lerp(L.y, L.ty, k);
    lampDark.style.setProperty('--lx', L.x.toFixed(2) + '%'); lampDark.style.setProperty('--ly', L.y.toFixed(2) + '%');
    return true;
  }
  tickers.push(lampTick);

  /* ================= paralaxe suave ================= */
  const pars = $$('[data-par]'), finalImg = $('.final__img img'), finalSec = $('#fim');
  function parTick() {
    if (mqRM.matches) return false;
    const vh = innerHeight;
    for (const im of pars) {
      const box = im.parentElement.getBoundingClientRect();
      if (box.bottom < 0 || box.top > vh) continue;
      const off = clamp((box.top + box.height / 2 - vh / 2) / vh, -1, 1) * Math.sign(+im.dataset.par);
      im.style.setProperty('--pl', ((-0.06 + off * 0.05) * 100).toFixed(2) + '%');
    }
    const r = finalSec.getBoundingClientRect();
    if (r.bottom > 0 && r.top < vh) finalImg.style.setProperty('--fy', (clamp((r.top + r.height / 2 - vh / 2) / vh, -1, 1) * 0.06 * r.height).toFixed(1) + 'px');
    return false;
  }
  tickers.push(parTick);

  /* ================= navegação, progresso, cartão-resposta lateral ================= */
  const nav = $('#nav'), bar = $('.nav__bar'), sheetnav = $('.sheetnav'), navList = $('#sheetnav');
  const secs = $$('[data-sec]');
  const GAB = 'ACEBDEADCBD';
  const NAMES = ['Abertura', 'O gabarito', 'O tempo', 'Como funciona', 'Pelo WhatsApp', 'Questão real', 'Diferenciais', 'Professor e aluno', 'Vantagens e limites', 'Planos', 'Dúvidas'];
  const links = secs.map((s, i) => {
    const li = document.createElement('li'), a = document.createElement('a');
    a.href = '#' + s.id; a.setAttribute('aria-label', String(i + 1).padStart(2, '0') + ' · ' + NAMES[i]);
    let h = '<b>' + String(i + 1).padStart(2, '0') + '</b>';
    for (let l = 0; l < 5; l++) h += '<i class="' + ('ABCDE'[l] === GAB[i] ? 'g' : '') + '"></i>';
    a.innerHTML = h + '<span>' + NAMES[i] + '</span>';
    li.appendChild(a); navList.appendChild(li); return a;
  });
  const C = { solid: null, cur: -1, p: -1, hide: null };
  function chromeTick() {
    const y = scrollY, max = document.documentElement.scrollHeight - innerHeight;
    const heroEnd = hero.offsetTop + hero.offsetHeight - innerHeight * 0.6;
    const solid = scrubOn ? y > heroEnd : y > 40;
    if (solid !== C.solid) { nav.classList.toggle('is-solid', solid); C.solid = solid; }
    const p = max > 0 ? y / max : 0;
    if (Math.abs(p - C.p) > 0.001) { bar.style.setProperty('--p', p.toFixed(4)); C.p = p; }
    let cur = 0;
    secs.forEach((s, i) => { if (s.getBoundingClientRect().top <= innerHeight * 0.45) cur = i; });
    if (cur !== C.cur) { links.forEach((a, i) => { a.classList.toggle('done', i < cur); a.classList.toggle('cur', i === cur); }); C.cur = cur; }
    const hide = y < innerHeight * 0.5;
    if (hide !== C.hide) { sheetnav.classList.toggle('hide', hide); C.hide = hide; }
    return false;
  }
  tickers.push(chromeTick);

  /* ================= observadores: seções vivas, contadores ================= */
  const io = new IntersectionObserver(es => es.forEach(e => {
    e.target.classList.toggle('live', e.isIntersecting);
    if (e.target === tempo) L.vis = e.isIntersecting;
    if (e.isIntersecting) kick();
  }), { rootMargin: '10% 0px' });
  [tempo, $('#diferenciais'), $('#whatsapp')].forEach(s => io.observe(s));

  const nums = $$('[data-count]');
  let numsArmed = [];
  if (!mqRM.matches) {
    numsArmed = nums.filter(el => el.getBoundingClientRect().top > innerHeight);
    numsArmed.forEach(el => { el.textContent = '0'; });
    const nio = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      nio.unobserve(e.target);
      const el = e.target, to = +el.dataset.count, t0 = performance.now(), dur = 1500;
      const step = now => { const k = clamp((now - t0) / dur, 0, 1); el.textContent = Math.round(to * ease(k)).toLocaleString('pt-BR'); if (k < 1 && !mqRM.matches) requestAnimationFrame(step); else el.textContent = to.toLocaleString('pt-BR'); };
      requestAnimationFrame(step);
    }), { threshold: 0.6 });
    numsArmed.forEach(el => nio.observe(el));
  }

  /* ================= 04 demonstração (Remotion) ================= */
  const player = $('#player'), video = $('#demo'), playBtn = $('#demoPlay'), vbar = $('#demoBar');
  const chaps = $$('#chapters button');
  const CH = chaps.map(b => +b.dataset.t);
  function setChapter() {
    const t = video.currentTime; let c = 0;
    CH.forEach((x, i) => { if (t >= x - 0.05) c = i; });
    chaps.forEach((b, i) => b.classList.toggle('on', i === c));
    vbar.style.setProperty('--vp', video.duration ? (t / video.duration).toFixed(4) : 0);
  }
  // Sem pausa: o botão só existe para dar play quando o aparelho bloqueia o vídeo automático.
  playBtn.addEventListener('click', () => { video.play().catch(() => {}); });
  video.addEventListener('play', () => player.classList.add('playing'));
  video.addEventListener('pause', () => player.classList.remove('playing'));
  video.addEventListener('timeupdate', setChapter);
  chaps.forEach((b, i) => b.addEventListener('click', () => { try { video.currentTime = CH[i]; } catch (_) {} video.play().catch(() => {}); setChapter(); }));
  chaps[0].classList.add('on');

  /* ================= 05 conversa no WhatsApp (Remotion) ================= */
  const phone = $('#phone'), wv = $('#wdemo'), wPlay = $('#wPlay'), wBar = $('#wBar');
  wPlay.addEventListener('click', () => { wv.play().catch(() => {}); });
  wv.addEventListener('play', () => phone.classList.add('playing'));
  wv.addEventListener('pause', () => phone.classList.remove('playing'));
  wv.addEventListener('timeupdate', () => wBar.style.setProperty('--vp', wv.duration ? (wv.currentTime / wv.duration).toFixed(4) : 0));

  /* ================= início automático dos vídeos ao entrar na tela ================= */
  // Os dois vídeos são mudos e playsinline, então o navegador deixa tocar sozinho.
  // O arquivo começa a baixar bem antes (~3 telas) e o vídeo já começa a tocar um pouco antes
  // de aparecer, para entrar na tela rodando, sem quadro escuro. Fora de vista, para sozinho
  // para poupar bateria. Não há pausa pela pessoa: tocar no vídeo não faz nada.
  // O botão de play só aparece se o aparelho bloquear o automático (ou com movimento reduzido).
  function autoPlay(v, box) {
    v.muted = true; v.defaultMuted = true; v.playsInline = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    let warm = false;
    if (mqRM.matches) box.classList.add('manual');
    const near = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting && !warm) { warm = true; v.preload = 'auto'; try { v.load(); } catch (_) {} }
    }), { rootMargin: '2400px 0px' });
    near.observe(box);
    // Quem pede para tocar marca o vídeo como aquecido, assim o observador de longe não chama
    // load() depois do play() (o load() cancelaria o play e o vídeo ficaria parado sem botão,
    // o que acontecia ao pular direto para a seção pelo menu).
    const tryPlay = () => v.play().catch(err => { if (!(err && err.name === 'AbortError')) box.classList.add('manual'); });
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) {
        warm = true;
        if (v.paused && !mqRM.matches) tryPlay();
      } else if (!v.paused) v.pause();
    }), { rootMargin: '240px 0px', threshold: 0 });
    io.observe(box);
  }
  autoPlay(video, player);
  autoPlay(wv, phone);

  /* ================= 06 questão real ================= */
  const ALT = {
    A: 'Leitura parcial: ignora a tendência de queda contínua exibida pelo gráfico, considerando apenas o valor inicial elevado e desconsiderando a melhora registrada nos dias seguintes.',
    B: 'A queda progressiva da creatinina ao longo dos cinco dias indica aumento da filtração glomerular, coerente com a resposta esperada à reposição de líquidos em quadro de desidratação.',
    C: 'Inversão de causa e efeito: atribui a queda da creatinina a uma suposta alteração na produção muscular, quando na verdade essa produção é constante e o gráfico mostra melhora, não piora, da função renal.',
    D: 'Excesso de escopo: desconsidera o padrão decrescente e consistente dos dados, tratando como aleatória uma tendência que o gráfico exibe de forma clara e regular ao longo dos dias.',
    E: 'Confusão conceitual: confunde o exame diagnóstico, que apenas mede a substância no sangue, com uma intervenção capaz de causar dano, atribuindo erroneamente ao procedimento um efeito fisiológico que não lhe compete.'
  };
  const alts = $$('#alts .alt'), vEl = $('#altVerdict'), tEl = $('#altTitle'), xEl = $('#altText');
  alts.forEach(btn => btn.addEventListener('click', () => {
    const l = btn.dataset.l, ok = l === 'B';
    alts.forEach(b => { b.setAttribute('aria-pressed', String(b === btn)); b.classList.remove('is-right', 'is-wrong'); });
    btn.classList.add(ok ? 'is-right' : 'is-wrong');
    vEl.className = 'verdict ' + (ok ? 'ok' : 'no');
    vEl.textContent = ok ? 'Correta · gabarito B' : 'Incorreta';
    tEl.textContent = 'Alternativa ' + l;
    xEl.textContent = ALT[l] + (ok ? '' : ' Tente outra letra ou abra a resolução comentada.');
  }));

  /* ================= planos, calculadora, compartilhar ================= */
  $$('.meter').forEach(m => { let h = ''; for (let i = 0; i < 20; i++) h += '<i class="' + (i < +m.dataset.sims ? 'f' : '') + '"></i>'; m.innerHTML = h; });
  const qMes = $('#qMes'), minQ = $('#minQ');
  const fill = el => el.style.setProperty('--fill', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
  function calc() {
    const q = +qMes.value, m = +minQ.value, h = q * Math.max(0, m - 2) / 60;
    const hs = h < 10 ? h.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : Math.round(h).toLocaleString('pt-BR');
    $('#qMesOut').textContent = q; $('#minQOut').textContent = m; $('#hMes').textContent = hs;
    $('#hAno').textContent = Math.round(h * 10).toLocaleString('pt-BR') + ' horas';
    fill(qMes); fill(minQ);
    $('#shareCalc').href = 'https://wa.me/?text=' + encodeURIComponent('Fiz a conta: com o Gera Enem eu recuperaria ' + hs + ' horas por mês que hoje gasto montando questões no padrão do ENEM. Dá uma olhada: ' + shareUrl());
  }
  qMes.addEventListener('input', calc); minQ.addEventListener('input', calc); calc();
  const toastEl = $('#toast'); let toastT;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 5200); }
  $$('.buy').forEach(b => b.addEventListener('click', () => {
    const n = b.dataset.plano;
    if (CONFIG.checkoutUrl) { location.href = CONFIG.checkoutUrl + (CONFIG.checkoutUrl.includes('?') ? '&' : '?') + 'plano=' + n; return; }
    toast('Prévia: a compra do pacote de ' + n + ' créditos ainda não está ligada ao pagamento. Nada é cobrado.');
  }));
  $('#shareWa').href = 'https://wa.me/?text=' + encodeURIComponent('Olha isso: um aplicativo que monta simulados no padrão do ENEM em poucos minutos, com gráfico, cinco alternativas e resolução comentada. ' + shareUrl());
  $('#copyLink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(shareUrl()); toast('Link copiado. É só colar na conversa.'); }
    catch (e) { toast('Não deu para copiar automaticamente. O link é: ' + shareUrl()); }
  });

  /* ================= movimento reduzido, ao vivo nas duas direções ================= */
  function pinToFinalStates() {
    gabArm();
    nums.forEach(el => { el.textContent = (+el.dataset.count).toLocaleString('pt-BR'); });
    if (!video.paused) video.pause();
    if (!wv.paused) wv.pause();
    player.classList.add('manual'); phone.classList.add('manual');
  }
  mqRM.addEventListener('change', e => {
    syncRvIO();
    if (e.matches) { pinToFinalStates(); applyHeroMode(); }
    else { player.classList.remove('manual'); phone.classList.remove('manual'); gabArm(); applyHeroMode(); kick(); }
    syncMotionUI();
  });

  /* botão "Ver o site com animações" (só aparece quando o sistema pede menos movimento) */
  const motionOn = $('#motionOn'), motionOff = $('#motionOff');
  function syncMotionUI() {
    motionOn.hidden = !(mqOS.matches && !motionOptIn);
    motionOff.hidden = !(mqOS.matches && motionOptIn);
  }
  motionOn.addEventListener('click', () => {
    setMotion(true);
    scrollTo({ top: 0, behavior: 'auto' });
    toast('Animações ligadas. Role a página para ver o filme da abertura.');
  });
  motionOff.addEventListener('click', () => {
    setMotion(false);
    toast('Pronto: o site voltou para a versão sem animações.');
  });
  syncMotionUI();

  heroSize();
  addEventListener('load', () => { heroSize(); kick(); });
  kick();
})();
