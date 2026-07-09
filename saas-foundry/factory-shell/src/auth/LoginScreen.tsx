import { useState, type FormEvent, type ReactElement } from 'react';
import { Hexagon, Loader2, Lock, Mail } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from './AuthProvider';

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
	'auth/invalid-credential': 'E-mail ou senha inválidos.',
	'auth/invalid-email': 'E-mail inválido.',
	'auth/user-disabled': 'Esta conta foi desativada.',
	'auth/too-many-requests': 'Muitas tentativas. Tente novamente em instantes.'
};

export function LoginScreen(): ReactElement {
	const { signIn } = useAuth();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const onSubmit = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		setError(null);
		setSubmitting(true);
		try {
			await signIn(email, password);
		} catch (err: unknown) {
			const code = (err as { code?: string }).code ?? '';
			setError(ERROR_MESSAGES[code] ?? 'Não foi possível entrar. Verifique sua conexão.');
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 font-sans antialiased">
			<motion.div
				initial={{ opacity: 0, y: 10 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.25, ease: 'easeOut' }}
				className="w-full max-w-sm"
			>
				<div className="mb-8 flex flex-col items-center gap-3">
					<span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-900 text-white shadow-sm">
						<Hexagon className="h-6 w-6" aria-hidden />
					</span>
					<div className="text-center">
						<h1 className="text-xl font-semibold tracking-tight text-gray-900">
							Lidar <span className="text-gray-400">Core</span>
						</h1>
						<p className="mt-1 text-sm text-gray-500">Entre para acessar a sua operação.</p>
					</div>
				</div>

				<form onSubmit={event => void onSubmit(event)} className="rounded-2xl bg-white p-6 shadow-sm">
					<label className="block text-sm font-medium text-gray-900" htmlFor="email">
						E-mail
					</label>
					<div className="relative mt-1.5">
						<Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" aria-hidden />
						<input
							id="email"
							type="email"
							required
							autoComplete="email"
							value={email}
							onChange={event => setEmail(event.target.value)}
							placeholder="voce@empresa.com"
							className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
						/>
					</div>

					<label className="mt-4 block text-sm font-medium text-gray-900" htmlFor="password">
						Senha
					</label>
					<div className="relative mt-1.5">
						<Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" aria-hidden />
						<input
							id="password"
							type="password"
							required
							autoComplete="current-password"
							value={password}
							onChange={event => setPassword(event.target.value)}
							placeholder="••••••••"
							className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
						/>
					</div>

					{error !== null && (
						<p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
							{error}
						</p>
					)}

					<button
						type="submit"
						disabled={submitting}
						className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:scale-105 hover:shadow-md disabled:pointer-events-none disabled:opacity-60"
					>
						{submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
						Entrar
					</button>
				</form>

				<p className="mt-6 text-center text-xs text-gray-400">
					Acesso restrito. Cada tenant enxerga apenas o próprio silo de dados.
				</p>
			</motion.div>
		</div>
	);
}
