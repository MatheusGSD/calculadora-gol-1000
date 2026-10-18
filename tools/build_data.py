"""Gera data/data.json e data/data.js para a página "Corrida ao Gol 1000".

Entradas (data/sources/):
  mvr_<p>_pd.json  histórico jogo a jogo do messivsronaldo.app (mesma contagem da imprensa); --baixar troca pelos de agora
  fixtures.csv     jogos futuros levantados em 10/10/2026 (Transfermarkt, ESPN, Wikipedia), editado à mão

A montagem fica em build(), que o tools/servidor.py também chama com o histórico baixado na hora (/api/corrida).

Regras combinadas com o usuário:
  - só jogos de clube entram no ritmo e no calendário futuro (gols por seleção contam só no total da carreira);
  - o jogador entra em todos os jogos do clube; sem aposentadoria e sem queda por idade;
  - calendário futuro só com jogos garantidos: liga e fase de liga/grupos; mata-mata só quando o clube
    já está classificado para aquela fase. Temporadas sem tabela publicada recebem só os jogos de liga.

Uso:  python -I tools/build_data.py            (refaz data.js com os arquivos de data/sources)
      python -I tools/build_data.py --baixar   (baixa o histórico de agora do messivsronaldo.app antes)
"""
import csv
import json
import math
import os
import re
import sys
import urllib.request
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'sources')
OUT = os.path.join(ROOT, 'data')

# histórico jogo a jogo do messivsronaldo.app: o JSON que o próprio site carrega (Gatsby). Não é API documentada.
MVR_URL = 'https://www.messivsronaldo.app/page-data/match-histories/{}-match-history/page-data.json'
MVR_SLUG = {'messi': 'messi', 'cr7': 'ronaldo'}
SNAPSHOT_AS_OF = '2026-10-10'  # data da primeira coleta, cujos arquivos não trazem "baixadoEm"
NT = {'Argentina', 'Portugal'}
CLUB_FROM = '2019-07-01'   # início dos jogos de clube usados no ritmo (recorte livre e ponderado)
HIST_FROM = '2022-07-01'   # início da linha real no gráfico da corrida

COMP_PT = {
    'MLS': 'MLS', 'MLS Cup': 'Playoffs MLS', 'Leagues Cup': 'Leagues Cup', 'CONCACAF Champions Cup': 'Concachampions',
    'Campeones Cup': 'Campeones Cup', 'Club World Cup': 'Mundial de Clubes', 'US Open Cup': 'US Open Cup',
    'Saudi Pro League': 'Liga Saudita', 'Saudi King Cup': 'Copa do Rei', 'Saudi Super Cup': 'Supercopa Saudita',
    'AFC Champions League': 'Champions da Ásia', 'AFC Champions League 2': 'Champions da Ásia 2',
    'Arab Club Champions Cup': 'Copa Árabe de Clubes', 'Ligue 1': 'Ligue 1', 'Coupe de France': 'Copa da França',
    'Champions League': 'Champions League', 'Serie A': 'Serie A', 'Premier League': 'Premier League',
    'La Liga': 'La Liga', 'Copa del Rey': 'Copa do Rei (ESP)', 'Coppa Italia': 'Copa da Itália',
    'FA Cup': 'FA Cup', 'League Cup': 'Copa da Liga', 'Europa League': 'Europa League',
    'Supercoppa Italiana': 'Supercopa da Itália', 'Supercopa de Espana': 'Supercopa da Espanha',
    'Trophee des Champions': 'Supercopa da França',
}
TEAM_PT = {'Al Nassr': 'Al-Nassr', 'Inter Miami': 'Inter Miami', 'Paris Saint-Germain': 'PSG',
           'Manchester United': 'Man. United', 'Juventus': 'Juventus', 'Barcelona': 'Barcelona'}


def d(s):
    return date.fromisoformat(s)


def br(s):
    return f'{s[8:10]}/{s[5:7]}/{s[:4]}'


