extends Control

## Protótipo jogável de deckbuilder (Balatro-lite) + Coringas + Loja + Tabuleiro.
## Toda a UI é construída em código de propósito: zero arte, foco no LOOP.
## A lógica de pontuação vive em scoring.gd (testável); aqui é só jogo + UI.
##
## FASE 2.5 (grade 2D): os coringas ocupam células de um TABULEIRO. A adjacência
## (vizinhos em cima/baixo/lados) e a ordem de leitura mudam a pontuação.
## Clique num coringa para selecioná-lo, depois clique numa célula vazia para
## mover ou noutro coringa para trocar. Organizar é a decisão central.

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
const BOARD_COLS := 5           # colunas do tabuleiro
const BOARD_ROWS := 2           # linhas do tabuleiro
const MAX_JOKERS := 6           # limite de coringas (<= COLS*ROWS)
const SHOP_SLOTS := 3           # coringas ofertados por loja
const REROLL_COST := 2          # custo para rerolar a loja

const NO_CELL := Vector2i(-1, -1)

# --------------------------------------------------------------------------
#  ESTADO
# --------------------------------------------------------------------------
var deck: Array = []
var hand: Array = []
var selected: Array = []          # índices dentro de `hand`
var board: Dictionary = {}        # Vector2i(col,row) -> Joker (fonte da verdade)
var selected_cell := NO_CELL      # célula do coringa selecionado p/ mover
var shop_offers: Array = []       # coringas à venda na loja atual
var round_num := 1
var target := BASE_TARGET
var round_score := 0
var hands_left := HANDS_PER_ROUND
var discards_left := DISCARDS_PER_ROUND
var money := 0
var game_over := false
var in_shop := false

# --------------------------------------------------------------------------
#  REFERÊNCIAS DE UI
# --------------------------------------------------------------------------
var info_label: Label
var message_label: Label
var board_grid: GridContainer
# painel de jogo
var play_panel: VBoxContainer
var preview_label: Label
var card_row: HBoxContainer
var play_button: Button
var discard_button: Button
# painel de loja
var shop_panel: VBoxContainer
var shop_row: HBoxContainer
var reroll_button: Button
var continue_button: Button


func _ready() -> void:
	randomize()
	set_anchors_preset(Control.PRESET_FULL_RECT)

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 32)
	add_child(margin)

	var root := VBoxContainer.new()
	root.add_theme_constant_override("separation", 14)
	margin.add_child(root)

	var title := Label.new()
	title.text = "PROTÓTIPO DECKBUILDER  ·  Tabuleiro de Coringas"
	title.add_theme_font_size_override("font_size", 24)
	root.add_child(title)

	info_label = Label.new()
	info_label.add_theme_font_size_override("font_size", 18)
	root.add_child(info_label)

	message_label = Label.new()
	message_label.add_theme_color_override("font_color", Color(0.4, 0.8, 1.0))
	root.add_child(message_label)

	_build_board(root)
	root.add_child(HSeparator.new())
	_build_play_panel(root)
	_build_shop_panel(root)

	# Começa com alguns coringas para o efeito ser visível já na 1ª rodada.
	for j in Joker.default_pool().slice(0, STARTING_JOKERS):
		_add_joker(j)
	start_round()


func _build_board(root: VBoxContainer) -> void:
	var header := Label.new()
	header.text = "Tabuleiro (adjacência e ordem de leitura importam — clique p/ selecionar e mover):"
	header.add_theme_color_override("font_color", Color(1.0, 0.82, 0.35))
	root.add_child(header)

	board_grid = GridContainer.new()
	board_grid.columns = BOARD_COLS
	board_grid.add_theme_constant_override("h_separation", 8)
	board_grid.add_theme_constant_override("v_separation", 8)
	root.add_child(board_grid)


func _build_play_panel(root: VBoxContainer) -> void:
	play_panel = VBoxContainer.new()
	play_panel.add_theme_constant_override("separation", 14)
	root.add_child(play_panel)

	preview_label = Label.new()
	preview_label.add_theme_font_size_override("font_size", 20)
	play_panel.add_child(preview_label)

	card_row = HBoxContainer.new()
	card_row.add_theme_constant_override("separation", 10)
	play_panel.add_child(card_row)

	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 12)
	play_panel.add_child(buttons)

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


