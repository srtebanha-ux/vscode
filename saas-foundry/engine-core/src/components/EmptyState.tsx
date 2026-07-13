import type { ComponentType, ReactElement } from 'react';

export interface EmptyStateProps {
	/** Lucide icon (or any component accepting className). */
	readonly icon: ComponentType<{ className?: string | undefined }>;
	readonly title: string;
	readonly description: string;
	readonly actionLabel: string;
	readonly onAction: () => void;
}

/** Friction-zero empty state: soft icon, short copy, one obvious CTA. */
export function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps): ReactElement {
	return (
		<div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
			<span className="rounded-full bg-gray-100 p-4 text-gray-400">
				<Icon className="h-8 w-8" aria-hidden />
			</span>
			<div>
				<h3 className="text-base font-semibold tracking-tight text-gray-900">{title}</h3>
				<p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-gray-500">{description}</p>
			</div>
			<button
				type="button"
				onClick={onAction}
				className="mt-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:scale-105 hover:shadow-md"
			>
				{actionLabel}
			</button>
		</div>
	);
}
