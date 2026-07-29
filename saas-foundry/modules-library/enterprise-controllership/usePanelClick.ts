import { useCallback, useEffect, useRef } from 'react';

/**
 * usePanelClick — distingue 1 clique de 2 cliques SEM disparar o simples durante
 * o duplo. Estratégia: conta os cliques dentro de uma janela (debounce) e só
 * decide quando a janela fecha. Assim, o segundo clique nunca deixa o `onSingle`
 * vazar antes do `onDouble` — o problema clássico de `onClick`+`onDoubleClick`.
 *
 * Retorna UM único handler para o `onClick` do elemento (o `onDoubleClick` nativo
 * não é usado; a decisão é nossa, o que a torna determinística e à prova de timing).
 */

/** Janela de decisão (ms). ~230ms cobre o duplo-clique humano sem atrasar demais o simples. */
export const CLICK_WINDOW_MS = 230;

/** Decisão pura (testável): 2+ cliques na janela = duplo; senão simples. */
export function resolveClicks(count: number): 'single' | 'double' {
	return count >= 2 ? 'double' : 'single';
}

export function usePanelClick(onSingle: () => void, onDouble: () => void, windowMs: number = CLICK_WINDOW_MS): () => void {
	const clicks = useRef(0);
	const timer = useRef<number | null>(null);
	// Refs para não recriar o handler a cada render (callbacks sempre atuais).
	const singleRef = useRef(onSingle);
	const doubleRef = useRef(onDouble);
	singleRef.current = onSingle;
	doubleRef.current = onDouble;

	useEffect(() => () => {
		if (timer.current !== null) window.clearTimeout(timer.current);
	}, []);

	return useCallback(() => {
		clicks.current += 1;
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			const decision = resolveClicks(clicks.current);
			clicks.current = 0;
			timer.current = null;
			if (decision === 'double') doubleRef.current();
			else singleRef.current();
		}, windowMs);
	}, [windowMs]);
}
