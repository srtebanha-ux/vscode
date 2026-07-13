import type { ReactElement, ReactNode } from 'react';

export interface TooltipProps {
	/** Explicação curta da ação complexa. */
	readonly label: string;
	readonly children: ReactNode;
}

/** Dica contextual: aparece 300ms após o hover, some imediatamente ao sair. Zero JS. */
export function Tooltip({ label, children }: TooltipProps): ReactElement {
	return (
		<span className="group/tooltip relative inline-flex">
			{children}
			<span
				role="tooltip"
				className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 max-w-64 -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-md transition-opacity delay-0 duration-150 group-hover/tooltip:delay-300 group-hover/tooltip:opacity-100"
			>
				{label}
			</span>
		</span>
	);
}