func _build_shop_panel(root: VBoxContainer) -> void:
	shop_panel = VBoxContainer.new()
	shop_panel.add_theme_constant_override("separation", 14)
	root.add_child(shop_panel)

	var shop_title := Label.new()
	shop_title.text = "🛒  LOJA — gaste seu dinheiro em coringas"
	shop_title.add_theme_font_size_override("font_size", 20)
	shop_panel.add_child(shop_title)

	shop_row = HBoxContainer.new()
	shop_row.add_theme_constant_override("separation", 12)
	shop_panel.add_child(shop_row)

	var shop_buttons := HBoxContainer.new()
	shop_buttons.add_theme_constant_override("separation", 12)
	shop_panel.add_child(shop_buttons)

	reroll_button = Button.new()
	reroll_button.text = "Rerolar ($%d)" % REROLL_COST
	reroll_button.custom_minimum_size = Vector2(160, 48)
	reroll_button.pressed.connect(_on_reroll)
	shop_buttons.add_child(reroll_button)

	continue_button = Button.new()
	continue_button.text = "Próxima Rodada  ▶"
	continue_button.custom_minimum_size = Vector2(220, 48)
	continue_button.pressed.connect(_on_continue)
	shop_buttons.add_child(continue_button)


# --------------------------------------------------------------------------
#  TABULEIRO — helpers
# --------------------------------------------------------------------------
func _first_free_cell() -> Vector2i:
	for r in BOARD_ROWS:
		for c in BOARD_COLS:
			var cell := Vector2i(c, r)
			if not board.has(cell):
				return cell
	return NO_CELL


func _add_joker(j: Joker) -> bool:
	if board.size() >= MAX_JOKERS:
		return false
	var cell := _first_free_cell()
	if cell == NO_CELL:
		return false
	board[cell] = j
	return true


func _owned_ids() -> Dictionary:
	var d := {}
	for j in board.values():
		d[j.id] = true
	return d


## Coringas em ordem de leitura (linha, depois coluna) + suas células.
func _ordered() -> Dictionary:
	var cells: Array = board.keys()
	cells.sort_custom(func(a, b): return (a.y * BOARD_COLS + a.x) < (b.y * BOARD_COLS + b.x))
	var js := []
	var ps := []
	for cell in cells:
		js.append(board[cell])
		ps.append(cell)
	return { "jokers": js, "positions": ps }


func _score(cards: Array) -> Dictionary:
	var od := _ordered()
	return Scoring.score(cards, od.jokers, _ctx(), od.positions)


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
#  AÇÕES DO JOGADOR (jogo)
# --------------------------------------------------------------------------
func _on_play() -> void:
	if game_over:
		_restart()
		return
	if selected.is_empty():
		return

	var result := _score(_selected_cards())
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
		money += 5 + round_num                       # recompensa da rodada
		message_label.text = "Rodada %d vencida!  +$%d" % [round_num, 5 + round_num]
		_open_shop()
	elif hands_left <= 0:
		game_over = true
		message_label.text = "FIM DE JOGO na rodada %d. Clique em 'Jogar Mão' para recomeçar." % round_num


func _restart() -> void:
	game_over = false
	in_shop = false
	round_num = 1
	money = 0
	selected_cell = NO_CELL
	message_label.text = ""
	board.clear()
	for j in Joker.default_pool().slice(0, STARTING_JOKERS):
		_add_joker(j)
	start_round()


# --------------------------------------------------------------------------
#  GESTÃO: mover/trocar coringas no tabuleiro (posição muda o cálculo)
# --------------------------------------------------------------------------
func _on_cell_clicked(cell: Vector2i) -> void:
	if board.has(cell):
		if selected_cell != NO_CELL and selected_cell != cell:
			# troca dois coringas de lugar
			var tmp = board[cell]
			board[cell] = board[selected_cell]
			board[selected_cell] = tmp
			selected_cell = NO_CELL
		elif selected_cell == cell:
			selected_cell = NO_CELL          # clicar de novo = desmarcar
		else:
			selected_cell = cell             # seleciona
	else:
		if selected_cell != NO_CELL:
			# move o coringa selecionado para a célula vazia
			board[cell] = board[selected_cell]
			board.erase(selected_cell)
			selected_cell = NO_CELL
	update_ui()


