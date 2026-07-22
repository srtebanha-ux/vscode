import { useState } from 'react';
import { hasScopes, useCoreService, useToast, useTrackEvent } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Loader2, Megaphone, ShieldAlert, Sparkles } from 'lucide-react';
import { MarketingPlanView, type AcaoMarketing, type PlanoCampanha } from './MarketingPlanView.js';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['read:insights', 'write:insights'];
const MODULE_ID = 'virtual-cmo-v1';

/** Objetivo de marketing escolhido no lugar da "tela em branco". */
export interface CmoGoal {
	readonly id: 'atrair' | 'promocao' | 'fidelizar' | 'conteudo';
	readonly emoji: string;
	readonly title: string;
	/** Microcopy: o que acontece se o usuário clicar aqui (zero surpresa). */
	readonly microcopy: string;
	/** Rótulo das peças geradas para este objetivo. */
	readonly pecasTitulo: string;
}

/** Dores reais no lugar de prompts — o usuário só reconhece o problema. */
export const CMO_GOALS: readonly CmoGoal[] = [
	{
		id: 'atrair',
		emoji: '🧲',
		title: 'Quero atrair novos clientes',
		microcopy: 'Vamos montar uma campanha para quem ainda não te conhece: ganchos de anúncio e roteiros de vídeo prontos.',
		pecasTitulo: '3 roteiros de Instagram para alcançar gente nova'
	},
	{
		id: 'promocao',
		emoji: '💸',
		title: 'Preciso de caixa rápido / Promoção',
		microcopy: 'A IA cria uma oferta irresistível com prazo e urgência para gerar vendas ainda nesta semana.',
		pecasTitulo: '3 peças de oferta com gatilho de urgência'
	},
	{
		id: 'fidelizar',
		emoji: '❤️',
		title: 'Quero fidelizar quem já comprou',
		microcopy: 'Mensagens prontas de WhatsApp para reativar clientes antigos — sem parecer spam.',
		pecasTitulo: '3 mensagens de WhatsApp para clientes antigos'
	},
	{
		id: 'conteudo',
		emoji: '📱',
		title: 'Não sei o que postar no Instagram',
		microcopy: 'Receba um cardápio de ideias de posts para a semana, cada uma com gancho e legenda.',
		pecasTitulo: 'Ideias de conteúdo para a sua semana'
	}
];

/** Kit de campanha entregue pelo CMO (formato único para qualquer objetivo). */
export interface CampaignKit {
	readonly diagnostico: string;
	readonly pecasTitulo: string;
	readonly pecas: readonly string[];
	readonly textoPrincipalTitulo: string;
	readonly textoPrincipal: string;
}

/**
 * Fábrica de campanha simulada por objetivo — interpola produto/cliente.
 * Em produção, o trio (objetivo, produto, cliente) vai à LLM via Serverless
 * Function do Core e retorna neste mesmo formato tipado.
 */
