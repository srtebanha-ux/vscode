import { useMemo, type ReactElement } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Calculator, FileText, Lock, ReceiptText, Sparkles, TrendingUp, Wallet, type LucideIcon } from 'lucide-react';

export interface DashboardHomeProps {
	/** E-mail da sessão — o primeiro nome é derivado dele para o cumprimento. */
	readonly email?: string | null | undefined;
	/** Plano comercial atual (default: Gratuito). */
	readonly plan?: string;
	readonly navigate: (to: string) => void;
}

/** Deriva um primeiro nome apresentável a partir do e-mail (ana.silva@x.com -> "Ana"). */
function firstNameFromEmail(email: string | null | undefined): string | null {
	if (!email) return null;
	const handle = email.split('@')[0] ?? '';
	const raw = handle.split(/[.\-_+]/)[0] ?? '';
	if (raw.length < 2) return null;
	return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

// ── Arsenal Essencial: atalhos diretos para as ferramentas do dia a dia ──────

interface Tool {
	readonly id: string;
	readonly icon: LucideIcon;
	readonly title: string;
	readonly description: string;
	readonly accent: string;
	readonly route: string;
}

const TOOLS: readonly Tool[] = [
	{
		id: 'margin-calculator-v1',
		icon: Calculator,
		title: 'Calculadora de Preço Sem Prejuízo',
		description: 'Descubra o preço certo que cobre seus custos e ainda deixa lucro.',
		accent: 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600',
		route: '/plugins/margin-calculator-v1'
	},
	{
		id: 'quick-receipt-maker-v1',
		icon: FileText,
		title: 'Emissor de Recibo em PDF',
		description: 'Preencha e baixe um recibo profissional em segundos.',
		accent: 'bg-sky-50 text-sky-600 group-hover:bg-sky-600',
		route: '/plugins/quick-receipt-maker-v1'
	},
	{
		id: 'smart-invoice-helper-v1',
		icon: ReceiptText,
		title: 'Assistente de Impostos e Notas',
		description: 'Impostos da nota calculados pela cidade do cliente, já prontos para a Reforma.',
		accent: 'bg-violet-50 text-violet-600 group-hover:bg-violet-600',
		route: '/plugins/smart-invoice-helper-v1'
	}
];

// ── Especialistas Virtuais (Plano Pro): gatilho de upgrade ───────────────────

interface PremiumSpecialist {
	readonly id: string;
	readonly icon: LucideIcon;
	readonly title: string;
	readonly description: string;
}

const SPECIALISTS: readonly PremiumSpecialist[] = [
	{ id: 'virtual-cfo-v1', icon: Wallet, title: 'Virtual CFO', description: 'Um diretor financeiro de IA que lê seu caixa e aponta onde cortar e onde investir.' },
	{ id: 'virtual-cmo-v1', icon: TrendingUp, title: 'Virtual CMO', description: 'Um diretor de marketing de IA que audita sua comunicação e destrava mais vendas.' }
];

function ToolCard({ tool, index, navigate }: { readonly tool: Tool; readonly index: number; readonly navigate: (to: string) => void }): ReactElement {
	return (
		<motion.div
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.25, delay: index * 0.07, ease: 'easeOut' }}
			data-testid={`tool-${tool.id}`}
			className="group flex flex-col rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 transition-all hover:-translate-y-0.5 hover:shadow-md"
		>
			<span className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors group-hover:text-white ${tool.accent}`}>
				<tool.icon className="h-5 w-5" aria-hidden />
			</span>
			<h3 className="mt-4 text-base font-semibold tracking-tight text-gray-900">{tool.title}</h3>
			<p className="mt-1.5 flex-1 text-sm leading-relaxed text-gray-500">{tool.description}</p>
			<button
				type="button"
				onClick={() => navigate(tool.route)}
				className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:scale-[1.02] hover:shadow-md"
			>
				Abrir Ferramenta
				<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
			</button>
		</motion.div>
	);
}

function PremiumCard({ specialist, index, navigate }: { readonly specialist: PremiumSpecialist; readonly index: number; readonly navigate: (to: string) => void }): ReactElement {
	return (
		<motion.div
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.25, delay: index * 0.07, ease: 'easeOut' }}
			data-testid={`premium-${specialist.id}`}
			className="relative flex flex-col overflow-hidden rounded-2xl border border-amber-200/60 bg-white p-6 shadow-sm"
		>
			{/* Selo dourado de bloqueio */}
			<span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-300 to-yellow-500 px-2.5 py-1 text-[11px] font-bold text-amber-950 shadow-sm">
				<Lock className="h-3 w-3" aria-hidden /> Pro
			</span>

			<span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
				<specialist.icon className="h-5 w-5" aria-hidden />
			</span>
			<h3 className="mt-4 text-base font-semibold tracking-tight text-gray-900">{specialist.title}</h3>
			<p className="mt-1.5 flex-1 text-sm leading-relaxed text-gray-500">{specialist.description}</p>

			<div className="mt-5 flex items-center gap-2 rounded-xl bg-amber-50/70 px-3.5 py-3 ring-1 ring-inset ring-amber-100">
				<Lock className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
				<button
					type="button"
					onClick={() => navigate('/billing')}
					className="text-left text-sm font-semibold text-amber-700 transition-colors hover:text-amber-900"
				>
					Disponível no Plano Pro. <span className="underline decoration-amber-400 underline-offset-2">Desbloquear Inteligência</span>
				</button>
			</div>
		</motion.div>
	);
}

/**
 * Painel principal do microempreendedor (pós-login). Foco total em utilidade:
 * um cumprimento direto, o Arsenal Essencial à mão e um gatilho elegante de
 * upgrade — o usuário encontra o que precisa em menos de 2 segundos.
 */
export function DashboardHome({ email, plan = 'Gratuito', navigate }: DashboardHomeProps): ReactElement {
	const name = useMemo(() => firstNameFromEmail(email), [email]);
	const today = useMemo(() => capitalize(dateFormatter.format(new Date())), []);

	return (
		<div className="mx-auto max-w-5xl space-y-10">
			{/* Header personalizado */}
			<header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="text-xs font-medium uppercase tracking-wide text-gray-400" data-testid="dashboard-date">{today}</p>
					<h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900" data-testid="dashboard-greeting">
						Olá{name ? `, ${name}` : ''}. Bem-vindo de volta.
					</h1>
					<p className="mt-1.5 text-sm text-gray-500">Suas ferramentas estão prontas — vamos organizar o seu dia.</p>
				</div>
				<span
					data-testid="account-plan"
					className="inline-flex w-fit items-center gap-1.5 rounded-full bg-gray-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm"
				>
					<Sparkles className="h-3.5 w-3.5 text-amber-300" aria-hidden /> Plano: {plan}
				</span>
			</header>

			{/* Arsenal Essencial */}
			<section aria-labelledby="tools-title">
				<div className="mb-4 flex items-center justify-between">
					<h2 id="tools-title" className="text-sm font-semibold uppercase tracking-wide text-gray-500">Ferramentas disponíveis</h2>
				</div>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
					{TOOLS.map((tool, index) => (
						<ToolCard key={tool.id} tool={tool} index={index} navigate={navigate} />
					))}
				</div>
			</section>

			{/* Especialistas Virtuais (gatilho de vendas) */}
			<section aria-labelledby="premium-title">
				<div className="mb-4">
					<h2 id="premium-title" className="text-lg font-semibold tracking-tight text-gray-900">Especialistas Virtuais para o seu Crescimento</h2>
					<p className="mt-1 text-sm text-gray-500">Inteligência de IA que trabalha o seu negócio enquanto você cuida do operacional.</p>
				</div>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					{SPECIALISTS.map((specialist, index) => (
						<PremiumCard key={specialist.id} specialist={specialist} index={index} navigate={navigate} />
					))}
				</div>
			</section>
		</div>
	);
}
