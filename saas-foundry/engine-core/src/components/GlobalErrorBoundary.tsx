import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react';

interface GlobalErrorBoundaryProps {
	readonly children: ReactNode;
	/** Telemetry hook (Sentry etc.). Never rethrows. */
	readonly onError?: (error: Error, info: ErrorInfo) => void;
	/** Override for tests; production default reloads the page. */
	readonly onReload?: () => void;
}

interface GlobalErrorBoundaryState {
	readonly error: Error | null;
}

/**
 * Last line of defense, mounted at the app root. A fatal render error in
 * production shows a friendly recovery screen instead of React's white
 * screen. Plugin crashes never reach this — the per-plugin ErrorBoundary
 * inside PluginRenderer absorbs them first.
 */
export class GlobalErrorBoundary extends Component<GlobalErrorBoundaryProps, GlobalErrorBoundaryState> {
	override state: GlobalErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): GlobalErrorBoundaryState {
		return { error };
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		this.props.onError?.(error, info);
	}

	private readonly reload = (): void => {
		if (this.props.onReload) {
			this.props.onReload();
			return;
		}
		window.location.reload();
	};

	override render(): ReactNode {
		if (this.state.error === null) {
			return this.props.children as ReactElement;
		}
		return (
			<div role="alert" className="flex min-h-screen items-center justify-center bg-gray-50 px-4 font-sans antialiased">
				<div className="w-full max-w-sm rounded-2xl bg-white p-10 text-center shadow-sm">
					<span aria-hidden className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-2xl">
						⚠️
					</span>
					<h1 className="text-xl font-semibold tracking-tight text-gray-900">Ops, algo deu errado</h1>
					<p className="mt-2 text-sm leading-relaxed text-gray-500">
						Encontramos um erro inesperado. Seus dados estão seguros — recarregue a página para continuar.
					</p>
					<button
						type="button"
						onClick={this.reload}
						className="mt-6 w-full rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:scale-105 hover:shadow-md"
					>
						Recarregar
					</button>
				</div>
			</div>
		);
	}
}
