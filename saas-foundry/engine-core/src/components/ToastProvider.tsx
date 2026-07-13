import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
	type ReactElement,
	type ReactNode
} from 'react';
import { CheckCircle2, TriangleAlert, X } from 'lucide-react';

type ToastKind = 'success' | 'error';

interface ToastItem {
	readonly id: number;
	readonly kind: ToastKind;
	readonly message: string;
}

export interface ToastApi {
	readonly success: (message: string) => void;
	readonly error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Outside a provider (tests, server render) toasts degrade to no-ops instead of crashing the plugin. */
const NOOP_TOAST: ToastApi = { success: () => undefined, error: () => undefined };

export function useToast(): ToastApi {
	return useContext(ToastContext) ?? NOOP_TOAST;
}

export interface ToastProviderProps {
	readonly children: ReactNode;
	readonly durationMs?: number;
}

/** Global visual feedback. Mounted once by the shell; plugins fire toasts via useToast(). */
export function ToastProvider({ children, durationMs = 3500 }: ToastProviderProps): ReactElement {
	const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
	const nextId = useRef(0);

	const dismiss = useCallback((id: number): void => {
		setToasts(current => current.filter(toast => toast.id !== id));
	}, []);

	const push = useCallback(
		(kind: ToastKind, message: string): void => {
			const id = ++nextId.current;
			setToasts(current => [...current, { id, kind, message }]);
			setTimeout(() => dismiss(id), durationMs);
		},
		[dismiss, durationMs]
	);

	const api = useMemo<ToastApi>(
		() => ({
			success: message => push('success', message),
			error: message => push('error', message)
		}),
		[push]
	);

	return (
		<ToastContext.Provider value={api}>
			{children}
			<div aria-live="polite" className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-80 flex-col gap-2">
				{toasts.map(toast => (
					<div
						key={toast.id}
						role="status"
						className="toast-item pointer-events-auto flex items-center gap-3 rounded-xl bg-gray-900 px-4 py-3 text-sm text-white shadow-md"
					>
						{toast.kind === 'success' ? (
							<CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
						) : (
							<TriangleAlert className="h-5 w-5 shrink-0 text-red-400" aria-hidden />
						)}
						<span className="min-w-0 flex-1">{toast.message}</span>
						<button
							type="button"
							aria-label="Fechar notificação"
							onClick={() => dismiss(toast.id)}
							className="rounded-lg p-1 text-gray-400 transition-all hover:bg-white/10 hover:text-white"
						>
							<X className="h-4 w-4" aria-hidden />
						</button>
					</div>
				))}
			</div>
		</ToastContext.Provider>
	);
}
