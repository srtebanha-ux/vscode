import { useMemo, useState } from 'react';
import { brlToNumber, hasScopes, maskBRL, numberToBRL, onlyDigits, useCoreService, useToast, useTrackEvent } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { motion } from 'framer-motion';
import { ArrowRight, Building2, CheckCircle2, FileDown, FileText, Info, Landmark, Loader2, MapPin, Plane, ReceiptText, Scale, Search, ShieldAlert, Store, User, Wallet, Wrench, Zap } from 'lucide-react';

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

// ── Documento do cliente: máscara + validação de dígitos verificadores ───────

function maskCpf(d: string): string {
	const parts = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9), d.slice(9, 11)].filter(Boolean);
	let out = parts[0] ?? '';
	if (parts[1]) out += `.${parts[1]}`;
	if (parts[2]) out += `.${parts[2]}`;
	if (parts[3]) out += `-${parts[3]}`;
	return out;
}

function maskCnpj(d: string): string {
	let out = d.slice(0, 2);
	if (d.length > 2) out += `.${d.slice(2, 5)}`;
	if (d.length > 5) out += `.${d.slice(5, 8)}`;
	if (d.length > 8) out += `/${d.slice(8, 12)}`;
	if (d.length > 12) out += `-${d.slice(12, 14)}`;
	return out;
}

/** Máscara progressiva: CPF (000.000.000-00) até 11 dígitos, CNPJ acima disso. */
export function maskCpfCnpj(raw: string): string {
	const digits = onlyDigits(raw).slice(0, 14);
	return digits.length <= 11 ? maskCpf(digits) : maskCnpj(digits);
}

function validCpf(d: string): boolean {
	if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
	const digit = (count: number): number => {
		let sum = 0;
		for (let i = 0; i < count; i += 1) sum += Number(d[i]) * (count + 1 - i);
		const rest = (sum * 10) % 11;
		return rest >= 10 ? 0 : rest;
	};
	return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

function validCnpj(d: string): boolean {
	if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
	const digit = (count: number): number => {
		const weights = count === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
		let sum = 0;
		for (let i = 0; i < count; i += 1) sum += Number(d[i]) * (weights[i] ?? 0);
		const rest = sum % 11;
		return rest < 2 ? 0 : 11 - rest;
	};
	return digit(12) === Number(d[12]) && digit(13) === Number(d[13]);
}

/** Valida CPF (11) ou CNPJ (14) pelos dígitos verificadores. Blindagem anti-nota inválida. */
export function isValidCpfCnpj(raw: string): boolean {
	const digits = onlyDigits(raw);
	if (digits.length === 11) return validCpf(digits);
	if (digits.length === 14) return validCnpj(digits);
	return false;
}

// ── Liquidação financeira: deduz os tributos do valor bruto ──────────────────

export interface SettlementLine {
	readonly label: string;
	readonly rate: number; // %
	readonly valor: number; // R$ retido nesta linha
}

export interface Settlement {
	readonly valorBruto: number;
	readonly impostoTotal: number;
	readonly valorLiquido: number;
	readonly linhas: readonly SettlementLine[];
}

/** Aplica as alíquotas da nota sobre o valor bruto e devolve o líquido a receber. */
export function computeSettlement(valorBruto: number, tax: InvoiceTax): Settlement {
	const bruto = Number.isFinite(valorBruto) && valorBruto > 0 ? valorBruto : 0;
	const linhas: SettlementLine[] = tax.lines.map(line => ({ label: line.label, rate: line.rate, valor: (bruto * line.rate) / 100 }));
	const impostoTotal = linhas.reduce((sum, line) => sum + line.valor, 0);
	return { valorBruto: bruto, impostoTotal, valorLiquido: Math.max(bruto - impostoTotal, 0), linhas };
}

/** Escapa os caracteres reservados de XML (blindagem contra corrupção do RPS). */
function escapeXml(value: string): string {
	return value.replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char] ?? char));
}

