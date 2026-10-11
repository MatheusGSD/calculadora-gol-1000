/* Gol 1000 de qualquer jogador — calculadora: um jogador por vez, meta sempre 1000. Depende de sim.js (window.Sim).
 * Dados: jogadores da Transfermarkt jogo a jogo, ao vivo (via tools/servidor.py); lendas vêm de data/lendas.json,
 * curado à mão por temporada (tools/build_lendas.py), porque a Transfermarkt não tem o futebol dos anos 50-70.
 * Modelo: o mesmo Gamma-Poisson de sim.js (ritmo por jogo com peso que cai pela metade a cada 300 dias), com
 * calendário sintético (N jogos oficiais por ano). Duas perguntas:
 *   1. em atividade: chance de chegar a 1000 antes da aposentadoria (simulação);
 *   2. todos: com que idade chegaria se nunca parasse (projeção com o ritmo atual, por absurda que seja). */
(function () {
  'use strict';
  const S = window.Sim;
  let LENDAS = [];   // data/lendas.json, carregado no início
  const DAY = 86400000, YEAR = 365.25;
  const HALF_LIFE = 300;     // a meia-vida ajustada na página principal (data.json > halfLifeFit.best)
  const PRIOR = [0.5, 0];    // Jeffreys, como na página principal
  const DECLINE_FROM = 33;   // a queda por idade começa aos 33 (ou no ponto de partida, se ele já passou disso)
  const RETIRED_AFTER = 540; // sem jogo oficial há mais de 540 dias: tratado como aposentado
  const N_SIMS = 4000, SEED = 1000, FAN_STEP = 30;
  // times de base e reserva pelo nome (Barcelona B, Bayern Munich II, Monaco U19, Real Madrid Castilla...)
  const RESERVE = /(\bB\b|\bII\b|\bIII\b|\bC\b|U-?\d{2}\b|Sub-?\d{2}|Youth|Reserve|Jgd|Juvenil|Primavera|^Jong\s|Castilla|Atl[eè]tic\b|\bJV\b)/i;
  // tipos de competição da Transfermarkt que são de base: copa juvenil, Youth League, seleção de base, liga sub-21
  const YOUTH_COMP = new Set([15, 16, 17, 18]);
  const PRESETS = [['28003', 'Messi'], ['8198', 'Cristiano Ronaldo'], ['38253', 'Lewandowski'], ['132098', 'Harry Kane'],
    ['44352', 'Luis Suárez'], ['342229', 'Mbappé'], ['418560', 'Haaland']];
  const STATE_PT = { first_half: '1º tempo', half_time: 'intervalo', second_half: '2º tempo', extra_time: 'prorrogação', penalty_shootout: 'pênaltis' };
  const $ = (id) => document.getElementById(id);

  // ---------- formatação ----------
  const fmtDay = (d) => { const x = new Date(d * DAY); return `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}`; };
  const fmtInt = (n) => Math.round(n).toLocaleString('pt-BR');
  const fmtDec = (x, k = 2) => x.toLocaleString('pt-BR', { minimumFractionDigits: k, maximumFractionDigits: k });
  function fmtPct(x) {
    if (x <= 0) return '0%';
    if (x >= 1) return '100%';
    if (x < 0.001) return '<0,1%';
    if (x > 0.999) return '>99,9%';
    return (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }
  const plural = (n, one, many) => `${fmtInt(n)} ${Math.round(n) === 1 ? one : many}`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const todayNum = () => Math.floor(Date.now() / DAY);
  const yearOf = (d) => Math.floor(1970 + d / 365.2425);   // vale também para datas além do que o Date aguenta
  // "1957", "1957-08" ou "1957-08-07" -> dia; `end` escolhe o fim do período quando a data é incompleta
  function dayOf(s, end) {
    const [y, m, d] = String(s).split('-').map(Number);
    if (d) return S.dayNum(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    if (m) return Math.floor(Date.UTC(y, end ? m : m - 1, end ? 0 : 1) / DAY);
    return Math.floor(Date.UTC(end ? y + 1 : y, 0, end ? 0 : 1) / DAY);
  }

  // ---------- dados ----------
  async function getJSON(path) {
    const r = await fetch(path);
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && j.erro) || `HTTP ${r.status} em ${path}`);
    return j;
  }

  /* A carreira é uma lista de blocos {from, to, day, games, goals, nt, club}. Na Transfermarkt cada bloco é um jogo
   * (from = to); nas lendas, uma temporada. `day` é o meio do bloco, usado no peso do ritmo. */

  /* Carreira oficial na Transfermarkt: jogos em que o jogador entrou em campo pelo time principal ou pela seleção
   * principal. Base, reserva e seleção sub-20/olímpica ficam de fora e aparecem na lista de excluídos.
   * Com essa regra o Messi fecha em 932 gols / 1178 jogos e o CR7 em 974 / 1333, os números da Transfermarkt. */
  function parseCareer(jogos, transf, today) {
    const names = new Map();
    for (const t of (transf && transf.transfers) || []) {
      for (const s of [t.from, t.to]) {
        const m = /verein\/(\d+)/.exec((s && s.href) || '');
        if (m) names.set(m[1], s.clubName);
      }
    }
    const perf = jogos.data.performance;
    const played = perf.filter((p) => p.statistics.generalStatistics.participationState === 'played' && p.gameInformation.date.dateTimeUTC);
    const ntCount = new Map();
    for (const p of played) {
      const gi = p.gameInformation;
      if (gi.isNationalGame && !YOUTH_COMP.has(gi.competitionTypeId)) {
        const c = p.clubsInformation.club.clubId;
        ntCount.set(c, (ntCount.get(c) || 0) + 1);
      }
    }
    const mainNT = [...ntCount].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    const blocks = [], dropped = new Map();
    let birth = null;
    for (const p of played) {
      const gi = p.gameInformation, gs = p.statistics.generalStatistics, cid = p.clubsInformation.club.clubId;
      const goals = p.statistics.goalStatistics.goalsScoredTotal || 0;
      const day = S.dayNum(gi.date.dateTimeUTC.slice(0, 10));
      if (birth == null && gs.age != null) {
        const d = new Date(gi.date.dateTimeUTC);
        birth = Math.floor(Date.UTC(d.getUTCFullYear() - gs.age, d.getUTCMonth(), d.getUTCDate() - (gs.ageDiscrepancyDays || 0)) / DAY);
      }
      if (day > today) continue;
      let why = null;
      if (YOUTH_COMP.has(gi.competitionTypeId)) why = 'competição de base';
      else if (gi.isNationalGame) { if (cid !== mainNT) why = 'seleção de base ou olímpica'; }
      else if (names.size && !names.has(cid)) why = 'time de base sem registro de transferência';
      else if (RESERVE.test(names.get(cid) || '')) why = names.get(cid);
      if (why) {
        const e = dropped.get(why) || { games: 0, goals: 0 };
        e.games++; e.goals += goals; dropped.set(why, e);
        continue;
      }
      blocks.push({ from: day, to: day, day, games: 1, goals, nt: gi.isNationalGame, club: gi.isNationalGame ? 'Seleção' : (names.get(cid) || `clube ${cid}`),
        live: !!gi.isLiveGame, state: gi.gameState });
    }
    blocks.sort((x, y) => x.to - y.to);
    return { blocks, dropped: [...dropped].sort((x, y) => y[1].games - x[1].games), birth };
  }

  function legendCareer(L) {
    const nts = new Set(L.nationalTeams || []);
    const blocks = L.official.filter((b) => b.games > 0).map((b) => {
      const from = dayOf(b.from, false), to = dayOf(b.to, true);
      return { from, to, day: Math.round((from + to) / 2), games: b.games, goals: b.goals, nt: nts.has(b.team), club: b.team, season: b.season, live: false };
    }).sort((x, y) => x.to - y.to || x.from - y.from);
    return { blocks, dropped: [], birth: dayOf(L.birth, false), death: L.death ? dayOf(L.death, false) : null };
  }

  // fração de um bloco que cai dentro de (w0, w1]
  function overlap(b, w0, w1) {
    if (b.from === b.to) return b.to > w0 && b.to <= w1 ? 1 : 0;
    return Math.max(0, Math.min(b.to, w1) - Math.max(b.from, w0)) / (b.to - b.from);
  }
  function rateParams(blocks, ref) {
    let a = PRIOR[0], b = PRIOR[1];
    for (const g of blocks) {
      if (g.live) continue;
      const w = Math.pow(0.5, Math.max(0, ref - g.day) / HALF_LIFE);
      a += w * g.goals; b += w * g.games;
    }
    const [q10, q50, q90] = S.gammaQuantiles(a, b, [0.1, 0.5, 0.9]);
    return { a, b, mean: (a - PRIOR[0]) / (b - PRIOR[1]), q10, q50, q90 };
  }
  // jogos oficiais por ano nos 2 anos antes de `ref` (ou desde a estreia, se a carreira for mais curta)
  function gamesPerYear(blocks, ref) {
    const done = blocks.filter((g) => !g.live);
    if (!done.length) return 0;
    const span = Math.min(730, Math.max(60, ref - Math.min(...done.map((g) => g.from))));
    const n = done.reduce((s, g) => s + g.games * overlap(g, ref - span, ref), 0);
    return n * YEAR / span;
  }
  // em que ponto da carreira real a contagem passou de 1000 (exato num jogo, aproximado dentro de uma temporada)
  function officialMilestone(blocks) {
    let cum = 0;
    for (const b of blocks) {
      if (cum + b.goals >= 1000) {
        const exact = b.from === b.to;
        return { day: exact ? b.day : Math.round(b.from + (1000 - cum) / b.goals * (b.to - b.from)), exact, block: b };
      }
      cum += b.goals;
    }
    return null;
  }

  /* Onde termina o ritmo de um aposentado: no último bloco, salvo um retorno isolado no fim da carreira (menos de 10
   * jogos, mais de um ano depois do resto), como o jogo único do Romário pelo America-RJ em 2009 ou os 5 jogos do Bican
   * em 1957. Os gols do retorno contam
   * no total; só o ritmo e os jogos por ano são medidos antes dele. */
  function paceEnd(blocks) {
    let games = 0;
    for (let k = blocks.length - 1; k > 0; k--) {
      games += blocks[k].games;
      if (games >= 10) break;
      const before = Math.max(...blocks.slice(0, k).map((g) => g.to));
      if (blocks[k].from - before > 365) return before;
    }
    return blocks[blocks.length - 1].to;
  }

  // ---------- simulação: só para quem está em atividade, até a aposentadoria ----------
  function simulate(m) {
    const { a, b, total, start, birth, retireDay, gpy, decline } = m;
    const declFrom = Math.max(DECLINE_FROM, (start - birth) / YEAR);
    const days = [], mult = [];
    for (let d = start + YEAR / gpy / 2; d < retireDay; d += YEAR / gpy) {
      const day = Math.round(d);
      days.push(day);
      mult.push(Math.pow(1 - decline, Math.max(0, (day - birth) / YEAR - declFrom)));
    }
    const grid = [];
    for (let d = start; d <= retireDay; d += FAN_STEP) grid.push(d);
    if (grid[grid.length - 1] < retireDay) grid.push(retireDay);
    const G = grid.length, cumAt = new Uint16Array(N_SIMS * G), reach = new Int32Array(N_SIMS).fill(-1), final = new Uint16Array(N_SIMS);
    for (let i = 0; i < N_SIMS; i++) {
      const rng = S.rngFor(SEED, i, 0);
      const lam = S.gamma(rng, a) / b;
      let cum = total, gi = 0;
      for (let k = 0; k < days.length; k++) {
        while (gi < G && grid[gi] < days[k]) cumAt[i * G + gi++] = cum;
        cum += S.poisson(rng, lam * mult[k]);
        if (cum >= 1000 && reach[i] < 0) reach[i] = days[k];
      }
      while (gi < G) cumAt[i * G + gi++] = cum;
      final[i] = cum;
    }
    const hits = Array.from(reach).filter((d) => d >= 0).sort((x, y) => x - y);
    const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(f * arr.length))];
    const fan = grid.map((d, gi) => {
      const col = new Uint16Array(N_SIMS);
      for (let i = 0; i < N_SIMS; i++) col[i] = cumAt[i * G + gi];
      col.sort();
      return [d, q(col, 0.1), q(col, 0.5), q(col, 0.9)];
    });
    // chance acumulada de já ter feito o gol 1000 em cada data da grade
    let hi = 0;
    const cdf = grid.map((d) => { while (hi < hits.length && hits[hi] <= d) hi++; return [d, hi / N_SIMS]; });
    const fin = Array.from(final).sort((x, y) => x - y);
    return { days, fan, cdf, p: hits.length / N_SIMS, p10: hits.length ? q(hits, 0.1) : null, p50: hits.length ? q(hits, 0.5) : null,
      p90: hits.length ? q(hits, 0.9) : null, finalP10: q(fin, 0.1), finalP50: q(fin, 0.5), finalP90: q(fin, 0.9) };
  }

  /* ---------- projeção "se nunca parasse" ----------
   * Gols esperados por ano = ritmo × jogos por ano × queda por idade, sem aposentadoria e sem limite de idade.
   * Sem queda a conta é direta; com queda a soma pode nunca chegar a 1000 (devolve null). `path` guarda a curva. */
  function project(lam, m, path) {
    const need = 1000 - m.total, ageStart = (m.start - m.birth) / YEAR;
    if (need <= 0) return m.start;
    const perYear = lam * m.gpy;
    if (!(perYear > 0)) return null;
    if (!m.decline) {
      const years = need / perYear;
      if (path) for (let t = 0; t <= years; t += Math.max(1 / 12, years / 400)) path.push([m.start + t * YEAR, m.total + perYear * t]);
      if (path) path.push([m.start + years * YEAR, 1000]);
      return m.start + years * YEAR;
    }
    const declFrom = Math.max(DECLINE_FROM, ageStart), dt = 1 / 12;
    let cum = 0, t = 0;
    for (let k = 0; k < 12 * 5000; k++) {
      const g = perYear * dt * Math.pow(1 - m.decline, Math.max(0, ageStart + t - declFrom));
      if (cum + g >= need) {
        const tt = t + dt * (need - cum) / g;
        if (path) path.push([m.start + tt * YEAR, 1000]);
        return m.start + tt * YEAR;
      }
      if (path && k % 3 === 0) path.push([m.start + t * YEAR, m.total + cum]);
      cum += g; t += dt;
      if (g < 1e-7) break;
    }
    return null;
  }

  // uma linha de humor para a idade projetada (os fatos citados: Kazu Miura jogava aos 58; Pelé viveu até os 82)
  function joke(age, years, never) {
    if (never) return `Nem jogando para sempre: com essa queda de ritmo, a soma dos gols nunca chega a 1000.`;
    let s;
    if (age <= 40) s = 'Nada de absurdo: é só manter o ritmo.';
    else if (age <= 45) s = 'Exigiria uma longevidade à la Cristiano Ronaldo.';
    else if (age < 59) s = 'Teria de imitar o japonês Kazuyoshi Miura, que seguia jogando como profissional aos 58.';
    else if (age < 82) s = 'Entraria em campo com direito a meia-entrada de idoso.';
    else if (age < 100) s = 'Mais velho do que o Pelé chegou a viver (82 anos).';
    else if (age <= 122) s = 'Gol 1000 com mais de cem velinhas no bolo.';
    else s = 'Mais velho do que a pessoa mais longeva já registrada (Jeanne Calment, 122 anos).';
    if (years > 163) s += ' Levaria mais tempo do que o futebol moderno existe (as regras são de 1863).';
    return s;
  }

  // ---------- estado da página ----------
  const state = { seq: 0 };

  /* hint: o que já se sabe do jogador pela busca ({name, imageUrl, club, position}). O perfil completo vem da API
   * comunitária, que é lenta e cai às vezes: chega depois e só completa foto/clube/posição. */
  async function loadPlayer(id, hint) {
    const seq = ++state.seq;
    showLoading(`Buscando a carreira de ${hint.name || 'jogador ' + id} na Transfermarkt…`);
    const profileP = getJSON('/api/perfil/' + id).catch(() => null);
    try {
      const [jogos, transf] = await Promise.all([
        getJSON('/api/jogos/' + id),
        getJSON('/api/transferencias/' + id).catch(() => null),
      ]);
      if (seq !== state.seq) return;
      const today = todayNum();
      const career = parseCareer(jogos, transf, today);
      if (!career.blocks.length || career.birth == null) throw new Error('A Transfermarkt não devolveu jogos oficiais para esse jogador.');
      const last = career.blocks[career.blocks.length - 1];
      const retired = today - last.to > RETIRED_AFTER;
      // sem nome da busca: tira do endereço do histórico de transferências ("/marquinhos/transfers/spieler/181767")
      const slug = /^\/([^/]+)\//.exec((transf && transf.url) || '');
      const slugName = slug ? slug[1].split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : null;
      setup({ kind: 'tm', id, name: hint.name || slugName || `Jogador ${id}`, profile: hint, legend: null, career, retired,
        ref: retired ? paceEnd(career.blocks) : today, end: retired ? last.to : today, fetchedAt: new Date() });
      history.replaceState(null, '', '?id=' + id);
      profileP.then((p) => {
        if (!p || seq !== state.seq) return;
        state.profile = { name: p.name || hint.name, imageUrl: p.imageUrl || hint.imageUrl, club: p.club || hint.club, position: p.position || hint.position };
        state.name = state.profile.name || state.name;
        renderPlayer();
      });
    } catch (e) {
      if (seq !== state.seq) return;
      $('carregando').hidden = true;
      $('erro').hidden = false;
      $('erro').textContent = 'Não deu para carregar: ' + e.message;
    }
  }

  function loadLegend(slug) {
    const L = LENDAS.find((x) => x.id === slug);
    if (!L) return;
    const seq = ++state.seq;
    const career = legendCareer(L);
    // o fim da última temporada (careerEnd costuma vir só com o ano)
    const end = career.blocks[career.blocks.length - 1].to;
    setup({ kind: 'lenda', id: slug, name: L.name, profile: null, legend: L, career, retired: true, ref: paceEnd(career.blocks), end, fetchedAt: null });
    history.replaceState(null, '', '?lenda=' + slug);
    // a foto vem da busca da Transfermarkt, se o jogador estiver lá
    if (L.tmId) {
      getJSON('/api/busca?q=' + encodeURIComponent(L.name)).then((r) => {
        const hit = (r.results || []).find((x) => x.id === String(L.tmId));
        if (!hit || !hit.imageUrl || /default\.jpg/.test(hit.imageUrl) || seq !== state.seq) return;
        state.profile = { imageUrl: hit.imageUrl };
        renderPlayer();
      }).catch(() => {});
    }
  }

  function showLoading(msg) {
    $('erro').hidden = true;
    $('carregando').hidden = false;
    $('carregando').textContent = msg;
  }

  function setup(p) {
    Object.assign(state, p);
    const c = state.career;
    state.total = c.blocks.reduce((s, g) => s + g.goals, 0);
    state.rate = rateParams(c.blocks, state.ref);
    state.gpyAuto = gamesPerYear(c.blocks, state.ref);
    state.ageRef = (state.ref - c.birth) / YEAR;
    state.milestone = officialMilestone(c.blocks);
    $('aposentadoria').min = Math.floor(state.ageRef) + 1;
    // padrão: 40 anos, mas sempre pelo menos 3 temporadas à frente (com 39, 40 seria só meio ano de jogo)
    $('aposentadoria').value = Math.max(40, Math.floor(state.ageRef) + 3);
    $('jogosAno').value = Math.max(1, Math.round(state.gpyAuto));
    $('queda').value = 0;
    $('campoAposentadoria').hidden = state.retired;
    $('atualizar').hidden = state.kind !== 'tm';
    $('cardAntes').hidden = state.retired;
    $('cardEncerrada').hidden = !state.retired;
    $('cardCdf').hidden = state.retired;
    $('legendaSim').hidden = state.retired;
    $('carregando').hidden = true;
    $('conteudo').hidden = false;
    renderPlayer();
    run();
  }

  const ageAt = (d) => (d - state.career.birth) / YEAR;

  function renderPlayer() {
    const c = state.career, p = state.profile, L = state.legend, blocks = c.blocks;
    $('foto').hidden = !(p && p.imageUrl);
    if (p && p.imageUrl) { $('foto').src = p.imageUrl; $('foto').alt = state.name; }
    $('nome').textContent = state.name;
    let sub;
    if (L) {
      const clubs = [...new Set(blocks.filter((g) => !g.nt).map((g) => g.club))];
      sub = [clubs.join(', '), `nasceu em ${fmtDay(c.birth)}`, c.death ? `morreu em ${fmtDay(c.death)}` : ''];
    } else {
      const club = (p && p.club && p.club.name) || [...blocks].reverse().find((g) => !g.nt)?.club || '';
      const pos = p && p.position && (p.position.main || (typeof p.position === 'string' ? p.position : ''));
      sub = [state.retired ? `último clube: ${club}` : club, state.retired ? `nasceu em ${fmtDay(c.birth)}` : `${Math.floor(state.ageRef)} anos (nasceu em ${fmtDay(c.birth)})`, pos];
    }
    $('sub').textContent = sub.filter(Boolean).join(' · ');
    const lastYear = blocks.filter((g) => !g.live);
    const games365 = lastYear.reduce((s, g) => s + g.games * overlap(g, state.ref - 365, state.ref), 0);
    const goals365 = lastYear.reduce((s, g) => s + g.goals * overlap(g, state.ref - 365, state.ref), 0);
    $('ultimoAno').textContent = `${plural(goals365, 'gol', 'gols')} em ${plural(games365, 'jogo', 'jogos')} ${state.retired ? 'no último ano de carreira' : 'nos últimos 12 meses'}` +
      (state.retired ? ` · encerrou em ${L ? yearOf(state.end) : fmtDay(state.end)}, aos ${Math.floor(ageAt(state.end))} anos` : '');
    $('total').textContent = fmtInt(state.total);
    $('falta').textContent = state.total >= 1000 ? 'já passou dos 1000' : `${state.retired ? 'faltaram' : 'faltam'} ${fmtInt(1000 - state.total)}`;
    $('totalTodos').hidden = !(L && L.allTotal);
    if (L && L.allTotal) $('totalTodos').textContent = `${fmtInt(L.allTotal.goals)} contando amistosos`;
    const live = blocks.find((g) => g.live);
    $('aoVivo').hidden = !live;
    if (live) $('aoVivo').textContent = `Jogo em andamento (${STATE_PT[live.state] || 'ao vivo'}): ${plural(live.goals, 'gol', 'gols')} até agora, já somado${live.goals === 1 ? '' : 's'} ao total.`;
  }

  let timer = null;
  function run() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const retireAge = +$('aposentadoria').value, gpy = +$('jogosAno').value, decline = +$('queda').value / 100;
      $('aposentadoriaOut').textContent = `${retireAge} anos`;
      $('jogosAnoOut').textContent = `${gpy} por ano` + (Math.round(state.gpyAuto) === gpy ? (state.retired ? ' (ritmo dos 2 últimos anos de carreira)' : ' (ritmo dos últimos 2 anos)') : '');
      $('quedaOut').textContent = decline ? `${fmtDec(decline * 100, 0)}% por ano depois dos ${Math.max(DECLINE_FROM, Math.floor(state.ageRef))}` : 'sem queda';
      Object.assign(state, { retireAge, gpy, decline, retireDay: Math.round(state.career.birth + retireAge * YEAR) });
      const m = { total: state.total, start: state.ref, birth: state.career.birth, gpy, decline };
      const t0 = performance.now();
      state.sim = state.retired ? null : simulate({ ...m, a: state.rate.a, b: state.rate.b, retireDay: state.retireDay });
      state.ms = performance.now() - t0;
      const path = [[state.ref, state.total]];
      state.proj = { p50: project(state.rate.q50, m, path), early: project(state.rate.q90, m), late: project(state.rate.q10, m), path };
      renderResult();
    }, 120);
  }

  function renderResult() {
    const s = state.sim, r = state.rate, L = state.legend;
    if (s) {
      const need = 1000 - state.total;
      $('chance').textContent = state.total >= 1000 ? '100%' : fmtPct(s.p);
      $('chanceTxt').textContent = `de chance de fazer o gol 1000 antes de se aposentar aos ${state.retireAge}`;
      $('quando').innerHTML = s.p50 != null
        ? `Data mais provável: <strong>${fmtDay(s.p50)}</strong>, aos ${Math.floor(ageAt(s.p50))} anos. Em 80% das simulações que chegam lá, entre ${fmtDay(s.p10)} e ${fmtDay(s.p90)}.`
        : `Em nenhuma das ${fmtInt(N_SIMS)} simulações ele chega lá. Na mediana, se aposenta com <strong>${fmtInt(s.finalP50)}</strong> gols (80%: ${fmtInt(s.finalP10)} a ${fmtInt(s.finalP90)}).`;
      const needRate = s.days.length ? need / s.days.length : Infinity;
      $('ritmo').innerHTML = `Precisa de <strong>${fmtDec(needRate)}</strong> gol por jogo em ${fmtInt(s.days.length)} jogos até ${fmtDay(state.retireDay)}. ` +
        `O ritmo atual é <strong>${fmtDec(r.q50)}</strong> (80%: ${fmtDec(r.q10)} a ${fmtDec(r.q90)}).`;
    } else {
      const ms = state.milestone;
      $('encerradaBig').textContent = ms ? `aos ${Math.floor(ageAt(ms.day))} anos` : fmtInt(state.total);
      $('encerradaTxt').textContent = ms
        ? `fez o gol 1000 oficial ${ms.exact ? 'em ' + fmtDay(ms.day) : 'na temporada ' + (ms.block.season || yearOf(ms.day))}`
        : `gols oficiais quando parou, em ${yearOf(state.end)}, aos ${Math.floor(ageAt(state.end))} anos`;
      const m = L && L.milestone1000;
      $('encerradaMarco').hidden = !m;
      if (m) {
        $('encerradaMarco').innerHTML = `${/^contagem/i.test(m.count) ? 'Na' : 'Na contagem'} ${esc(m.count)}, o gol 1000 saiu em <strong>${fmtDay(dayOf(m.date))}</strong>, aos ${Math.floor(ageAt(dayOf(m.date)))} anos` +
          (m.match ? `: ${esc([m.how, m.match].filter(Boolean).join(', '))}` : '') + '.' +
          (L.allTotal ? ` Nessa contagem, terminou com ${fmtInt(L.allTotal.goals)}.` : '');
      }
    }
    // projeção sem aposentadoria
    const pj = state.proj, never = pj.p50 == null;
    $('sempreTitulo').textContent = state.retired ? 'E se ele não tivesse parado?' : 'E se ele nunca se aposentasse?';
    if (state.total >= 1000) {
      $('idade').textContent = 'já fez';
      $('idadeTxt').textContent = '';
      $('piada').textContent = '';
    } else if (never) {
      $('idade').textContent = 'nunca';
      $('idadeTxt').textContent = `Com o ritmo de ${fmtDec(r.q50)} gol por jogo caindo ${fmtDec(state.decline * 100, 0)}% ao ano, ele não passa de 1000 nem jogando para sempre.`;
      $('piada').textContent = joke(0, 0, true);
    } else {
      const age = ageAt(pj.p50), years = (pj.p50 - state.ref) / YEAR;
      $('idade').textContent = `aos ${fmtInt(Math.floor(age))} anos`;
      const ageEarly = pj.early != null ? Math.floor(ageAt(pj.early)) : null, ageLate = pj.late != null ? Math.floor(ageAt(pj.late)) : null;
      const range = ageEarly != null && ageLate != null
        ? (ageEarly === ageLate ? ` Mesmo com a incerteza do ritmo, continua aos ${fmtInt(ageEarly)} anos (80%).`
          : ` Com a incerteza do ritmo, entre ${fmtInt(ageEarly)} e ${fmtInt(ageLate)} anos (80%).`)
        : pj.early != null ? ` Se o ritmo for mais alto, a partir dos ${fmtInt(Math.floor(ageAt(pj.early)))}; se for mais baixo, pode nunca chegar.` : '';
      $('idadeTxt').innerHTML = `O gol 1000 sairia por volta de <strong>${yearOf(pj.p50)}</strong>, ${state.retired ? 'continuando no ritmo do fim da carreira' : 'mantendo o ritmo de hoje'}: ` +
        `${fmtDec(r.q50)} gol por jogo, ${state.gpy} jogos por ano${state.decline ? `, caindo ${fmtDec(state.decline * 100, 0)}% ao ano` : ''}.` + range;
      $('piada').textContent = joke(age, years, false);
    }
    renderState();
    drawCareer();
    if (s) drawCdf();
  }

  // painel de estado: tudo o que entrou na conta, para conferir
  function renderState() {
    const c = state.career, r = state.rate, s = state.sim, L = state.legend;
    const club = c.blocks.filter((g) => !g.nt), nt = c.blocks.filter((g) => g.nt);
    const games = (a) => a.reduce((x, g) => x + g.games, 0), goals = (a) => a.reduce((x, g) => x + g.goals, 0);
    const rows = [];
    if (L) {
      rows.push(['Fonte', `dados curados à mão, por temporada: ${(L.sources || []).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">${i + 1}</a>`).join(' ')}`]);
      if (L.officialTotal) rows.push(['Total oficial citado', `${fmtInt(L.officialTotal.goals)} gols` + (L.officialTotal.games ? ` em ${fmtInt(L.officialTotal.games)} jogos` : '') +
        (L.officialTotal.goals !== state.total ? ` (soma das temporadas usadas aqui: ${fmtInt(state.total)})` : '')]);
      if (L.notes) rows.push(['Observações', esc(L.notes)]);
    } else {
      rows.push(['Fonte', `Transfermarkt, jogo a jogo; consultado às ${state.fetchedAt.toLocaleTimeString('pt-BR')}`]);
    }
    rows.push(['Contados', `${fmtInt(games(c.blocks))} jogos oficiais: ${fmtInt(games(club))} por clubes (${fmtInt(goals(club))} gols) e ${fmtInt(games(nt))} pela seleção (${fmtInt(goals(nt))} gols)`]);
    if (!L) rows.push(['Excluídos', c.dropped.length ? c.dropped.map(([k, v]) => `${esc(k)}: ${plural(v.games, 'jogo', 'jogos')}, ${plural(v.goals, 'gol', 'gols')}`).join('<br>') : 'nada']);
    rows.push(['Ritmo por jogo', `posteriori Gamma(a = ${fmtDec(r.a, 1)}, b = ${fmtDec(r.b, 1)}), peso que cai pela metade a cada ${HALF_LIFE} dias antes de ${fmtDay(state.ref)}; mediana ${fmtDec(r.q50)}, faixa de 80%: ${fmtDec(r.q10)} a ${fmtDec(r.q90)} (média ponderada dos jogos: ${fmtDec(r.mean)})`]);
    rows.push(['Jogos por ano', `${state.gpy} (medido nos 2 anos antes de ${fmtDay(state.ref)}: ${fmtDec(state.gpyAuto, 1)})`]);
    if (state.end !== state.ref) rows.push(['Fim do ritmo', `${fmtDay(state.ref)}: o retorno isolado até ${fmtDay(state.end)} conta no total, mas fica fora do ritmo e dos jogos por ano`]);
    rows.push(['Queda por idade', state.decline ? `ritmo × ${fmtDec(1 - state.decline)} a cada ano depois dos ${fmtDec(Math.max(DECLINE_FROM, state.ageRef), 1)} anos` : 'nenhuma']);
    if (s) rows.push(['Simulação', `${fmtInt(N_SIMS)} carreiras, semente ${SEED}, ${fmtInt(s.days.length)} jogos sintéticos até ${fmtDay(state.retireDay)}; ${fmtInt(state.ms)} ms`]);
    rows.push(['Projeção sem aposentadoria', 'gols esperados com o ritmo mediano; a faixa usa os ritmos de 10% e 90%. Sem sorteio: é conta, não simulação.']);
    $('estado').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }

  // ---------- gráficos ----------
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function fitCanvas(cv) {
    const rect = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(10, Math.round(rect.width)), h = Math.max(10, Math.round(rect.height));
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }
  function axes(ctx, w, h, pad, x0, x1, y0, y1, yTicks, yFmt) {
    const X = (v) => pad.l + (v - x0) / (x1 - x0) * (w - pad.l - pad.r);
    const Y = (v) => h - pad.b - (v - y0) / (y1 - y0) * (h - pad.t - pad.b);
    ctx.font = `12px ${cssVar('--font-body')}`;
    ctx.fillStyle = cssVar('--muted'); ctx.strokeStyle = cssVar('--grid'); ctx.lineWidth = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of yTicks) { ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke(); ctx.fillText(yFmt(v), pad.l - 6, Y(v)); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const y0y = yearOf(x0), y1y = yearOf(x1);
    const every = Math.max(1, Math.ceil((y1y - y0y) / Math.max(2, Math.floor((w - pad.l - pad.r) / 56))));
    for (let y = Math.ceil((y0y + 1) / every) * every; y <= y1y; y += every) {
      const d = Math.floor(Date.UTC(y, 0, 1) / DAY);
      ctx.fillText(String(y), X(d), h - pad.b + 6);
    }
    return { X, Y };
  }
  // linha vertical com rótulo no alto, do lado `align`; à esquerda, o rótulo não passa de minX (onde fica o "gol 1000")
  function vline(ctx, X, d, label, { pad, w, h, align = 'right', minX = pad.l }) {
    const x = X(d);
    ctx.strokeStyle = cssVar('--line'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
    ctx.fillStyle = cssVar('--muted'); ctx.textBaseline = 'top'; ctx.font = `12px ${cssVar('--font-body')}`;
    const tw = ctx.measureText(label).width;
    if (align === 'right' && x - 4 - tw < minX) align = 'left';
    else if (align === 'left' && x + 4 + tw > w - pad.r) {
      // não cabe à direita (tela estreita): vai para o pé da linha, do lado esquerdo, longe do rótulo de "hoje"
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      return haloText(ctx, label, x - 4, h - pad.b - 2);
    }
    ctx.textAlign = align;
    ctx.fillText(label, x + (align === 'left' ? 4 : -4), pad.t + 2);
  }
  // texto com contorno da cor do cartão, para continuar legível sobre linhas e faixas
  function haloText(ctx, text, x, y) {
    ctx.save(); ctx.strokeStyle = cssVar('--surface'); ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeText(text, x, y); ctx.restore();
    ctx.fillText(text, x, y);
  }

  function drawCareer() {
    const { ctx, w, h } = fitCanvas($('carreira'));
    const s = state.sim, blocks = state.career.blocks, pj = state.proj;
    // o eixo vai até o gol 1000 projetado, se ele cair antes dos 100 anos; senão para 15 anos depois do ponto de partida
    const end = state.retired ? state.end + 2 * YEAR : state.retireDay;
    const projVisible = pj.p50 != null && ageAt(pj.p50) <= 100;
    const projMark = projVisible && state.total < 1000;
    const retireLabel = `aposenta aos ${state.retireAge}`, projLabel = projMark ? `aos ${Math.floor(ageAt(pj.p50))} anos` : '';
    const pad = { l: 46, r: 14, t: 12, b: 26 }, plotW = w - pad.l - pad.r, font = cssVar('--font-body');
    const x0 = blocks[0].from - 120;
    // fim do eixo que deixa `px` pixels livres à direita da data d (no máximo um quarto do gráfico)
    const roomFor = (d, px) => x0 + (d - x0) * plotW / Math.max(plotW - px, plotW * 0.75);
    const textW = (f, t) => { ctx.font = `${f}12px ${font}`; return ctx.measureText(t).width; };
    const x1 = Math.max(Math.max(end, projVisible ? pj.p50 : state.ref + 15 * YEAR) + 120,
      state.retired ? -Infinity : roomFor(state.retireDay, textW('', retireLabel) + 8),
      projMark ? roomFor(pj.p50, textW('600 ', projLabel) + 14) : -Infinity);
    const yMax = Math.max(1000, s ? s.finalP90 : 0, state.total) * 1.06;
    const ticks = []; for (let v = 0; v <= yMax; v += yMax > 1200 ? 250 : 200) ticks.push(v);
    const { X, Y } = axes(ctx, w, h, pad, x0, x1, 0, yMax, ticks, fmtInt);
    const accent = cssVar('--accent'), gold = cssVar('--gold'), fg = cssVar('--fg'), muted = cssVar('--muted');
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, 0, w - pad.l - pad.r, h); ctx.clip();
    // meta
    ctx.strokeStyle = gold; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, Y(1000)); ctx.lineTo(w - pad.r, Y(1000)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = gold; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.font = `600 12px ${cssVar('--font-body')}`;
    ctx.fillText('gol 1000', pad.l + 4, Y(1000) - 3);
    // simulação até a aposentadoria: faixa de 80% e mediana
    if (s) {
      ctx.fillStyle = accent; ctx.globalAlpha = 0.18; ctx.beginPath();
      s.fan.forEach(([d, , , hi], i) => (i ? ctx.lineTo(X(d), Y(hi)) : ctx.moveTo(X(d), Y(hi))));
      [...s.fan].reverse().forEach(([d, lo]) => ctx.lineTo(X(d), Y(lo)));
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath();
      s.fan.forEach(([d, , mid], i) => (i ? ctx.lineTo(X(d), Y(mid)) : ctx.moveTo(X(d), Y(mid))));
      ctx.stroke(); ctx.setLineDash([]);
    }
    // projeção sem aposentadoria
    if (pj.path.length > 1 && state.total < 1000) {
      ctx.strokeStyle = gold; ctx.lineWidth = 1.5; ctx.setLineDash([2, 4]); ctx.beginPath();
      pj.path.forEach(([d, v], i) => (i ? ctx.lineTo(X(d), Y(Math.min(v, 1000))) : ctx.moveTo(X(d), Y(v))));
      ctx.stroke(); ctx.setLineDash([]);
    }
    // carreira real: gols acumulados em cada início/fim de bloco; dentro de uma temporada a linha sobe por igual
    // (temporadas de clube e anos de seleção se sobrepõem, por isso a soma é feita data a data)
    ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.beginPath();
    const pts = [...new Set(blocks.flatMap((g) => [g.from, g.to]))].sort((x, y) => x - y);
    ctx.moveTo(X(pts[0]), Y(0));
    for (const d of pts) ctx.lineTo(X(d), Y(cumAtDay(d)));
    ctx.stroke();
    const goalLabelEnd = pad.l + 4 + textW('600 ', 'gol 1000') + 8;
    vline(ctx, X, state.end, state.retired ? 'fim da carreira' : 'hoje', { pad, w, h, minX: goalLabelEnd });
    if (!state.retired) vline(ctx, X, state.retireDay, retireLabel, { pad, w, h, align: 'left' });
    if (projMark) {
      ctx.strokeStyle = gold; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(pj.p50), Y(1000), 6, 0, 2 * Math.PI); ctx.stroke();
      ctx.fillStyle = gold; ctx.textBaseline = 'top'; ctx.font = `600 12px ${font}`;
      ctx.textAlign = X(pj.p50) + 8 + ctx.measureText(projLabel).width > w - pad.r ? 'right' : 'left';
      haloText(ctx, projLabel, X(pj.p50) + (ctx.textAlign === 'right' ? -8 : 8), Y(1000) + 6);
    } else if (state.total < 1000) {
      ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.font = `600 12px ${cssVar('--font-body')}`;
      ctx.fillText(pj.p50 == null ? 'gol 1000: nunca →' : `gol 1000 só aos ${fmtInt(Math.floor(ageAt(pj.p50)))} anos →`, w - pad.r - 4, Y(1000) + 6);
    }
    // o gol 1000 de verdade, quando houve (oficial ou na contagem com amistosos)
    const ms = state.milestone, lm = state.legend && state.legend.milestone1000;
    for (const d of [ms && ms.day, lm && dayOf(lm.date)].filter((x) => x != null)) {
      const yv = Math.min(1000, cumAtDay(d));
      ctx.fillStyle = gold; ctx.beginPath(); ctx.arc(X(d), Y(yv), 5, 0, 2 * Math.PI); ctx.fill();
      if (lm && d === dayOf(lm.date)) {
        // a curva acumulada só sobe, então acima e à esquerda do ponto, ou abaixo e à direita, ela nunca passa
        const label = `gol 1000 contando amistosos (${yearOf(d)})`, x = X(d), y = Y(yv);
        ctx.font = `600 12px ${font}`;
        const tw = ctx.measureText(label).width;
        if (x - 8 - tw >= pad.l) {
          ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
          haloText(ctx, label, x - 8, y - 6);
        } else {
          ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          const lines = x + 8 + tw <= w - pad.r ? [label] : ['gol 1000 contando', `amistosos (${yearOf(d)})`];  // tela estreita: duas linhas
          lines.forEach((t, i) => haloText(ctx, t, x + 8, y + 6 + i * 15));
        }
      }
    }
    ctx.restore();
  }
  function cumAtDay(d) {
    let cum = 0;
    for (const g of state.career.blocks) {
      if (g.to <= d) cum += g.goals;
      else if (g.from < d) cum += g.goals * (d - g.from) / (g.to - g.from);
    }
    return cum;
  }

  function drawCdf() {
    const { ctx, w, h } = fitCanvas($('cdf'));
    const s = state.sim;
    const x0 = state.ref, x1 = state.retireDay;
    const pad = { l: 46, r: 14, t: 26, b: 26 };
    const { X, Y } = axes(ctx, w, h, pad, x0, x1, 0, 1, [0, 0.25, 0.5, 0.75, 1], (v) => `${v * 100}%`);
    ctx.strokeStyle = cssVar('--accent'); ctx.lineWidth = 2.5; ctx.beginPath();
    s.cdf.forEach(([d, p], i) => (i ? ctx.lineTo(X(d), Y(p)) : ctx.moveTo(X(d), Y(p))));
    ctx.stroke();
    // marcas de idade no topo
    ctx.fillStyle = cssVar('--muted'); ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = `11px ${cssVar('--font-body')}`;
    const every = Math.max(1, Math.ceil(60 / (X(x0 + YEAR) - X(x0))));
    for (let age = Math.ceil(state.ageRef); age <= state.retireAge; age += every) {
      const d = state.career.birth + age * YEAR;
      if (d > x0 && d < x1) ctx.fillText(`${age} anos`, X(d), 4);
    }
  }

  // ---------- busca e controles ----------
  function renderPresets() {
    $('atalhos').innerHTML = PRESETS.map(([id, n]) => `<button type="button" class="chip" data-id="${id}" data-nome="${esc(n)}">${esc(n)}</button>`).join('');
    $('lendas').innerHTML = LENDAS.map((L) => `<button type="button" class="chip lenda" data-lenda="${esc(L.id)}">${esc(L.name)}</button>`).join('');
    $('linhaLendas').hidden = !LENDAS.length;
  }
  let searchTimer = null, searchSeq = 0;
  const searchHits = new Map();   // id -> resultado da busca (nome, foto, clube, posição)
  $('busca').addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = $('busca').value.trim();
    if (q.length < 3) { $('resultados').innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      $('resultados').innerHTML = '<li class="muted">buscando…</li>';
      try {
        const r = await getJSON('/api/busca?q=' + encodeURIComponent(q));
        if (seq !== searchSeq) return;
        const items = (r.results || []).slice(0, 10);
        for (const p of items) searchHits.set(p.id, p);
        $('resultados').innerHTML = items.length ? items.map((p) =>
          `<li><button type="button" data-id="${esc(p.id)}" data-nome="${esc(p.name)}"><strong>${esc(p.name)}</strong>
           <span class="muted">${esc([p.position, p.club && p.club.name, p.age && p.age + ' anos', (p.nationalities || [])[0]].filter(Boolean).join(' · '))}</span></button></li>`).join('')
          : '<li class="muted">ninguém com esse nome</li>';
      } catch (e) {
        if (seq === searchSeq) $('resultados').innerHTML = `<li class="muted">busca falhou: ${esc(e.message)}</li>`;
      }
    }, 350);
  });
  document.addEventListener('click', (e) => {
    const lb = e.target.closest('button[data-lenda]');
    if (lb) { loadLegend(lb.dataset.lenda); return; }
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    $('resultados').innerHTML = '';
    // se a lenda estiver na base curada, usa a base: a Transfermarkt é incompleta para o futebol antigo
    const L = LENDAS.find((x) => String(x.tmId) === b.dataset.id);
    if (L) loadLegend(L.id);
    else loadPlayer(b.dataset.id, searchHits.get(b.dataset.id) || { name: b.dataset.nome });
  });
  for (const id of ['aposentadoria', 'jogosAno', 'queda']) $(id).addEventListener('input', () => state.career && run());
  $('atualizar').addEventListener('click', () => state.kind === 'tm' && loadPlayer(state.id, state.profile || { name: state.name }));
  let resizeTimer = null;
  const redraw = () => { if (!state.proj) return; drawCareer(); if (state.sim) drawCdf(); };
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(redraw, 120); });

  // ---------- tema (mesma preferência da corrida Messi × CR7) ----------
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
  new MutationObserver(() => { syncThemeBtn(); redraw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { syncThemeBtn(); redraw(); });
  syncThemeBtn();

  // ---------- início ----------
  getJSON('data/lendas.json').catch(() => []).then((lendas) => {
    LENDAS = lendas;
    renderPresets();
    const qs = new URLSearchParams(location.search);
    const startId = qs.get('id'), startLenda = qs.get('lenda');
    if (startLenda && LENDAS.some((L) => L.id === startLenda)) loadLegend(startLenda);
    else if (startId && /^\d+$/.test(startId)) loadPlayer(startId, { name: PRESETS.find((p) => p[0] === startId)?.[1] });
    else loadPlayer('38253', { name: 'Lewandowski' });
  });
})();
