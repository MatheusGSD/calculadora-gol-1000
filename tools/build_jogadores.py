"""Baixa da Transfermarkt a carreira jogo a jogo dos jogadores de data/sources/jogadores.csv, para a página funcionar
sem servidor (GitHub Pages). Roda toda semana pelo GitHub Actions.

Saídas:
  data/jogadores.json       índice da busca: nome, foto, posição, clube, idade, nacionalidade (também das lendas
                            com tmId, só para foto e busca)
  data/jogadores/<id>.json  carreira enxuta: só os jogos em que o jogador entrou em campo, com o que a página usa
                            (data, clube, gols, se é seleção, tipo de competição), os nomes dos clubes pelo histórico
                            de transferências e a idade num jogo, para achar a data de nascimento

Os endpoints da Transfermarkt não são documentados: podem mudar ou ser bloqueados sem aviso. Se um jogador falhar,
o arquivo dele da semana anterior fica.

Uso:  python -I tools/build_jogadores.py            (todos)
      python -I tools/build_jogadores.py 28003 8198 (só esses ids)
"""
import csv
import datetime
import importlib.util
import json
import os
import re
import sys
import time
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'jogadores')
# python -I não põe a pasta do script no sys.path, então o servidor é carregado pelo caminho (fetch e parse_search)
_spec = importlib.util.spec_from_file_location('servidor', os.path.join(ROOT, 'tools', 'servidor.py'))
srv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(srv)
PAUSA = 1.0  # segundos entre consultas, para não martelar a Transfermarkt


def get(route, arg):
    tpl, _, timeout = srv.ROUTES[route]
    body = srv.fetch(tpl.format(urllib.parse.quote(str(arg))), 0, timeout)
    srv.cache.clear()  # o cache do servidor guardaria as carreiras inteiras na memória
    return body


def busca(nome, pid):
    """Nome, foto, posição, clube, idade e nacionalidade pela busca rápida (o mesmo formato do /api/busca)."""
    hits = json.loads(srv.parse_search(get('busca', nome)))['results']
    return next((h for h in hits if h['id'] == str(pid)), None)


def carreira(pid):
    perf = json.loads(get('jogos', pid))['data']['performance']
    time.sleep(PAUSA)
    transf = json.loads(get('transferencias', pid))
    clubes = {}
    for t in transf.get('transfers') or []:
        for s in (t.get('from'), t.get('to')):
            m = re.search(r'verein/(\d+)', (s or {}).get('href') or '')
            if m:
                clubes[m.group(1)] = s['clubName']
    jogos, nasc = [], None
    for p in perf:
        gi, st = p['gameInformation'], p['statistics']
        gs = st['generalStatistics']
        utc = gi['date']['dateTimeUTC']
        if gs['participationState'] != 'played' or not utc or gi.get('isLiveGame'):
            continue
        if nasc is None and gs.get('age') is not None:
            nasc = [utc, gs['age'], gs.get('ageDiscrepancyDays') or 0]
        jogos.append([utc[:10], str(p['clubsInformation']['club']['clubId']), st['goalStatistics']['goalsScoredTotal'] or 0,
                      1 if gi['isNationalGame'] else 0, gi['competitionTypeId']])
    jogos.sort()
    return {'nasc': nasc, 'clubes': clubes, 'jogos': jogos}


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(ROOT, 'data', 'sources', 'jogadores.csv'), encoding='utf-8') as f:
        lista = [(r['id'], r['nome']) for r in csv.DictReader(f)]
    with open(os.path.join(ROOT, 'data', 'lendas.json'), encoding='utf-8') as f:
        lendas = [(str(L['tmId']), L['name']) for L in json.load(f) if L.get('tmId')]
    so = set(sys.argv[1:])
    idx_path = os.path.join(ROOT, 'data', 'jogadores.json')
    antigo = {}
    if os.path.exists(idx_path):
        with open(idx_path, encoding='utf-8') as f:
            antigo = {p['id']: p for p in json.load(f)}
    hoje = datetime.date.today().isoformat()
    indice, falhas = [], []
    for pid, nome in lista + lendas:
        lenda = (pid, nome) in lendas
        if so and pid not in so:
            if pid in antigo:
                indice.append(antigo[pid])
            continue
        try:
            meta = busca(nome, pid) or {}
            time.sleep(PAUSA)
            if not lenda:
                c = carreira(pid)
                if not c['jogos']:
                    raise ValueError('sem jogos')
                c = {'id': pid, 'baixadoEm': hoje, **c}
                with open(os.path.join(OUT, pid + '.json'), 'w', encoding='utf-8') as f:
                    json.dump(c, f, ensure_ascii=False, separators=(',', ':'))
                time.sleep(PAUSA)
            item = {'id': pid, 'name': meta.get('name') or nome, 'position': meta.get('position'),
                    'club': meta.get('club') or {'name': None}, 'age': meta.get('age'),
                    'nationalities': meta.get('nationalities') or [], 'imageUrl': meta.get('imageUrl')}
            if lenda:
                item['lenda'] = True
            indice.append(item)
            print(pid, item['name'], 'lenda' if lenda else f"{len(c['jogos'])} jogos", flush=True)
        except Exception as e:
            falhas.append(pid)
            print('FALHOU', pid, nome, e, flush=True)
            if pid in antigo:
                indice.append(antigo[pid])
    indice.sort(key=lambda p: p['name'])
    with open(idx_path, 'w', encoding='utf-8') as f:
        f.write('[\n' + ',\n'.join(json.dumps(p, ensure_ascii=False) for p in indice) + '\n]\n')  # um por linha: diff legível
    print(f'{len(indice)} no índice, {len(falhas)} falhas')
    if len(falhas) > len(lista) // 2:
        sys.exit('mais da metade falhou: a Transfermarkt pode ter bloqueado o acesso')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
