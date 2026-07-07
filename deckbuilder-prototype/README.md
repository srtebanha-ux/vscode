# Deckbuilder Prototype (Balatro-lite)

Protótipo jogável de um **roguelike deckbuilder de perseguição de pontuação**,
construído para validar o *loop central* antes de investir em arte, som ou
qualquer polimento. Feio de propósito: só retângulos e texto.

## Como rodar

1. Instale o [Godot 4.3+](https://godotengine.org/download) (versão padrão, não
   a .NET/C# — este projeto usa GDScript).
2. Abra o Godot → **Import** → aponte para a pasta `deckbuilder-prototype/`
   (o arquivo `project.godot`).
3. Aperte **F5** (ou o botão ▶ no canto superior direito).

## Como jogar

- Você recebe uma mão de 8 cartas.
- Clique para **selecionar até 5 cartas**. O painel mostra a mão de pôquer
  detectada e a pontuação projetada (`chips × mult`).
- **Jogar Mão**: pontua as cartas selecionadas e gasta uma jogada.
- **Descartar**: troca as selecionadas por novas (gasta um descarte).
- Bata a **meta (Alvo)** antes de acabarem as jogadas para avançar de rodada.
  A meta cresce a cada rodada.

## Coringas + Loja (Fases 1 e 1.5)

O jogo tem **coringas** — recursos que quebram as regras de pontuação (o "molho"
que diferencia do Balatro genérico). Você começa com 2 e aparecem em amarelo,
modificando o cálculo `chips × mult` na hora. O catálogo tem 8: *Ganancioso*
(+3 mult por Ouros), *Colecionador* (+4 mult em Flush), *Cauteloso* (+2 mult por
descarte não usado), *Vidente* (×3), *Otimista*, *Peso Pesado*, *Fúnebre*, *Trio*.

Ao **vencer uma rodada** você ganha dinheiro (`$`) e entra na **loja**: 3
coringas são ofertados e você compra os que quiser (e puder pagar) antes de
seguir. Dá para **rerolar** as ofertas por $2. É aqui que o jogo vira decisão
estratégica — gastar agora ou guardar.

## Tabuleiro 2D (Fases 2 e 2.5)

Os coringas ocupam células de um **tabuleiro** (5×2). Duas coisas mexem na
pontuação:

- **Adjacência** — coringas vizinhos (cima/baixo/lados) se potencializam.
  Ex.: *Ímã* dá +3 mult por vizinho, então colar coringas rende mais.
- **Ordem de leitura** (esquerda→direita, cima→baixo) — *Acumulador* (+2 mult
  por coringa anterior) e *Finalizador* (+8 mult se for o último).

Para reorganizar: **clique num coringa** para selecioná-lo (fica destacado),
depois clique numa **célula vazia** para movê-lo ou em **outro coringa** para
trocar de lugar. Montar um bom arranjo é o "molho" que aproxima o jogo do
Backpack Hero, não de um Balatro genérico.

## Arquivos

| Arquivo             | Papel                                                     |
|---------------------|-----------------------------------------------------------|
| `GDD.md`            | Documento de design (2 páginas). **Leia primeiro.**       |
| `project.godot`     | Configuração do projeto Godot.                            |
| `main.tscn`         | Cena principal (só um nó `Control` com o script).         |
| `main.gd`           | Jogo + UI construída em código. Balanceamento no topo.    |
| `card.gd`           | Recurso `Card` (rank + naipe + valor em chips).           |
| `scoring.gd`        | Motor de pontuação **puro** (sem UI) — por isso é testável.|
| `joker.gd`          | Recurso `Joker` + catálogo de coringas.                   |
| `jokers/*.tres`     | Coringas como Custom Resources (exemplos data-driven).    |
| `tests/run_tests.gd`| Testes automatizados da lógica de pontuação/coringas.     |

## Rodar os testes (headless, sem dependências)

```bash
godot --headless --path . -s res://tests/run_tests.gd
```

Sai com código de erro `0` se tudo passar, `1` se algo falhar (pronto para CI).
Cobre classificação de mãos, valores de carta, cada tipo de coringa e o
empilhamento de coringas.

## Onde mexer no balanceamento

Tudo que define a "sensação" do jogo está nas constantes no topo de `main.gd`:
tamanho da mão, jogadas/descartes por rodada, crescimento da meta e a tabela
`HAND_VALUES` (chips e mult de cada tipo de mão). Ajuste, rode, repita.

## Próximos passos (ver GDD, seção 6)

- **Fase 1:** cartas como arquivos `.tres`; testes com GdUnit4 em modo headless;
  primeiro "coringa" que quebra as regras (o molho do gênero).
- **Fase 2:** arte com modelo de estilo consistente, som, loja entre rodadas.
- **Fase 3:** página na Steam + wishlists + Steam Next Fest (começar cedo!).

---
Protótipo inicial. Nada aqui é final — a ideia é jogar, sentir e iterar.
