import type { ReactElement } from 'react';

export interface LoadingSkeletonProps {
	/** Placeholder rows mimicking the list being fetched. */
	readonly rows?: number;
	/** Renders a title/action header placeholder above the rows. */
	readonly withHeader?: boolean;
}

/** Structural placeholder shown while a module fetches data (Firestore, gateway…). */
export function LoadingSkeleton({ rows = 3, withHeader = true }: LoadingSkeletonProps): ReactElement {
	return (
		<div aria-busy="true" aria-label="Carregando conteúdo" className="animate-pulse space-y-4">
			{withHeader && (
				<div className="flex items-center justify-between">
					<div className="space-y-2">
						<div className="h-4 w-40 rounded-lg bg-gray-100" />
						<div className="h-3 w-56 rounded-lg bg-gray-100" />
					</div>
					<div className="h-9 w-32 rounded-xl bg-gray-100" />
				</div>
			)}
			{Array.from({ length: rows }, (_, index) => (
				<div key={index} className="h-16 rounded-xl bg-gray-100" />
			))}
		</div>
	);
}