export function buildCampaign(goalId: CmoGoal['id'], product: string, customer: string): CampaignKit {
	const goal = CMO_GOALS.find(option => option.id === goalId) ?? CMO_GOALS[0]!;
	if (goalId === 'promocao') {
		return {
			diagnostico: `Promoção sem prazo é desconto perdido. Para gerar caixa com ${product}, a oferta precisa de urgência real e um motivo claro.`,
			pecasTitulo: goal.pecasTitulo,
			pecas: [
				`Story (hoje): “SÓ ATÉ SEXTA: ${product} com condição especial para ${customer}. Responde EU QUERO que eu te mando os detalhes.”`,
				`WhatsApp (lista de contatos): “Oi! Abri 10 vagas com preço de tabela antiga para ${product}. Fecho a lista sexta às 18h — quer a sua?”`,
				`Post no feed: antes/depois de um cliente + “Última chamada da condição especial. Comenta EU que o preço chega no seu direct.”`
			],
			textoPrincipalTitulo: 'O texto da sua oferta',
			textoPrincipal: `Semana de caixa: ${product} com condição que não volta. Só para ${customer}, só até sexta. Sem letra miúda: você garante agora e usa quando quiser.`
		};
	}
	if (goalId === 'fidelizar') {
		return {
			diagnostico: `Vender de novo para quem já confia em você custa 5x menos que conquistar um estranho. Seus clientes antigos de ${product} são a sua mina de ouro.`,
			pecasTitulo: goal.pecasTitulo,
			pecas: [
				`Reativação: “Oi, [nome]! Senti sua falta por aqui 👀 Como está o resultado com ${product}? Tenho uma novidade que é a sua cara.”`,
				`Mimo VIP: “[nome], você é cliente da casa: liberei uma condição exclusiva de ${product} antes de abrir para todo mundo. Quer ver?”`,
				`Indicação: “[nome], conhece alguém como você (${customer}) que precisa de ${product}? Se indicar, os dois ganham um agrado meu 🎁”`
			],
			textoPrincipalTitulo: 'Mensagem VIP para os seus melhores clientes',
			textoPrincipal: `[nome], obrigado por confiar no meu trabalho! Clientes como você têm prioridade: reservei uma condição especial de ${product} este mês. Sem compromisso — responde aqui e eu te conto em 1 minuto.`
		};
	}
	if (goalId === 'conteudo') {
		return {
			diagnostico: `Perfil parado passa sensação de negócio fechado. Com 3 posts por semana sobre ${product}, o algoritmo volta a te mostrar para ${customer}.`,
			pecasTitulo: goal.pecasTitulo,
			pecas: [
				`Segunda (autoridade): grave 30s respondendo a dúvida nº1 de ${customer} sobre ${product}. Legenda: “Salva esse post — você vai precisar.”`,
				`Quarta (bastidor): mostre o processo por trás de ${product} em fotos. Legenda: “O que ninguém vê antes de ficar pronto.”`,
				`Sexta (prova social): print de feedback de cliente + “Mais um(a) ${customer} resolvido(a). Quer ser o próximo? Chama no direct.”`
			],
			textoPrincipalTitulo: 'A bio que transforma visita em cliente',
			textoPrincipal: `${product} para ${customer} | Resultado sem enrolação | 📍 Atendo na sua região | 👇 Fala comigo no WhatsApp`
		};
	}
	return {
		diagnostico: `Quem nunca ouviu falar de você não compra ${product} de primeira. A campanha abaixo apresenta o seu trabalho para ${customer} que ainda não te conhece.`,
		pecasTitulo: goal.pecasTitulo,
		pecas: [
			`Gancho: “${customer}: você ainda perde tempo/dinheiro com isso?” → corte seco → mostre ${product} resolvendo em 15s → CTA: “Chama no direct AGORA”.`,
			`Prova social: cliente real usando ${product} + legenda “o antes e depois que ${customer} precisava ver” → CTA nos comentários fixados.`,
			`Objeção na câmera: “Isso é caro?” → responda com o custo do problema NÃO resolvido → feche com convite para conhecer ${product}.`
		],
		textoPrincipalTitulo: 'O texto da sua página/anúncio',
		textoPrincipal: `Pare de perder clientes por [dor principal]. O ${product} entrega [resultado concreto] para ${customer} em dias, não meses — sem contrato de fidelidade. Comece hoje: o primeiro resultado aparece na primeira semana.`
	};
}

