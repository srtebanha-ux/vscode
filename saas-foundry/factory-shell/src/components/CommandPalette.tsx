import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownLeft, Search, type LucideIcon } from 'lucide-react';

export interface Command {
	readonly id: string;
	readonly label: string;
	readonly hint: string;
	readonly icon: LucideIcon;
	/** Termos extras de busca (não exibidos). */
	readonly keywords: string;
	readonly run: () => void;
}

export interface CommandPaletteProps {
	readonly commands: readonly Command[];
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
}

/** Command Palette global (Ctrl/Cmd+K): busca módulos, painéis e ações sem tocar no mouse. */
export function CommandPalette({ commands, open, onOpenChange }: CommandPaletteProps): ReactElement {
	const [query, setQuery] = useState('');
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	// Atalho global — funciona de qualquer lugar do sistema.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				onOpenChange(!open);
			} else if (event.key === 'Escape' && open) {
				onOpenChange(false);
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [open, onOpenChange]);

	useEffect(() => {
		if (open) {
			setQuery('');
			setActiveIndex(0);
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open]);

	const results = useMemo(() => {
		const term = query.trim().toLowerCase();
		if (!term) {
			return commands;
		}
		return commands.filter(command => `${command.label} ${command.hint} ${command.keywords}`.toLowerCase().includes(term));
	}, [commands, query]);

	const execute = (command: Command): void => {
		onOpenChange(false);
		command.run();
	};

	const onInputKeyDown = (event: React.KeyboardEvent): void => {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			setActiveIndex(index => Math.min(index + 1, results.length - 1));
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			setActiveIndex(index => Math.max(index - 1, 0));
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const command = results[activeIndex];
			if (command) {
				execute(command);
			}
		}
	};

	return (
		<AnimatePresence>
			{open && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.15 }}
					className="fixed inset-0 z-50 flex items-start justify-center bg-gray-950/40 px-4 pt-[18vh] backdrop-blur-sm"
					onClick={() => onOpenChange(false)}
				>
					<motion.div
						role="dialog"
						aria-modal="true"
						aria-label="Busca de comandos"
						initial={{ opacity: 0, scale: 0.96, y: -8 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.96, y: -8 }}
						transition={{ type: 'spring', stiffness: 500, damping: 32 }}
						className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-900/10"
						onClick={event => event.stopPropagation()}
					>
						<div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
							<Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
							<input
								ref={inputRef}
								type="text"
								value={query}
								onChange={event => {
									setQuery(event.target.value);
									setActiveIndex(0);
								}}
								onKeyDown={onInputKeyDown}
								aria-label="Buscar módulos, painéis e ações"
								placeholder="Buscar módulos, painéis e ações…"
								className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
							/>
							<kbd className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">esc</kbd>
						</div>

						<ul role="listbox" aria-label="Resultados" className="max-h-72 overflow-y-auto p-2">
							{results.length === 0 ? (
								<li className="px-3 py-8 text-center text-sm text-gray-400">Nada encontrado para “{query}”.</li>
							) : (
								results.map((command, index) => (
									<li key={command.id} role="option" aria-selected={index === activeIndex}>
										<button
											type="button"
											onClick={() => execute(command)}
											onMouseEnter={() => setActiveIndex(index)}
											aria-label={`${command.label} — ${command.hint}`}
											className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
												index === activeIndex ? 'bg-gray-900 text-white' : 'text-gray-700'
											}`}
										>
											<command.icon className="h-4 w-4 shrink-0" aria-hidden />
											<span className="min-w-0 flex-1 truncate font-medium">{command.label}</span>
											<span className={`truncate text-xs ${index === activeIndex ? 'text-gray-300' : 'text-gray-400'}`}>
												{command.hint}
											</span>
											{index === activeIndex && <CornerDownLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />}
										</button>
									</li>
								))
							)}
						</ul>

						<div className="flex items-center gap-4 border-t border-gray-100 px-4 py-2 text-[10px] text-gray-400">
							<span><kbd className="rounded bg-gray-100 px-1">↑↓</kbd> navegar</span>
							<span><kbd className="rounded bg-gray-100 px-1">↵</kbd> abrir</span>
							<span><kbd className="rounded bg-gray-100 px-1">esc</kbd> fechar</span>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
