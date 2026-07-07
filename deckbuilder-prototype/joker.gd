class_name Joker
extends Resource

## Um "coringa": modifica a pontuação de forma que quebra as regras normais.
## É o coração do gênero — o que diferencia o jogo de um deckbuilder genérico.
## Definido como Resource para virar arquivo .tres editável (ver pasta jokers/).

## IMPORTANTE: a ordem deste enum é o "contrato" com os arquivos .tres.
## Não reordene sem atualizar os .tres (eles guardam o efeito como número).
enum Effect {
	FLAT_MULT,        # 0: +amount no mult
	FLAT_CHIPS,       # 1: +amount nos chips
	MULT_TIMES,       # 2: mult *= amount
	MULT_PER_SUIT,    # 3: +amount de mult por carta do naipe suit_filter
	CHIPS_PER_SUIT,   # 4: +amount de chips por carta do naipe suit_filter
	MULT_IF_HAND,     # 5: +amount de mult SE o tipo de mão == hand_filter
	MULT_PER_DISCARD, # 6: +amount de mult por descarte NÃO usado (recompensa cautela)
	MULT_PER_LEFT,    # 7: +amount de mult por coringa ANTES dele (ordem de leitura)
	MULT_IF_RIGHTMOST,# 8: +amount de mult SE for o último (ordem de leitura)
	MULT_PER_ADJACENT,# 9: +amount de mult por coringa ADJACENTE no tabuleiro (2D!)
}

@export var id: String = ""
@export var joker_name: String = ""
@export var description: String = ""
@export var effect: Effect = Effect.FLAT_MULT
@export var amount: int = 0
@export var suit_filter: String = ""   # usado pelos efeitos *_PER_SUIT
@export var hand_filter: String = ""   # usado por MULT_IF_HAND (ex.: "Flush")
@export var cost: int = 4              # preço na loja (Fase 1.5)


## Aplica o efeito. Recebe chips/mult atuais e devolve os modificados.
## `ctx` traz estado do jogo (ex.: quantos descartes sobraram).
func apply(chips: int, mult: int, hand_type: String, cards: Array, ctx: Dictionary) -> Dictionary:
	match effect:
		Effect.FLAT_MULT:
			mult += amount
		Effect.FLAT_CHIPS:
			chips += amount
		Effect.MULT_TIMES:
			mult *= amount
		Effect.MULT_PER_SUIT:
			mult += amount * _count_suit(cards)
		Effect.CHIPS_PER_SUIT:
			chips += amount * _count_suit(cards)
		Effect.MULT_IF_HAND:
			if hand_type == hand_filter:
				mult += amount
		Effect.MULT_PER_DISCARD:
			mult += amount * int(ctx.get("discards_left", 0))
		Effect.MULT_PER_LEFT:
			# ctx["index"] = posição deste coringa (0 = mais à esquerda)
			mult += amount * int(ctx.get("index", 0))
		Effect.MULT_IF_RIGHTMOST:
			if int(ctx.get("index", 0)) == int(ctx.get("joker_count", 1)) - 1:
				mult += amount
		Effect.MULT_PER_ADJACENT:
			# ctx["adjacent_count"] = coringas ortogonalmente vizinhos no tabuleiro
			mult += amount * int(ctx.get("adjacent_count", 0))
	return { "chips": chips, "mult": mult }


func _count_suit(cards: Array) -> int:
	var n := 0
	for c in cards:
		if c.suit == suit_filter:
			n += 1
	return n


# --------------------------------------------------------------------------
#  Fábrica + catálogo (fonte da verdade em código, garante que o jogo roda
#  mesmo sem os .tres). Os .tres em jokers/ são exemplos do fluxo data-driven.
# --------------------------------------------------------------------------
static func make(p_id: String, p_name: String, p_desc: String, p_effect: Effect,
		p_amount: int, p_suit := "", p_hand := "", p_cost := 4) -> Joker:
	var j := Joker.new()
	j.id = p_id
	j.joker_name = p_name
	j.description = p_desc
	j.effect = p_effect
	j.amount = p_amount
	j.suit_filter = p_suit
	j.hand_filter = p_hand
	j.cost = p_cost
	return j


## Catálogo completo de coringas disponíveis (loja + pool inicial).
static func default_pool() -> Array:
	return [
		make("ganancioso", "Ganancioso", "+3 Mult por Ouros jogado",
			Effect.MULT_PER_SUIT, 3, "diamonds", "", 4),
		make("colecionador", "Colecionador", "+4 Mult se for Flush",
			Effect.MULT_IF_HAND, 4, "", "Flush", 5),
		make("cauteloso", "Cauteloso", "+2 Mult por descarte não usado",
			Effect.MULT_PER_DISCARD, 2, "", "", 5),
		make("vidente", "Vidente", "Triplica o Mult (x3)",
			Effect.MULT_TIMES, 3, "", "", 9),
		make("otimista", "Otimista", "+4 Mult sempre",
			Effect.FLAT_MULT, 4, "", "", 4),
		make("peso_pesado", "Peso Pesado", "+50 Chips sempre",
			Effect.FLAT_CHIPS, 50, "", "", 4),
		make("funebre", "Fúnebre", "+15 Chips por Espadas jogada",
			Effect.CHIPS_PER_SUIT, 15, "spades", "", 5),
		make("trio", "Trio", "+5 Mult se for Trinca",
			Effect.MULT_IF_HAND, 5, "", "Trinca", 5),
		make("acumulador", "Acumulador", "+2 Mult por coringa anterior",
			Effect.MULT_PER_LEFT, 2, "", "", 6),
		make("finalizador", "Finalizador", "+8 Mult se for o último",
			Effect.MULT_IF_RIGHTMOST, 8, "", "", 6),
		make("ima", "Ímã", "+3 Mult por coringa adjacente",
			Effect.MULT_PER_ADJACENT, 3, "", "", 7),
	]
