"""Serve as páginas do projeto, repassa à Transfermarkt as consultas da calculadora (jogador.html) e monta a corrida
Messi × CR7 (index.html) com o histórico de agora do messivsronaldo.app.

Por que um servidor: a busca por nome é uma página HTML da Transfermarkt, que o navegador não pode ler de outro
site (CORS). Aqui tudo passa por /api/..., com um cache curto em memória para não martelar as fontes.

  /api/busca?q=kane          -> transfermarkt.com/schnellsuche (HTML, lido aqui e devolvido como JSON)
  /api/jogos/132098          -> transfermarkt.com/ceapi/performance-game/132098      (carreira jogo a jogo, ao vivo)
  /api/transferencias/132098 -> transfermarkt.com/ceapi/transferHistory/list/132098 (nomes dos clubes)
  /api/perfil/132098         -> transfermarkt-api.fly.dev/players/132098/profile     (foto e posição; API
                                comunitária e instável, por isso a página não depende dela)
  /api/corrida               -> messivsronaldo.app, jogo a jogo dos dois, passado pelo build() de tools/build_data.py
                                com a data de hoje; é o mesmo formato de data/data.js

Os endpoints da Transfermarkt e do messivsronaldo.app não são documentados: podem mudar ou ser bloqueados sem aviso.

Uso:  python -I tools/servidor.py      (abre http://localhost:8765/jogador.html; a corrida fica em /index.html)
"""
import datetime
import importlib.util
import html
import http.server
import json
import os
import re
import socketserver
import threading
import time
import urllib.parse
import urllib.request
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# python -I não põe a pasta do script no sys.path, então o build_data é carregado pelo caminho
_spec = importlib.util.spec_from_file_location('build_data', os.path.join(ROOT, 'tools', 'build_data.py'))
build_data = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build_data)
CORRIDA_TTL = 120
PORT = 8765
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) gol1000'
ROUTES = {
    'busca': ('https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query={}&Spieler_page=0', 3600, 15),
    'jogos': ('https://www.transfermarkt.com/ceapi/performance-game/{}', 60, 40),
    'transferencias': ('https://www.transfermarkt.com/ceapi/transferHistory/list/{}', 3600, 20),
    'perfil': ('https://transfermarkt-api.fly.dev/players/{}/profile', 3600, 12),
}
cache = {}
lock = threading.Lock()


def fetch(url, ttl, timeout):
    with lock:
        hit = cache.get(url)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    for attempt in range(3):  # a Transfermarkt derruba uma ou outra conexão; tenta de novo antes de desistir
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(0.8 * (attempt + 1))
    with lock:
        cache[url] = (time.time(), body)
    return body


ROW = re.compile(r'<tr class="(?:odd|even)">(.*?)</tr>\s*(?=<tr class="(?:odd|even)">|</tbody>)', re.S)


def parse_search(page):
    """Tabela de jogadores da busca rápida -> o mesmo formato da busca da transfermarkt-api."""
    out = []
    for row in ROW.findall(page.decode('utf-8', 'replace')):
        m = re.search(r'class="hauptlink"><a title="([^"]*)" href="/[^"]*/profil/spieler/(\d+)"', row)
        if not m:
            continue
        club = re.search(r'<a title="([^"]*)" href="/[^"]*/startseite/verein/\d+"', row)
        cells = re.findall(r'<td class="zentriert">([^<]*)</td>', row)
        nat = re.findall(r'title="([^"]*)" alt="[^"]*" class="flaggenrahmen"', row)
        photo = re.search(r'src="(https://img\.a\.transfermarkt\.technology/portrait/[^"]+)"', row)
        out.append({
            'id': m.group(2), 'name': html.unescape(m.group(1)),
            'position': html.unescape(cells[0]) if cells else None,
            'club': {'name': html.unescape(club.group(1)) if club else None},
            'age': int(cells[1]) if len(cells) > 1 and cells[1].isdigit() else None,
            'nationalities': [html.unescape(n) for n in nat],
            'imageUrl': photo.group(1).replace('/portrait/small/', '/portrait/big/') if photo else None,
        })
    return json.dumps({'results': out}, ensure_ascii=False).encode()


def corrida():
    """Dados da corrida com o histórico de agora; guardados por CORRIDA_TTL segundos, como as consultas."""
    with lock:
        hit = cache.get('corrida')
        if hit and time.time() - hit[0] < CORRIDA_TTL:
            return hit[1]
    raws = {p: json.loads(fetch(build_data.MVR_URL.format(slug), CORRIDA_TTL, 40)) for p, slug in build_data.MVR_SLUG.items()}
    data = build_data.build(raws, datetime.date.today().isoformat())
    data['aoVivo'] = {'fonte': 'messivsronaldo.app', 'consultadoEm': datetime.datetime.now().astimezone().isoformat(timespec='seconds')}
    body = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
    with lock:
        cache['corrida'] = (time.time(), body)
    return body


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        parts = u.path.strip('/').split('/')
        if parts[0] != 'api':
            return super().do_GET()
        name = parts[1] if len(parts) > 1 else ''
        if name == 'corrida':
            return self.reply(corrida)
        arg = urllib.parse.parse_qs(u.query).get('q', [''])[0].strip() if name == 'busca' else (parts[2] if len(parts) > 2 else '')
        if name not in ROUTES or not arg or (name != 'busca' and not arg.isdigit()):
            return self.send_error(404)
        tpl, ttl, timeout = ROUTES[name]

        def get():
            body = fetch(tpl.format(urllib.parse.quote(arg)), ttl, timeout)
            return parse_search(body) if name == 'busca' else body
        self.reply(get)

    def reply(self, get):
        try:
            body, status = get(), 200
        except Exception as e:  # só repassa o erro para a página mostrar (ou, na corrida, cair no data.js)
            body, status = json.dumps({'erro': str(e)}).encode(), 502
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        if '/api/' in str(args[0] if args else ''):
            print(time.strftime('%H:%M:%S'), fmt % args, flush=True)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == '__main__':
    url = f'http://localhost:{PORT}/jogador.html'
    with Server(('127.0.0.1', PORT), Handler) as srv:
        print('No ar:', url, '| corrida ao vivo:', f'http://localhost:{PORT}/index.html', '(Ctrl+C para parar)', flush=True)
        if os.environ.get('SEM_NAVEGADOR') != '1':
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        srv.serve_forever()