/** Metadados do plano dia a dia por objetivo: quando, formato e direção visual. */
const PLAN_META: Readonly<Record<CmoGoal['id'], {
	readonly titulo: string;
	readonly objetivo: (product: string) => string;
	readonly formatos: readonly [string, string, string, string];
	readonly direcoes: readonly [string, string, string, string];
	readonly formatoPrincipal: string;
}>> = {
	atrair: {
		titulo: 'Campanha: apresente seu trabalho para gente nova',
		objetivo: product => `Fazer quem nunca ouviu falar de ${product} te conhecer e chamar no direct.`,
		formatos: ['Instagram Reels', 'Instagram Story', 'Instagram Reels', 'Texto do anúncio/página'],
		direcoes: [
			'Grave em pé, com o celular na altura do rosto e luz de janela. Fale olhando para a câmera, sem ler.',
			'Filme um cliente real usando o produto (peça autorização) ou mostre um antes/depois com duas fotos.',
			'Grave você respondendo a pergunta de preço com naturalidade, como se fosse um áudio de WhatsApp.',
			'Não precisa de foto: cole este texto na sua página, bio ou anúncio do Instagram.'
		],
		formatoPrincipal: 'Texto do anúncio/página'
	},
	promocao: {
		titulo: 'Semana do Caixa Rápido',
		objetivo: product => `Gerar vendas de ${product} ainda esta semana com uma oferta de verdade, com prazo.`,
		formatos: ['Instagram Story', 'Mensagem de WhatsApp', 'Post no Feed', 'Texto da oferta'],
		direcoes: [
			'Tire uma foto do produto em cima de uma mesa bem iluminada, de dia, perto da janela. Fundo limpo.',
			'Não precisa de foto: envie esta mensagem para a sua lista de clientes no WhatsApp, um a um ou por lista de transmissão.',
			'Use uma foto de antes/depois ou do produto pronto. Se tiver foto com cliente sorrindo, melhor ainda.',
			'Guarde este texto: ele é a sua oferta oficial. Use em qualquer canal onde perguntarem o preço.'
		],
		formatoPrincipal: 'Texto da oferta'
	},
	fidelizar: {
		titulo: 'Semana de Reativação de Clientes',
		objetivo: product => `Trazer de volta quem já comprou ${product} — custa 5x menos que conquistar um estranho.`,
		formatos: ['Mensagem de WhatsApp', 'Mensagem de WhatsApp', 'Mensagem de WhatsApp', 'Mensagem VIP'],
		direcoes: [
			'Não precisa de foto: abra o WhatsApp, escolha 10 clientes antigos e envie trocando [nome] pelo nome de cada um.',
			'Envie para os 5 melhores clientes. Dica: mande de manhã, entre 9h e 11h, quando a resposta é maior.',
			'Envie para clientes satisfeitos. Se tiver um brinde simples (10% off, mimo), já deixe decidido antes.',
			'Reserve esta mensagem para os 3 clientes que mais gastam com você. Personalize a primeira frase.'
		],
		formatoPrincipal: 'Mensagem VIP'
	},
	conteudo: {
		titulo: 'Sua Semana de Conteúdo',
		objetivo: product => `Manter o perfil vivo com 3 posts sobre ${product} — sem precisar inventar nada.`,
		formatos: ['Post no Feed', 'Post no Feed', 'Post no Feed', 'Bio do Instagram'],
		direcoes: [
			'Grave 30 segundos com o celular apoiado (pode ser numa caneca). Luz de janela e fala natural.',
			'Tire 3 fotos do processo: começo, meio e resultado. Poste como carrossel, nessa ordem.',
			'Print de uma conversa com feedback de cliente (apague o nome/foto) ou foto do resultado final.',
			'Não precisa de foto: copie este texto e cole na sua bio do Instagram agora — leva 30 segundos.'
		],
		formatoPrincipal: 'Bio do Instagram'
	}
};

const PLAN_DAYS: readonly [string, string, string, string] = ['Hoje', 'Amanhã', 'Sexta-feira', 'Sábado'];

/**
 * Monta o plano guiado dia a dia a partir do kit do objetivo: cada peça vira
 * uma ação com QUANDO postar, FORMATO, direção visual para leigo e o texto
 * pronto. Em produção, a LLM devolve este PlanoCampanha diretamente.
 */
export function buildPlanoCampanha(goalId: CmoGoal['id'], product: string, customer: string): PlanoCampanha {
	const kit = buildCampaign(goalId, product, customer);
	const meta = PLAN_META[goalId];
	const textos = [...kit.pecas, kit.textoPrincipal];
	const acoes: AcaoMarketing[] = textos.map((texto, index) => ({
		dia_postagem: PLAN_DAYS[index] ?? 'Esta semana',
		formato: meta.formatos[index] ?? meta.formatoPrincipal,
		direcao_visual: meta.direcoes[index] ?? 'Siga a instrução do texto — não precisa de produção.',
		texto_pronto: texto,
		status: 'pendente'
	}));
	return { titulo_campanha: meta.titulo, objetivo: meta.objetivo(product), acoes };
}

/** Passo a passo visual do "Como funciona" (3 ícones, linguagem simples). */
export const HOW_IT_WORKS: readonly { readonly emoji: string; readonly title: string; readonly text: string }[] = [
	{ emoji: '🎯', title: 'Escolha o Objetivo', text: 'Ex.: atrair clientes ou limpar estoque. Só clicar.' },
	{ emoji: '🧠', title: 'A IA Trabalha', text: 'O sistema cria os textos e a estratégia por você.' },
	{ emoji: '🚀', title: 'Você Publica', text: 'Copie, cole no Instagram/WhatsApp e veja o resultado.' }
];

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

type Phase = 'welcome' | 'brief' | 'result';

