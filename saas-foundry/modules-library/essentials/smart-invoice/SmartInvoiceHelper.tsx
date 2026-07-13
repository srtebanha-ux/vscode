import { useMemo, useState } from 'react';
import { hasScopes, useCoreService, useToast, useTrackEvent } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { motion } from 'framer-motion';
import { ArrowRight, Building2, Info, Landmark, MapPin, Plane, ReceiptText, Scale, Search, ShieldAlert, Store, Wrench } from 'lucide-react';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['ui:render'];
const MODULE_ID = 'smart-invoice-helper-v1';

// ── Modelo de dados fiscal (mockado — em produção vem do cadastro + tabelas oficiais) ──

export type OperationKind = 'servico' | 'produto';
export type OperationScope = 'interna' | 'externa';

export interface City {
	readonly name: string;
	readonly uf: string;
	readonly iss: number; // alíquota de ISS do município (%)
}

export interface MerchantProfile {
	readonly razaoSocial: string;
	readonly cnpj: string;
	readonly city: string;
	readonly uf: string;
	readonly issProprio: number; // ISS do município de registro (%)
	readonly icmsInterno: number; // ICMS interno do estado de origem (%)
}

/** Perfil do CNPJ do usuário (mock do cadastro). Origem das operações. */
export const MERCHANT_PROFILE: MerchantProfile = {
	razaoSocial: 'Sua Empresa ME',
	cnpj: '12.345.678/0001-90',
	city: 'São Paulo',
	uf: 'SP',
	issProprio: 5,
	icmsInterno: 18
};

/** Diretório de municípios para a busca rápida (auto-complete). */
export const CITY_DIRECTORY: readonly City[] = [
	{ name: 'São Paulo', uf: 'SP', iss: 5 },
	{ name: 'Guarulhos', uf: 'SP', iss: 5 },
	{ name: 'Campinas', uf: 'SP', iss: 3 },
	{ name: 'Rio de Janeiro', uf: 'RJ', iss: 5 },
	{ name: 'Belo Horizonte', uf: 'MG', iss: 5 },
	{ name: 'Curitiba', uf: 'PR', iss: 4 },
	{ name: 'Porto Alegre', uf: 'RS', iss: 5 },
	{ name: 'Florianópolis', uf: 'SC', iss: 4 },
	{ name: 'Salvador', uf: 'BA', iss: 5 },
	{ name: 'Recife', uf: 'PE', iss: 5 },
	{ name: 'Fortaleza', uf: 'CE', iss: 5 },
	{ name: 'Goiânia', uf: 'GO', iss: 5 },
	{ name: 'Brasília', uf: 'DF', iss: 5 },
	{ name: 'Manaus', uf: 'AM', iss: 5 }
];

const PIS_COFINS = 3.65; // regime cumulativo simplificado (%) — vira CBS na Reforma

/**
 * Referência da Reforma Tributária (guia): o IVA dual unifica os tributos
 * atuais. IBS absorve ICMS (estadual) + ISS (municipal); CBS absorve
 * PIS + COFINS (federal). Alíquotas de referência do modelo pleno.
 */
export const REFORM_REFERENCE = {
	ibs: 17.7, // unifica ICMS + ISS
	cbs: 8.8 // unifica PIS + COFINS
} as const;

const SUL_SUDESTE_EXCETO_ES = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS']);

/** Alíquota interestadual de ICMS (guia): 7% do Sul/Sudeste p/ demais regiões, senão 12%. */
export function interstateIcms(originUf: string, destUf: string): number {
	const destinoDemais = !SUL_SUDESTE_EXCETO_ES.has(destUf);
	if (SUL_SUDESTE_EXCETO_ES.has(originUf) && destinoDemais) return 7;
	return 12;
}

/** Interna quando o cliente está no mesmo município da origem; externa caso contrário. */
export function resolveScope(origin: MerchantProfile, client: City): OperationScope {
	return origin.city === client.name && origin.uf === client.uf ? 'interna' : 'externa';
}

export interface TaxLine {
	readonly label: string;
	readonly rate: number; // %
	readonly note: string;
}

export interface InvoiceTax {
	readonly scope: OperationScope;
	readonly interestadual: boolean;
	readonly principal: TaxLine; // tributo principal da operação (ISS ou ICMS)
	readonly lines: readonly TaxLine[];
	readonly cargaAtual: number; // soma das alíquotas do modelo atual (%)
}

