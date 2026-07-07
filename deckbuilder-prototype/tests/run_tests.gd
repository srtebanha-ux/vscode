extends SceneTree

## Runner de testes leve e SEM dependências — roda em modo headless:
##
##   godot --headless --path . -s res://tests/run_tests.gd
##
## O GDD sugeria GdUnit4, mas ele é um addon que precisa ser baixado. Este
## runner faz o mesmo trabalho para a lógica pura de scoring/jokers com zero
## setup, e sai com código de erro != 0 se algo falhar (bom para CI).

var _passed := 0
var _failed := 0


func _initialize() -> void:
	print("== Rodando testes ==")
	test_classify()
	test_scoring_base()
	test_card_chip_values()
	test_joker_mult_times()
	test_joker_per_suit()
	test_joker_if_hand()
	test_joker_per_discard()
	test_joker_stacking()
	print("\n== Resultado: %d passaram, %d falharam ==" % [_passed, _failed])
	quit(1 if _failed > 0 else 0)


# ---- helpers ----
func _card(rank: int, suit: String) -> Card:
	var c := Card.new()
	c.rank = rank
	c.suit = suit
	return c


func check(label: String, actual, expected) -> void:
	if actual == expected:
		_passed += 1
		print("  ok  %s" % label)
	else:
		_failed += 1
		print("  XX  %s  — esperado %s, veio %s" % [label, str(expected), str(actual)])


# ---- testes de classificação de mão ----
func test_classify() -> void:
	check("classify: par",
		Scoring.classify([_card(13, "spades"), _card(13, "hearts")]), "Par")
	check("classify: trinca",
		Scoring.classify([_card(5, "spades"), _card(5, "hearts"), _card(5, "clubs")]),
		"Trinca")
	check("classify: quadra",
		Scoring.classify([_card(9, "spades"), _card(9, "hearts"),
			_card(9, "clubs"), _card(9, "diamonds")]), "Quadra")
	check("classify: dois pares",
		Scoring.classify([_card(3, "spades"), _card(3, "hearts"),
			_card(8, "clubs"), _card(8, "diamonds")]), "Dois Pares")
	check("classify: full house",
		Scoring.classify([_card(4, "spades"), _card(4, "hearts"), _card(4, "clubs"),
			_card(2, "diamonds"), _card(2, "spades")]), "Full House")
	check("classify: flush",
		Scoring.classify([_card(2, "hearts"), _card(5, "hearts"), _card(7, "hearts"),
			_card(9, "hearts"), _card(11, "hearts")]), "Flush")
	check("classify: sequencia",
		Scoring.classify([_card(5, "spades"), _card(6, "hearts"), _card(7, "clubs"),
			_card(8, "diamonds"), _card(9, "spades")]), "Sequência")
	check("classify: straight flush",
		Scoring.classify([_card(5, "hearts"), _card(6, "hearts"), _card(7, "hearts"),
			_card(8, "hearts"), _card(9, "hearts")]), "Straight Flush")
	check("classify: carta alta",
		Scoring.classify([_card(2, "spades"), _card(7, "hearts")]), "Carta Alta")


# ---- valores de carta ----
func test_card_chip_values() -> void:
	check("chip: as = 11", _card(1, "spades").chip_value(), 11)
	check("chip: rei = 10", _card(13, "spades").chip_value(), 10)
	check("chip: sete = 7", _card(7, "spades").chip_value(), 7)


# ---- pontuação base (sem coringa) ----
func test_scoring_base() -> void:
	# Par de reis: base Par [10,2]; chips += 10+10 = 30; mult 2; total 60.
	var r := Scoring.score([_card(13, "spades"), _card(13, "hearts")], [], {})
	check("base: par de reis chips", int(r.chips), 30)
	check("base: par de reis mult", int(r.mult), 2)
	check("base: par de reis total", int(r.total), 60)


# ---- coringas ----
func test_joker_mult_times() -> void:
	# Vidente: mult x3. Par de reis: 30 chips, mult 2 -> 6. Total 180.
	var vidente := Joker.make("v", "Vidente", "", Joker.Effect.MULT_TIMES, 3)
	var r := Scoring.score([_card(13, "spades"), _card(13, "hearts")], [vidente], {})
	check("vidente: mult x3", int(r.mult), 6)
	check("vidente: total", int(r.total), 180)


func test_joker_per_suit() -> void:
	# Ganancioso: +3 mult por Ouros. Duas cartas de ouros num par -> +6 mult.
	var ganancioso := Joker.make("g", "Ganancioso", "", Joker.Effect.MULT_PER_SUIT, 3, "diamonds")
	var cards := [_card(13, "diamonds"), _card(13, "diamonds")]  # par, 2 ouros
	var r := Scoring.score(cards, [ganancioso], {})
	check("ganancioso: mult 2 + 3*2", int(r.mult), 8)


func test_joker_if_hand() -> void:
	# Colecionador: +4 mult se Flush. Flush de ouros -> mult 4 + 4 = 8.
	var col := Joker.make("c", "Colecionador", "", Joker.Effect.MULT_IF_HAND, 4, "", "Flush")
	var flush := [_card(2, "diamonds"), _card(5, "diamonds"), _card(7, "diamonds"),
		_card(9, "diamonds"), _card(11, "diamonds")]
	var r := Scoring.score(flush, [col], {})
	check("colecionador: flush mult 4+4", int(r.mult), 8)
	# Sem flush não deve aplicar.
	var r2 := Scoring.score([_card(13, "spades"), _card(13, "hearts")], [col], {})
	check("colecionador: par nao ativa", int(r2.mult), 2)


func test_joker_per_discard() -> void:
	# Cauteloso: +2 mult por descarte restante. ctx com 3 -> +6.
	var cau := Joker.make("k", "Cauteloso", "", Joker.Effect.MULT_PER_DISCARD, 2)
	var r := Scoring.score([_card(13, "spades"), _card(13, "hearts")], [cau],
		{ "discards_left": 3 })
	check("cauteloso: mult 2 + 2*3", int(r.mult), 8)


func test_joker_stacking() -> void:
	# Dois coringas empilham na ordem: Ganancioso (+6 mult) depois Vidente (x3).
	# Par de ouros: mult 2 -> +6 = 8 -> x3 = 24.
	var ganancioso := Joker.make("g", "", "", Joker.Effect.MULT_PER_SUIT, 3, "diamonds")
	var vidente := Joker.make("v", "", "", Joker.Effect.MULT_TIMES, 3)
	var cards := [_card(13, "diamonds"), _card(13, "diamonds")]
	var r := Scoring.score(cards, [ganancioso, vidente], {})
	check("stack: (2+6)*3", int(r.mult), 24)
