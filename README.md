# Corrida ao Gol 1000

Simulação Monte Carlo de quem chega primeiro ao milésimo gol oficial: Messi ou Cristiano Ronaldo.
Dados reais até 10/10/2026.

- `index.html`: abra com dois cliques. As fontes vêm do Google Fonts; o resto funciona offline.
- `data/data.json` e `data/data.js`: dados usados pela página (o `.js` é o mesmo JSON, para abrir sem servidor).
- `data/sources/`: dados brutos levantados em 10/10/2026 (histórico jogo a jogo do messivsronaldo.app, calendário, notas).
- `sim.js`: motor da simulação. `app.js`: interface e gráficos.

## Atualizar os dados

1. Troque `data/sources/mvr_messi_pd.json`, `data/sources/mvr_cr7_pd.json` e `data/sources/fixtures.csv` por versões novas.
2. Ajuste `AS_OF` e os totais (`total`) em `tools/build_data.py`.
3. Rode `python -I tools/build_data.py` e depois `python -I tools/build_artifact.py` (versão para o Artifact).
