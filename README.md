# Gol 1000 de qualquer jogador

Calculadora que mostra um jogador por vez, com meta sempre 1000. Para quem está em atividade, simula a chance de chegar ao gol 1000 antes da aposentadoria. Para todos, inclusive aposentados e lendas, calcula com que idade o gol 1000 sairia se ele nunca parasse, por absurda que seja a idade.

**Página:** https://matheusgsd.github.io/calculadora-gol-1000/

Nasceu da [corrida Messi × CR7 ao gol 1000](https://matheusgsd.github.io/messi-cr7-1000/), que é outro repositório.

## De onde vêm os dados

- **Jogadores da lista** (`data/sources/jogadores.csv`, cerca de 100): os maiores artilheiros em atividade, nomes em ascensão e craques aposentados. A carreira oficial vem jogo a jogo da Transfermarkt e é baixada toda segunda por uma GitHub Action (`.github/workflows/atualizar.yml`), que roda `python -I tools/build_jogadores.py` e sobe o que mudou. Para incluir alguém, acrescente o id da Transfermarkt e o nome no CSV.
- **Regra de contagem:** contam os jogos do time principal e da seleção principal. Ficam de fora base, reserva e seleção olímpica. Por essa regra, o CR7 fica 6 gols abaixo da contagem da imprensa, porque a Transfermarkt não conta a Copa Árabe de Clubes de 2023.
- **Lendas** (Pelé, Romário, Bican, Puskás, Gerd Müller e Eusébio): a Transfermarkt não tem o futebol antigo, então os dados vêm de `data/sources/lendas.json`. São jogos e gols oficiais por temporada, levantados em Wikipedia, RSSSF e Guinness, com fontes e notas por jogador. Rode `python -I tools/build_lendas.py` para gerar `data/lendas.json`. Quem não tem temporadas de clube fica de fora, como o Túlio Maravilha.
- Os endpoints da Transfermarkt não são documentados e podem mudar ou ser bloqueados sem aviso. Se um jogador falhar na coleta, fica o arquivo da semana anterior.

## Rodar localmente

`python -I tools/servidor.py` abre http://localhost:8765/. Pelo servidor, a busca também consulta a Transfermarkt ao vivo, então dá para ver jogadores fora da lista, e o botão "Atualizar dados da Transfermarkt" baixa a carreira de agora. No GitHub Pages, a página usa só a lista: o navegador não pode ler a Transfermarkt direto (CORS).

`jogador.js` usa o mesmo motor da corrida (`sim.js`), com meia-vida de 300 dias. O calendário futuro é sintético: N jogos oficiais por ano, ajustável na página.

## Licença

Código sob a licença MIT (`LICENSE`). As lendas (`data/sources/lendas.json`, `data/lendas.json`) ficam sob [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.pt-br), citando Matheus Dalmolin. As carreiras em `data/jogadores/` são extraídas da Transfermarkt e seguem as condições do site.
