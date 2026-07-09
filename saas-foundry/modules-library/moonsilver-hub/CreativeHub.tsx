import { useCallback, useEffect, useState } from 'react';
import {
	ContractViolationError,
	EmptyState,
	LoadingSkeleton,
	VISUAL_LOCK,
	hasScopes,
	publicationSchema,
	sceneGridModule,
	useCoreService,
	useToast,
	useTrackEvent
} from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { motion } from 'framer-motion';
import {
	Check,
	Clapperboard,
	Inbox,
	Lock,
	Send,
	ShieldAlert,
	Sparkles,
	TriangleAlert,
	Wand2
} from 'lucide-react';

export type PublicationStatus = 'pending' | 'approved' | 'review';

export interface Publication {
	readonly id: string;
	readonly title: string;
	readonly channel: string;
	readonly status: PublicationStatus;
}

/** Must mirror `permissions` in manifest.json. */
const REQUIRED_SCOPES: readonly SecurityScope[] = ['read:production', 'write:production'];

/** A trava agora vem do contrato rígido do Core (fonte única). */
export { VISUAL_LOCK };

/** Pura (exportada para testes): prompt do usuário + trava inegociável. */
export function generateScenePayload(basePrompt: string): string {
	return `${basePrompt.trim()}${VISUAL_LOCK}`;
}

const CHARACTERS = ['Zane', 'Naty', 'Zane & Naty'] as const;

const STATUS_BADGES: Readonly<Record<PublicationStatus, { readonly label: string; readonly classes: string }>> = {
	pending: { label: 'Pendente', classes: 'bg-gray-100 text-gray-600' },
	approved: { label: 'Aprovada', classes: 'bg-emerald-100 text-emerald-700' },
	review: { label: 'Em revisão', classes: 'bg-amber-100 text-amber-700' }
};

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied rounded-2xl bg-white p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-gray-900">Acesso negado</h2>
			<p className="mt-2 text-sm text-gray-500">Você não possui as permissões necessárias para o MoonSilver Hub.</p>
		</div>
	);
}

export default function CreativeHub(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <Hub />;
}

type Tab = 'publications' | 'consistency';

