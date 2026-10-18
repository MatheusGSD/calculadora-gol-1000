# Gol 1000 de qualquer jogador

Calculadora que mostra um jogador por vez, com meta sempre 1000. Para quem está em atividade, simula a chance de chegar ao gol 1000 antes da aposentadoria. Para todos, inclusive aposentados e lendas, calcula com que idade o gol 1000 sairia se ele nunca parasse, por absurda que seja a idade.

Nasceu da [corrida Messi × CR7 ao gol 1000](https://github.com/MatheusGSD/messi-cr7-1000), que agora é outro repositório.

- Rode `python -I tools/servidor.py`, que abre http://localhost:8765/. A página precisa do servidor: a busca por nome da Transfermarkt não pode ser lida direto pelo navegador (CORS).
- **Jogadores da Transfermarkt:** a carreira oficial vem jogo a jogo, ao vivo, por endpoints não documentados, que podem mudar ou ser bloqueados sem aviso. Contam os jogos do time principal e da seleção principal. Ficam de fora base, reserva e seleção olímpica. Por essa regra, o CR7 fica 6 gols abaixo da contagem da imprensa, porque a Transfermarkt não conta a Copa Árabe de Clubes de 2023.
- **Lendas** (Pelé, Romário, Bican, Puskás, Gerd Müller e Eusébio): a Transfermarkt não tem o futebol antigo, então os dados vêm de `data/sources/lendas.json`. São jogos e gols oficiais por temporada, levantados em Wikipedia, RSSSF e Guinness, com fontes e notas por jogador. Rode `python -I tools/build_lendas.py` para gerar `data/lendas.json`. Quem não tem temporadas de clube fica de fora, como o Túlio Maravilha.
- `jogador.js` usa o mesmo motor da corrida (`sim.js`), com meia-vida de 300 dias. O calendário futuro é sintético: N jogos oficiais por ano, ajustável na página.

## Antes de publicar

A página ainda não funciona hospedada só com arquivos estáticos (GitHub Pages): a busca e a carreira jogo a jogo passam pelo `tools/servidor.py`. Para publicar, falta uma versão com jogadores pré-calculados ou um proxy.
