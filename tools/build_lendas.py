"""Gera data/lendas.json para a calculadora (jogador.html) a partir de data/sources/lendas.json.

A fonte é a pesquisa curada à mão (Wikipedia, RSSSF, Guinness, imprensa), com jogos e gols OFICIAIS por temporada:
a Transfermarkt não tem o futebol dos anos 50-70 (do Pelé, ela só tem 111 jogos, quase todos pela seleção).

Regras:
  - entra só quem tem temporadas de clube; sem elas não há como medir o ritmo do fim da carreira
    (por isso o Túlio Maravilha fica de fora: as fontes só dão totais por clube, e eles se contradizem);
  - a soma das temporadas é o total oficial usado na página; o total citado pelas fontes vai junto, para comparar.

Uso:  python -I tools/build_lendas.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'sources', 'lendas.json')
OUT = os.path.join(ROOT, 'data', 'lendas.json')
KEEP = ('id', 'name', 'fullName', 'birth', 'death', 'nationalTeams', 'careerStart', 'careerEnd', 'tmId',
        'official', 'officialTotal', 'allTotal', 'milestone1000', 'sources', 'notes')


def main():
    out = []
    for p in json.load(open(SRC, encoding='utf-8')):
        nts = set(p.get('nationalTeams') or [])
        club = [b for b in p['official'] if b['team'] not in nts and b['games']]
        games = sum(b['games'] for b in p['official'])
        goals = sum(b['goals'] for b in p['official'])
        cited = (p.get('officialTotal') or {}).get('goals')
        if not club:
            print(f"{p['id']}: fora (sem temporadas de clube)")
            continue
        print(f"{p['id']}: {goals} gols em {games} jogos oficiais (fonte cita {cited})")
        out.append({k: p.get(k) for k in KEEP})
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('ok', len(out), 'lendas,', os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