function Hub(): React.JSX.Element {
	const [tab, setTab] = useState<Tab>('publications');
	const tabs: readonly { readonly id: Tab; readonly label: string }[] = [
		{ id: 'publications', label: 'Publicações' },
		{ id: 'consistency', label: 'Trava de Consistência 3D' }
	];

	return (
		<section className="moonsilver-hub rounded-2xl bg-white p-6 shadow-sm">
			<header className="mb-5">
				<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
					<Clapperboard className="h-5 w-5 text-gray-400" aria-hidden />
					MoonSilver Hub
				</h1>
				<p className="mt-1 text-sm text-gray-500">Produção e consistência visual do universo Zane & Naty.</p>
			</header>

			<div role="tablist" aria-label="Áreas do hub" className="mb-6 flex gap-1 border-b border-gray-100">
				{tabs.map(item => (
					<button
						key={item.id}
						type="button"
						role="tab"
						data-tour={item.id === 'consistency' ? 'consistency-tab' : undefined}
						aria-selected={tab === item.id}
						onClick={() => setTab(item.id)}
						className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
							tab === item.id ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
						}`}
					>
						{item.label}
						{tab === item.id && (
							<motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gray-900" />
						)}
					</button>
				))}
			</div>

			{tab === 'publications' ? <PublicationsTab /> : <ConsistencyTab />}
		</section>
	);
}

function PublicationsTab(): React.JSX.Element {
	const { api } = useCoreService();
	const toast = useToast();
	const [publications, setPublications] = useState<readonly Publication[] | null>(null);

	useEffect(() => {
		let cancelled = false;
		api.get<readonly Publication[]>('publications')
			.then(fetched => { if (!cancelled) { setPublications(fetched); } })
			.catch(() => { if (!cancelled) { setPublications([]); } });
		return () => { cancelled = true; };
	}, [api]);

	const setStatus = useCallback(async (publication: Publication, status: PublicationStatus) => {
		const updated: Publication = { ...publication, status };
		// Contrato: nenhuma aprovação processada com metadados incompletos.
		const check = publicationSchema.safeParse(updated);
		if (!check.success) {
			toast.error(check.error.issues[0]?.message ?? 'Publicação fora do contrato.');
			return;
		}
		try {
			await api.put<Publication>(`publications/${publication.id}`, updated);
			setPublications(current => (current ?? []).map(p => (p.id === publication.id ? updated : p)));
			toast.success(status === 'approved' ? `“${publication.title}” aprovada!` : `“${publication.title}” enviada para revisão.`);
		} catch {
			toast.error('Não foi possível atualizar a publicação.');
		}
	}, [api, toast]);

	if (publications === null) {
		return <LoadingSkeleton rows={3} withHeader={false} />;
	}
	if (publications.length === 0) {
		return (
			<EmptyState
				icon={Inbox}
				title="Nenhuma publicação pendente."
				description="Tudo aprovado — o feed MoonSilver está em dia."
				actionLabel="Atualizar"
				onAction={() => window.location.reload()}
			/>
		);
	}

	return (
		<div>
			<h2 className="mb-3 text-sm font-medium text-gray-500">Publicações MoonSilver Pendentes de Aprovação</h2>
			<ul className="space-y-3">
				{publications.map(publication => {
					const badge = STATUS_BADGES[publication.status];
					return (
						<li
							key={publication.id}
							className="flex items-center gap-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-all hover:shadow-md"
						>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium text-gray-900">{publication.title}</p>
								<p className="mt-0.5 text-xs text-gray-500">{publication.channel}</p>
							</div>
							<span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-medium ${badge.classes}`}>{badge.label}</span>
							<div className="flex shrink-0 items-center gap-2">
								<button
									type="button"
									onClick={() => void setStatus(publication, 'approved')}
									disabled={publication.status === 'approved'}
									aria-label={`Aprovar ${publication.title}`}
									className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-all hover:scale-105 hover:bg-emerald-100 disabled:pointer-events-none disabled:opacity-40"
								>
									<Check className="h-3.5 w-3.5" aria-hidden />
									Aprovar
								</button>
								<button
									type="button"
									onClick={() => void setStatus(publication, 'review')}
									disabled={publication.status === 'review'}
									aria-label={`Enviar ${publication.title} para revisão`}
									className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition-all hover:scale-105 hover:bg-amber-100 disabled:pointer-events-none disabled:opacity-40"
								>
									<TriangleAlert className="h-3.5 w-3.5" aria-hidden />
									Revisar
								</button>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function ConsistencyTab(): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [character, setCharacter] = useState<(typeof CHARACTERS)[number]>('Zane & Naty');
	const [basePrompt, setBasePrompt] = useState('');
	const [payload, setPayload] = useState<string | null>(null);

	const generate = async (): Promise<void> => {
		try {
			// Contrato rígido: entrada validada e a saída só passa COM as tags de estilo.
			const scene = await sceneGridModule.run({ character, basePrompt });
			setPayload(scene.payload);
			track('Cálculo Realizado', { moduleId: 'moonsilver-hub-v1', kind: 'scene-grid', character });
			toast.success('Payload do grid gerado com a trava visual aplicada.');
		} catch (err) {
			if (err instanceof ContractViolationError) {
				toast.error(err.issues[0]?.message ?? 'Requisição fora do contrato.');
			} else {
				toast.error('Não foi possível gerar o grid.');
			}
		}
	};

	return (
		<div className="space-y-5">
			{/* A trava é inegociável e o usuário PRECISA saber disso */}
			<div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
				<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm">
					<Lock className="h-4 w-4" aria-hidden />
				</span>
				<div>
					<p className="text-sm font-semibold text-emerald-800">Trava de Cabelo Ondulado: ATIVADA</p>
					<p className="text-xs text-emerald-700">
						Todo payload sai com “estilo animação 3D Pixar, textura do cabelo ondulada (nunca liso)”.
					</p>
				</div>
			</div>

			<div>
				<p className="text-sm font-medium text-gray-900">Personagens do grid</p>
				<div className="mt-2 flex gap-2" role="radiogroup" aria-label="Personagens">
					{CHARACTERS.map(option => (
						<button
							key={option}
							type="button"
							role="radio"
							aria-checked={character === option}
							onClick={() => setCharacter(option)}
							className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-all hover:scale-105 ${
								character === option ? 'bg-gray-900 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
							}`}
						>
							{option}
						</button>
					))}
				</div>
			</div>

			<div>
				<label htmlFor="base-prompt" className="text-sm font-medium text-gray-900">
					Cena base (prompt)
				</label>
				<textarea
					id="base-prompt"
					rows={3}
					value={basePrompt}
					onChange={event => setBasePrompt(event.target.value)}
					placeholder="ex.: dueto no telhado ao pôr do sol, câmera orbitando devagar"
					className="mt-1.5 w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
				/>
			</div>

			<button
				type="button"
				onClick={() => void generate()}
				className="flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:scale-105 hover:shadow-md"
			>
				<Wand2 className="h-4 w-4" aria-hidden />
				Gerar Grid de Animação
			</button>

			{payload !== null && (
				<motion.div
					initial={{ opacity: 0, y: 8 }}
					animate={{ opacity: 1, y: 0 }}
					className="rounded-xl border border-gray-100 bg-gray-50 p-4"
					data-testid="scene-payload"
				>
					<p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-gray-400">
						<Send className="h-3.5 w-3.5" aria-hidden />
						Payload enviado à IA geradora (simulado)
					</p>
					<p className="font-mono text-xs leading-relaxed text-gray-700">{payload}</p>
					<p className="mt-2 flex items-center gap-1 text-[10px] text-emerald-600">
						<Sparkles className="h-3 w-3" aria-hidden />
						Trava visual aplicada automaticamente
					</p>
				</motion.div>
			)}
		</div>
	);
}

/** Registry entry contract. */
export function createPlugin(): typeof CreativeHub {
	return CreativeHub;
}
