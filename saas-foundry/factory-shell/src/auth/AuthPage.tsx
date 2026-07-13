import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useForm, type FieldError, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Building2, Check, Hexagon, Loader2, Lock, Mail, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';

// ── Contrato de integração: a página é desacoplada do provedor de auth ───────

export interface PasswordLogin {
	readonly email: string;
	readonly password: string;
}
export interface SignUpPayload {
	readonly email: string;
	readonly password: string;
	readonly company: string;
}
export interface AuthHandlers {
	readonly onPasswordLogin: (values: PasswordLogin) => Promise<void>;
	readonly onSignUp: (values: SignUpPayload) => Promise<void>;
	readonly onGoogle: () => Promise<void>;
	readonly onMagicLink: (email: string) => Promise<void>;
}

export interface AuthPageProps {
	/** Ganchos reais de autenticação. Sem eles, a página opera em modo demonstração. */
	readonly handlers?: Partial<AuthHandlers>;
}

export type AuthTab = 'login' | 'signup';

// ── Frases de impacto rotativas (painel institucional) ───────────────────────

const IMPACT_PHRASES: readonly string[] = [
	'A infraestrutura de inteligência que elimina o prejuízo da sua operação.',
	'Precificação, fiscal e controladoria em um só lugar — sem planilha.',
	'Do microempreendedor ao enterprise: a mesma base blindada de dados.'
];

// ── Validação (react-hook-form + zod) ────────────────────────────────────────

const emailField = z.email({ error: 'E-mail inválido' });
const passwordField = z.string().min(6, { error: 'Mínimo de 6 caracteres' });

const loginSchema = z.object({ email: emailField, password: passwordField });
const signupSchema = z.object({
	company: z.string().trim().min(2, { error: 'Informe o nome da empresa' }).max(80, { error: 'Nome muito longo' }),
	email: emailField,
	password: passwordField
});
const magicSchema = z.object({ email: emailField });

type LoginForm = z.infer<typeof loginSchema>;
type SignupForm = z.infer<typeof signupSchema>;

// ── Campo com validação visual defensiva (borda verde/vermelha) ──────────────

interface FieldProps {
	readonly icon: typeof Mail;
	readonly label: string;
	readonly type: string;
	readonly placeholder: string;
	readonly autoComplete: string;
	readonly registration: UseFormRegisterReturn;
	readonly error?: FieldError | undefined;
	readonly valid: boolean;
	readonly testId: string;
}

