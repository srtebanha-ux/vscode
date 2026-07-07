# Coringas como Custom Resources (.tres)

Estes arquivos `.tres` demonstram o fluxo **data-driven** que o GDD prometeu:
cada coringa é um recurso editável, sem tocar em código. Abra qualquer um no
inspetor do Godot e mude `amount`, `effect`, `suit_filter` etc. — o Godot
serializa de volta em texto simples (fácil de ler no diff e para a IA editar).

## Como o campo `effect` mapeia (contrato com o enum em `joker.gd`)

| Nº | Effect            | Usa                         |
|---:|-------------------|-----------------------------|
| 0  | FLAT_MULT         | `amount`                    |
| 1  | FLAT_CHIPS        | `amount`                    |
| 2  | MULT_TIMES        | `amount`                    |
| 3  | MULT_PER_SUIT     | `amount`, `suit_filter`     |
| 4  | CHIPS_PER_SUIT    | `amount`, `suit_filter`     |
| 5  | MULT_IF_HAND      | `amount`, `hand_filter`     |
| 6  | MULT_PER_DISCARD  | `amount`                    |
| 7  | MULT_PER_LEFT     | `amount` (posição importa)  |
| 8  | MULT_IF_RIGHTMOST | `amount` (posição importa)  |

> Se você reordenar o enum em `joker.gd`, atualize estes números.

## Observação sobre o protótipo

Hoje o jogo usa `Joker.default_pool()` (definido em código) como fonte da
verdade — assim ele roda mesmo sem estes arquivos. Estes `.tres` são exemplos
do caminho de produção. Para carregá-los no jogo:

```gdscript
var ganancioso: Joker = load("res://jokers/ganancioso.tres")
jokers.append(ganancioso)
```

Um passo natural da Fase 1.5 é escanear esta pasta e montar o pool a partir
dos `.tres`, aposentando o pool em código.
