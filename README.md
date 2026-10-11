# Corrida ao Gol 1000

Simulação Monte Carlo de quem chega primeiro ao milésimo gol oficial: Messi ou Cristiano Ronaldo.
Pelo servidor, os dados são os de agora; aberta com dois cliques, vale o último retrato gerado (a data aparece no topo da página).

- `index.html`: rode `python -I tools/servidor.py` e abra http://localhost:8765/index.html. A página baixa o histórico jogo a jogo de agora do messivsronaldo.app (`/api/corrida`), a mesma contagem da imprensa. O site não libera CORS, por isso o servidor. Aberta com dois cliques, ou publicada como Artifact, a página usa `data/data.js`. As fontes vêm do Google Fonts; o resto funciona offline.
- `data/data.json` e `data/data.js`: o retrato usado sem servidor (o `.js` é o mesmo JSON, para abrir sem servidor).
- `data/sources/`: dados brutos (histórico jogo a jogo do messivsronaldo.app, calendário, notas). O calendário e as notas são de 10/10/2026.
- `sim.js`: motor da simulação. `app.js`: interface e gráficos.

## Atualizar os dados

- **Retrato** (versão offline e Artifact): `python -I tools/build_data.py --baixar` baixa o histórico de agora para `data/sources/` e refaz `data/data.js`. Depois, `python -I tools/build_artifact.py` refaz `dist/index.html`.
- **Calendário futuro** (`data/sources/fixtures.csv`): continua à mão. Os jogos já disputados saem sozinhos, mas jogos novos (mata-mata, temporada seguinte) precisam entrar no arquivo.
- O endereço do histórico no messivsronaldo.app é o JSON interno do site, que não é documentado e pode mudar sem aviso.

## Calculadora: gol 1000 de qualquer jogador

`jogador.html` mostra um jogador por vez, com meta sempre 1000. Para quem está em atividade, simula a chance de chegar ao gol 1000 antes da aposentadoria. Para todos, inclusive aposentados e lendas, calcula com que idade o gol 1000 sairia se ele nunca parasse, por absurda que seja a idade.

- Rode `python -I tools/servidor.py`, que abre http://localhost:8765/jogador.html. A página precisa do servidor: a busca por nome da Transfermarkt não pode ser lida direto pelo navegador (CORS).
- **Jogadores da Transfermarkt:** a carreira oficial vem jogo a jogo, ao vivo, por endpoints não documentados, que podem mudar ou ser bloqueados sem aviso. Contam os jogos do time principal e da seleção principal. Ficam de fora base, reserva e seleção olímpica. Por essa regra, o Messi fecha em 932 gols e o CR7 em 974 (a imprensa dá 980 para o CR7).
- **Lendas** (Pelé, Romário, Bican, Puskás, Gerd Müller e Eusébio): a Transfermarkt não tem o futebol antigo, então os dados vêm de `data/sources/lendas.json`. São jogos e gols oficiais por temporada, levantados em Wikipedia, RSSSF e Guinness, com fontes e notas por jogador. Rode `python -I tools/build_lendas.py` para gerar `data/lendas.json`. Quem não tem temporadas de clube fica de fora, como o Túlio Maravilha.
- `jogador.js` usa o mesmo motor (`sim.js`) e a mesma meia-vida da corrida Messi × CR7. O calendário futuro é sintético: N jogos oficiais por ano, ajustável na página.
