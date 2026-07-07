extends Control

## Protótipo jogável de deckbuilder (Balatro-lite).
## Toda a UI é construída em código de propósito: zero arte, foco no LOOP.
## O objetivo deste protótipo é responder uma pergunta: o loop é divertido?

# --------------------------------------------------------------------------
#  BALANCEAMENTO — mexa aqui para ajustar o jogo. É o "painel de controle".
# --------------------------------------------------------------------------
const HAND_SIZE := 8            # cartas na mão
const MAX_SELECT := 5           # cartas jogáveis por vez
const HANDS_PER_ROUND := 4      # tentativas de pontuar por rodada
const DISCARDS_PER_ROUND := 3   # descartes por rodada
const BASE_TARGET := 100        # meta da rodada 1
const TARGET_GROWTH := 1.6      # meta cresce ^ por rodada

# [chips_base, mult] por tipo de mão
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

# --------------------------------------------------------------------------
#  ESTADO
# --------------------------------------------------------------------------
var deck: Array = []
var hand: Array = []
var selected: Array = []   # índices dentro de `hand`
var round_num := 1
var target := BASE_TARGET
var round_score := 0
var hands_left := HANDS_PER_ROUND
var discards_left := DISCARDS_PER_ROUND
var money := 0
var game_over := false

# --------------------------------------------------------------------------
#  REFERÊNCIAS DE UI
# --------------------------------------------------------------------------
var info_label: Label
var message_label: Label
var preview_label: Label
var card_row: HBoxContainer
var play_button: Button
var discard_button: Button


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 32)
	add_child(margin)

	var root := VBoxContainer.new()
	root.add_theme_constant_override("separation", 18)
	margin.add_child(root)

	var title := Label.new()
	title.text = "PROTÓTIPO DECKBUILDER  ·  Balatro-lite"
	title.add_theme_font_size_override("font_size", 24)
	root.add_child(title)

	info_label = Label.new()
	info_label.add_theme_font_size_override("font_size", 18)
	root.add_child(info_label)

	message_label = Label.new()
	message_label.add_theme_color_override("font_color", Color(0.4, 0.8, 1.0))
	root.add_child(message_label)

	root.add_child(HSeparator.new())

	preview_label = Label.new()
	preview_label.add_theme_font_size_override("font_size", 20)
	root.add_child(preview_label)

	card_row = HBoxContainer.new()
	card_row.add_theme_constant_override("separation", 10)
	root.add_child(card_row)

	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 12)
	root.add_child(buttons)

	play_button = Button.new()
	play_button.text = "Jogar Mão"
	play_button.custom_minimum_size = Vector2(160, 48)
	play_button.pressed.connect(_on_play)
	buttons.add_child(play_button)

	discard_button = Button.new()
	discard_button.text = "Descartar"
	discard_button.custom_minimum_size = Vector2(160, 48)
	discard_button.pressed.connect(_on_discard)
	buttons.add_child(discard_button)

	var hint := Label.new()
	hint.text = "Selecione até 5 cartas e forme a maior pontuação (chips × mult)."
	hint.add_theme_color_override("font_color", Color(0.6, 0.6, 0.6))
	root.add_child(hint)

	start_round()


# --------------------------------------------------------------------------
#  FLUXO DE RODADA
# --------------------------------------------------------------------------
func start_round() -> void:
	target = int(round(BASE_TARGET * pow(TARGET_GROWTH, round_num - 1)))
	round_score = 0
	hands_left = HANDS_PER_ROUND
	discards_left = DISCARDS_PER_ROUND
	selected.clear()
	build_deck()
	hand.clear()
	deal_hand()
	update_ui()


func build_deck() -> void:
	deck.clear()
	for suit in ["spades", "hearts", "diamonds", "clubs"]:
		for r in range(1, 14):
			var c := Card.new()
			c.rank = r
			c.suit = suit
			deck.append(c)
	deck.shuffle()


func deal_hand() -> void:
	while hand.size() < HAND_SIZE and deck.size() > 0:
		hand.append(deck.pop_back())


func remove_selected_and_refill() -> void:
	var idx := selected.duplicate()
	idx.sort()
	idx.reverse()  # remove de trás pra frente pra não bagunçar os índices
	for i in idx:
		hand.remove_at(i)
	selected.clear()
	deal_hand()


