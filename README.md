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

## Calculadora: gol 1000 de qualquer jogador

`jogador.html` mostra um jogador por vez, com meta sempre 1000. Para quem está em atividade, simula a chance de chegar ao gol 1000 antes da aposentadoria. Para todos, inclusive aposentados e lendas, calcula com que idade o gol 1000 sairia se ele nunca parasse, por absurda que seja a idade.

- Rode `python -I tools/servidor.py`, que abre http://localhost:8765/jogador.html. A página precisa do servidor: a busca por nome da Transfermarkt não pode ser lida direto pelo navegador (CORS).
- **Jogadores da Transfermarkt:** a carreira oficial vem jogo a jogo, ao vivo, por endpoints não documentados, que podem mudar ou ser bloqueados sem aviso. Contam os jogos do time principal e da seleção principal. Ficam de fora base, reserva e seleção olímpica. Por essa regra, o Messi fecha em 932 gols e o CR7 em 974 (a imprensa dá 980 para o CR7).
- **Lendas** (Pelé, Romário, Bican, Puskás, Gerd Müller e Eusébio): a Transfermarkt não tem o futebol antigo, então os dados vêm de `data/sources/lendas.json`. São jogos e gols oficiais por temporada, levantados em Wikipedia, RSSSF e Guinness, com fontes e notas por jogador. Rode `python -I tools/build_lendas.py` para gerar `data/lendas.json`. Quem não tem temporadas de clube fica de fora, como o Túlio Maravilha.
- `jogador.js` usa o mesmo motor (`sim.js`) e a mesma meia-vida da corrida Messi × CR7. O calendário futuro é sintético: N jogos oficiais por ano, ajustável na página.