function Field({ icon: Icon, label, type, placeholder, autoComplete, registration, error, valid, testId }: FieldProps): ReactElement {
	const state = error ? 'error' : valid ? 'valid' : 'idle';
	const ring =
		state === 'error'
			? 'border-red-300 focus-within:border-red-400 focus-within:ring-red-100'
			: state === 'valid'
				? 'border-emerald-300 focus-within:border-emerald-400 focus-within:ring-emerald-100'
				: 'border-gray-200 focus-within:border-gray-900 focus-within:ring-gray-900/10';
	return (
		<label className="block">
			<span className="mb-1.5 block text-sm font-medium text-gray-900">{label}</span>
			<div className={`flex items-center rounded-xl border bg-white shadow-sm transition-all focus-within:ring-2 ${ring}`}>
				<Icon className="ml-3 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
				<input
					type={type}
					placeholder={placeholder}
					autoComplete={autoComplete}
					aria-invalid={state === 'error'}
					aria-label={label}
					data-testid={testId}
					className="w-full rounded-xl bg-transparent px-2.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-300"
					{...registration}
				/>
				{state === 'valid' && <Check className="mr-3 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />}
			</div>
			{error && (
				<motion.span initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert" className="mt-1.5 block text-xs font-medium text-red-500">
					{error.message}
				</motion.span>
			)}
		</label>
	);
}

// ── Ícone oficial do Google (multicolor, inline SVG) ─────────────────────────

function GoogleGlyph(): ReactElement {
	return (
		<svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden focusable="false">
			<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
			<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
			<path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
			<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
		</svg>
	);
}

// ── Botões de fricção zero (Google + Magic Link) ─────────────────────────────

type Status = { readonly kind: 'idle' | 'loading' | 'sent' | 'error'; readonly message?: string };

function FrictionlessAccess({ handlers }: { readonly handlers: AuthHandlers }): ReactElement {
	const [google, setGoogle] = useState<Status>({ kind: 'idle' });
	const [magic, setMagic] = useState<Status>({ kind: 'idle' });
	const {
		register,
		handleSubmit,
		formState: { errors, isValid }
	} = useForm<{ email: string }>({ resolver: zodResolver(magicSchema), mode: 'onChange', defaultValues: { email: '' } });

	const withGoogle = async (): Promise<void> => {
		if (google.kind === 'loading') return;
		setGoogle({ kind: 'loading' });
		try {
			await handlers.onGoogle();
			setGoogle({ kind: 'idle' });
		} catch {
			setGoogle({ kind: 'error', message: 'Não foi possível conectar com o Google.' });
		}
	};

	const sendLink = handleSubmit(async ({ email }) => {
		setMagic({ kind: 'loading' });
		try {
			await handlers.onMagicLink(email);
			setMagic({ kind: 'sent', message: `Link enviado para ${email}. Abra o e-mail para entrar.` });
		} catch {
			setMagic({ kind: 'error', message: 'Não foi possível enviar o link agora.' });
		}
	});

	return (
		<div className="space-y-3">
			<button
				type="button"
				onClick={() => void withGoogle()}
				disabled={google.kind === 'loading'}
				data-testid="google-signin"
				className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:border-gray-300 hover:shadow-md disabled:opacity-60"
			>
				{google.kind === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <GoogleGlyph />}
				Entrar com o Google
			</button>

			{/* Magic Link: sem senha para lembrar */}
			<form onSubmit={event => void sendLink(event)} className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-3">
				<span className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600">
					<Wand2 className="h-3.5 w-3.5" aria-hidden /> Acesso sem senha
				</span>
				<div className="mt-2 flex items-center rounded-xl border border-gray-200 bg-white shadow-sm focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
					<Mail className="ml-3 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
					<input
						type="email"
						placeholder="voce@empresa.com"
						autoComplete="email"
						aria-label="E-mail para link mágico"
						data-testid="magic-email"
						className="w-full rounded-xl bg-transparent px-2.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-300"
						{...register('email')}
					/>
				</div>
				<button
					type="submit"
					disabled={!isValid || magic.kind === 'loading' || magic.kind === 'sent'}
					data-testid="magic-submit"
					className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.01] hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-50"
				>
					{magic.kind === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : magic.kind === 'sent' ? <Check className="h-4 w-4" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
					{magic.kind === 'sent' ? 'Link enviado' : 'Receber Link de Acesso Rápido'}
				</button>
				{(errors.email || magic.message) && (
					<p role={magic.kind === 'error' ? 'alert' : undefined} className={`mt-2 text-xs font-medium ${magic.kind === 'sent' ? 'text-emerald-600' : magic.kind === 'error' ? 'text-red-500' : 'text-red-500'}`} data-testid="magic-status">
						{errors.email?.message ?? magic.message}
					</p>
				)}
			</form>

			{google.kind === 'error' && <p role="alert" className="text-xs font-medium text-red-500">{google.message}</p>}
		</div>
	);
}

// ── Formulários clássicos (Login / Cadastro) ─────────────────────────────────

function LoginForm({ handlers }: { readonly handlers: AuthHandlers }): ReactElement {
	const [failure, setFailure] = useState<string | null>(null);
	const {
		register,
		handleSubmit,
		formState: { errors, dirtyFields, isSubmitting }
	} = useForm<LoginForm>({ resolver: zodResolver(loginSchema), mode: 'onChange', defaultValues: { email: '', password: '' } });

	const submit = handleSubmit(async values => {
		setFailure(null);
		try {
			await handlers.onPasswordLogin(values);
		} catch {
			setFailure('E-mail ou senha inválidos.');
		}
	});

	return (
		<form onSubmit={event => void submit(event)} className="space-y-4" noValidate>
			<Field icon={Mail} label="E-mail" type="email" placeholder="voce@empresa.com" autoComplete="email" registration={register('email')} error={errors.email} valid={Boolean(dirtyFields.email) && !errors.email} testId="login-email" />
			<Field icon={Lock} label="Senha" type="password" placeholder="••••••••" autoComplete="current-password" registration={register('password')} error={errors.password} valid={Boolean(dirtyFields.password) && !errors.password} testId="login-password" />
			{failure && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{failure}</p>}
			<button type="submit" disabled={isSubmitting} data-testid="login-submit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.01] hover:shadow-md disabled:opacity-60">
				{isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Entrar
			</button>
		</form>
	);
}

function SignupForm({ handlers }: { readonly handlers: AuthHandlers }): ReactElement {
	const [failure, setFailure] = useState<string | null>(null);
	const {
		register,
		handleSubmit,
		formState: { errors, dirtyFields, isSubmitting }
	} = useForm<SignupForm>({ resolver: zodResolver(signupSchema), mode: 'onChange', defaultValues: { company: '', email: '', password: '' } });

	const submit = handleSubmit(async values => {
		setFailure(null);
		try {
			await handlers.onSignUp(values);
		} catch {
			setFailure('Não foi possível criar a conta. Este e-mail já pode estar em uso.');
		}
	});

	return (
		<form onSubmit={event => void submit(event)} className="space-y-4" noValidate>
			<Field icon={Building2} label="Nome da Empresa" type="text" placeholder="Sua Empresa ME" autoComplete="organization" registration={register('company')} error={errors.company} valid={Boolean(dirtyFields.company) && !errors.company} testId="signup-company" />
			<Field icon={Mail} label="E-mail" type="email" placeholder="voce@empresa.com" autoComplete="email" registration={register('email')} error={errors.email} valid={Boolean(dirtyFields.email) && !errors.email} testId="signup-email" />
			<Field icon={Lock} label="Senha" type="password" placeholder="crie uma senha forte" autoComplete="new-password" registration={register('password')} error={errors.password} valid={Boolean(dirtyFields.password) && !errors.password} testId="signup-password" />
			{failure && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{failure}</p>}
			<button type="submit" disabled={isSubmitting} data-testid="signup-submit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.01] hover:shadow-md disabled:opacity-60">
				{isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Criar Conta Gratuita
			</button>
		</form>
	);
}

// ── Handlers de demonstração (quando não há provedor real) ───────────────────

const wait = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));
const DEMO_HANDLERS: AuthHandlers = {
	onPasswordLogin: async () => { await wait(600); },
	onSignUp: async () => { await wait(600); },
	onGoogle: async () => { await wait(600); },
	onMagicLink: async () => { await wait(600); }
};

// ── Página unificada ─────────────────────────────────────────────────────────

export function AuthPage({ handlers }: AuthPageProps): ReactElement {
	const merged = useMemo<AuthHandlers>(() => ({ ...DEMO_HANDLERS, ...handlers }), [handlers]);
	const [tab, setTab] = useState<AuthTab>('login');
	const [phrase, setPhrase] = useState(0);

	// Frase de impacto rotativa no painel institucional.
	useEffect(() => {
		const id = window.setInterval(() => setPhrase(current => (current + 1) % IMPACT_PHRASES.length), 5000);
		return () => window.clearInterval(id);
	}, []);

	return (
		<div className="flex min-h-screen w-full font-sans antialiased">
			{/* Lado esquerdo — painel institucional fixo (dark premium) */}
			<aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-zinc-950 p-12 text-white lg:flex">
				{/* Textura sutil de linhas + gradiente */}
				<div className="pointer-events-none absolute inset-0 opacity-[0.35]" style={{ backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '48px 48px' }} aria-hidden />
				<div className="pointer-events-none absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" aria-hidden />
				<div className="pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full bg-violet-600/10 blur-3xl" aria-hidden />

				<div className="relative flex items-center gap-2.5">
					<span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15">
						<Hexagon className="h-5 w-5" aria-hidden />
					</span>
					<span className="text-lg font-semibold tracking-tight">Lidar <span className="text-white/50">Core</span></span>
				</div>

				<div className="relative">
					<span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/70 ring-1 ring-inset ring-white/10">
						<Sparkles className="h-3.5 w-3.5" aria-hidden /> Inteligência operacional
					</span>
					<div className="mt-5 min-h-[7rem]">
						<AnimatePresence mode="wait">
							<motion.h2
								key={phrase}
								initial={{ opacity: 0, y: 12 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, y: -12 }}
								transition={{ duration: 0.4, ease: 'easeOut' }}
								className="max-w-md text-3xl font-bold leading-tight tracking-tight"
							>
								{IMPACT_PHRASES[phrase]}
							</motion.h2>
						</AnimatePresence>
					</div>
					<div className="mt-6 flex gap-1.5" aria-hidden>
						{IMPACT_PHRASES.map((_, index) => (
							<span key={index} className={`h-1 rounded-full transition-all ${index === phrase ? 'w-8 bg-white' : 'w-3 bg-white/20'}`} />
						))}
					</div>
				</div>

				<p className="relative flex items-center gap-2 text-xs text-white/40">
					<ShieldCheck className="h-4 w-4" aria-hidden /> Multi-tenant · cada empresa enxerga apenas o próprio silo de dados.
				</p>
			</aside>

			{/* Lado direito — formulário dinâmico (limpo) */}
			<main className="flex w-full items-center justify-center bg-gray-50 px-5 py-10 lg:w-1/2">
				<div className="w-full max-w-sm">
					{/* Logo compacto (mobile: substitui o painel oculto) */}
					<div className="mb-6 flex items-center gap-2.5 lg:hidden">
						<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-900 text-white">
							<Hexagon className="h-5 w-5" aria-hidden />
						</span>
						<span className="text-base font-semibold tracking-tight text-gray-900">Lidar <span className="text-gray-400">Core</span></span>
					</div>

					{/* Tabs Login / Cadastro */}
					<div role="tablist" aria-label="Acesso" className="relative flex rounded-xl bg-gray-100 p-1">
						{([['login', 'Entrar na Conta'], ['signup', 'Criar Conta Gratuita']] as const).map(([id, label]) => (
							<button
								key={id}
								type="button"
								role="tab"
								aria-selected={tab === id}
								data-testid={`tab-${id}`}
								onClick={() => setTab(id)}
								className={`relative z-10 flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${tab === id ? 'text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
							>
								{tab === id && <motion.span layoutId="auth-tab-pill" className="absolute inset-0 -z-10 rounded-lg bg-white shadow-sm" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
								{label}
							</button>
						))}
					</div>

					<div className="mt-4">
						<h1 className="text-xl font-semibold tracking-tight text-gray-900">
							{tab === 'login' ? 'Bem-vindo de volta' : 'Comece de graça em 30 segundos'}
						</h1>
						<p className="mt-1 text-sm text-gray-500">
							{tab === 'login' ? 'Acesse a sua operação com um clique.' : 'Sem cartão de crédito. Sem burocracia.'}
						</p>
					</div>

					{/* Acesso de fricção zero */}
					<div className="mt-5">
						<FrictionlessAccess handlers={merged} />
					</div>

					{/* Divisor */}
					<div className="my-5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-gray-400">
						<span className="h-px flex-1 bg-gray-200" /> ou com e-mail e senha <span className="h-px flex-1 bg-gray-200" />
					</div>

					{/* Formulário clássico deslizante */}
					<div className="relative overflow-hidden">
						<AnimatePresence mode="wait" initial={false}>
							<motion.div
								key={tab}
								initial={{ opacity: 0, x: tab === 'login' ? -32 : 32 }}
								animate={{ opacity: 1, x: 0 }}
								exit={{ opacity: 0, x: tab === 'login' ? 32 : -32 }}
								transition={{ duration: 0.25, ease: 'easeOut' }}
							>
								{tab === 'login' ? <LoginForm handlers={merged} /> : <SignupForm handlers={merged} />}
							</motion.div>
						</AnimatePresence>
					</div>

					<p className="mt-6 text-center text-xs text-gray-400">
						{tab === 'login' ? (
							<>Ainda não tem conta? <button type="button" onClick={() => setTab('signup')} className="font-semibold text-gray-700 hover:text-gray-900">Criar grátis</button></>
						) : (
							<>Já é cliente? <button type="button" onClick={() => setTab('login')} className="font-semibold text-gray-700 hover:text-gray-900">Entrar</button></>
						)}
					</p>
				</div>
			</main>
		</div>
	);
}
