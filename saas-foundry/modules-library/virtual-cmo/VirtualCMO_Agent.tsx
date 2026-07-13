import { useState } from 'react';
import { hasScopes, useCoreService, useToast, useTrackEvent } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { AnimatePresence, motion } from 'framer-motion';
import {
	ClipboardCopy,
	Factory,
	Gauge,
	Loader2,
	Megaphone,
	SearchCheck,
	ShieldAlert,
	Sparkles
} from 'lucide-react';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['read:insights', 'write:insights'];

interface CampaignKit {
	readonly auditVerdict: string;
	readonly estimatedConversion: string;
	readonly reelScripts: readonly string[];
	readonly landingCopy: string;
}

/**
 * Fábrica de conversão simulada — interpola produto/cliente do usuário.
 * Em produção, o trio de inputs vai à LLM via Serverless Function do
 * Core e retorna neste mesmo formato tipado.
 */
function buildCampaign(product: string, customer: string): CampaignKit {
	return {
		auditVerdict: 'Seu texto atual tem foco nas características, não nos benefícios. A taxa de conversão estimada é baixa.',
		estimatedConversion: '≈ 0,8%',
		reelScripts: [
			`Gancho: “${customer}: você ainda perde horas com isso?” → corte seco → mostre ${product} resolvendo em 15s → CTA: “Chama no direct AGORA”.`,
			`Prova social: cliente real usando ${product} + legenda “o antes e depois que ${customer} precisava ver” → CTA nos comentários fixados.`,
			`Objeção na câmera: “Isso é caro?” → responda com o custo do problema NÃO resolvido → feche com oferta de teste de ${product}.`
		],
		landingCopy: `Pare de perder clientes por [dor principal]. O ${product} entrega [resultado concreto] para ${customer} em dias, não meses — sem contrato de fidelidade. Comece hoje: o setup leva 10 minutos e o primeiro resultado aparece na primeira semana.`
	};
}

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied rounded-2xl bg-white p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-gray-900">Acesso negado</h2>
			<p className="mt-2 text-sm text-gray-500">Sua conta não possui o especialista Virtual CMO ativo.</p>
		</div>
	);
}

export default function VirtualCMO_Agent(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <CmoAgent />;
}