/**
 * Motor fiscal (puro): resolve o tributo principal (ISS ou ICMS) pela
 * localização e tipo de operação e devolve o resumo de alíquotas do modelo
 * vigente. Valores de referência — não substituem o fechamento contábil.
 */
export function computeInvoiceTax(origin: MerchantProfile, client: City, kind: OperationKind): InvoiceTax {
	const scope = resolveScope(origin, client);
	const interestadual = origin.uf !== client.uf;

	let principal: TaxLine;
	if (kind === 'servico') {
		// ISS é municipal. Como guia: interna recolhe no seu município; externa, no do cliente.
		const municipio = scope === 'interna' ? origin.city : client.name;
		principal = {
			label: `ISS · ${municipio}`,
			rate: scope === 'interna' ? origin.issProprio : client.iss,
			note: scope === 'interna' ? 'Serviço prestado no seu município.' : `Fora do município — alíquota de ${client.name}.`
		};
	} else {
		// ICMS é estadual/interestadual.
		principal = {
			label: interestadual ? `ICMS interestadual · ${origin.uf}→${client.uf}` : `ICMS interno · ${origin.uf}`,
			rate: interestadual ? interstateIcms(origin.uf, client.uf) : origin.icmsInterno,
			note: interestadual ? 'Venda para outro estado — tabela interestadual.' : 'Venda dentro do seu estado.'
		};
	}

	const federal: TaxLine = { label: 'PIS + COFINS', rate: PIS_COFINS, note: 'Tributos federais sobre o faturamento.' };
	const lines: readonly TaxLine[] = [principal, federal];
	const cargaAtual = lines.reduce((sum, line) => sum + line.rate, 0);
	return { scope, interestadual, principal, lines, cargaAtual };
}

