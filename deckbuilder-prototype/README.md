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

## Coringas (Fase 1)

O jogo agora tem **coringas** — recursos que quebram as regras de pontuação
(o "molho" que diferencia do Balatro genérico). Você começa com 2 e ganha mais
a cada rodada vencida. Eles aparecem em amarelo e modificam o cálculo
`chips × mult` na hora. Exemplos: *Ganancioso* (+3 mult por Ouros), *Colecionador*
(+4 mult em Flush), *Cauteloso* (+2 mult por descarte não usado), *Vidente* (×3).

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
