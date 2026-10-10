/* Motor da simulação Monte Carlo — Corrida ao Gol 1000.
 * Modelo: para cada jogador, a taxa de gols por jogo de clube (λ) segue a posteriori Gamma(a, b) do recorte.
 * Cada simulação sorteia um λ e depois os gols de cada jogo futuro ~ Poisson(λ), na ordem do calendário,
 * até a contagem chegar a 1000. Mesma semente => mesma simulação (é o que permite o replay). */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const dayNum = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY);
  const isoOf = (n) => new Date(n * DAY).toISOString().slice(0, 10);

  // ---------- números aleatórios: splitmix32 -> sfc32, um fluxo por (semente, simulação, jogador) ----------
  function splitmix32(a) {
    return function () {
      a |= 0; a = (a + 0x9e3779b9) | 0;
      let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad);
      t ^= t >>> 15; t = Math.imul(t, 0x735a2d97);
      return (t ^ (t >>> 15)) >>> 0;
    };
  }
  function rngFor(seed, sim, player) {
    const sm = splitmix32((seed * 0x51ed27 + sim * 0x2c1b3c6d + player * 0x297a2d39) | 0);
    let a = sm(), b = sm(), c = sm(), d = sm();
    const next = function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      let t = (a + b) | 0;
      a = b ^ (b >>> 9); b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11); d = (d + 1) | 0;
      t = (t + d) | 0; c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
    for (let i = 0; i < 12; i++) next();
    return next;
  }

  function normal(rng) {
    let u = 0; while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }
  // Gamma(shape, 1) — Marsaglia & Tsang
  function gamma(rng, shape) {
    if (shape < 1) return gamma(rng, shape + 1) * Math.pow(rng(), 1 / shape);
    const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = normal(rng); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = rng();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  function poisson(rng, lambda) {
    const L = Math.exp(-lambda);
    let k = 0, p = rng();
    while (p > L) { k++; p *= rng(); }
    return k;
  }
  // quantil da Gamma(a, b) por simulação determinística (só para exibir o intervalo da taxa)
  function gammaQuantiles(a, b, qs) {
    const rng = rngFor(7, 1, 1), n = 4000, xs = new Float64Array(n);
    for (let i = 0; i < n; i++) xs[i] = gamma(rng, a) / b;
    xs.sort();
    return qs.map((q) => xs[Math.min(n - 1, Math.floor(q * n))]);
  }

  // ---------- recorte -> parâmetros da posteriori ----------
  // clubMatches: [[iso, gols, adversário, competição, clube, mando], ...]
  function windowParams(clubMatches, spec, asOf, prior) {
    const [a0, b0] = prior;
    let a = a0, b = b0, n = 0, goals = 0, first = null, last = null;
    if (spec.kind === 'decay') {
      const t0 = dayNum(asOf);
      for (const m of clubMatches) {
        const w = Math.pow(0.5, (t0 - dayNum(m[0])) / spec.halfLife);
        a += w * m[1]; b += w; n++; goals += m[1];
      }
      first = clubMatches.length ? clubMatches[0][0] : null;
      last = clubMatches.length ? clubMatches[clubMatches.length - 1][0] : null;
    } else {
      for (const m of clubMatches) {
        if (m[0] < spec.from || m[0] > spec.to) continue;
        a += m[1]; b += 1; n++; goals += m[1];
        if (!first) first = m[0];
        last = m[0];
      }
    }
    return { a, b, n, goals, ess: b - b0, rate: n ? (a - a0) / (b - b0) : NaN, first, last };
  }

  // ---------- simulação ----------
  /* players: [{key, need, mult, a, b, fx: Int32Array de dias}] ; months: Int32Array de dias (início de cada mês da grade) */
  function createRun(opts) {
    const N = opts.nSims, P = opts.players, M = opts.months.length;
    const Q = Math.min(N, opts.quantileSims ?? 3000), D = Math.min(N, opts.drawSims ?? 160);
    const run = {
      N, done: 0, seed: opts.seed, players: P, months: opts.months,
      reach: P.map(() => new Int32Array(N).fill(-1)),
      reachDay: P.map(() => new Int32Array(N).fill(2147483647)),
      lam: P.map(() => new Float32Array(N)),
      monthly: P.map(() => new Uint16Array(Q * M)), Q, D,
      paths: P.map(() => []),
    };
    return run;
  }

  function simOne(run, pi, i, detail) {
    const p = run.players[pi], rng = rngFor(run.seed, i, pi);
    const lam = (gamma(rng, p.a) / p.b) * p.mult;
    const start = 1000 - p.need, fx = p.fx, months = run.months, M = months.length;
    const keepQ = i < run.Q, keepD = i < run.D;
    const mrow = keepQ ? run.monthly[pi] : null, base = i * M;
    const path = keepD ? [[-1, start]] : null;
    const log = detail ? [] : null;
    let cum = start, m = 0, hit = -1;
    for (let k = 0; k < fx.length; k++) {
      const day = fx[k];
      if (keepQ) while (m < M && months[m] <= day) { mrow[base + m] = cum; m++; }
      const g = poisson(rng, lam);
      if (detail) log.push([k, g, cum + g]);
      if (g) { cum += g; if (keepD) path.push([k, cum]); }
      if (cum >= 1000) { hit = k; break; }
    }
    if (keepQ) while (m < M) { mrow[base + m] = cum >= 1000 ? 1000 : cum; m++; }
    run.lam[pi][i] = lam;
    run.reach[pi][i] = hit;
    run.reachDay[pi][i] = hit >= 0 ? fx[hit] : 2147483647;
    if (keepD) run.paths[pi].push(path);
    return detail ? { lam, log, hit } : null;
  }

  function step(run, count) {
    const end = Math.min(run.N, run.done + count);
    for (let i = run.done; i < end; i++) for (let pi = 0; pi < run.players.length; pi++) simOne(run, pi, i, false);
    run.done = end;
    return run.done >= run.N;
  }

  // replay detalhado de uma simulação (não altera o run)
  function replay(run, i) {
    const shadow = {
      seed: run.seed, players: run.players, months: run.months, Q: 0, D: 0,
      reach: run.players.map(() => []), reachDay: run.players.map(() => []), lam: run.players.map(() => []),
      monthly: [], paths: [],
    };
    return run.players.map((_, pi) => simOne(shadow, pi, i, true));
  }

  // ---------- resumo ----------
  function summarize(run, upTo) {
    const n = upTo == null ? run.done : upTo, P = run.players.length;
    let first = new Array(P).fill(0), tie = 0, none = 0;
    for (let i = 0; i < n; i++) {
      let best = 2147483647, who = -1, ties = 0;
      for (let pi = 0; pi < P; pi++) {
        const d = run.reachDay[pi][i];
        if (d < best) { best = d; who = pi; ties = 0; } else if (d === best && d !== 2147483647) ties++;
      }
      if (best === 2147483647) none++;
      else if (ties) tie++;
      else first[who]++;
    }
    const per = run.players.map((p, pi) => {
      const days = Array.from(run.reachDay[pi].subarray(0, n)).filter((d) => d !== 2147483647).sort((x, y) => x - y);
      const q = (f) => days.length ? days[Math.min(days.length - 1, Math.floor(f * days.length))] : null;
      const idxCount = new Map();
      const games = [];
      for (let i = 0; i < n; i++) {
        const k = run.reach[pi][i];
        if (k >= 0) { idxCount.set(k, (idxCount.get(k) || 0) + 1); games.push(k + 1); }
      }
      games.sort((x, y) => x - y);
      const top = [...idxCount.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, c]) => ({ k, p: c / n }));
      return { reached: days.length / Math.max(1, n), p10: q(0.1), p50: q(0.5), p90: q(0.9), top,
        games50: games.length ? games[Math.floor(games.length / 2)] : null };
    });
    return { n, first: first.map((c) => c / Math.max(1, n)), tie: tie / Math.max(1, n), none: none / Math.max(1, n), per };
  }

  const api = { dayNum, isoOf, rngFor, gamma, poisson, gammaQuantiles, windowParams, createRun, step, replay, summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