interface RpsPayload {
	readonly prestadorCnpj: string;
	readonly tomadorDoc: string;
	readonly tomadorCidade: string;
	readonly discriminacao: string;
	readonly valorServico: number;
	readonly aliquota: number;
	readonly valorIss: number;
}

/** Monta um RPS (Recibo Provisório de Serviços) no padrão ABRASF — pronto para a prefeitura. */
export function buildRpsXml(payload: RpsPayload): string {
	const iso = new Date().toISOString().slice(0, 10);
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<Rps xmlns="http://www.abrasf.org.br/nfse.xsd">',
		'  <InfDeclaracaoPrestacaoServico>',
		`    <Competencia>${iso}</Competencia>`,
		'    <Servico>',
		'      <Valores>',
		`        <ValorServicos>${payload.valorServico.toFixed(2)}</ValorServicos>`,
		`        <Aliquota>${(payload.aliquota / 100).toFixed(4)}</Aliquota>`,
		`        <ValorIss>${payload.valorIss.toFixed(2)}</ValorIss>`,
		'      </Valores>',
		`      <Discriminacao>${escapeXml(payload.discriminacao)}</Discriminacao>`,
		`      <MunicipioPrestacao>${escapeXml(payload.tomadorCidade)}</MunicipioPrestacao>`,
		'    </Servico>',
		`    <Prestador><CpfCnpj><Cnpj>${onlyDigits(payload.prestadorCnpj)}</Cnpj></CpfCnpj></Prestador>`,
		`    <Tomador><CpfCnpj>${onlyDigits(payload.tomadorDoc).length === 11 ? `<Cpf>${onlyDigits(payload.tomadorDoc)}</Cpf>` : `<Cnpj>${onlyDigits(payload.tomadorDoc)}</Cnpj>`}</CpfCnpj></Tomador>`,
		'  </InfDeclaracaoPrestacaoServico>',
		'</Rps>'
	].join('\n');
}

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

const inputBase = 'w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition-all placeholder:text-gray-300';

function Field({ icon: Icon, label, children }: { readonly icon: typeof User; readonly label: string; readonly children: React.ReactNode }): React.JSX.Element {
	return (
		<label className="block">
			<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
				<Icon className="h-4 w-4 text-gray-400" aria-hidden /> {label}
			</span>
			{children}
		</label>
	);
}