def download_mvr(p, timeout=40):
    req = urllib.request.Request(MVR_URL.format(MVR_SLUG[p]), headers={'User-Agent': 'Mozilla/5.0 gol1000'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def parse_mvr(raw):
    key = next(iter(raw['result']['data']))
    rows = []
    for e in raw['result']['data'][key]['edges']:
        n = e['node']
        dd, mm = n['date'].split('-')
        rows.append({
            'date': f"{n['year']}-{mm}-{dd}", 'team': n['team'], 'comp': n['competition'],
            'opp': n['opponent'], 'ha': n['homeAway'], 'goals': int(n['goals'] or 0),
            'pens': int(n['pens'] or 0) if str(n['pens']).isdigit() else 0,
            'mins': int(n['minsPlayed']) if str(n['minsPlayed']).isdigit() else None,
        })
    rows.sort(key=lambda r: r['date'])
    return rows


def history(rows):
    cum, out = 0, []
    for r in rows:
        cum += r['goals']
        if r['date'] >= HIST_FROM:
            out.append([r['date'], cum, 0 if r['team'] in NT else 1])
    start = out[0][1] - next(r['goals'] for r in rows if r['date'] >= HIST_FROM)
    return start, out


def club_matches(rows):
    out = []
    for r in rows:
        if r['team'] in NT or r['date'] < CLUB_FROM:
            continue
        out.append([r['date'], r['goals'], r['opp'], COMP_PT.get(r['comp'], r['comp']), TEAM_PT.get(r['team'], r['team']), r['ha']])
    return out


# ---------------- calendário futuro ----------------
GUARANTEED = {
    'Inter Miami': ['MLS regular season 2026', 'MLS Cup Playoffs 2026 - Round One Game 1 (best-of-3)',
                    'MLS Cup Playoffs 2026 - Round One Game 2 (best-of-3)'],
    'Al-Nassr': ['Saudi Pro League 2026-27', 'AFC Champions League Elite 2026-27 - league stage (West)',
                 "King's Cup 2026-27 - Round of 16", 'Saudi Super Cup 2026 - Semi-final'],
}
FX_COMP_PT = {
    'MLS regular season 2026': 'MLS', 'MLS Cup Playoffs 2026 - Round One Game 1 (best-of-3)': 'Playoffs MLS · jogo 1',
    'MLS Cup Playoffs 2026 - Round One Game 2 (best-of-3)': 'Playoffs MLS · jogo 2', 'Saudi Pro League 2026-27': 'Liga Saudita',
    'AFC Champions League Elite 2026-27 - league stage (West)': 'Champions da Ásia',
    "King's Cup 2026-27 - Round of 16": 'Copa do Rei · oitavas', 'Saudi Super Cup 2026 - Semi-final': 'Supercopa · semifinal',
}


def real_fixtures(team, after):
    """Jogos garantidos do clube depois de `after` (os de antes já estão no histórico, ou já passaram)."""
    out = []
    with open(os.path.join(SRC, 'fixtures.csv'), encoding='utf-8') as f:
        for r in csv.DictReader(f):
            if r['team'] != team or r['competition'] not in GUARANTEED[team] or not r['date'] or r['date'] <= after:
                continue
            opp = re.sub(r'\s+(FC|SC|SFC|Club)$', '', r['opponent'])
            if opp.startswith('TBD'):
                opp = 'adversário a definir'
            out.append([r['date'], opp, FX_COMP_PT[r['competition']], r['home_away'], 1 if r['confirmed'] == 'Y' else 0])
    out.sort(key=lambda x: x[0])
    return out


def spread(start, end, n, blackouts):
    """n datas espaçadas por igual entre start e end, pulando os intervalos de pausa."""
    days, cur = [], d(start)
    while cur <= d(end):
        if not any(d(a) <= cur <= d(b) for a, b in blackouts):
            days.append(cur)
        cur += timedelta(days=1)
    step = (len(days) - 1) / (n - 1)
    return [days[round(i * step)].isoformat() for i in range(n)]


def shift(s, years):
    x = d(s)
    try:
        return x.replace(year=x.year + years).isoformat()
    except ValueError:
        return (x.replace(day=28, year=x.year + years)).isoformat()


def synthetic_miami():
    out = []
    # MLS 2027 "Sprint Season": 14 jogos de liga entre fev e abr/2027 (datas não publicadas)
    for i, dt in enumerate(spread('2027-02-20', '2027-04-28', 14, [('2027-03-22', '2027-03-30')]), 1):
        out.append([dt, f'rodada {i} de 14', 'MLS 2027 · temporada curta', '', 2])
    # MLS 2027-28 em diante: 34 jogos de jul a abr, pausa de inverno e datas FIFA
    base = [('2027-09-20', '2027-10-05'), ('2027-11-08', '2027-11-16'), ('2027-12-13', '2028-02-05'), ('2028-03-20', '2028-03-28')]
    for k in range(8):
        y = 2027 + k
        bl = [(shift(a, k), shift(b, k)) for a, b in base]
        for i, dt in enumerate(spread(shift('2027-07-17', k), shift('2028-04-29', k), 34, bl), 1):
            out.append([dt, f'rodada {i} de 34', f'MLS {y}-{str(y + 1)[2:]}', '', 2])
    return out


def synthetic_nassr():
    out = []
    base = [('2027-09-20', '2027-10-05'), ('2027-11-08', '2027-11-16'), ('2028-03-20', '2028-03-28')]
    for k in range(8):
        y = 2027 + k
        bl = [(shift(a, k), shift(b, k)) for a, b in base]
        for i, dt in enumerate(spread(shift('2027-08-14', k), shift('2028-05-27', k), 34, bl), 1):
            out.append([dt, f'rodada {i} de 34', f'Liga Saudita {y}-{str(y + 1)[2:]}', '', 2])
    return out


# ---------------- meia-vida do recorte ponderado ----------------
A0, B0 = 0.5, 0.0   # priori de Jeffreys para a taxa de Poisson


def nb_logpmf(k, a, p):
    """log P(K=k) da binomial negativa: Gamma(a, b) misturando Poisson sobre n jogos, com p = b/(b+n)."""
    return math.lgamma(a + k) - math.lgamma(a) - math.lgamma(k + 1) + a * math.log(p) + k * math.log1p(-p)


def score_half_life(matches, h, eval_from, block=20, stride=3):
    """Pontua a previsão do total de gols nos próximos `block` jogos, a partir de várias origens."""
    t = [d(m[0]).toordinal() for m in matches]
    g = [m[1] for m in matches]
    total, n_orig = 0.0, 0
    for i in range(len(matches)):
        if matches[i][0] < eval_from or i + block > len(matches) or (i % stride):
            continue
        a, b = A0, B0
        for j in range(i):
            w = 1.0 if h is None else 0.5 ** ((t[i] - t[j]) / h)
            a += w * g[j]
            b += w
        k = sum(g[i:i + block])
        total += nb_logpmf(k, a, b / (b + block))
        n_orig += 1
    return total, n_orig


def build(raws, as_of, log=lambda *a: None):
    """Monta os dados da página a partir do histórico do messivsronaldo.app (raws[p], JSON como o site entrega)."""
    players = {}
    meta = {
        'messi': {'name': 'Lionel Messi', 'short': 'Messi', 'club': 'Inter Miami'},
        'cr7': {'name': 'Cristiano Ronaldo', 'short': 'CR7', 'club': 'Al-Nassr'},
    }
    yesterday = (d(as_of) - timedelta(days=1)).isoformat()
    clubs = {}
    for p in ('messi', 'cr7'):
        rows = [r for r in parse_mvr(raws[p]) if r['date'] <= as_of]
        total = sum(r['goals'] for r in rows)
        start, hist = history(rows)
        clubs[p] = club_matches(rows)
        team = meta[p]['club']
        # o calendário começa depois do último jogo registrado e nunca antes de hoje
        fx_real = real_fixtures(team, max(clubs[p][-1][0], yesterday))
        fx_syn = synthetic_miami() if p == 'messi' else synthetic_nassr()
        last_real = fx_real[-1][0] if fx_real else as_of
        fx = fx_real + [x for x in fx_syn if x[0] > last_real]
        debut = next(m[0] for m in clubs[p] if m[4] == team)
        g = [m[1] for m in clubs[p] if m[0] >= debut]
        mean = sum(g) / len(g)
        var = sum((x - mean) ** 2 for x in g) / (len(g) - 1)
        players[p] = dict(meta[p], total=total, histStart=start, history=hist, club_matches=clubs[p], fixtures=fx,
                          debut=debut, dispersion=round(var / mean, 3))
        log(p, 'total', total, 'último jogo', rows[-1]['date'], 'jogos de clube desde', CLUB_FROM, len(clubs[p]), 'estreia', debut,
            'jogos futuros reais', len(fx_real), 'sintéticos', len(fx) - len(fx_real), 'var/média', round(var / mean, 2))

    # meia-vida comum aos dois, escolhida pelo melhor log-score fora da amostra
    eval_from = '2024-01-01'
    grid = [30, 45, 60, 90, 120, 150, 180, 240, 300, 365, 450, 540, 730, 1095, None]
    scores = []
    for h in grid:
        s1, n1 = score_half_life(clubs['messi'], h, eval_from)
        s2, n2 = score_half_life(clubs['cr7'], h, eval_from)
        scores.append([h if h else 0, round(s1 + s2, 3), round(s1, 3), round(s2, 3)])
        log('meia-vida', h, 'log-score', round(s1 + s2, 2), '(messi', round(s1, 2), 'cr7', round(s2, 2), ') origens', n1, n2)
    best = max(scores, key=lambda x: x[1])
    log('melhor meia-vida:', best[0] or 'sem decaimento')

    year_ago = shift(as_of, -1)
    windows = [
        {'id': 'ponderado', 'label': 'Ponderado ótimo', 'kind': 'decay', 'halfLife': best[0],
         'desc': f'Todos os jogos de clube desde 2019, com peso que cai pela metade a cada {best[0]} dias. A meia-vida foi a que melhor previu, no passado, os gols dos 20 jogos seguintes.'},
        {'id': 'ultimo_ano', 'label': 'Último ano', 'kind': 'range',
         'from': {'messi': year_ago, 'cr7': year_ago}, 'to': as_of,
         'desc': f'Jogos de clube de {br(year_ago)} a {br(as_of)}.'},
        {'id': 'pre_copa', 'label': 'Pré-Copa', 'kind': 'range',
         'from': {'messi': '2025-06-11', 'cr7': '2025-06-11'}, 'to': '2026-06-10',
         'desc': 'Jogos de clube nos 12 meses antes da Copa do Mundo (11/06/2025 a 10/06/2026).'},
        {'id': 'pos_copa', 'label': 'Pós-Copa', 'kind': 'range',
         'from': {'messi': '2026-07-20', 'cr7': '2026-07-07'}, 'to': as_of,
         'desc': 'Jogos de clube depois da eliminação de cada um na Copa (Portugal caiu em 06/07; a Argentina perdeu a final em 19/07).'},
        {'id': 'era', 'label': 'Era MLS/Arábia', 'kind': 'range',
         'from': {'messi': players['messi']['debut'], 'cr7': players['cr7']['debut']}, 'to': as_of,
         'desc': 'Todos os jogos de clube desde a estreia no clube atual (CR7 no Al-Nassr, Messi no Inter Miami).'},
    ]

    return {
        'asOf': as_of, 'clubFrom': CLUB_FROM, 'players': players, 'windows': windows,
        'halfLifeFit': {'grid': scores, 'best': best[0], 'evalFrom': eval_from, 'block': 20},
        'prior': [A0, B0],
    }


def main():
    raws = {}
    for p in ('messi', 'cr7'):
        path = os.path.join(SRC, f'mvr_{p}_pd.json')
        if '--baixar' in sys.argv[1:]:
            raws[p] = dict(download_mvr(p), baixadoEm=date.today().isoformat())
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(raws[p], f, ensure_ascii=False, separators=(',', ':'))
        else:
            raws[p] = json.load(open(path, encoding='utf-8'))
    as_of = min(raws[p].get('baixadoEm', SNAPSHOT_AS_OF) for p in raws)
    print('dados até', as_of)
    data = build(raws, as_of, log=print)
    with open(os.path.join(OUT, 'data.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(OUT, 'data.js'), 'w', encoding='utf-8') as f:
        f.write('window.DATA = ')
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print('ok', os.path.getsize(os.path.join(OUT, 'data.json')), 'bytes')


if __name__ == '__main__':
    main()
