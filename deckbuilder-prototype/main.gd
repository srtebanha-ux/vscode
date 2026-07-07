extends Control

## Protótipo jogável de deckbuilder (Balatro-lite) + sistema de Coringas.
## Toda a UI é construída em código de propósito: zero arte, foco no LOOP.
## A lógica de pontuação vive em scoring.gd (testável); aqui é só jogo + UI.

# --------------------------------------------------------------------------
#  BALANCEAMENTO — mexa aqui para ajustar o jogo. É o "painel de controle".
# --------------------------------------------------------------------------
const HAND_SIZE := 8            # cartas na mão
const MAX_SELECT := 5           # cartas jogáveis por vez
const HANDS_PER_ROUND := 4      # tentativas de pontuar por rodada
const DISCARDS_PER_ROUND := 3   # descartes por rodada
const BASE_TARGET := 100        # meta da rodada 1
const TARGET_GROWTH := 1.6      # meta cresce ^ por rodada
const STARTING_JOKERS := 2      # coringas com que o jogador começa
const MAX_JOKERS := 5           # limite de coringas

# --------------------------------------------------------------------------
#  ESTADO
# --------------------------------------------------------------------------
var deck: Array = []
var hand: Array = []
var selected: Array = []   # índices dentro de `hand`
var jokers: Array = []     # coringas em posse do jogador
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
var joker_label: Label
var message_label: Label
var preview_label: Label
var card_row: HBoxContainer
var play_button: Button
var discard_button: Button


func _ready() -> void:
	randomize()
	set_anchors_preset(Control.PRESET_FULL_RECT)

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 32)
	add_child(margin)

	var root := VBoxContainer.new()
	root.add_theme_constant_override("separation", 16)
	margin.add_child(root)

	var title := Label.new()
	title.text = "PROTÓTIPO DECKBUILDER  ·  Balatro-lite + Coringas"
	title.add_theme_font_size_override("font_size", 24)
	root.add_child(title)

	info_label = Label.new()
	info_label.add_theme_font_size_override("font_size", 18)
	root.add_child(info_label)

	joker_label = Label.new()
	joker_label.add_theme_color_override("font_color", Color(1.0, 0.82, 0.35))
	joker_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	root.add_child(joker_label)

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
	hint.text = "Selecione até 5 cartas. Os coringas (em amarelo) modificam a pontuação."
	hint.add_theme_color_override("font_color", Color(0.6, 0.6, 0.6))
	root.add_child(hint)

	# Começa com alguns coringas para o efeito ser visível já na 1ª rodada.
	jokers = Joker.default_pool().slice(0, STARTING_JOKERS)
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


func _ctx() -> Dictionary:
	return { "discards_left": discards_left, "hands_left": hands_left }


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
		jokers = Joker.default_pool().slice(0, STARTING_JOKERS)
		start_round()
		return

	if selected.is_empty():
		return

	var result := Scoring.score(_selected_cards(), jokers, _ctx())
	round_score += int(result.total)
	hands_left -= 1
	remove_selected_and_refill()
	message_label.text = "%s!  +%d pontos" % [result.name, int(result.total)]
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
		var got := _grant_random_joker()
		start_round()
		if got != "":
			message_label.text = "Rodada vencida! Novo coringa: %s  →  Rodada %d" % [got, round_num]
		else:
			message_label.text = "Rodada vencida!  →  Rodada %d" % round_num
	elif hands_left <= 0:
		game_over = true
		message_label.text = "FIM DE JOGO na rodada %d. Clique em 'Jogar Mão' para recomeçar." % round_num


## Concede um coringa aleatório ainda não possuído. Retorna o nome ou "".
func _grant_random_joker() -> String:
	if jokers.size() >= MAX_JOKERS:
		return ""
	var owned := {}
	for j in jokers:
		owned[j.id] = true
	var candidates := []
	for j in Joker.default_pool():
		if not owned.has(j.id):
			candidates.append(j)
	if candidates.is_empty():
		return ""
	var chosen: Joker = candidates[randi() % candidates.size()]
	jokers.append(chosen)
	return chosen.joker_name


# --------------------------------------------------------------------------
#  PONTUAÇÃO (delegada a scoring.gd)
# --------------------------------------------------------------------------
func _selected_cards() -> Array:
	var cards := []
	for i in selected:
		cards.append(hand[i])
	return cards


# --------------------------------------------------------------------------
#  UI
# --------------------------------------------------------------------------
func update_ui() -> void:
	info_label.text = "Rodada %d   |   Alvo: %d   |   Pontos: %d   |   Mãos: %d   |   Descartes: %d   |   $%d" % [
		round_num, target, round_score, hands_left, discards_left, money
	]
	_update_jokers_label()
	_rebuild_cards()
	_update_preview()
	play_button.disabled = (not game_over) and selected.is_empty()
	discard_button.disabled = game_over or selected.is_empty() or discards_left <= 0


func _update_jokers_label() -> void:
	if jokers.is_empty():
		joker_label.text = "Coringas: (nenhum)"
		return
	var parts := []
	for j in jokers:
		parts.append("[%s: %s]" % [j.joker_name, j.description])
	joker_label.text = "Coringas: " + "  ".join(parts)


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
	var r := Scoring.score(_selected_cards(), jokers, _ctx())
	var base_total: int = int(r.base_chips) * int(r.base_mult)
	var suffix := ""
	if int(r.total) != base_total:
		suffix = "   (base %d, coringas ativos!)" % base_total
	preview_label.text = "%s   →   %d chips × %d mult = %d pontos%s" % [
		r.name, int(r.chips), int(r.mult), int(r.total), suffix
	]