function CmoAgent(): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [phase, setPhase] = useState<Phase>('welcome');
	const [goal, setGoal] = useState<CmoGoal | null>(null);
	const [product, setProduct] = useState('');
	const [customer, setCustomer] = useState('');
	const [thinking, setThinking] = useState(false);
	const [kit, setKit] = useState<CampaignKit | null>(null);
	const [plano, setPlano] = useState<PlanoCampanha | null>(null);

	const pickGoal = (option: CmoGoal): void => {
		setGoal(option);
		setKit(null);
		setPlano(null);
		setPhase('brief');
		track('CMO Objetivo Escolhido', { moduleId: MODULE_ID, objetivo: option.id });
	};

	const run = async (): Promise<void> => {
		if (!goal) return;
		if (product.trim().length < 3 || customer.trim().length < 3) {
			toast.error('Conta pra gente o que você vende e para quem — são só esses dois campos.');
			return;
		}
		setThinking(true);
		setKit(null);
		setPlano(null);
		await new Promise(resolve => setTimeout(resolve, 1400)); // latência da LLM (simulada)
		setKit(buildCampaign(goal.id, product.trim(), customer.trim()));
		setPlano(buildPlanoCampanha(goal.id, product.trim(), customer.trim()));
		setThinking(false);
		setPhase('result');
		track('Cálculo Realizado', { moduleId: MODULE_ID, kind: 'campaign-plan', objetivo: goal.id });
	};

	const restart = (): void => {
		setPhase('welcome');
		setGoal(null);
		setKit(null);
		setPlano(null);
	};

	const inputClasses =
		'mt-1.5 w-full rounded-xl border border-gray-200 px-3.5 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-fuchsia-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/10';

	return (
		<section className="virtual-cmo mx-auto max-w-3xl">
			<AnimatePresence mode="wait">
				{phase === 'welcome' && (
					<motion.div
						key="welcome"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="overflow-hidden rounded-2xl bg-white shadow-sm"
						data-testid="cmo-welcome"
					>
						{/* 1. Header educativo: o que é e para que serve, sem jargão */}
						<div className="tour-cmo-intro bg-gradient-to-br from-fuchsia-600 to-indigo-600 px-6 py-8 text-white sm:px-8">
							<span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
								<Megaphone className="h-3.5 w-3.5" aria-hidden /> Virtual CMO
							</span>
							<h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">Conheça seu Novo Diretor de Marketing</h1>
							<p className="mt-2 max-w-xl text-sm leading-relaxed text-fuchsia-100">
								O Virtual CMO é a sua agência de bolso. Ele analisa o seu negócio e cria campanhas, textos para redes sociais e
								estratégias de vendas em segundos. Sem termos complicados, focado apenas em trazer resultados.
							</p>
						</div>

						{/* 2. Como funciona: 3 passos visuais */}
						<div className="border-b border-gray-100 px-6 py-6 sm:px-8" data-testid="cmo-how-it-works">
							<h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Como funciona</h2>
							<ol className="mt-4 grid gap-4 sm:grid-cols-3">
								{HOW_IT_WORKS.map((step, index) => (
									<li key={step.title} className="flex items-start gap-3 sm:flex-col sm:gap-2">
										<span className="text-3xl" aria-hidden>{step.emoji}</span>
										<span>
											<span className="block text-sm font-semibold text-gray-900">{index + 1}. {step.title}</span>
											<span className="mt-0.5 block text-sm text-gray-500">{step.text}</span>
										</span>
									</li>
								))}
							</ol>
						</div>

						{/* 3. Ações guiadas: dores reais no lugar da tela em branco */}
						<div className="px-6 py-6 sm:px-8">
							<h2 className="text-lg font-bold tracking-tight text-gray-900">O que vamos resolver hoje?</h2>
							<p className="mt-1 text-sm text-gray-500">Toque no seu problema — o resto é com o seu CMO.</p>
							<div className="tour-cmo-objetivo mt-4 grid gap-3 sm:grid-cols-2">
								{CMO_GOALS.map(option => (
									<button
										key={option.id}
										type="button"
										onClick={() => pickGoal(option)}
										data-testid={`cmo-goal-${option.id}`}
										className="group flex flex-col items-start gap-1.5 rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-fuchsia-300 hover:shadow-md hover:shadow-fuchsia-500/10"
									>
										<span className="text-3xl" aria-hidden>{option.emoji}</span>
										<span className="text-sm font-semibold leading-snug text-gray-900 group-hover:text-fuchsia-600">{option.title}</span>
										{/* 4. Microcopy: o que acontece ao clicar */}
										<span className="text-sm leading-snug text-gray-500">{option.microcopy}</span>
									</button>
								))}
							</div>
						</div>
					</motion.div>
				)}

				{phase === 'brief' && goal && (
					<motion.div
						key="brief"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="overflow-hidden rounded-2xl bg-white p-6 shadow-sm sm:p-8"
						data-testid="cmo-brief"
					>
						<span className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia-50 px-3 py-1 text-xs font-semibold text-fuchsia-600">
							{goal.emoji} {goal.title}
						</span>
						<h2 className="mt-4 text-xl font-bold tracking-tight text-gray-900">Perfeito! Só preciso de 2 respostas rápidas</h2>
						<p className="mt-1 text-sm text-gray-500">{goal.microcopy}</p>

						<label htmlFor="cmo-product" className="mt-6 block text-sm font-medium text-gray-900">O que você vende?</label>
						<input
							id="cmo-product"
							type="text"
							value={product}
							onChange={event => setProduct(event.target.value)}
							placeholder="ex.: marmitas fitness, corte de cabelo, tatuagem…"
							className={`tour-cmo-produto ${inputClasses}`}
						/>
						<p className="mt-1 text-sm text-gray-500">Pode ser simples: o nome do seu produto ou serviço, do seu jeito.</p>

						<label htmlFor="cmo-customer" className="mt-4 block text-sm font-medium text-gray-900">Quem costuma comprar de você?</label>
						<input
							id="cmo-customer"
							type="text"
							value={customer}
							onChange={event => setCustomer(event.target.value)}
							placeholder="ex.: mulheres que treinam, moradores do bairro…"
							className={`tour-cmo-publico ${inputClasses}`}
						/>
						<p className="mt-1 text-sm text-gray-500">Descreva seu cliente típico com as suas palavras — a IA entende.</p>

						<button
							type="button"
							onClick={() => void run()}
							disabled={thinking}
							data-testid="cmo-generate"
							className="tour-cmo-gerar mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/30 transition-all hover:scale-[1.01] disabled:pointer-events-none disabled:opacity-60"
						>
							{thinking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
							{thinking ? 'Seu CMO está montando a campanha…' : 'Criar minha campanha'}
						</button>
						{thinking && <p className="mt-2 text-center text-sm text-gray-500">🧠 Analisando seu negócio e escrevendo os textos…</p>}

						<button type="button" onClick={restart} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600">
							<ArrowLeft className="h-4 w-4" aria-hidden /> Trocar objetivo
						</button>
					</motion.div>
				)}

				{phase === 'result' && kit && plano && goal && (
					<motion.div
						key="result"
						initial={{ opacity: 0, scale: 0.97 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.98 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="overflow-hidden rounded-2xl bg-white shadow-sm"
					>
						<div className="border-b border-gray-100 bg-gradient-to-br from-fuchsia-50 to-white px-6 py-5">
							<span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-fuchsia-600 shadow-sm">
								{goal.emoji} {goal.title}
							</span>
							<h2 className="mt-3 text-lg font-semibold tracking-tight text-gray-900">Seu plano está pronto 🎉</h2>
							<p className="mt-1 text-sm text-gray-500">Siga os passos na ordem: cada card diz o que fazer, quando e com qual texto.</p>
						</div>

						<div className="space-y-4 p-4 sm:p-6">
							{/* Diagnóstico amigável */}
							<article className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
								<h3 className="text-sm font-bold text-amber-700">O olhar do seu CMO</h3>
								<p className="mt-2 text-sm leading-relaxed text-amber-800">{kit.diagnostico}</p>
							</article>

							{/* O plano guiado dia a dia (hoje, amanhã e depois) */}
							<MarketingPlanView plano={plano} />
						</div>

						<div className="flex flex-col gap-3 border-t border-gray-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
							<button type="button" onClick={restart} className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600">
								<ArrowLeft className="h-4 w-4" aria-hidden /> Resolver outro problema
							</button>
							<button
								type="button"
								onClick={() => setPhase('brief')}
								className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md"
							>
								<Sparkles className="h-4 w-4" aria-hidden /> Gerar outra versão
							</button>
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</section>
	);
}

/** Registry entry contract. */
export function createPlugin(): typeof VirtualCMO_Agent {
	return VirtualCMO_Agent;
}
