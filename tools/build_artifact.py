"""Gera dist/index.html para publicar como Artifact no claude.ai.

O Artifact embrulha a página no próprio esqueleto (doctype/html/head/body), então aqui só tiramos esse
esqueleto do index.html local e mantemos título, fontes, estilo, corpo e scripts. Os scripts (data/data.js,
sim.js, app.js) são publicados junto, nos mesmos caminhos relativos.

Uso:  python -I tools/build_artifact.py
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()

head = re.search(r'<head>(.*?)</head>', src, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', src, re.S).group(1)
keep = re.findall(r'(<title>.*?</title>|<link [^>]*>|<style>.*?</style>)', head, re.S)

os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
with open(os.path.join(ROOT, 'dist', 'index.html'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(keep) + '\n' + body.strip() + '\n')
print('dist/index.html ok')
