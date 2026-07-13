import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react';

interface ErrorBoundaryProps {
	readonly pluginId: string;
	readonly children: ReactNode;
	readonly onError?: (error: Error, info: ErrorInfo) => void;
	/** Quando presente, o painel de falha oferece restauração manual do módulo. */
	readonly onRetry?: (() => void) | undefined;
}

interface ErrorBoundaryState {
	readonly error: Error | null;
}

/**
 * Crash isolation for plugin render trees: a throwing plugin degrades to
 * a fallback panel instead of unmounting the Core shell. Errors never
 * cross the boundary upward.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	override state: ErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		this.props.onError?.(error, info);
	}

	override render(): ReactNode {
		if (this.state.error !== null) {
			return (
				<div role="alert" className="plugin-crash-panel rounded-2xl bg-white p-8 text-center shadow-sm">
					<h2 className="text-lg font-semibold tracking-tight text-gray-900">Plugin indisponível</h2>
					<p className="mt-2 text-sm text-gray-500">
						O plugin “{this.props.pluginId}” encontrou um erro e foi isolado. O restante da aplicação segue funcionando.
					</p>
					{this.props.onRetry && (
						<button
							type="button"
							onClick={() => {
								this.setState({ error: null });
								this.props.onRetry?.();
							}}
							className="mt-5 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:scale-105 hover:shadow-md"
						>
							Restaurar módulo
						</button>
					)}
				</div>
			);
		}
		return this.props.children as ReactElement;
	}
}