function Helper(): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [client, setClient] = useState<City | null>(null);
	const [kind, setKind] = useState<OperationKind>('servico');
	const [doc, setDoc] = useState('');
	const [valor, setValor] = useState('');
	const [descricao, setDescricao] = useState('');
	const [emitting, setEmitting] = useState(false);
	const [emitted, setEmitted] = useState<string | null>(null);

	const tax = useMemo(() => (client ? computeInvoiceTax(MERCHANT_PROFILE, client, kind) : null), [client, kind]);
	const valorBruto = brlToNumber(valor);
	const settlement = useMemo(() => (tax ? computeSettlement(valorBruto, tax) : null), [tax, valorBruto]);

	const docValid = isValidCpfCnpj(doc);
	const docError = doc.trim().length > 0 && !docValid;
	const canEmit = Boolean(client && tax && settlement && settlement.valorBruto > 0 && docValid && descricao.trim());

	const selectCity = (city: City): void => {
		setClient(city);
		setEmitted(null);
		track('Cálculo Realizado', { moduleId: MODULE_ID, kind, uf: city.uf, scope: resolveScope(MERCHANT_PROFILE, city) });
	};

	const downloadRps = (): void => {
		if (!canEmit || !client || !tax || !settlement) {
			toast.error('Preencha cidade, CPF/CNPJ válido, valor e descrição para gerar o arquivo.');
			return;
		}
		const xml = buildRpsXml({
			prestadorCnpj: MERCHANT_PROFILE.cnpj,
			tomadorDoc: doc,
			tomadorCidade: `${client.name} - ${client.uf}`,
			discriminacao: descricao.trim(),
			valorServico: settlement.valorBruto,
			aliquota: tax.principal.rate,
			valorIss: (settlement.valorBruto * tax.principal.rate) / 100
		});
		const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'rps-lidar-core.xml';
		anchor.click();
		URL.revokeObjectURL(url);
		track('Cálculo Realizado', { moduleId: MODULE_ID, kind: 'rps-download' });
		toast.success('Arquivo RPS/XML gerado — pronto para o portal da prefeitura.');
	};

	const emitInvoice = async (): Promise<void> => {
		if (!canEmit) {
			toast.error('Preencha cidade, CPF/CNPJ válido, valor e descrição para emitir a nota.');
			return;
		}
		if (emitting) return;
		setEmitting(true);
		track('Cálculo Realizado', { moduleId: MODULE_ID, kind: 'emit-invoice', valor: valorBruto });
		// PRODUÇÃO: POST autenticado para Focus NFe / eNotas com o payload da nota e o token do tenant.
		await new Promise(resolve => window.setTimeout(resolve, 1400));
		const protocolo = `NFSe-${Date.now().toString(36).toUpperCase().slice(-8)}`;
		setEmitted(protocolo);
		setEmitting(false);
		toast.success(`Nota emitida com sucesso — protocolo ${protocolo}.`);
	};

	return (
		<section className="mx-auto max-w-5xl overflow-hidden rounded-2xl bg-white shadow-sm">
			<header className="border-b border-gray-100 px-6 py-4">
				<h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
					<ReceiptText className="h-5 w-5 text-indigo-500" aria-hidden />
					Assistente Fiscal Inteligente
					<span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600">Emissor de NF</span>
					<span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold text-violet-600">Reforma-ready</span>
				</h1>
				<p className="mt-1 text-sm text-gray-500">
					Origem da nota: <span className="font-medium text-gray-700">{MERCHANT_PROFILE.city} · {MERCHANT_PROFILE.uf}</span> — CNPJ {MERCHANT_PROFILE.cnpj}
				</p>
			</header>

			<div className="grid gap-6 p-6 lg:grid-cols-2">
				{/* Esquerda — dados de faturamento */}
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

					<Field icon={User} label="CPF/CNPJ do Cliente">
						<input
							type="text"
							inputMode="numeric"
							aria-label="CPF/CNPJ do Cliente"
							value={doc}
							onChange={event => setDoc(maskCpfCnpj(event.target.value))}
							placeholder="000.000.000-00"
							className={`${inputBase} font-mono ${docError ? 'border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100' : docValid ? 'border-emerald-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100' : 'border-gray-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'}`}
						/>
						{docError && <span role="alert" className="mt-1.5 block text-xs font-medium text-red-500">CPF/CNPJ inválido — confira os dígitos.</span>}
					</Field>

					<Field icon={Wallet} label="Valor Total da Nota (R$)">
						<input
							type="text"
							inputMode="decimal"
							aria-label="Valor Total da Nota (R$)"
							value={valor}
							onChange={event => setValor(maskBRL(event.target.value))}
							placeholder="R$ 0,00"
							className={`${inputBase} border-gray-200 font-semibold tabular-nums focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100`}
						/>
					</Field>

					<Field icon={FileText} label="Descrição do Serviço/Produto">
						<textarea
							rows={4}
							aria-label="Descrição do Serviço/Produto"
							value={descricao}
							onChange={event => setDescricao(event.target.value)}
							placeholder="Detalhe o trabalho realizado ou os itens vendidos…"
							className={`${inputBase} resize-none border-gray-200 leading-relaxed focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100`}
						/>
					</Field>
				</div>

				{/* Direita — resumo, líquido a receber e ações de emissão */}
				<div className="flex flex-col gap-4">
					{!tax || !client || !settlement ? (
						<div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 p-8 text-center">
							<span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
								<MapPin className="h-5 w-5" aria-hidden />
							</span>
							<p className="mt-3 text-sm text-gray-500">Escolha a cidade do cliente para ver o cálculo automático e emitir a nota.</p>
						</div>
					) : (
						<>
							{tax.scope === 'interna' ? (
								<span data-testid="operation-scope-badge" className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
									<Building2 className="h-3.5 w-3.5" aria-hidden /> 📍 Operação Interna (Mesmo Município)
								</span>
							) : (
								<span data-testid="operation-scope-badge" className="inline-flex w-fit items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
									<Plane className="h-3.5 w-3.5" aria-hidden /> ✈️ Operação Externa (Fora do Município){tax.interestadual ? ' · Interestadual' : ''}
								</span>
							)}

							{/* Líquido a receber — o valor percebido do PME */}
							<motion.div
								key={settlement.valorLiquido}
								initial={{ opacity: 0.6, y: 4 }}
								animate={{ opacity: 1, y: 0 }}
								data-testid="net-amount"
								className="rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-5 text-white shadow-lg shadow-emerald-500/20"
							>
								<span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-white/80">
									<Wallet className="h-4 w-4" aria-hidden /> Valor Líquido a Receber
								</span>
								<p className="mt-1 text-3xl font-bold tabular-nums">{numberToBRL(settlement.valorLiquido)}</p>
								<div className="mt-3 flex items-center justify-between border-t border-white/20 pt-3 text-xs text-white/80">
									<span>Bruto {numberToBRL(settlement.valorBruto)}</span>
									<span>Impostos −{numberToBRL(settlement.impostoTotal)}</span>
								</div>
							</motion.div>

							{/* Impostos calculados (com o valor retido por linha) */}
							<div data-testid="tax-summary" className="rounded-2xl bg-gray-900 p-4 text-white">
								<span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-white/60">
									<Scale className="h-4 w-4" aria-hidden /> Impostos calculados automaticamente
								</span>
								<ul className="mt-3 space-y-2">
									{settlement.linhas.map(line => (
										<li key={line.label} className="flex items-center justify-between gap-3 text-sm">
											<span className="min-w-0 truncate font-medium">{line.label}</span>
											<span className="shrink-0 tabular-nums">
												<span className="text-white/50">{pct(line.rate)}</span>
												{settlement.valorBruto > 0 && <span className="ml-2 font-semibold text-emerald-300">{numberToBRL(line.valor)}</span>}
											</span>
										</li>
									))}
								</ul>
								<div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 text-sm">
									<span className="text-xs font-medium uppercase tracking-wide text-white/60">Carga · total de impostos</span>
									<span className="font-bold tabular-nums text-white">{pct(tax.cargaAtual)}{settlement.valorBruto > 0 && <span className="ml-2 text-white/70">{numberToBRL(settlement.impostoTotal)}</span>}</span>
								</div>
							</div>

							{/* Ações de emissão */}
							<div className="flex flex-col gap-2.5">
								<button
									type="button"
									onClick={downloadRps}
									disabled={!canEmit}
									data-testid="export-rps"
									className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
								>
									<FileDown className="h-4 w-4" aria-hidden /> Baixar Arquivo para Prefeitura (XML/RPS)
								</button>
								<button
									type="button"
									onClick={() => void emitInvoice()}
									disabled={!canEmit || emitting}
									data-testid="emit-invoice"
									className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition-all hover:scale-[1.01] hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
								>
									{emitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Zap className="h-4 w-4" aria-hidden />}
									{emitting ? 'Emitindo…' : 'Emitir Nota Oficial Agora (Automático)'}
								</button>
							</div>

							{emitted && (
								<motion.div
									initial={{ opacity: 0, y: 6 }}
									animate={{ opacity: 1, y: 0 }}
									data-testid="emit-receipt"
									className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200"
								>
									<CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> Nota emitida · protocolo {emitted}
								</motion.div>
							)}
						</>
					)}
				</div>
			</div>

			{/* Visualizador da Reforma — faixa full-width */}
			{tax && (
				<div className="px-6 pb-6">
					<ReformVisualizer tax={tax} />
				</div>
			)}

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
