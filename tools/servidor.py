"""Serve as páginas do projeto e repassa à Transfermarkt as consultas da calculadora (jogador.html).

Por que um servidor: a busca por nome é uma página HTML da Transfermarkt, que o navegador não pode ler de outro
site (CORS). Aqui tudo passa por /api/..., com um cache curto em memória para não martelar as fontes.

  /api/busca?q=kane          -> transfermarkt.com/schnellsuche (HTML, lido aqui e devolvido como JSON)
  /api/jogos/132098          -> transfermarkt.com/ceapi/performance-game/132098      (carreira jogo a jogo, ao vivo)
  /api/transferencias/132098 -> transfermarkt.com/ceapi/transferHistory/list/132098 (nomes dos clubes)
  /api/perfil/132098         -> transfermarkt-api.fly.dev/players/132098/profile     (foto e posição; API
                                comunitária e instável, por isso a página não depende dela)

Os endpoints da Transfermarkt não são documentados: podem mudar ou ser bloqueados sem aviso.

Uso:  python -I tools/servidor.py      (abre http://localhost:8765/jogador.html)
"""
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


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        parts = u.path.strip('/').split('/')
        if parts[0] != 'api':
            return super().do_GET()
        name = parts[1] if len(parts) > 1 else ''
        arg = urllib.parse.parse_qs(u.query).get('q', [''])[0].strip() if name == 'busca' else (parts[2] if len(parts) > 2 else '')
        if name not in ROUTES or not arg or (name != 'busca' and not arg.isdigit()):
            return self.send_error(404)
        tpl, ttl, timeout = ROUTES[name]
        try:
            body = fetch(tpl.format(urllib.parse.quote(arg)), ttl, timeout)
            if name == 'busca':
                body = parse_search(body)
            status = 200
        except Exception as e:  # o protótipo só repassa o erro para a página mostrar
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
        print('No ar:', url, '(Ctrl+C para parar)', flush=True)
        if os.environ.get('SEM_NAVEGADOR') != '1':
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        srv.serve_forever()
