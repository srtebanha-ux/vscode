class_name Scoring
extends RefCounted

## Motor de pontuação PURO — sem UI, sem estado global. Recebe cartas + coringas,
## devolve números. Ficar separado da interface é o que torna tudo testável
## (ver tests/run_tests.gd).

# [chips_base, mult_base] por tipo de mão
const HAND_VALUES := {
	"Carta Alta":     [5, 1],
	"Par":            [10, 2],
	"Dois Pares":     [20, 2],
	"Trinca":         [30, 3],
	"Sequência":      [30, 4],
	"Flush":          [35, 4],
	"Full House":     [40, 4],
	"Quadra":         [60, 7],
	"Straight Flush": [100, 8],
}


## Determina o melhor tipo de mão de pôquer para as cartas.
static func classify(cards: Array) -> String:
	if cards.is_empty():
		return "Carta Alta"

	var rank_counts := {}
	var suits := {}
	var rank_list := []
	for c in cards:
		rank_counts[c.rank] = int(rank_counts.get(c.rank, 0)) + 1
		suits[c.suit] = true
		rank_list.append(c.rank)

	var counts: Array = rank_counts.values()
	counts.sort()
	counts.reverse()  # decrescente: [maior grupo, ...]

	var is_flush: bool = cards.size() == 5 and suits.size() == 1
	var is_straight: bool = _is_straight(rank_list)

	if is_straight and is_flush:
		return "Straight Flush"
	if counts[0] == 4:
		return "Quadra"
	if counts[0] == 3 and counts.size() > 1 and counts[1] == 2:
		return "Full House"
	if is_flush:
		return "Flush"
	if is_straight:
		return "Sequência"
	if counts[0] == 3:
		return "Trinca"
	if counts[0] == 2 and counts.size() > 1 and counts[1] == 2:
		return "Dois Pares"
	if counts[0] == 2:
		return "Par"
	return "Carta Alta"


static func _is_straight(rank_list: Array) -> bool:
	if rank_list.size() != 5:
		return false
	var uniq := {}
	for r in rank_list:
		uniq[r] = true
	if uniq.size() != 5:
		return false
	var sorted_ranks: Array = uniq.keys()
	sorted_ranks.sort()
	return sorted_ranks[4] - sorted_ranks[0] == 4


## Pontua uma mão. Aplica primeiro as regras base, depois cada coringa em ordem.
## `positions` (opcional): célula Vector2i de cada coringa no tabuleiro, na mesma
## ordem de `jokers`. Se informado, habilita efeitos de adjacência 2D.
## Retorna: { name, base_chips, base_mult, chips, mult, total }
static func score(cards: Array, jokers: Array, ctx: Dictionary, positions := []) -> Dictionary:
	if cards.is_empty():
		return { "name": "—", "base_chips": 0, "base_mult": 0,
			"chips": 0, "mult": 0, "total": 0 }

	var type_name := classify(cards)
	var base: Array = HAND_VALUES[type_name]
	var chips: int = base[0]
	var mult: int = base[1]
	for c in cards:
		chips += c.chip_value()

	var base_chips := chips
	var base_mult := mult

	# Conjunto de células ocupadas, para calcular adjacência em O(1).
	var occupied := {}
	for p in positions:
		occupied[p] = true

	# Aplica em ordem de leitura. A POSIÇÃO de cada coringa entra no ctx, então
	# efeitos posicionais (index/rightmost) e de adjacência 2D dependem do lugar.
	ctx["joker_count"] = jokers.size()
	for i in jokers.size():
		var j = jokers[i]
		ctx["index"] = i
		ctx["adjacent_count"] = _count_adjacent(positions[i], occupied) if i < positions.size() else 0
		var r: Dictionary = j.apply(chips, mult, type_name, cards, ctx)
		chips = int(r.chips)
		mult = int(r.mult)

	return {
		"name": type_name,
		"base_chips": base_chips,
		"base_mult": base_mult,
		"chips": chips,
		"mult": mult,
		"total": chips * mult,
	}


## Conta quantas das 4 células ortogonais a `cell` estão ocupadas.
static func _count_adjacent(cell, occupied: Dictionary) -> int:
	var n := 0
	for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
		if occupied.has(cell + d):
			n += 1
	return n