function CmoAgent(): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [product, setProduct] = useState('');
	const [customer, setCustomer] = useState('');
	const [siteCopy, setSiteCopy] = useState('');
	const [thinking, setThinking] = useState(false);
	const [kit, setKit] = useState<CampaignKit | null>(null);

	const run = async (): Promise<void> => {
		if (product.trim().length < 3 || customer.trim().length < 3) {
			toast.error('Diga o produto e o cliente — o CMO precisa dos dois para mirar a campanha.');
			return;
		}
		setThinking(true);
		setKit(null);
		await new Promise(resolve => setTimeout(resolve, 1400)); // latência da LLM (simulada)
		setKit(buildCampaign(product.trim(), customer.trim()));
		setThinking(false);
		track('Cálculo Realizado', { moduleId: 'virtual-cmo-v1', kind: 'campaign-kit' });
	};

	const copyStrategy = async (): Promise<void> => {
		if (!kit) {
			return;
		}
		const strategy = [
			'== ROTEIROS INSTAGRAM ==',
			...kit.reelScripts.map((script, index) => `${index + 1}. ${script}`),
			'',
			'== LANDING PAGE ==',
			kit.landingCopy
		].join('\n');
		try {
			await navigator.clipboard.writeText(strategy);
			toast.success('Estratégia completa copiada — cole no seu gerenciador de anúncios.');
		} catch {
			toast.error('Não foi possível copiar a estratégia.');
		}
	};

	const inputClasses =
		'mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-fuchsia-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/10';

	return (
		<section className="virtual-cmo overflow-hidden rounded-2xl bg-white shadow-sm">
			<header className="border-b border-gray-100 px-6 py-4">
				<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
					<Megaphone className="h-5 w-5 text-fuchsia-500" aria-hidden />
					Virtual CMO
					<span className="rounded-full bg-fuchsia-50 px-2.5 py-0.5 text-[11px] font-semibold text-fuchsia-600">Growth & Vendas</span>
				</h1>
				<p className="mt-1 text-sm text-gray-500">Campanhas que convertem, sem o retainer de uma agência.</p>
			</header>

			<div className="grid grid-cols-1 lg:grid-cols-2">
				{/* Lado Esquerdo — Inputs rápidos */}
				<div className="border-b border-gray-100 p-6 lg:border-b-0 lg:border-r">
					<label htmlFor="cmo-product" className="text-sm font-medium text-gray-900">Qual é o seu produto?</label>
					<input
						id="cmo-product"
						type="text"
						value={product}
						onChange={event => setProduct(event.target.value)}
						placeholder="ex.: sistema de agendamento para barbearias"
						className={inputClasses}
					/>

					<label htmlFor="cmo-customer" className="mt-4 block text-sm font-medium text-gray-900">Quem é o seu cliente?</label>
					<input
						id="cmo-customer"
						type="text"
						value={customer}
						onChange={event => setCustomer(event.target.value)}
						placeholder="ex.: dono de barbearia com 2+ cadeiras"
						className={inputClasses}
					/>

					<label htmlFor="cmo-copy" className="mt-4 block text-sm font-medium text-gray-900">Cole o texto atual do seu site</label>
					<textarea
						id="cmo-copy"
						rows={6}
						value={siteCopy}
						onChange={event => setSiteCopy(event.target.value)}
						placeholder="Opcional — o CMO audita e reescreve."
						className={`${inputClasses} resize-none font-mono text-xs leading-relaxed`}
					/>

					<button
						type="button"
						onClick={() => void run()}
						disabled={thinking}
						className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md disabled:pointer-events-none disabled:opacity-60"
					>
						{thinking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
						{thinking ? 'CMO montando a campanha…' : 'Auditar e Gerar Campanha'}
					</button>
				</div>

				{/* Lado Direito — A Fábrica de Conversão */}
				<div className="bg-gray-50/60 p-6">
					<h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-400">
						<Factory className="h-4 w-4" aria-hidden />
						A Fábrica de Conversão
					</h2>

					<AnimatePresence mode="wait">
						{kit === null && !thinking && (
							<motion.p key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-10 text-center text-sm text-gray-400">
								Preencha o alvo à esquerda e a fábrica entrega a campanha pronta.
							</motion.p>
						)}
						{thinking && (
							<motion.div key="thinking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-6 space-y-3">
								{[0, 1, 2].map(row => (
									<div key={row} className="h-16 animate-pulse rounded-xl bg-gray-200/70" />
								))}
							</motion.div>
						)}
						{kit && (
							<motion.div key="result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 space-y-4">
								{/* Auditoria */}
								<article className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
									<h3 className="flex items-center gap-2 text-sm font-bold text-amber-700">
										<SearchCheck className="h-4 w-4" aria-hidden />
										Auditoria do texto atual
									</h3>
									<p className="mt-2 text-sm leading-relaxed text-amber-800">{kit.auditVerdict}</p>
									<p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
										<Gauge className="h-3.5 w-3.5" aria-hidden />
										Conversão estimada: {kit.estimatedConversion}
									</p>
								</article>

								{/* Geração */}
								<article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" data-testid="campaign-kit">
									<h3 className="text-sm font-bold text-gray-900">Campanha pronta para usar hoje</h3>
									<p className="mt-1 text-xs text-gray-500">3 roteiros validados para Instagram + o texto exato da sua Landing Page.</p>
									<ol className="mt-3 space-y-2">
										{kit.reelScripts.map((script, index) => (
											<li key={script} className="flex gap-2 rounded-xl bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-700">
												<span className="font-bold text-fuchsia-600">{index + 1}.</span>
												{script}
											</li>
										))}
									</ol>
									<blockquote className="mt-3 rounded-xl border-l-4 border-fuchsia-400 bg-fuchsia-50/60 px-3 py-2.5 text-xs italic leading-relaxed text-gray-700">
										{kit.landingCopy}
									</blockquote>
									<button
										type="button"
										onClick={() => void copyStrategy()}
										className="mt-4 flex items-center gap-2 rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-105 hover:bg-fuchsia-500 hover:shadow-md"
									>
										<ClipboardCopy className="h-4 w-4" aria-hidden />
										Copiar Estratégia
									</button>
								</article>
							</motion.div>
						)}
					</AnimatePresence>
				</div>
			</div>
		</section>
	);
}

/** Registry entry contract. */
export function createPlugin(): typeof VirtualCMO_Agent {
	return VirtualCMO_Agent;
}
