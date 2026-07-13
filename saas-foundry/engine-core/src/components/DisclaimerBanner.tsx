import type { ReactElement } from 'react';

/** Texto legal EXATO — reutilizado em todas as ferramentas de estimativa. */
export const DISCLAIMER_TEXT =
	'O Lidar Core é uma ferramenta de inteligência e estimativa de mercado. Valores exatos de tributação devem ser validados com seu contador local. Não nos responsabilizamos por margens operacionais executadas.';

/** Blindagem legal: banner sutil mas inegável no rodapé dos resultados. */
export function DisclaimerBanner(): ReactElement {
	return (
		<p
			role="note"
			data-testid="legal-disclaimer"
			className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50/70 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700 ring-1 ring-inset ring-amber-100"
		>
			<span aria-hidden>⚠️</span>
			<span>{DISCLAIMER_TEXT}</span>
		</p>
	);
}
