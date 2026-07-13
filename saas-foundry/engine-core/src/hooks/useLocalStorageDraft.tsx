import { useCallback, useRef, useState } from 'react';

/**
 * Rascunho persistente anti-frustração: cada alteração é gravada no
 * localStorage, então um F5 recarrega exatamente o que o usuário digitava.
 * Defensivo: modo privado / JSON corrompido nunca quebram o formulário —
 * caem no fallback silenciosamente.
 *
 * Retorna [rascunho inicial (lido uma vez), salvar, limpar]. O valor inicial
 * é resolvido no primeiro render para semear os defaultValues do formulário.
 */
export function useLocalStorageDraft<T extends object>(
	key: string,
	fallback: T
): readonly [T, (value: T) => void, () => void] {
	const fallbackRef = useRef(fallback);

	const [initial] = useState<T>(() => {
		try {
			const raw = window.localStorage.getItem(key);
			if (!raw) return fallbackRef.current;
			const parsed = JSON.parse(raw) as Partial<T>;
			return { ...fallbackRef.current, ...parsed };
		} catch {
			return fallbackRef.current;
		}
	});

	const save = useCallback(
		(value: T): void => {
			try {
				window.localStorage.setItem(key, JSON.stringify(value));
			} catch {
				/* modo privado / cota cheia: segue sem persistir */
			}
		},
		[key]
	);

	const clear = useCallback((): void => {
		try {
			window.localStorage.removeItem(key);
		} catch {
			/* idem */
		}
	}, [key]);

	return [initial, save, clear] as const;
}