# --------------------------------------------------------------------------
#  AÇÕES DO JOGADOR
# --------------------------------------------------------------------------
func _on_play() -> void:
	if game_over:
		# Recomeçar do zero.
		game_over = false
		round_num = 1
		money = 0
		message_label.text = ""
		start_round()
		return

	if selected.is_empty():
		return

	var cards := _selected_cards()
	var result := evaluate(cards)
	var gained: int = result.chips * result.mult
	round_score += gained
	hands_left -= 1
	remove_selected_and_refill()
	message_label.text = "%s!  +%d pontos" % [result.name, gained]
	_check_round_state()
	update_ui()


func _on_discard() -> void:
	if game_over or selected.is_empty() or discards_left <= 0:
		return
	var n := selected.size()
	discards_left -= 1
	remove_selected_and_refill()
	message_label.text = "Descartou %d carta(s)." % n
	update_ui()


func _check_round_state() -> void:
	if round_score >= target:
		money += 5 + round_num
		round_num += 1
		start_round()
		message_label.text = "Rodada vencida!  +$%d  →  Rodada %d" % [5 + (round_num - 1), round_num]
	elif hands_left <= 0:
		game_over = true
		message_label.text = "FIM DE JOGO na rodada %d. Clique em 'Jogar Mão' para recomeçar." % round_num


# --------------------------------------------------------------------------
#  PONTUAÇÃO
# --------------------------------------------------------------------------
func _selected_cards() -> Array:
	var cards := []
	for i in selected:
		cards.append(hand[i])
	return cards


## Retorna { "name": String, "chips": int, "mult": int }
func evaluate(cards: Array) -> Dictionary:
	var type_name := classify(cards)
	var base: Array = HAND_VALUES[type_name]
	var chips: int = base[0]
	var mult: int = base[1]
	for c in cards:
		chips += c.chip_value()
	return { "name": type_name, "chips": chips, "mult": mult }


## Determina o melhor tipo de mão de pôquer para as cartas selecionadas.
func classify(cards: Array) -> String:
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
	counts.reverse()  # ordem decrescente: [maior grupo, ...]

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


func _is_straight(rank_list: Array) -> bool:
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


# --------------------------------------------------------------------------
#  UI
# --------------------------------------------------------------------------
func update_ui() -> void:
	info_label.text = "Rodada %d   |   Alvo: %d   |   Pontos: %d   |   Mãos: %d   |   Descartes: %d   |   $%d" % [
		round_num, target, round_score, hands_left, discards_left, money
	]
	_rebuild_cards()
	_update_preview()
	play_button.disabled = (not game_over) and selected.is_empty()
	discard_button.disabled = game_over or selected.is_empty() or discards_left <= 0


func _rebuild_cards() -> void:
	for child in card_row.get_children():
		child.queue_free()
	for i in hand.size():
		var c = hand[i]
		var b := Button.new()
		b.toggle_mode = true
		b.custom_minimum_size = Vector2(78, 108)
		b.text = c.display_name()
		b.add_theme_font_size_override("font_size", 22)
		if c.is_red():
			b.add_theme_color_override("font_color", Color(0.92, 0.28, 0.28))
		# IMPORTANTE: definir o estado ANTES de conectar, senão o set programático
		# dispara o sinal `toggled` e causa recursão.
		b.button_pressed = selected.has(i)
		b.toggled.connect(_on_card_toggled.bind(i))
		card_row.add_child(b)


func _on_card_toggled(pressed: bool, index: int) -> void:
	if pressed:
		if selected.size() >= MAX_SELECT:
			update_ui()  # reverte o visual do botão recém-clicado
			return
		if not selected.has(index):
			selected.append(index)
	else:
		selected.erase(index)
	update_ui()


func _update_preview() -> void:
	if selected.is_empty():
		preview_label.text = "Selecione cartas para ver a mão…"
		return
	var r := evaluate(_selected_cards())
	preview_label.text = "%s   →   %d chips × %d mult = %d pontos" % [
		r.name, r.chips, r.mult, r.chips * r.mult
	]
