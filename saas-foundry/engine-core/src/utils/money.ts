/**
 * Máscara monetária BRL — utilitário nativo (sem dependência de runtime).
 * O usuário digita apenas dígitos, tratados como centavos: "12345" -> "R$ 123,45".
 * Programação defensiva: qualquer entrada suja colapsa para R$ 0,00 / 0.
 */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Remove tudo que não é dígito (limita para evitar overflow em colagens absurdas). */
export function onlyDigits(value: string): string {
	return value.replace(/\D/g, '').slice(0, 15);
}

/** Centavos (inteiro) -> "R$ 1.234,56". */
export function centsToBRL(cents: number): string {
	const safe = Number.isFinite(cents) ? Math.max(Math.trunc(cents), 0) : 0;
	return brl.format(safe / 100);
}

/** Texto de input -> string mascarada em BRL, tratando os dígitos como centavos. */
export function maskBRL(input: string): string {
	return centsToBRL(Number(onlyDigits(input)) || 0);
}

/** Texto mascarado (ou cru) -> valor numérico em reais (>= 0). */
export function brlToNumber(masked: string): number {
	return (Number(onlyDigits(masked)) || 0) / 100;
}

/** Valor numérico em reais -> string mascarada (para semear rascunhos salvos). */
export function numberToBRL(value: number): string {
	const cents = Number.isFinite(value) ? Math.round(Math.max(value, 0) * 100) : 0;
	return centsToBRL(cents);
}