const pct = (value: number): string => `${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;

// ── Busca rápida de município (auto-complete) ────────────────────────────────

interface CityComboboxProps {
	readonly selected: City | null;
	readonly onSelect: (city: City) => void;
}

function CityCombobox({ selected, onSelect }: CityComboboxProps): React.JSX.Element {
	const [query, setQuery] = useState('');
	const [open, setOpen] = useState(false);

	const matches = useMemo(() => {
		const term = query.trim().toLowerCase();
		if (!term) return CITY_DIRECTORY.slice(0, 6);
		return CITY_DIRECTORY.filter(c => `${c.name} ${c.uf}`.toLowerCase().includes(term)).slice(0, 6);
	}, [query]);

	const pick = (city: City): void => {
		onSelect(city);
		setQuery(`${city.name} · ${city.uf}`);
		setOpen(false);
	};

	return (
		<label className="relative block">
			<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
				<MapPin className="h-4 w-4 text-gray-400" aria-hidden /> Cidade do seu Cliente
			</span>
			<div className="flex items-center rounded-xl border border-gray-200 bg-white shadow-sm transition-all focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
				<Search className="ml-3.5 h-4 w-4 text-gray-400" aria-hidden />
				<input
					type="text"
					role="combobox"
					aria-expanded={open}
					aria-label="Cidade do seu Cliente"
					value={query}
					placeholder="Digite a cidade (ex: Rio de Janeiro)"
					onChange={event => { setQuery(event.target.value); setOpen(true); }}
					onFocus={() => setOpen(true)}
					onBlur={() => window.setTimeout(() => setOpen(false), 120)}
					className="w-full rounded-xl bg-transparent px-2.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-300"
				/>
			</div>
			{open && matches.length > 0 && (
				<ul role="listbox" className="absolute z-10 mt-1.5 max-h-60 w-full overflow-auto rounded-xl border border-gray-100 bg-white p-1 shadow-lg">
					{matches.map(city => (
						<li key={`${city.name}-${city.uf}`}>
							<button
								type="button"
								role="option"
								aria-selected={selected?.name === city.name && selected?.uf === city.uf}
								onMouseDown={event => { event.preventDefault(); pick(city); }}
								className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-indigo-50"
							>
								<span className="font-medium text-gray-800">{city.name}</span>
								<span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500">{city.uf}</span>
							</button>
						</li>
					))}
				</ul>
			)}
			{open && query.trim() && matches.length === 0 && (
				<p className="absolute z-10 mt-1.5 w-full rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-sm text-gray-400 shadow-lg">Município não encontrado na base de referência.</p>
			)}
		</label>
	);
}

// ── Visualizador da Reforma Tributária (barras simples) ──────────────────────

function ReformVisualizer({ tax }: { readonly tax: InvoiceTax }): React.JSX.Element {
	const legacyTotal = tax.cargaAtual;
	const unifiedTotal = REFORM_REFERENCE.ibs + REFORM_REFERENCE.cbs;
	const scale = Math.max(legacyTotal, unifiedTotal) || 1;
	const w = (value: number): string => `${Math.max((value / scale) * 100, 2)}%`;
	const mainLegacy = tax.principal;

	return (
		<div data-testid="reform-visualizer" className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-5">
			<span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-600">
				<Landmark className="h-4 w-4" aria-hidden /> Visualizador da Reforma Tributária
			</span>

			<div className="mt-4 space-y-4">
				{/* Modelo atual */}
				<div>
					<div className="mb-1 flex items-center justify-between text-[11px] font-medium text-gray-500">
						<span>Modelo atual ({mainLegacy.label.split(' · ')[0]} + PIS/COFINS)</span>
						<span className="tabular-nums text-gray-700">{pct(legacyTotal)}</span>
					</div>
					<div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
						<motion.div initial={{ width: 0 }} animate={{ width: w(mainLegacy.rate) }} transition={{ duration: 0.4 }} className="h-full bg-sky-400" title={mainLegacy.label} />
						<motion.div initial={{ width: 0 }} animate={{ width: w(PIS_COFINS) }} transition={{ duration: 0.4, delay: 0.05 }} className="h-full bg-sky-200" title="PIS + COFINS" />
					</div>
				</div>

				{/* Seta de transição */}
				<div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-violet-500">
					<ArrowRight className="h-3.5 w-3.5" aria-hidden /> transição para o modelo unificado
				</div>

				{/* Modelo novo (IBS + CBS) */}
				<div>
					<div className="mb-1 flex items-center justify-between text-[11px] font-medium text-gray-500">
						<span>IBS + CBS (modelo unificado)</span>
						<span className="tabular-nums text-gray-700">{pct(unifiedTotal)}</span>
					</div>
					<div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
						<motion.div initial={{ width: 0 }} animate={{ width: w(REFORM_REFERENCE.ibs) }} transition={{ duration: 0.4, delay: 0.1 }} className="h-full bg-violet-500" title="IBS — unifica ICMS + ISS" />
						<motion.div initial={{ width: 0 }} animate={{ width: w(REFORM_REFERENCE.cbs) }} transition={{ duration: 0.4, delay: 0.15 }} className="h-full bg-violet-300" title="CBS — unifica PIS + COFINS" />
					</div>
					<div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-500">
						<span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet-500" aria-hidden /> IBS ({pct(REFORM_REFERENCE.ibs)}) · substitui ICMS + ISS</span>
						<span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet-300" aria-hidden /> CBS ({pct(REFORM_REFERENCE.cbs)}) · substitui PIS + COFINS</span>
					</div>
				</div>
			</div>

			<p className="mt-4 flex items-start gap-1.5 rounded-xl bg-white/70 p-3 text-xs leading-relaxed text-gray-600 ring-1 ring-inset ring-violet-100">
				<Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />
				Sua nota já está calculada dentro das regras de transição vigentes para evitar problemas fiscais.
			</p>
		</div>
	);
}

// ── Componente principal ─────────────────────────────────────────────────────

function Helper(): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [client, setClient] = useState<City | null>(null);
	const [kind, setKind] = useState<OperationKind>('servico');

	const tax = useMemo(() => (client ? computeInvoiceTax(MERCHANT_PROFILE, client, kind) : null), [client, kind]);

	const selectCity = (city: City): void => {
		setClient(city);
		track('Cálculo Realizado', { moduleId: MODULE_ID, kind, uf: city.uf, scope: resolveScope(MERCHANT_PROFILE, city) });
	};

	const apply = (): void => {
		if (!tax || !client) {
			toast.error('Escolha a cidade do cliente para gerar o resumo fiscal da nota.');
			return;
		}
		toast.success(`Resumo fiscal pronto — ${tax.scope === 'interna' ? 'operação interna' : 'operação externa'} · carga de referência ${pct(tax.cargaAtual)}.`);
	};

	return (
		<section className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-white shadow-sm">
			<header className="border-b border-gray-100 px-6 py-4">
				<h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
					<ReceiptText className="h-5 w-5 text-indigo-500" aria-hidden />
					Assistente Fiscal Inteligente
					<span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600">Essencial</span>
					<span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold text-violet-600">Reforma-ready</span>
				</h1>
				<p className="mt-1 text-sm text-gray-500">
					Origem da nota: <span className="font-medium text-gray-700">{MERCHANT_PROFILE.city} · {MERCHANT_PROFILE.uf}</span> — CNPJ {MERCHANT_PROFILE.cnpj}
				</p>
			</header>

			<div className="grid gap-6 p-6 md:grid-cols-2">
				{/* Coluna de contexto rápido */}
				<div className="flex flex-col gap-4">
					<CityCombobox selected={client} onSelect={selectCity} />

					<div>
						<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
							<ReceiptText className="h-4 w-4 text-gray-400" aria-hidden /> O que você está faturando?
						</span>
						<div className="flex gap-1 rounded-xl bg-gray-100 p-1">
							{([['servico', 'Prestação de Serviço', Wrench], ['produto', 'Venda de Produto', Store]] as const).map(([id, label, Icon]) => (
								<button
									key={id}
									type="button"
									aria-pressed={kind === id}
									onClick={() => setKind(id)}
									className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-all ${kind === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
								>
									<Icon className="h-3.5 w-3.5" aria-hidden /> {label}
								</button>
							))}
						</div>
					</div>

					<button
						type="button"
						onClick={apply}
						className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md"
					>
						<ReceiptText className="h-4 w-4" aria-hidden /> Gerar Resumo da Nota
					</button>
				</div>

				{/* Coluna de resultado fiscal */}
				<div className="flex flex-col gap-4">
					{!tax || !client ? (
						<div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 p-8 text-center">
							<span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
								<MapPin className="h-5 w-5" aria-hidden />
							</span>
							<p className="mt-3 text-sm text-gray-500">Escolha a cidade do cliente para ver o cálculo automático dos impostos.</p>
						</div>
					) : (
						<>
							{/* Badge de operação interna/externa */}
							{tax.scope === 'interna' ? (
								<motion.span
									key="interna"
									initial={{ opacity: 0, y: 4 }}
									animate={{ opacity: 1, y: 0 }}
									data-testid="operation-scope-badge"
									className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200"
								>
									<Building2 className="h-3.5 w-3.5" aria-hidden /> 📍 Operação Interna (Mesmo Município)
								</motion.span>
							) : (
								<motion.span
									key="externa"
									initial={{ opacity: 0, y: 4 }}
									animate={{ opacity: 1, y: 0 }}
									data-testid="operation-scope-badge"
									className="inline-flex w-fit items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200"
								>
									<Plane className="h-3.5 w-3.5" aria-hidden /> ✈️ Operação Externa (Fora do Município){tax.interestadual ? ' · Interestadual' : ''}
								</motion.span>
							)}

							{/* Resumo de impostos calculados */}
							<div data-testid="tax-summary" className="rounded-2xl bg-gray-900 p-5 text-white">
								<span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-white/60">
									<Scale className="h-4 w-4" aria-hidden /> Impostos calculados automaticamente
								</span>
								<ul className="mt-3 space-y-2.5">
									{tax.lines.map(line => (
										<li key={line.label} className="flex items-start justify-between gap-3">
											<span className="min-w-0">
												<span className="block text-sm font-semibold">{line.label}</span>
												<span className="block text-[11px] text-white/50">{line.note}</span>
											</span>
											<span className="shrink-0 text-lg font-bold tabular-nums text-emerald-300">{pct(line.rate)}</span>
										</li>
									))}
								</ul>
								<div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
									<span className="text-xs font-medium uppercase tracking-wide text-white/60">Carga de referência</span>
									<span className="text-xl font-bold tabular-nums text-white">{pct(tax.cargaAtual)}</span>
								</div>
							</div>

							<ReformVisualizer tax={tax} />
						</>
					)}
				</div>
			</div>

			{/* Micro-copy de segurança jurídica obrigatório */}
			<footer data-testid="invoice-disclaimer" className="flex items-start gap-2 border-t border-gray-100 bg-gray-50 px-6 py-4 text-xs leading-relaxed text-gray-500">
				<ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
				<span>Os valores e alíquotas exibidos são guias de referência automatizados com base na localização informada. Valide o fechamento fiscal com sua contabilidade.</span>
			</footer>
		</section>
	);
}

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied mx-auto max-w-md rounded-2xl bg-white p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-gray-900">Acesso negado</h2>
			<p className="mt-2 text-sm text-gray-500">Sua conta não possui o Assistente Fiscal Inteligente ativo.</p>
		</div>
	);
}

export default function SmartInvoiceHelper(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <Helper />;
}

/** Registry entry contract. */
export function createPlugin(): typeof SmartInvoiceHelper {
	return SmartInvoiceHelper;
}
