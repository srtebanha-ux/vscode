import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react';

interface ErrorBoundaryProps {
	readonly pluginId: string;
	readonly children: ReactNode;
	readonly onError?: (error: Error, info: ErrorInfo) => void;
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
				<div role="alert" className="plugin-crash-panel">
					<h2>Plugin indisponível</h2>
					<p>O plugin “{this.props.pluginId}” encontrou um erro e foi isolado. O restante da aplicação segue funcionando.</p>
				</div>
			);
		}
		return this.props.children as ReactElement;
	}
}