# --------------------------------------------------------------------------
#  LOJA
# --------------------------------------------------------------------------
func _open_shop() -> void:
	in_shop = true
	_generate_offers()


func _generate_offers() -> void:
	shop_offers.clear()
	var owned := _owned_ids()
	var pool := []
	for j in Joker.default_pool():
		if not owned.has(j.id):
			pool.append(j)
	pool.shuffle()
	for i in min(SHOP_SLOTS, pool.size()):
		shop_offers.append(pool[i])


func _buy_joker(index: int) -> void:
	if index < 0 or index >= shop_offers.size():
		return
	var j: Joker = shop_offers[index]
	if money < j.cost or board.size() >= MAX_JOKERS:
		return
	if not _add_joker(j):
		return
	money -= j.cost
	shop_offers.remove_at(index)
	message_label.text = "Comprou: %s  (-$%d)" % [j.joker_name, j.cost]
	update_ui()


func _on_reroll() -> void:
	if money < REROLL_COST:
		return
	money -= REROLL_COST
	_generate_offers()
	message_label.text = "Loja rerolada (-$%d)" % REROLL_COST
	update_ui()


func _on_continue() -> void:
	in_shop = false
	round_num += 1
	start_round()
	message_label.text = "Rodada %d — alvo %d" % [round_num, target]


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
	_rebuild_board()

	play_panel.visible = not in_shop
	shop_panel.visible = in_shop

	if in_shop:
		_rebuild_shop()
		reroll_button.disabled = money < REROLL_COST
	else:
		_rebuild_cards()
		_update_preview()
		play_button.disabled = (not game_over) and selected.is_empty()
		discard_button.disabled = game_over or selected.is_empty() or discards_left <= 0


func _rebuild_board() -> void:
	for child in board_grid.get_children():
		child.queue_free()
	for r in BOARD_ROWS:
		for c in BOARD_COLS:
			var cell := Vector2i(c, r)
			var b := Button.new()
			b.custom_minimum_size = Vector2(150, 78)
			if board.has(cell):
				var j: Joker = board[cell]
				b.text = "%s\n%s" % [j.joker_name, j.description]
				if cell == selected_cell:
					b.modulate = Color(1.0, 0.9, 0.4)  # destaca o selecionado
			else:
				b.text = "· vazio ·"
				b.add_theme_color_override("font_color", Color(0.45, 0.45, 0.45))
			b.pressed.connect(_on_cell_clicked.bind(cell))
			board_grid.add_child(b)


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


func _rebuild_shop() -> void:
	for child in shop_row.get_children():
		child.queue_free()
	if shop_offers.is_empty():
		var empty := Label.new()
		empty.text = "(nada à venda — você já tem tudo, ou não sobrou nada!)"
		empty.add_theme_color_override("font_color", Color(0.6, 0.6, 0.6))
		shop_row.add_child(empty)
		return
	var board_full := board.size() >= MAX_JOKERS
	for i in shop_offers.size():
		var j: Joker = shop_offers[i]
		var b := Button.new()
		b.custom_minimum_size = Vector2(210, 130)
		var tag := "  (tabuleiro cheio)" if board_full else ""
		b.text = "%s\n$%d\n\n%s%s" % [j.joker_name, j.cost, j.description, tag]
		b.disabled = money < j.cost or board_full
		b.pressed.connect(_buy_joker.bind(i))
		shop_row.add_child(b)


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
	var r := _score(_selected_cards())
	var base_total: int = int(r.base_chips) * int(r.base_mult)
	var suffix := ""
	if int(r.total) != base_total:
		suffix = "   (base %d, coringas ativos!)" % base_total
	preview_label.text = "%s   →   %d chips × %d mult = %d pontos%s" % [
		r.name, int(r.chips), int(r.mult), int(r.total), suffix
	]
