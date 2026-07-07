class_name Card
extends Resource

## Uma carta de baralho. Definida como Resource para, na Fase 1, virar um
## arquivo .tres editável no inspetor do Godot (o padrão recomendado no GDD).

## 1 = Ás, 2..10 = número, 11 = J, 12 = Q, 13 = K
@export var rank: int = 1
## "spades", "hearts", "diamonds", "clubs"
@export var suit: String = "spades"

const SUIT_SYMBOLS := {
	"spades": "♠",   # ♠
	"hearts": "♥",   # ♥
	"diamonds": "♦", # ♦
	"clubs": "♣",    # ♣
}

const RANK_NAMES := { 1: "A", 11: "J", 12: "Q", 13: "K" }

## Texto curto exibido no botão da carta, ex.: "A♠", "10♥".
func display_name() -> String:
	var r: String = RANK_NAMES.get(rank, str(rank))
	var s: String = SUIT_SYMBOLS.get(suit, "?")
	return "%s%s" % [r, s]

## Valor em "chips" que a carta soma quando jogada.
## Ás vale 11, figuras valem 10, o resto vale o próprio número.
func chip_value() -> int:
	if rank == 1:
		return 11
	if rank > 10:
		return 10
	return rank

## Vermelho para copas/ouros, preto para espadas/paus (usado no estilo do botão).
func is_red() -> bool:
	return suit == "hearts" or suit == "diamonds"
