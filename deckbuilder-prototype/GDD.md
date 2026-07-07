# GDD — Deckbuilder (protótipo "Balatro-lite")

> Documento de Design de Jogo enxuto. Objetivo: validar se o **loop central é
> divertido** antes de gastar 1 minuto com arte. Duas páginas, não mais.

---

## 1. Pitch em uma linha

Um roguelike deckbuilder de **perseguição de pontuação**: monte mãos de cartas,
multiplique números, bata a meta da rodada. Sessões de 15–20 min, altamente
rejogável, 2D, por turnos, determinístico.

**Por que este escopo:** é o tipo de jogo onde IA (Claude Code) mais ajuda —
tudo é estrutura de dados + matemática + UI. Sem física, sem 3D, sem level
design espacial. E é o gênero com a maior razão procura/oferta na Steam hoje.

## 2. Público e referências

- **Referência direta:** Balatro (núcleo matemático), com pitadas de Slay the
  Spire (progressão) e Backpack Hero (organização de itens — fase futura).
- **Jogador-alvo:** fã de sistemas, otimização e "só mais uma rodada". Compra
  na Steam por tags `Roguelike Deckbuilder`, `Card Game`, `Replay Value`.

## 3. Loop central (o que estamos validando)

```
  [Comprar mão]  →  [Selecionar até 5 cartas]  →  [Jogar → pontuar]
        ↑                                                    │
        └──────────  repete até bater a meta ou acabar as mãos
```

1. Você recebe uma **mão de 8 cartas** do baralho.
2. Seleciona **até 5** para jogar como uma "mão de pôquer".
3. A pontuação é **chips × mult**:
   - `chips` = valor base do tipo de mão + soma do valor das cartas.
   - `mult`  = multiplicador do tipo de mão (Par ×2, Trinca ×3, Quadra ×7...).
4. Você tem um número limitado de **jogadas** e **descartes** por rodada.
5. Bateu a **meta de pontos** → vence a rodada, ganha dinheiro, meta sobe.
6. Acabaram as jogadas antes da meta → fim de jogo.

**Critério de sucesso do protótipo:** você joga 30 minutos seguidos sem largar?
Se sim, o conceito se sustenta. Se não, mexemos nas fórmulas — não na arte.

## 4. Valores de mãos (tabela de balanceamento inicial)

| Mão             | Chips base | Mult |
|-----------------|-----------:|-----:|
| Carta Alta      |          5 |    1 |
| Par             |         10 |    2 |
| Dois Pares      |         20 |    2 |
| Trinca          |         30 |    3 |
| Sequência       |         30 |    4 |
| Flush           |         35 |    4 |
| Full House      |         40 |    4 |
| Quadra          |         60 |    7 |
| Straight Flush  |        100 |    8 |

Valor de carta (chips): Ás = 11, figuras (J/Q/K) = 10, resto = número.
Meta da rodada `n`: `100 × 1.6^(n-1)` (arredondado).

> Todos esses números vivem em constantes no topo de `main.gd` — mexer no
> balanceamento é editar uma linha, não caçar código.

## 5. O que está FORA do protótipo (de propósito)

- Arte, animação, som — só depois que o loop provar que diverte.
- "Coringas"/relíquias (o molho do Balatro) — **fase 2**, quando o núcleo estiver
  gostoso. É aqui que entra a camada de gestão/diferenciação que discutimos.
- Loja entre rodadas, meta-progressão, save. Fase 2.

## 6. Roadmap curto

- **Fase 0 (feito aqui):** loop jogável com retângulos. Valida diversão.
- **Fase 1:** dados como Custom Resources (`.tres`), testes com GdUnit4 em
  modo headless, 1º "coringa" que quebra as regras.
- **Fase 2:** arte com modelo LoRA consistente (Scenario/Leonardo), som, loja.
- **Fase 3:** página na Steam + wishlists + Steam Next Fest (começa cedo!).

## 7. Riscos

- **Balanceamento** é o jogo inteiro — reservar a maior fatia de tempo pra isso.
- **"AI Slop"** na arte mata as vendas: só arte com estilo consistente e
  declaração de uso de IA na Content Survey da Steam.
- **Marketing começa meses antes** do lançamento, não na semana.
