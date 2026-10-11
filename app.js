/* Corrida ao Gol 1000 — interface: controles, animação, gráficos e replay. Depende de sim.js (window.Sim) e de window.DATA:
   o de data/data.js ou, pelo tools/servidor.py, o de /api/corrida (o carregador no fim do index.html decide). */
(function () {
  'use strict';
  const D = window.DATA, S = window.Sim;
  const KEYS = ['messi', 'cr7'];
  const NAMES = ['Messi', 'CR7'];
  const FULL = ['Lionel Messi', 'Cristiano Ronaldo'];
  const COLOR_VARS = ['--messi', '--cr7'];
  const DAY = 86400000;
  const TODAY = S.dayNum(D.asOf);
  const NEVER = 2147483647;
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- formatação ----------
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const dt = (d) => new Date(d * DAY);
  const fmtDay = (d) => { const x = dt(d); return `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}`; };
  const fmtMonth = (d) => { const x = dt(d); return `${MES[x.getUTCMonth()]}/${x.getUTCFullYear()}`; };
  const fmtInt = (n) => n.toLocaleString('pt-BR');
  const fmtDec = (x, k = 2) => x.toLocaleString('pt-BR', { minimumFractionDigits: k, maximumFractionDigits: k });
  function fmtPct(x) {
    if (x <= 0) return '0%';
    if (x >= 1) return '100%';
    if (x < 0.001) return '<0,1%';
    if (x > 0.999) return '>99,9%';
    return (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }
  const monthStart = (d) => { const x = dt(d); return Math.floor(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1) / DAY); };
  const addMonths = (d, k) => { const x = dt(d); return Math.floor(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + k, 1) / DAY); };
  const yearStart = (y) => Math.floor(Date.UTC(y, 0, 1) / DAY);
  // a corrida começa um ano antes de hoje: mostra o momento de cada um sem achatar a parte simulada
  const VIEW_START = addMonths(TODAY, -12);
  function rangeMonths(d1, d2) { const x = dt(d1); return x.getUTCFullYear() * 12 + x.getUTCMonth() - (dt(d2).getUTCFullYear() * 12 + dt(d2).getUTCMonth()); }

  // ---------- tema ----------
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function rgba(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function palette() {
    return { bg: cssVar('--bg'), surface: cssVar('--surface'), surface2: cssVar('--surface-2'), line: cssVar('--line'), grid: cssVar('--grid'),
      fg: cssVar('--fg'), muted: cssVar('--muted'), gold: cssVar('--gold'), p: [cssVar('--messi'), cssVar('--cr7')],
      font: cssVar('--font-body') || 'sans-serif', display: cssVar('--font-display') || 'sans-serif' };
  }
  function effectiveTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function syncThemeBtn() { $('themeBtn').textContent = effectiveTheme() === 'dark' ? 'Tema claro' : 'Tema escuro'; }
  try { const saved = localStorage.getItem('gol1000-theme'); if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved); } catch (e) { /* sem armazenamento */ }
  $('themeBtn').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('gol1000-theme', next); } catch (e) { /* ok */ }
  });
  new MutationObserver(() => { syncThemeBtn(); redrawAll(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { syncThemeBtn(); redrawAll(); });

  function fitCanvas(cv) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  // ---------- dados derivados ----------
  const P = KEYS.map((k) => D.players[k]);
  const FX = P.map((p) => Int32Array.from(p.fixtures.map((f) => S.dayNum(f[0]))));
  const START = P.map((p) => p.total);
  const MONTHS = (() => { const a = []; let d = addMonths(TODAY, 1); while (d < S.dayNum('2036-01-01')) { a.push(d); d = addMonths(d, 1); } return Int32Array.from(a); })();
  const HIST = P.map((p) => p.history.map((h) => [S.dayNum(h[0]), h[1], h[2]]));
  const CLUB = P.map((p) => p.club_matches);
  const CLUB_FROM = S.dayNum(D.clubFrom);

  function fxLabel(pi, k) {
    const f = P[pi].fixtures[k], club = P[pi].club;
    if (f[4] === 2) return { title: `${club} · ${f[1]}`, sub: f[2], syn: true };
    const opp = f[1];
    return { title: f[3] === 'A' ? `${opp} x ${club}` : `${club} x ${opp}`, sub: f[2] + (f[3] === 'H' ? ', em casa' : f[3] === 'A' ? ', fora' : ''), syn: false };
  }

  // ---------- estado ----------
  const state = { win: 'ponderado', custom: null, nSims: 10000, speed: reduceMotion ? 'none' : 'normal', mult: [1, 1], seed: 20261010 };
  if (reduceMotion) $('speed').value = 'none';

  function specFor(winId, pi) {
    if (winId === 'custom') return { kind: 'range', from: S.isoOf(state.custom.from), to: S.isoOf(state.custom.to) };
    const w = D.windows.find((x) => x.id === winId);
    return w.kind === 'decay' ? { kind: 'decay', halfLife: w.halfLife } : { kind: 'range', from: w.from[KEYS[pi]], to: w.to };
  }
  const paramsFor = (winId) => KEYS.map((_, pi) => S.windowParams(CLUB[pi], specFor(winId, pi), D.asOf, D.prior));
  const playersFor = (wp) => KEYS.map((k, pi) => ({ key: k, need: 1000 - START[pi], mult: state.mult[pi], a: wp[pi].a, b: wp[pi].b, fx: FX[pi] }));
  const winLabel = (id) => id === 'custom' ? 'Recorte livre' : D.windows.find((w) => w.id === id).label;
  const adjusted = () => state.mult[0] !== 1 || state.mult[1] !== 1;

  // ---------- chips de recorte ----------
  const chipsEl = $('windowChips');
  [...D.windows.map((w) => [w.id, w.label]), ['custom', 'Recorte livre']].forEach(([id, label]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.dataset.win = id;
    b.addEventListener('click', () => selectWindow(id, true));
    chipsEl.appendChild(b);
  });
  function syncChips() { chipsEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.win === state.win))); }

  function selectWindow(id, focus) {
    state.win = id;
    syncChips();
    $('customBox').hidden = id !== 'custom';
    if (id === 'custom') {
      if (!state.custom) { const t = dt(TODAY); state.custom = { from: Math.floor(Date.UTC(t.getUTCFullYear() - 2, t.getUTCMonth(), t.getUTCDate()) / DAY), to: TODAY }; }
      setupCustom();
      if (!customValid()) { updateWindowNote(paramsFor('custom')); return; }
    }
    startRun({ focus });
  }

  // ---------- nota do recorte ----------
  function updateWindowNote(wp) {
    const w = D.windows.find((x) => x.id === state.win);
    const desc = state.win === 'custom'
      ? `Jogos de clube de ${fmtDay(state.custom.from)} a ${fmtDay(state.custom.to)}.`
      : w.desc;
    const parts = wp.map((x, pi) => {
      const q = S.gammaQuantiles(x.a, x.b, [0.1, 0.9]);
      const base = state.win === 'ponderado'
        ? `${fmtInt(x.n)} jogos, peso equivalente a <span class="v">${fmtDec(x.ess, 0)}</span> jogos`
        : `<span class="v">${x.n}</span> jogos · <span class="v">${x.goals}</span> gols`;
      return `<div class="wstat"><span class="who-s"><span class="chip ${pi ? 'c' : 'm'}"></span>${NAMES[pi]}</span>
        <span>${base} · <b class="v">${x.n ? fmtDec(x.rate) : '–'}</b> gol/jogo <span style="color:var(--muted)">(80%: ${fmtDec(q[0])}–${fmtDec(q[1])})</span></span></div>`;
    });
    $('windowNote').innerHTML = `<p class="desc">${desc}</p>${parts.join('')}`;
  }

  // ---------- simulação principal ----------
  let run = null, token = 0, fan = null, summary = null, firstDays = null, sweepDay = NEVER, viewEnd = TODAY + 1500;

  // opts.focus: a rodada veio de um clique (recorte, rodar de novo...), então a página vai até a corrida
  function startRun(opts) {
    const my = ++token;
    const wp = paramsFor(state.win);
    updateWindowNote(wp);
    $('adjBadge').hidden = !adjusted();
    run = S.createRun({ nSims: state.nSims, seed: state.seed, players: playersFor(wp), months: MONTHS, quantileSims: 3000, drawSims: 160 });
    run.wp = wp;
    fan = null; summary = null; firstDays = null; sweepDay = TODAY;
    sweeping = false; pendingSweep = null; setLive(false); brush = null; boardReal();
    if (zoomAnim) { cancelAnimationFrame(zoomAnim); zoomAnim = null; }
    view = state.speed === 'none' ? null : cameraAt(TODAY);
    $('verdictText').textContent = 'Simulando…';
    $('simCounter').textContent = `${fmtInt(run.N)} simulações`;
    setBar(0, 0, 1, 0, 'sweep');
    drawRace();
    if (opts && opts.focus) focusStage();
    // calcula tudo de uma vez (100 mil simulações levam menos de 1 s); a animação é a varredura no tempo
    setTimeout(() => { if (my !== token) return; S.step(run, run.N); finish(my); }, 30);
  }

  function finish(my) {
    summary = S.summarize(run);
    fan = computeFan(run);
    // datas em que cada desfecho acontece, para a barra acompanhar a varredura no tempo
    const m = [], c = [], t = [];
    for (let i = 0; i < run.N; i++) {
      const a = run.reachDay[0][i], b = run.reachDay[1][i];
      if (a === NEVER && b === NEVER) continue;
      if (a < b) m.push(a); else if (b < a) c.push(b); else t.push(a);
    }
    firstDays = [m, c, t].map((arr) => Int32Array.from(arr).sort());
    const p90s = summary.per.map((x) => x.p90 || NEVER);
    viewEnd = Math.min(TODAY + 365 * 9, Math.max(TODAY + 420, Math.max(...p90s.map((x) => x === NEVER ? TODAY + 365 * 9 : x)) + 160));
    viewEnd = addMonths(viewEnd, 1);
    renderKpis(); renderHist(); renderEta(); renderWinTable();
    $('simNo').max = String(run.N);
    loadReplay(Math.min(run.N, Math.max(1, +$('simNo').value || 1)));
    scheduleCompare();
    if (state.speed === 'none' || document.hidden) { endSweep(); return; }
    // a corrida só larga com o gráfico na tela; fora dela, espera a página chegar até ele
    if (raceOnScreen()) beginSweep(my);
    else {
      pendingSweep = () => beginSweep(my);
      $('verdictText').textContent = 'Simulação pronta. Role até o gráfico para ver a corrida.';
    }
  }
  // tempo da animação -> data: largada lenta (o CR7 está a poucos gols), meio rápido e chegada suave
  const sweepEase = (t) => t * t * (0.592 + 2.816 * t - 2.408 * t * t);
  function beginSweep(my) {
    if (my !== token) return;
    const dur = state.speed === 'slow' ? 14000 : 7000;
    const t0 = performance.now();
    sweeping = true; setLive(true); bursts = [0, 0]; setZoomMode('cam');
    const anim = (now) => {
      if (my !== token || !sweeping) return;
      const t = Math.max(0, Math.min(1, (now - t0) / dur));
      sweepDay = Math.round(TODAY + sweepEase(t) * (viewEnd - TODAY));
      view = cameraAt(sweepDay);
      summary.per.forEach((p, pi) => { if (!bursts[pi] && p.p50 && sweepDay >= p.p50) bursts[pi] = now; });
      drawRace();
      sweepVerdict();
      boardFollow(now);
      if (t < 1) requestAnimationFrame(anim); else endSweep(true);
    };
    requestAnimationFrame(anim);
  }
  let sweeping = false, pendingSweep = null;
  // natural: a animação chegou ao fim sozinha (o placar segura a chegada e depois volta ao real); senão, volta na hora
  function endSweep(natural) {
    sweeping = false; pendingSweep = null; setLive(false); sweepDay = NEVER;
    view = fullView(); setZoomMode('all');
    drawRace(); finalVerdict();
    if (natural) { brd.returnAt = performance.now() + 2600; startBoardLoop(); } else boardReal();
  }
  const setLive = (on) => $('stage').classList.toggle('live', on);
  // aba escondida não roda requestAnimationFrame: mostra o resultado final direto
  document.addEventListener('visibilitychange', () => { if (document.hidden && sweeping) endSweep(); });

  // ---------- a corrida em evidência ----------
  const RACE_VISIBLE = 0.7;
  let raceRatio = null;
  function raceOnScreen() {
    if (!('IntersectionObserver' in window)) return true;
    if (raceRatio != null) return raceRatio >= RACE_VISIBLE;
    const r = raceCv.getBoundingClientRect(), vh = window.innerHeight || document.documentElement.clientHeight;
    return r.height > 0 && (Math.min(r.bottom, vh) - Math.max(r.top, 0)) / r.height >= RACE_VISIBLE;
  }
  // o observador mede contra a janela de verdade, mesmo com a página dentro de um iframe
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => {
      raceRatio = es[es.length - 1].intersectionRatio;
      if (pendingSweep && raceRatio >= RACE_VISIBLE) { const go = pendingSweep; pendingSweep = null; go(); }
    }, { threshold: [0, 0.4, RACE_VISIBLE, 1] }).observe($('race'));
  }
  // rola até deixar veredito e gráfico inteiros na tela (ou só o gráfico, se os dois não couberem)
  function focusStage() {
    const vh = window.innerHeight || document.documentElement.clientHeight, pad = 12;
    const v = $('stage').querySelector('.st-verdict').getBoundingClientRect(), c = $('race').getBoundingClientRect();
    const fits = c.bottom - v.top + 2 * pad <= vh;
    if (fits ? v.top >= 0 && c.bottom <= vh : c.top >= 0 && c.bottom <= vh) return;
    const delta = fits ? v.top - pad : c.top - Math.max(pad, (vh - c.height) / 2);
    window.scrollTo({ top: window.scrollY + delta, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  const countLE = (arr, d) => { let lo = 0, hi = arr.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= d) lo = mid + 1; else hi = mid; } return lo; };

  function setBar(c, t, n, m, mode) {
    const segs = [['segM', m], ['segT', t], ['segN', n], ['segC', c]];
    let seen = false;
    segs.forEach(([id, v]) => {
      const el = $(id);
      el.style.width = (v * 100).toFixed(3) + '%';
      el.style.borderLeft = seen && v > 0 ? '2px solid var(--surface-2)' : '0';
      if (v > 0) seen = true;
    });
    $('pC').textContent = fmtPct(c);
    $('pM').textContent = fmtPct(m);
    const mid = [];
    if (mode === 'sweep') { if (n > 0.0005) mid.push(`ainda ninguém: ${fmtPct(n)}`); }
    else { if (t > 0) mid.push(`empate no mesmo dia: ${fmtPct(t)}`); if (n > 0) mid.push(`nenhum até 2035: ${fmtPct(n)}`); }
    $('pMid').textContent = mid.join(' · ');
  }

  function sweepVerdict() {
    const N = run.N;
    const m = countLE(firstDays[0], sweepDay) / N, c = countLE(firstDays[1], sweepDay) / N, t = countLE(firstDays[2], sweepDay) / N;
    setBar(c, t, Math.max(0, 1 - m - c - t), m, 'sweep');
    const lead = c + m + t === 0 ? 'ninguém chegou aos 1000 ainda'
      : c >= m ? `CR7 já chegou primeiro em ${fmtPct(c)} das simulações` : `Messi já chegou primeiro em ${fmtPct(m)} das simulações`;
    $('verdictText').textContent = `Em ${fmtMonth(sweepDay)}: ${lead}.`;
  }

  function finalVerdict() {
    const s = summary, c = s.first[1], m = s.first[0];
    setBar(c, s.tie, s.none, m, 'final');
    const nC = Math.round(c * s.n), nM = Math.round(m * s.n);
    let txt;
    if (c >= 0.995) txt = `Cristiano Ronaldo chega primeiro em ${fmtInt(nC)} de ${fmtInt(s.n)} simulações.`;
    else if (m >= 0.995) txt = `Messi chega primeiro em ${fmtInt(nM)} de ${fmtInt(s.n)} simulações.`;
    else if (c >= m) txt = `Cristiano Ronaldo chega primeiro em ${fmtPct(c)} das simulações. Messi, em ${fmtPct(m)}.`;
    else txt = `Messi chega primeiro em ${fmtPct(m)} das simulações. Cristiano Ronaldo, em ${fmtPct(c)}.`;
    $('verdictText').textContent = txt;
    $('simCounter').textContent = `${fmtInt(s.n)} simulações · ${winLabel(state.win)}${adjusted() ? ' · cenário ajustado' : ''}`;
  }

  function computeFan(r) {
    const M = r.months.length, Q = Math.min(r.Q, r.done);
    return r.players.map((_, pi) => {
      const col = new Uint16Array(Q), rows = [];
      for (let m = 0; m < M; m++) {
        for (let i = 0; i < Q; i++) col[i] = r.monthly[pi][i * M + m];
        col.sort();
        let reached = 0; for (let i = Q - 1; i >= 0 && col[i] >= 1000; i--) reached++;
        rows.push({ d: r.months[m], p10: col[Math.floor(0.1 * Q)], p50: col[Math.floor(0.5 * Q)], p90: col[Math.floor(0.9 * Q)], r: reached / Q });
      }
      return rows;
    });
  }

  // ---------- gráfico da corrida ----------
  const raceCv = $('race'), raceTip = $('raceTip');
  let raceGeom = null, hoverX = null;
  // view: janela de tempo visível {x0, x1}; o eixo Y se ajusta sozinho a ela. zoomMode: 'cam' (animação), 'near', 'all' ou 'brush'
  let view = null, zoomMode = 'all', zoomAnim = null, brush = null, bursts = [0, 0];

  const fullView = () => ({ x0: VIEW_START, x1: viewEnd });
  // perto de hoje: até o fim da janela de 80% de quem chega antes
  function nearView() {
    const p90 = summary ? Math.min(...summary.per.map((p) => p.p90 || NEVER)) : NEVER;
    const end = p90 === NEVER ? TODAY + 365 : p90 + 45;
    return { x0: TODAY - 45, x1: Math.max(TODAY + 200, Math.min(TODAY + 600, end)) };
  }
  // câmera da animação: começa colada em hoje e vai abrindo para manter o cursor perto da borda direita
  const CAM0 = { x0: TODAY - 30, x1: TODAY + 120 };
  function cameraAt(sd) {
    const f = fullView();
    const x1 = Math.min(f.x1, Math.max(CAM0.x1, sd + 0.22 * (sd - CAM0.x0)));
    const k = Math.max(0, Math.min(1, (x1 - CAM0.x1) / (f.x1 - CAM0.x1)));
    return { x0: CAM0.x0 + (f.x0 - CAM0.x0) * Math.pow(k, 0.6), x1 };
  }

  // valor contínuo das curvas (interpolação linear), para a câmera e as cabeças da corrida andarem sem saltos
  function histAt(pi, d) {
    const hs = HIST[pi];
    let pd = hs[0][0], pv = hs[0][1];
    for (const [dd, vv] of hs) { if (dd >= d) return dd === pd ? vv : pv + (vv - pv) * (d - pd) / (dd - pd); pd = dd; pv = vv; }
    return pv;
  }
  function fanAt(pi, d, key) {
    if (!fan || d <= TODAY) return START[pi];
    let pd = TODAY, pv = START[pi];
    for (const r of fan[pi]) { if (r.d >= d) return pv + (r[key] - pv) * (d - pd) / (r.d - pd); pd = r.d; pv = r[key]; }
    return pv;
  }
  // menor valor visível fica um pouco acima do eixo; os 1000 sempre aparecem
  function fitY(x0) {
    const lo = Math.min(...[0, 1].map((pi) => (x0 < TODAY ? histAt(pi, x0) : fanAt(pi, x0, 'p10'))));
    return Math.min(lo - Math.max(3, 0.08 * (1000 - lo)), 980);
  }
  function yStep(span, px) {
    for (const s of [1, 2, 5, 10, 20, 25, 50, 100]) if (px / (span / s) >= 34) return s;
    return 100;
  }
  function xTicks(x0, x1, plotW) {
    const ppm = plotW / ((x1 - x0) / 30.44), out = [];
    const months = ppm >= 46 ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : ppm >= 15 ? [0, 3, 6, 9] : ppm >= 8 ? [0, 6] : [0];
    const yearEvery = ppm * 12 < 60 ? 2 : 1;
    for (let yy = dt(x0).getUTCFullYear(); yy <= dt(x1).getUTCFullYear(); yy++) {
      for (const mo of months) {
        const d = Math.floor(Date.UTC(yy, mo, 1) / DAY);
        if (d < x0 || d > x1) continue;
        const label = mo === 0 ? (yy % yearEvery === 0 ? String(yy) : '') : months.length === 2 ? '' : MES[mo];
        out.push({ d, label, major: mo === 0 });
      }
    }
    return out;
  }

  function drawRace() {
    if (!run) return;
    const { ctx, w, h } = fitCanvas(raceCv), c = palette();
    const narrow = w < 560, now = performance.now();
    const L = narrow ? 38 : 48, R = narrow ? 14 : 22, T = 54, B = 28, HEAD = 24;
    const { x0, x1 } = view || fullView();
    const plotW = w - L - R, plotH = h - T - B;
    const yMin = fitY(x0), yMax = 1000 + (HEAD / (plotH - HEAD)) * (1000 - yMin);
    const x = (d) => L + ((d - x0) / (x1 - x0)) * plotW;
    const y = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * plotH;
    raceGeom = { L, R, T, B, w, h, x0, x1 };
    const inX = (px) => px >= L - 0.5 && px <= w - R + 0.5;

    // grade
    ctx.font = `500 12px ${c.font}`; ctx.textBaseline = 'middle'; ctx.lineWidth = 1;
    const step = yStep(1000 - yMin, plotH - HEAD);
    for (let v = Math.ceil(yMin / step) * step; v <= 1000; v += step) {
      ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(L, Math.round(y(v)) + 0.5); ctx.lineTo(w - R, Math.round(y(v)) + 0.5); ctx.stroke();
      ctx.fillStyle = v === 1000 ? c.gold : c.muted; ctx.font = v === 1000 ? `800 14px ${c.display}` : `500 12px ${c.font}`;
      ctx.textAlign = 'right'; ctx.fillText(String(v), L - 8, y(v));
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    let lastLab = -1e9;
    for (const tk of xTicks(x0, x1, plotW)) {
      const px = Math.round(x(tk.d)) + 0.5;
      ctx.strokeStyle = c.grid; ctx.globalAlpha = tk.major ? 1 : 0.55;
      ctx.beginPath(); ctx.moveTo(px, T); ctx.lineTo(px, h - B); ctx.stroke(); ctx.globalAlpha = 1;
      if (tk.label && px - lastLab > 34) { ctx.fillStyle = tk.major ? c.fg : c.muted; ctx.font = `${tk.major ? 600 : 500} 12px ${c.font}`; ctx.fillText(tk.label, px, h - B + 8); lastLab = px; }
    }

    // tudo que é dado fica preso à área do gráfico
    ctx.save();
    ctx.beginPath(); ctx.rect(L, T, plotW, plotH); ctx.clip();

    // projeções, reveladas pela varredura
    const clipTo = sweepDay === NEVER ? x1 : Math.min(x1, sweepDay);
    ctx.save();
    ctx.beginPath(); ctx.rect(x(TODAY), 0, Math.max(0, x(clipTo) - x(TODAY)), h); ctx.clip();
    if (fan) fan.forEach((rows, pi) => {
      ctx.fillStyle = rgba(c.p[pi], 0.13);
      ctx.beginPath(); ctx.moveTo(x(TODAY), y(START[pi]));
      const vis = []; for (const r of rows) { vis.push(r); if (r.d > x1) break; }
      vis.forEach((r) => ctx.lineTo(x(r.d), y(r.p90)));
      for (let i = vis.length - 1; i >= 0; i--) ctx.lineTo(x(vis[i].d), y(vis[i].p10));
      ctx.closePath(); ctx.fill();
    });
    run.paths.forEach((paths, pi) => {
      ctx.strokeStyle = rgba(c.p[pi], 0.16); ctx.lineWidth = 1;
      const fx = FX[pi];
      ctx.beginPath();
      paths.forEach((path) => {
        let py = y(path[0][1]);
        ctx.moveTo(x(TODAY), py);
        for (let j = 1; j < path.length; j++) {
          const d = fx[path[j][0]], nx = x(d), ny = y(Math.min(path[j][1], 1000));
          ctx.lineTo(nx, py); ctx.lineTo(nx, ny); py = ny;
          if (d > clipTo) break;
        }
      });
      ctx.stroke();
    });
    if (fan) fan.forEach((rows, pi) => {
      ctx.strokeStyle = c.p[pi]; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(x(TODAY), y(START[pi]));
      for (const r of rows) { ctx.lineTo(x(r.d), y(Math.min(r.p50, 1000))); if (r.p50 >= 1000 || r.d > clipTo) break; }
      ctx.stroke();
    });
    // milésimos simulados: um ponto por simulação na faixa acima dos 1000; os que acabaram de acontecer acendem
    const nDots = Math.min(run.done, 1500), popD = Math.max(5, 0.012 * (x1 - x0));
    for (let pi = 0; pi < 2; pi++) {
      const hot = [];
      ctx.fillStyle = rgba(c.p[pi], 0.24);
      ctx.beginPath();
      for (let i = 0; i < nDots; i++) {
        const d = run.reachDay[pi][i];
        if (d === NEVER || d < x0 || d > x1) continue;
        const jitter = (((i * 2654435761) >>> 0) % 1000) / 1000 - 0.5;
        const px = x(d), py = y(1000) - HEAD / 2 + jitter * 12 + (pi ? -2 : 2);
        if (sweepDay !== NEVER && d > sweepDay - popD) { hot.push([px, py]); continue; }
        ctx.moveTo(px + 1.8, py); ctx.arc(px, py, 1.8, 0, Math.PI * 2);
      }
      ctx.fill();
      if (hot.length) {
        ctx.fillStyle = rgba(c.p[pi], 0.9); ctx.beginPath();
        hot.forEach(([px, py]) => { ctx.moveTo(px + 3.4, py); ctx.arc(px, py, 3.4, 0, Math.PI * 2); });
        ctx.fill();
      }
    }
    ctx.restore();

    // linha dos 1000
    ctx.strokeStyle = c.gold; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(L, y(1000)); ctx.lineTo(w - R, y(1000)); ctx.stroke(); ctx.setLineDash([]);

    // histórico real
    HIST.forEach((hs, pi) => {
      if (x0 >= TODAY) return;
      ctx.strokeStyle = c.p[pi]; ctx.lineWidth = 2.25; ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false, prevY = null;
      for (const [d, v] of hs) {
        if (d < x0) { prevY = v; continue; }
        if (!started) { ctx.moveTo(x(x0), y(prevY == null ? v : prevY)); started = true; }
        ctx.lineTo(x(d), y(prevY == null ? v : prevY)); ctx.lineTo(x(d), y(v)); prevY = v;
      }
      ctx.lineTo(x(TODAY), y(prevY)); ctx.stroke();
    });

    // hoje
    const tx = Math.round(x(TODAY)) + 0.5;
    if (inX(tx)) {
      ctx.strokeStyle = c.muted; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(tx, T); ctx.lineTo(tx, h - B); ctx.stroke(); ctx.setLineDash([]);
    }
    // rótulos diretos à direita de hoje, abaixo do ponto de partida (na animação, quem leva o nome é a cabeça da corrida)
    if (sweepDay === NEVER && inX(tx) && tx < w - R - 80) {
      ctx.font = `700 13px ${c.font}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (let pi = 0; pi < 2; pi++) {
        const ly = y(START[pi]) + 16;
        ctx.fillStyle = c.p[pi]; ctx.fillRect(tx + 8, ly - 4, 8, 8);
        ctx.fillStyle = c.fg; ctx.fillText(`${NAMES[pi]} ${START[pi]}`, tx + 21, ly);
      }
    }

    // seleção de zoom
    if (brush && brush.b != null) {
      const a = Math.max(L, Math.min(brush.a, brush.b)), b = Math.min(w - R, Math.max(brush.a, brush.b));
      ctx.fillStyle = rgba(c.fg, 0.08); ctx.fillRect(a, T, b - a, plotH);
      ctx.strokeStyle = c.fg; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(a) + 0.5, T); ctx.lineTo(Math.round(a) + 0.5, h - B); ctx.moveTo(Math.round(b) + 0.5, T); ctx.lineTo(Math.round(b) + 0.5, h - B); ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.restore();

    // marco do milésimo mediano de cada um: aparece quando o cursor passa por ele
    const marks = [];
    if (summary) summary.per.forEach((p, pi) => {
      if (!p.p50 || p.p50 < x0 || p.p50 > x1 || (sweepDay !== NEVER && sweepDay < p.p50) || !inX(x(p.p50))) return;
      const mx = x(p.p50), my = y(1000);
      ctx.strokeStyle = c.gold; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(mx) + 0.5, 22); ctx.lineTo(Math.round(mx) + 0.5, my); ctx.stroke(); ctx.globalAlpha = 1;
      if (bursts[pi] && now - bursts[pi] < 900) {
        const k = (now - bursts[pi]) / 900;
        ctx.strokeStyle = rgba(c.p[pi], 0.85 * (1 - k)); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(mx, my, 6 + 34 * k, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = c.p[pi]; ctx.strokeStyle = c.surface; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx, my, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      marks.push({ pi, mx, text: `${NAMES[pi]} · ${fmtMonth(p.p50)}` });
    });

    // cabeças da corrida: a mediana de cada um no instante do cursor
    if (sweepDay !== NEVER && sweepDay > TODAY && fan) {
      const sx = x(Math.min(sweepDay, x1));
      const heads = [0, 1].filter((pi) => !(summary.per[pi].p50 && sweepDay >= summary.per[pi].p50))
        .map((pi) => ({ pi, v: Math.min(1000, fanAt(pi, sweepDay, 'p50')) }));
      heads.forEach((hd) => { hd.y = y(hd.v); hd.ly = hd.y; });
      if (heads.length === 2 && Math.abs(heads[0].ly - heads[1].ly) < 18) {
        const mid = (heads[0].ly + heads[1].ly) / 2, up = heads[0].ly < heads[1].ly ? 0 : 1;
        heads[up].ly = mid - 9; heads[1 - up].ly = mid + 9;
      }
      const right = sx < w - R - 90;
      heads.forEach((hd) => {
        ctx.save(); ctx.shadowColor = c.p[hd.pi]; ctx.shadowBlur = 14;
        ctx.fillStyle = c.p[hd.pi]; ctx.beginPath(); ctx.arc(sx, hd.y, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        ctx.strokeStyle = c.surface; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, hd.y, 5.5, 0, Math.PI * 2); ctx.stroke();
        ctx.font = `700 13px ${c.font}`; ctx.textAlign = right ? 'left' : 'right'; ctx.textBaseline = 'middle';
        const lx = sx + (right ? 11 : -11), txt = `${NAMES[hd.pi]} ${Math.round(hd.v)}`;
        ctx.lineJoin = 'round'; ctx.strokeStyle = c.surface; ctx.lineWidth = 4; ctx.strokeText(txt, lx, hd.ly);
        ctx.fillStyle = c.fg; ctx.fillText(txt, lx, hd.ly);
      });
    }

    // rótulos da margem de cima: "1000", hoje, marcos do milésimo e o cursor
    ctx.textBaseline = 'middle';
    const topY = 12;
    const boxes = [];
    const place = (cx, width) => {
      let a = Math.max(L, Math.min(w - R - width, cx - width / 2));
      for (const bx of boxes) if (a < bx[1] + 8 && a + width > bx[0] - 8) a = bx[1] + 8;
      if (a + width > w - R) a = w - R - width;
      boxes.push([a, a + width]); return a;
    };
    if (inX(tx)) {
      ctx.font = `600 12px ${c.font}`;
      const tw = ctx.measureText('hoje').width, a = place(tx, tw);
      ctx.fillStyle = c.muted; ctx.textAlign = 'left'; ctx.fillText('hoje', a, topY);
    }
    marks.sort((m1, m2) => m1.mx - m2.mx).forEach((m) => {
      ctx.font = `700 12px ${c.font}`;
      const tw = ctx.measureText(m.text).width + 14, a = place(m.mx, tw);
      ctx.fillStyle = c.p[m.pi]; ctx.beginPath(); ctx.arc(a + 4, topY, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c.fg; ctx.textAlign = 'left'; ctx.fillText(m.text, a + 14, topY);
    });

    // cursor da varredura, com a data numa etiqueta
    if (sweepDay !== NEVER && sweepDay > TODAY) {
      const sx = x(Math.min(sweepDay, x1));
      ctx.strokeStyle = c.fg; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx, T - 5); ctx.lineTo(sx, h - B); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.font = `800 14px ${c.display}`;
      const lab = fmtMonth(sweepDay).toUpperCase(), tw = ctx.measureText(lab).width + 16;
      const a = Math.max(L, Math.min(w - R - tw, sx - tw / 2));
      ctx.fillStyle = c.fg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(a, T - 27, tw, 22, 6) : ctx.rect(a, T - 27, tw, 22); ctx.fill();
      ctx.fillStyle = c.bg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(lab, a + tw / 2, T - 16);
    }

    // mira do mouse
    if (hoverX != null && !brush) {
      ctx.strokeStyle = c.fg; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hoverX + 0.5, T); ctx.lineTo(hoverX + 0.5, h - B); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  function valueAt(hs, d) { let v = null; for (const [dd, vv] of hs) { if (dd > d) break; v = vv; } return v; }
  const dayAtPx = (px) => { const g = raceGeom; return g.x0 + ((px - g.L) / (g.w - g.L - g.R)) * (g.x1 - g.x0); };

  // ---------- zoom ----------
  const zoomBtns = document.querySelectorAll('#raceZoom button');
  function setZoomMode(m) { zoomMode = m; zoomBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.zoom === m))); }
  // anima a janela de tempo até o alvo; a animação da corrida, se estiver rodando, termina antes
  function zoomTo(target, mode) {
    if (!run || !summary) return;
    if (sweeping || pendingSweep) endSweep();
    setZoomMode(mode);
    if (zoomAnim) cancelAnimationFrame(zoomAnim);
    const from = view || fullView(), t0 = performance.now(), dur = reduceMotion ? 0 : 420;
    const tick = (now) => {
      const t = dur ? Math.min(1, (now - t0) / dur) : 1, e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      view = { x0: from.x0 + (target.x0 - from.x0) * e, x1: from.x1 + (target.x1 - from.x1) * e };
      drawRace();
      zoomAnim = t < 1 ? requestAnimationFrame(tick) : null;
    };
    zoomAnim = requestAnimationFrame(tick);
  }
  zoomBtns.forEach((b) => b.addEventListener('click', () => zoomTo(b.dataset.zoom === 'near' ? nearView() : fullView(), b.dataset.zoom)));
  raceCv.addEventListener('dblclick', () => zoomTo(fullView(), 'all'));

  // arrastar na horizontal seleciona o período para aproximar
  raceCv.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !raceGeom || !summary || sweeping) return;
    const px = ev.clientX - raceCv.getBoundingClientRect().left;
    if (px < raceGeom.L || px > raceGeom.w - raceGeom.R) return;
    brush = { a: px, b: null, id: ev.pointerId };
  });
  window.addEventListener('pointerup', (ev) => {
    if (!brush || ev.pointerId !== brush.id) return;
    const b = brush; brush = null;
    if (b.b != null && Math.abs(b.b - b.a) >= 10) {
      let d0 = dayAtPx(Math.min(b.a, b.b)), d1 = dayAtPx(Math.max(b.a, b.b));
      if (d1 - d0 < 21) { const m = (d0 + d1) / 2; d0 = m - 10.5; d1 = m + 10.5; }
      zoomTo({ x0: d0, x1: d1 }, 'brush');
    } else drawRace();
  });

  raceCv.addEventListener('pointermove', (ev) => {
    if (!raceGeom || !run) return;
    const r = raceCv.getBoundingClientRect(), g = raceGeom;
    const px = Math.max(g.L, Math.min(g.w - g.R, ev.clientX - r.left));
    if (brush && ev.pointerId === brush.id) {
      if (brush.b != null || Math.abs(px - brush.a) > 4) { brush.b = px; raceTip.hidden = true; raceCv.setPointerCapture(ev.pointerId); drawRace(); }
      return;
    }
    if (ev.clientX - r.left < g.L || ev.clientX - r.left > g.w - g.R) { hideRaceTip(); return; }
    hoverX = px;
    const d = Math.round(dayAtPx(px));
    let html;
    if (d <= TODAY) {
      html = `<div class="h">${fmtDay(d)} · real</div>` + [0, 1].map((pi) => {
        const v = valueAt(HIST[pi], d);
        return `<div class="r"><span class="chip ${pi ? 'c' : 'm'}"></span>${NAMES[pi]}: <b>${v == null ? '–' : v}</b> gols</div>`;
      }).join('');
    } else if (fan) {
      const m = Math.max(0, MONTHS.findIndex((x) => x >= d));
      html = `<div class="h">${fmtMonth(MONTHS[m])} · simulado</div>` + [0, 1].map((pi) => {
        const row = fan[pi][m];
        const chegou = row.r > 0 ? ` · já chegou: ${fmtPct(row.r)}` : '';
        return `<div class="r"><span class="chip ${pi ? 'c' : 'm'}"></span>${NAMES[pi]}: <b>${row.p50}</b></div><div class="m" style="margin-left:16px">80%: ${row.p10}–${row.p90}${chegou}</div>`;
      }).join('');
    } else return;
    raceTip.innerHTML = html; raceTip.hidden = false;
    const tw = raceTip.offsetWidth, th = raceTip.offsetHeight;
    let left = px + 14; if (left + tw > r.width) left = px - tw - 14;
    raceTip.style.left = Math.max(0, left) + 'px';
    raceTip.style.top = Math.max(0, Math.min(r.height - th, ev.clientY - r.top - th / 2)) + 'px';
    if (sweepDay === NEVER) drawRace();
  });
  function hideRaceTip() { hoverX = null; raceTip.hidden = true; if (sweepDay === NEVER) drawRace(); }
  raceCv.addEventListener('pointerleave', () => { if (!brush) hideRaceTip(); });
  raceCv.addEventListener('pointercancel', () => { brush = null; hideRaceTip(); });

  // ---------- placar acompanha a corrida ----------
  // na animação, o placar mostra a mediana do recorte na data do cursor; nos 1000, comemora; no fim, volta à contagem real.
  // tudo anda pelo relógio de requestAnimationFrame, então a gravação quadro a quadro sai igual à tela
  const LEDS = [$('ledMessi'), $('ledCr7')], NEEDS = [$('needMessi'), $('needCr7')], fxCv = $('boardFx');
  const CLUBS = P.map((p) => p.club);
  const brd = { val: START.slice(), hit: [0, 0], parts: [], returnAt: 0, from: null, raf: 0, month: '' };
  const needHtml = (pi, v) => (pi ? `${CLUBS[1]} · faltam <b>${1000 - v}</b>` : `faltam <b>${1000 - v}</b> · ${CLUBS[0]}`);
  function setLed(pi, v) {
    if (brd.val[pi] === v) return;
    brd.val[pi] = v; LEDS[pi].textContent = String(v);
    if (!brd.hit[pi]) NEEDS[pi].innerHTML = needHtml(pi, v);
  }
  function setVs(month) {
    if (brd.month === month) return;
    brd.month = month;
    $('vsSub').innerHTML = month ? `na simulação<br>${month}` : 'gols oficiais<br>na carreira';
    $('vsSub').classList.toggle('sim', !!month);
  }
  function boardReal() {
    brd.hit = [0, 0]; brd.parts = []; brd.returnAt = 0; brd.from = null;
    [0, 1].forEach((pi) => { LEDS[pi].classList.remove('hit'); LEDS[pi].style.transform = ''; brd.val[pi] = -1; setLed(pi, START[pi]); });
    setVs('');
    fitCanvas(fxCv);
  }
  function boardFollow(now) {
    setVs(fmtMonth(sweepDay));
    summary.per.forEach((p, pi) => {
      if (p.p50 && sweepDay >= p.p50) { if (!brd.hit[pi]) celebrate(pi, p.p50, now); }
      else setLed(pi, Math.min(999, Math.round(fanAt(pi, sweepDay, 'p50'))));
    });
    boardFx(now);
  }
  function celebrate(pi, day, now) {
    setLed(pi, 1000);
    brd.hit[pi] = now;
    LEDS[pi].classList.add('hit');
    NEEDS[pi].innerHTML = `<span class="hitmsg">milésimo em ${fmtMonth(day)}</span>`;
    // confete saindo do número, com sorteio fixo para a cena se repetir igual
    const cr = fxCv.getBoundingClientRect(), lr = LEDS[pi].getBoundingClientRect();
    const cx = lr.left + lr.width / 2 - cr.left, cy = lr.top + lr.height / 2 - cr.top;
    let seed = (pi + 1) * 7919 + day;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const cols = [cssVar(COLOR_VARS[pi]), cssVar('--gold'), cssVar('--fg')];
    for (let i = 0; i < 120; i++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * Math.PI * 1.6, sp = 160 + rnd() * 380;
      brd.parts.push({ t0: now, x: cx + (rnd() - 0.5) * lr.width * 0.7, y: cy + (rnd() - 0.5) * lr.height * 0.5,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: rnd() * 6.3, vr: (rnd() - 0.5) * 16,
        w: 5 + rnd() * 6, h: 2.5 + rnd() * 3, c: cols[Math.floor(rnd() * 3)], life: 1500 + rnd() * 1000 });
    }
    brd.glow = brd.glow || [];
    brd.glow[pi] = { cx, cy, c: cols[0] };
  }
  function boardFx(now) {
    const { ctx } = fitCanvas(fxCv);
    for (let pi = 0; pi < 2; pi++) {
      if (!brd.hit[pi]) continue;
      const k = (now - brd.hit[pi]) / 1300;
      // número dá um pulo
      const kp = Math.min(1, (now - brd.hit[pi]) / 650);
      LEDS[pi].style.transform = kp < 1 ? `scale(${(1 + 0.16 * Math.sin(Math.PI * kp)).toFixed(4)})` : '';
      if (k >= 1 || !brd.glow || !brd.glow[pi]) continue;
      const g = brd.glow[pi];
      // brilho na cor do jogador e um anel dourado abrindo
      const rad = ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, 170);
      rad.addColorStop(0, rgba(g.c, 0.5 * (1 - k) * (1 - k))); rad.addColorStop(1, rgba(g.c, 0));
      ctx.fillStyle = rad; ctx.fillRect(g.cx - 170, g.cy - 170, 340, 340);
      ctx.strokeStyle = rgba(cssVar('--gold'), 0.9 * (1 - k)); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(g.cx, g.cy, 30 + 150 * k, 0, Math.PI * 2); ctx.stroke();
    }
    brd.parts = brd.parts.filter((p) => now - p.t0 < p.life);
    for (const p of brd.parts) {
      const t = (now - p.t0) / 1000, k = (now - p.t0) / p.life;
      ctx.save();
      ctx.translate(p.x + p.vx * t, p.y + p.vy * t + 0.5 * 820 * t * t);
      ctx.rotate(p.rot + p.vr * t);
      ctx.globalAlpha = k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35;
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    // volta para a contagem real depois de um tempo parado na chegada
    if (brd.returnAt && now >= brd.returnAt) {
      if (!brd.from) {
        brd.from = brd.val.slice(); brd.hit = [0, 0];
        LEDS.forEach((el) => { el.classList.remove('hit'); el.style.transform = ''; });
        setVs('');
      }
      const k = Math.min(1, (now - brd.returnAt) / 900), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      [0, 1].forEach((pi) => { const v = Math.round(brd.from[pi] + (START[pi] - brd.from[pi]) * e); brd.val[pi] = -1; setLed(pi, v); });
      if (k >= 1) boardReal();
    }
  }
  const boardBusy = (now) => brd.parts.length > 0 || brd.returnAt > 0 || brd.hit.some((h) => h && now - h < 1300);
  function startBoardLoop() {
    if (brd.raf) return;
    const loop = (now) => {
      brd.raf = 0;
      if (sweeping) return; // durante a animação quem desenha é a varredura
      boardFx(now);
      if (boardBusy(now)) brd.raf = requestAnimationFrame(loop);
    };
    brd.raf = requestAnimationFrame(loop);
  }

  // ---------- previsão no placar e cartões ----------
  function renderEta() {
    ['etaMessi', 'etaCr7'].forEach((id, pi) => {
      const s = summary.per[pi];
      $(id).innerHTML = s.p50 ? `milésimo provável: <b>${fmtMonth(s.p50)}</b>` : 'não chega até 2035';
    });
  }

  function renderKpis() {
    const el = $('kpis');
    el.innerHTML = [1, 0].map((pi) => {
      const s = summary.per[pi], wp = run.wp[pi];
      const q = S.gammaQuantiles(run.players[pi].a, run.players[pi].b, [0.1, 0.9]).map((v) => v * state.mult[pi]);
      const top = s.top.map((t) => {
        const f = fxLabel(pi, t.k);
        return `<li><span>${fmtDay(FX[pi][t.k])} · ${f.title}<br><small style="color:var(--muted)">${f.sub}</small></span><span class="p">${fmtPct(t.p)}</span></li>`;
      }).join('');
      const range = s.p10 && s.p90 ? `80% das simulações entre <b>${fmtMonth(s.p10)}</b> e <b>${fmtMonth(s.p90)}</b>` : '';
      return `<div class="panel kpi">
        <div class="kpi-head"><span class="chip ${pi ? 'c' : 'm'}"></span>${FULL[pi]}</div>
        <div><div class="kpi-main">${s.p50 ? fmtMonth(s.p50) : 'depois de 2035'}</div>
        <div class="kpi-sub">mês mais provável do milésimo (mediana). ${range}.</div></div>
        <div class="kpi-sub">Faltam <b>${1000 - START[pi]}</b> gols: cerca de <b>${s.games50 ?? '–'}</b> jogos do ${P[pi].club}, num ritmo de <b>${fmtDec(wp.rate * state.mult[pi])}</b> gol/jogo (80%: ${fmtDec(q[0])}–${fmtDec(q[1])}).</div>
        <div><div class="ctl-label" style="margin:4px 0 6px">Jogos mais prováveis do milésimo</div><ul class="toplist">${top}</ul></div>
      </div>`;
    }).join('');
  }

  // ---------- histograma ----------
  const histCv = $('hist'), histTip = $('histTip');
  let histGeom = null, histData = null;

  function buildHistData() {
    const m0 = monthStart(TODAY), n = rangeMonths(viewEnd, m0) + 1;
    const counts = [new Float64Array(n), new Float64Array(n)];
    for (let pi = 0; pi < 2; pi++) for (let i = 0; i < run.N; i++) {
      const d = run.reachDay[pi][i];
      if (d === NEVER) continue;
      const k = rangeMonths(d, m0);
      if (k >= 0 && k < n) counts[pi][k]++;
    }
    const pct = counts.map((a) => Array.from(a, (v) => v / run.N));
    const cum = pct.map((a) => { let s = 0; return a.map((v) => (s += v)); });
    return { m0, n, pct, cum };
  }

  function renderHist() { histData = buildHistData(); drawHist(); renderHistTable(); }

  function drawHist() {
    if (!histData || !summary) return;
    const { ctx, w, h } = fitCanvas(histCv), c = palette(), hd = histData;
    const L = 44, R = 12, T = 12, B = 26, mid = T + (h - T - B) / 2;
    const maxV = Math.max(0.01, ...hd.pct[0], ...hd.pct[1]);
    const step = maxV > 0.2 ? 0.1 : maxV > 0.08 ? 0.05 : maxV > 0.04 ? 0.02 : 0.01;
    const top = Math.ceil(maxV / step) * step;
    const bw = (w - L - R) / hd.n, half = (h - T - B) / 2 - 2;
    const yv = (v) => (v / top) * half;
    histGeom = { L, R, T, B, w, h, bw, mid };
    ctx.font = `500 12px ${c.font}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (let v = step; v <= top + 1e-9; v += step) {
      for (const s of [-1, 1]) {
        const yy = Math.round(mid + s * yv(v)) + 0.5;
        ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(w - R, yy); ctx.stroke();
        ctx.fillStyle = c.muted; ctx.fillText(Math.round(v * 100) + '%', L - 6, yy);
      }
    }
    for (let k = 0; k < hd.n; k++) {
      const x0 = L + k * bw + 1, bwid = Math.max(1, bw - 2);
      for (const [pi, dir] of [[1, -1], [0, 1]]) {
        const v = hd.pct[pi][k]; if (!v) continue;
        const hh = Math.max(1, yv(v)), r = Math.min(3, bwid / 2, hh);
        ctx.fillStyle = c.p[pi];
        ctx.beginPath();
        if (dir < 0) { ctx.moveTo(x0, mid - 1); ctx.lineTo(x0, mid - hh + r); ctx.quadraticCurveTo(x0, mid - hh, x0 + r, mid - hh); ctx.lineTo(x0 + bwid - r, mid - hh); ctx.quadraticCurveTo(x0 + bwid, mid - hh, x0 + bwid, mid - hh + r); ctx.lineTo(x0 + bwid, mid - 1); }
        else { ctx.moveTo(x0, mid + 1); ctx.lineTo(x0, mid + hh - r); ctx.quadraticCurveTo(x0, mid + hh, x0 + r, mid + hh); ctx.lineTo(x0 + bwid - r, mid + hh); ctx.quadraticCurveTo(x0 + bwid, mid + hh, x0 + bwid, mid + hh - r); ctx.lineTo(x0 + bwid, mid + 1); }
        ctx.closePath(); ctx.fill();
      }
      if (histGeom.hover === k) { ctx.fillStyle = rgba(c.fg, 0.08); ctx.fillRect(L + k * bw, T, bw, h - T - B); }
    }
    ctx.strokeStyle = c.line; ctx.beginPath(); ctx.moveTo(L, mid + 0.5); ctx.lineTo(w - R, mid + 0.5); ctx.stroke();
    // medianas
    summary.per.forEach((s, pi) => {
      if (!s.p50) return;
      const k = rangeMonths(s.p50, hd.m0), frac = (dt(s.p50).getUTCDate() - 1) / 30;
      const xx = L + (k + frac) * bw;
      ctx.strokeStyle = c.fg; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.25;
      ctx.beginPath(); ctx.moveTo(xx, mid); ctx.lineTo(xx, pi ? T : h - B); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = c.fg; ctx.font = `700 12px ${c.font}`; ctx.textAlign = xx > w - 120 ? 'right' : 'left';
      ctx.textBaseline = pi ? 'top' : 'bottom';
      ctx.fillText(`mediana ${NAMES[pi]}: ${fmtMonth(s.p50)}`, xx + (xx > w - 120 ? -6 : 6), pi ? T + 2 : h - B - 2);
    });
    // eixo de anos
    ctx.font = `500 12px ${c.font}`; ctx.fillStyle = c.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let k = 0; k < hd.n; k++) {
      const d = addMonths(hd.m0, k);
      if (dt(d).getUTCMonth() === 0) {
        const xx = L + k * bw;
        ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(xx + 0.5, T); ctx.lineTo(xx + 0.5, h - B); ctx.stroke();
        ctx.fillText(String(dt(d).getUTCFullYear()), xx, h - B + 8);
      }
    }
  }

  histCv.addEventListener('pointermove', (ev) => {
    if (!histGeom || !histData) return;
    const r = histCv.getBoundingClientRect(), px = ev.clientX - r.left, g = histGeom;
    const k = Math.floor((px - g.L) / g.bw);
    if (k < 0 || k >= histData.n) { histHide(); return; }
    if (g.hover !== k) { g.hover = k; drawHist(); }
    const d = addMonths(histData.m0, k);
    histTip.innerHTML = `<div class="h">${fmtMonth(d)}</div>` + [1, 0].map((pi) =>
      `<div class="r"><span class="chip ${pi ? 'c' : 'm'}"></span>${NAMES[pi]}: <b>${fmtPct(histData.pct[pi][k])}</b></div><div class="m" style="margin-left:16px">acumulado até o fim do mês: ${fmtPct(histData.cum[pi][k])}</div>`).join('');
    histTip.hidden = false;
    const tw = histTip.offsetWidth;
    let left = px + 14; if (left + tw > r.width) left = px - tw - 14;
    histTip.style.left = Math.max(0, left) + 'px';
    histTip.style.top = '8px';
  });
  function histHide() { if (histGeom) { histGeom.hover = null; drawHist(); } histTip.hidden = true; }
  histCv.addEventListener('pointerleave', histHide);

  function renderHistTable() {
    const hd = histData, rows = [];
    for (let k = 0; k < hd.n; k++) {
      if (!hd.pct[0][k] && !hd.pct[1][k]) continue;
      rows.push(`<tr><td>${fmtMonth(addMonths(hd.m0, k))}</td><td class="n">${fmtPct(hd.pct[1][k])}</td><td class="n">${fmtPct(hd.cum[1][k])}</td><td class="n">${fmtPct(hd.pct[0][k])}</td><td class="n">${fmtPct(hd.cum[0][k])}</td></tr>`);
    }
    $('histTbl').innerHTML = `<table><thead><tr><th>Mês</th><th class="n">CR7 no mês</th><th class="n">CR7 acumulado</th><th class="n">Messi no mês</th><th class="n">Messi acumulado</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }
  $('histTblBtn').addEventListener('click', () => {
    const t = $('histTbl'); t.hidden = !t.hidden;
    $('histTblBtn').setAttribute('aria-expanded', String(!t.hidden));
    $('histTblBtn').textContent = t.hidden ? 'Ver em tabela' : 'Esconder tabela';
  });

  // ---------- comparativo entre recortes ----------
  let cmpResults = [], cmpToken = 0;
  function scheduleCompare() {
    const my = ++cmpToken;
    const ids = D.windows.map((w) => w.id).concat(state.custom && customValid() ? ['custom'] : []);
    cmpResults = ids.map((id) => ({ id, s: null, wp: null }));
    renderCompare();
    let i = 0;
    const next = () => {
      if (my !== cmpToken || i >= ids.length) return;
      const id = ids[i], wp = paramsFor(id);
      const r = S.createRun({ nSims: 4000, seed: state.seed, players: playersFor(wp), months: MONTHS, quantileSims: 0, drawSims: 0 });
      S.step(r, r.N);
      cmpResults[i] = { id, s: S.summarize(r), wp };
      i++;
      renderCompare();
      setTimeout(next, 16);
    };
    setTimeout(next, state.speed === 'none' ? 0 : 400);
  }

  function renderCompare() {
    const done = cmpResults.filter((r) => r.s);
    let maxD = TODAY + 400;
    done.forEach((r) => r.s.per.forEach((p) => { if (p.p90 && p.p90 > maxD) maxD = p.p90; }));
    maxD = addMonths(maxD, 2);
    const xp = (d) => ((d - TODAY) / (maxD - TODAY)) * 100;
    $('cmp').innerHTML = cmpResults.map((r) => {
      const cur = r.id === state.win;
      if (!r.s) return `<div class="cmp-row" data-win="${r.id}" aria-current="${cur}" role="button" tabindex="0"><div><div class="cmp-name">${winLabel(r.id)}</div></div><div class="pending">calculando…</div><div></div></div>`;
      const rates = r.wp.map((x, pi) => `${NAMES[pi]} ${fmtDec(x.rate * state.mult[pi])}`).join(' · ');
      const bars = [0, 1].map((pi) => {
        const p = r.s.per[pi]; if (!p.p50) return '';
        const yy = pi ? 31 : 13;
        return `<line x1="${xp(p.p10)}%" x2="${xp(p.p90)}%" y1="${yy}" y2="${yy}" style="stroke:var(${COLOR_VARS[pi]});stroke-opacity:.45" stroke-width="7" stroke-linecap="round"/>
          <circle cx="${xp(p.p50)}%" cy="${yy}" r="6" style="fill:var(${COLOR_VARS[pi]});stroke:var(--surface)" stroke-width="2"><title>${NAMES[pi]}: mediana ${fmtMonth(p.p50)} (80%: ${fmtMonth(p.p10)} a ${fmtMonth(p.p90)})</title></circle>`;
      }).join('');
      const c = r.s.first[1], m = r.s.first[0];
      return `<div class="cmp-row" data-win="${r.id}" aria-current="${cur}" role="button" tabindex="0" aria-label="Usar o recorte ${winLabel(r.id)}">
        <div><div class="cmp-name">${winLabel(r.id)}</div><div class="cmp-rates">gol/jogo: ${rates}</div></div>
        <div class="cmp-plot"><svg aria-hidden="true">${bars}</svg></div>
        <div class="cmp-p"><b>${fmtPct(c)}</b><small>CR7 primeiro · Messi ${fmtPct(m)}</small></div>
      </div>`;
    }).join('');
    // eixo
    let ticks = '';
    for (let yy = dt(TODAY).getUTCFullYear() + 1; yearStart(yy) < maxD; yy++) {
      const p = xp(yearStart(yy));
      ticks += `<line x1="${p}%" x2="${p}%" y1="0" y2="6" style="stroke:var(--muted)"/><text x="${p}%" y="18" text-anchor="middle" style="fill:var(--muted);font:500 12px var(--font-body)">${yy}</text>`;
    }
    ticks += `<text x="0%" y="18" text-anchor="start" style="fill:var(--muted);font:500 12px var(--font-body)">hoje</text>`;
    $('cmpAxis').innerHTML = `<svg aria-hidden="true">${ticks}</svg>`;
    document.querySelectorAll('.cmp-row').forEach((row) => {
      const go = () => { if (row.dataset.win !== state.win) selectWindow(row.dataset.win, true); else focusStage(); };
      row.addEventListener('click', go);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  // ---------- recorte livre ----------
  const stripCv = $('strip'), rFrom = $('rangeFrom'), rTo = $('rangeTo');
  let customTimer = null;
  function customValid() { const wp = paramsFor('custom'); return wp.every((x) => x.n >= 5); }
  function setupCustom() {
    [rFrom, rTo].forEach((r) => { r.min = String(CLUB_FROM); r.max = String(TODAY); r.step = '1'; });
    rFrom.value = String(state.custom.from); rTo.value = String(state.custom.to);
    drawStrip(); readCustom();
  }
  function readCustom() {
    const wp = paramsFor('custom');
    const ok = wp.every((x) => x.n >= 5);
    updateWindowNote(wp);
    $('customRead').innerHTML = ok
      ? 'Arraste as alças para escolher o período. Cada traço é um jogo de clube; a altura mostra os gols.'
      : '<span class="warn">Cada um precisa de pelo menos 5 jogos de clube no recorte. Aumente o intervalo.</span>';
    return ok;
  }
  function onCustomInput(ev) {
    let a = +rFrom.value, b = +rTo.value;
    if (b - a < 30) { if (ev.target === rFrom) a = b - 30; else b = a + 30; }
    a = Math.max(CLUB_FROM, a); b = Math.min(TODAY, b);
    state.custom = { from: a, to: b };
    rFrom.value = String(a); rTo.value = String(b);
    drawStrip();
    const ok = readCustom();
    clearTimeout(customTimer);
    if (ok) customTimer = setTimeout(() => { if (state.win === 'custom') startRun(); }, 350);
  }
  rFrom.addEventListener('input', onCustomInput); rTo.addEventListener('input', onCustomInput);

  function drawStrip() {
    if ($('customBox').hidden) return;
    const { ctx, w, h } = fitCanvas(stripCv), c = palette();
    const L = 9, R = 9, mid = 50;
    const x = (d) => L + ((d - CLUB_FROM) / (TODAY - CLUB_FROM)) * (w - L - R);
    ctx.font = `600 11px ${c.font}`; ctx.textBaseline = 'middle';
    for (let yy = dt(CLUB_FROM).getUTCFullYear() + 1; yy <= dt(TODAY).getUTCFullYear(); yy++) {
      const px = Math.round(x(yearStart(yy))) + 0.5;
      ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(px, 4); ctx.lineTo(px, 92); ctx.stroke();
      ctx.fillStyle = c.muted; ctx.textAlign = 'left'; ctx.fillText(String(yy), px + 3, 8);
    }
    ctx.strokeStyle = c.line; ctx.beginPath(); ctx.moveTo(L, mid + 0.5); ctx.lineTo(w - R, mid + 0.5); ctx.stroke();
    CLUB.forEach((ms, pi) => {
      ctx.fillStyle = c.p[pi];
      for (const m of ms) {
        const d = S.dayNum(m[0]), px = x(d), g = m[1];
        const inR = d >= state.custom.from && d <= state.custom.to;
        ctx.globalAlpha = inR ? 1 : 0.28;
        const hh = g ? 6 + g * 8 : 2;
        if (pi === 0) ctx.fillRect(px - 0.75, mid - 2 - hh, 1.5, hh); else ctx.fillRect(px - 0.75, mid + 2, 1.5, hh);
      }
    });
    ctx.globalAlpha = 1;
    const a = x(state.custom.from), b = x(state.custom.to);
    ctx.strokeStyle = c.fg; ctx.lineWidth = 1.5;
    ctx.strokeRect(a, 12, Math.max(1, b - a), 80);
    ctx.fillStyle = c.muted; ctx.font = `600 11px ${c.font}`; ctx.textAlign = 'left';
    ctx.fillText('Messi', L, 18); ctx.fillText('CR7', L, 84);
  }

  // ---------- replay ----------
  const rp = { i: 1, events: [], pos: 0, timer: null, hits: [null, null], res: null };
  function loadReplay(i) {
    stopReplay();
    rp.i = i; $('simNo').value = String(i);
    rp.res = S.replay(run, i - 1);
    const evs = [];
    rp.res.forEach((r, pi) => r.log.forEach(([k, g, cum]) => evs.push({ d: FX[pi][k], pi, k, g, cum, hit: k === r.hit })));
    evs.sort((a, b) => a.d - b.d || b.pi - a.pi);
    rp.events = evs; rp.pos = 0; rp.hits = [null, null];
    $('rMessi').textContent = START[0]; $('rCr7').textContent = START[1];
    $('rDate').textContent = fmtDay(TODAY);
    ['rLamMessi', 'rLamCr7'].forEach((id, pi) => { $(id).textContent = `nesta simulação: ${fmtDec(rp.res[pi].lam)} gol por jogo`; });
    $('rBanner').hidden = true;
    $('feed').innerHTML = `<div class="ev zero" style="grid-template-columns:1fr"><span>Simulação nº ${fmtInt(i)} pronta. Aperte <b>Reproduzir</b> para ver jogo a jogo.</span></div>`;
    $('playBtn').textContent = 'Reproduzir';
  }
  function evRow(e) {
    const f = fxLabel(e.pi, e.k);
    const dots = '<i></i>'.repeat(Math.min(e.g, 5));
    return `<div class="ev${e.g ? '' : ' zero'}${e.hit ? ' hit' : ''}"><span class="d">${fmtDay(e.d)}</span><span class="chip ${e.pi ? 'c' : 'm'}"></span><span class="t">${f.title} <small>· ${f.sub}</small></span><span class="g" aria-label="${e.g} gols">${dots}</span><span class="c">${Math.min(e.cum, 9999)}</span></div>`;
  }
  function applyEvent(e) {
    $(e.pi ? 'rCr7' : 'rMessi').textContent = e.cum;
    $('rDate').textContent = fmtDay(e.d);
    if (e.hit) { rp.hits[e.pi] = e; renderBanner(); }
  }
  function renderBanner() {
    const first = [rp.hits[0], rp.hits[1]].filter(Boolean).sort((a, b) => a.d - b.d || b.pi - a.pi);
    if (!first.length) return;
    const e = first[0], f = fxLabel(e.pi, e.k), nGames = e.k + 1;
    let html = `Simulação nº ${fmtInt(rp.i)}: <b>${FULL[e.pi]}</b> marca o milésimo em <b>${fmtDay(e.d)}</b>, ${f.syn ? `na ${f.title.split(' · ')[1]} da ${f.sub}` : `no jogo ${f.title} (${f.sub})`}. Foi o ${nGames}º jogo simulado.`;
    if (first[1]) html += ` ${FULL[first[1].pi]} chega em ${fmtDay(first[1].d)}.`;
    $('rBanner').innerHTML = html; $('rBanner').hidden = false;
  }
  function tickReplay() {
    if (rp.pos >= rp.events.length) { stopReplay(); $('playBtn').textContent = 'Reproduzir de novo'; return; }
    const e = rp.events[rp.pos++], feed = $('feed');
    if (rp.pos === 1) feed.innerHTML = '';
    feed.insertAdjacentHTML('beforeend', evRow(e));
    feed.scrollTop = feed.scrollHeight;
    applyEvent(e);
  }
  function playReplay() {
    if (rp.timer) { stopReplay(); $('playBtn').textContent = 'Continuar'; return; }
    if (rp.pos >= rp.events.length) loadReplay(rp.i);
    $('playBtn').textContent = 'Pausar';
    rp.timer = setInterval(tickReplay, +$('rSpeed').value);
  }
  function stopReplay() { if (rp.timer) clearInterval(rp.timer); rp.timer = null; }
  function skipReplay() {
    stopReplay();
    const feed = $('feed');
    if (rp.pos === 0) feed.innerHTML = '';
    feed.insertAdjacentHTML('beforeend', rp.events.slice(rp.pos).map(evRow).join(''));
    rp.events.slice(rp.pos).forEach(applyEvent);
    rp.pos = rp.events.length;
    feed.scrollTop = feed.scrollHeight;
    $('playBtn').textContent = 'Reproduzir de novo';
  }
  $('playBtn').addEventListener('click', playReplay);
  $('skipBtn').addEventListener('click', skipReplay);
  $('randBtn').addEventListener('click', () => { loadReplay(1 + Math.floor(Math.random() * run.N)); playReplay(); });
  $('simNo').addEventListener('change', () => { const v = Math.max(1, Math.min(run.N, Math.round(+$('simNo').value || 1))); loadReplay(v); });
  $('rSpeed').addEventListener('change', () => { if (rp.timer) { stopReplay(); rp.timer = setInterval(tickReplay, +$('rSpeed').value); } });

  // ---------- método ----------
  function renderMethod() {
    $('hlTxt').textContent = String(D.halfLifeFit.best);
    $('dispTxt').textContent = `variância/média de ${fmtDec(P[0].dispersion)} no Messi e ${fmtDec(P[1].dispersion)} no CR7`;
    // com dados ao vivo, os jogos com data publicada vão sendo disputados e podem acabar
    const cal = P.map((p, pi) => {
      const real = p.fixtures.filter((f) => f[4] !== 2);
      return real.length ? `<b>${real.length}</b> ${real.length === 1 ? 'jogo' : 'jogos'} do ${p.club} com data publicada (até ${fmtDay(S.dayNum(real.at(-1)[0]))})`
        : `nenhum jogo do ${p.club} com data publicada pela frente`;
    });
    $('calTxt').innerHTML = `Calendário usado: Messi tem ${cal[0]}; CR7 tem ${cal[1]}. Depois disso, o calendário segue o formato de cada liga.`;
  }
  // de onde vêm os dados: ao vivo (servidor) ou o retrato de data/data.js
  function renderSource() {
    const last = P.map((p) => fmtDay(S.dayNum(p.history.at(-1)[0])).slice(0, 5));
    const lastTxt = `Último jogo registrado: Messi em ${last[0]}, CR7 em ${last[1]}.`;
    $('totMessi').textContent = fmtInt(START[0]); $('totCr7').textContent = fmtInt(START[1]);
    $('totDate').textContent = fmtDay(TODAY);
    if (D.aoVivo) {
      const t = new Date(D.aoVivo.consultadoEm), hora = t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      $('dataStamp').textContent = `dados ao vivo · ${hora}`;
      $('dataNote').textContent = `Dados ao vivo do messivsronaldo.app, consultados em ${t.toLocaleDateString('pt-BR')} às ${hora}. ${lastTxt}`;
    } else {
      $('dataStamp').textContent = `dados até ${fmtDay(TODAY)}`;
      $('dataNote').textContent = `Dados de ${fmtDay(TODAY)}. ${lastTxt}`;
    }
  }
  function drawHalfLife() {
    const cv = $('hl'); const { ctx, w, h } = fitCanvas(cv), c = palette();
    const g = D.halfLifeFit.grid, L = 12, R = 12, T = 22, B = 26;
    const vals = g.map((r) => r[1]), lo = Math.min(...vals), hi = Math.max(...vals);
    const x = (i) => L + (i / (g.length - 1)) * (w - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (h - T - B);
    ctx.strokeStyle = c.muted; ctx.lineWidth = 2; ctx.beginPath();
    g.forEach((r, i) => (i ? ctx.lineTo(x(i), y(r[1])) : ctx.moveTo(x(i), y(r[1])))); ctx.stroke();
    ctx.font = `500 11px ${c.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    g.forEach((r, i) => {
      const best = r[0] === D.halfLifeFit.best;
      ctx.fillStyle = best ? c.gold : c.muted;
      ctx.beginPath(); ctx.arc(x(i), y(r[1]), best ? 5 : 3, 0, Math.PI * 2); ctx.fill();
      if (w > 420 || i % 2 === 0 || best) { ctx.fillStyle = best ? c.fg : c.muted; ctx.fillText(r[0] ? String(r[0]) : '∞', x(i), h - B + 8); }
      if (best) { ctx.font = `700 12px ${c.font}`; ctx.fillStyle = c.fg; ctx.textBaseline = 'bottom'; ctx.fillText(`${r[0]} dias: melhor previsão`, Math.min(w - 80, Math.max(80, x(i))), y(r[1]) - 8); ctx.textBaseline = 'top'; ctx.font = `500 11px ${c.font}`; }
    });
  }
  function renderWinTable() {
    const ids = D.windows.map((w) => w.id).concat(state.custom && customValid() ? ['custom'] : []);
    const rows = ids.map((id) => {
      const wp = paramsFor(id);
      return `<tr><td>${winLabel(id)}</td>${wp.map((x) => `<td class="n">${id === 'ponderado' ? '≈' + fmtDec(x.ess, 0) : x.n}</td><td class="n">${id === 'ponderado' ? '–' : x.goals}</td><td class="n">${fmtDec(x.rate)}</td>`).join('')}</tr>`;
    }).join('');
    $('winTbl').innerHTML = `<table><thead><tr><th>Recorte</th><th class="n">Messi jogos</th><th class="n">gols</th><th class="n">gol/jogo</th><th class="n">CR7 jogos</th><th class="n">gols</th><th class="n">gol/jogo</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ---------- controles ----------
  $('nSims').addEventListener('change', () => { state.nSims = +$('nSims').value; startRun({ focus: true }); });
  $('speed').addEventListener('change', () => { state.speed = $('speed').value; });
  $('rerun').addEventListener('click', () => { state.seed = (Math.random() * 2147483647) | 0; startRun({ focus: true }); });
  [['multMessi', 0], ['multCr7', 1]].forEach(([id, pi]) => {
    const el = $(id);
    el.addEventListener('input', () => { state.mult[pi] = +el.value; $(id + 'V').textContent = '×' + fmtDec(state.mult[pi]); $('adjBadge').hidden = !adjusted(); });
    el.addEventListener('change', () => startRun());
  });
  $('resetMult').addEventListener('click', () => {
    state.mult = [1, 1];
    ['multMessi', 'multCr7'].forEach((id) => { $(id).value = '1'; $(id + 'V').textContent = '×1,00'; });
    startRun({ focus: true });
  });

  // ---------- redesenho ----------
  let rafPending = false;
  function redrawAll() {
    if (rafPending) return; rafPending = true;
    requestAnimationFrame(() => { rafPending = false; drawRace(); drawHist(); drawStrip(); drawHalfLife(); });
  }
  new ResizeObserver(redrawAll).observe(document.body);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawAll);

  // ---------- início ----------
  syncThemeBtn();
  syncChips();
  renderSource();
  renderMethod();
  drawHalfLife();
  startRun();
})();
