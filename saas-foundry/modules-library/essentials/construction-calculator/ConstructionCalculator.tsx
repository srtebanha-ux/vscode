import { useMemo, useState } from 'react';
import { hasScopes, useCoreService, useToast, useTrackEvent } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { motion } from 'framer-motion';
import { Boxes, Calculator, Layers, Ruler, Save, ShieldAlert, Wallet } from 'lucide-react';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['ui:render'];
const MODULE_ID = 'construction-calculator-v1';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Converte o texto do input em número não-negativo (campo vazio -> 0). */
function toNumber(value: string): number {
	const parsed = Number(value.replace(',', '.'));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

interface FieldProps {
	readonly icon: typeof Ruler;
	readonly label: string;
	readonly suffix: string;
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly placeholder: string;
}

function Field({ icon: Icon, label, suffix, value, onChange, placeholder }: FieldProps): React.JSX.Element {
	return (
		<label className="block">
			<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
				<Icon className="h-4 w-4 text-gray-400" aria-hidden />
				{label}
			</span>
			<div className="flex items-center rounded-xl border border-gray-200 bg-white shadow-sm transition-all focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
				<input
					type="number"
					inputMode="decimal"
					min={0}
					step="any"
					value={value}
					onChange={event => onChange(event.target.value)}
					placeholder={placeholder}
					className="w-full rounded-xl bg-transparent px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-300"
				/>
				<span className="whitespace-nowrap px-3 text-xs font-medium text-gray-400">{suffix}</span>
			</div>
		</label>
	);
}

function Calculator_(): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [area, setArea] = useState('');
	const [thickness, setThickness] = useState('');
	const [price, setPrice] = useState('');

	const { volume, total } = useMemo(() => {
		const v = toNumber(area) * (toNumber(thickness) / 100); // cm -> m
		return { volume: v, total: v * toNumber(price) };
	}, [area, thickness, price]);

	const saveBudget = (): void => {
		if (volume <= 0 || total <= 0) {
			toast.error('Preencha área, espessura e preço do m³ para salvar o orçamento.');
			return;
		}
		track('Cálculo Realizado', { moduleId: MODULE_ID, volumeM3: Number(volume.toFixed(2)), total: Number(total.toFixed(2)) });
		toast.success(`Orçamento salvo: ${num.format(volume)} m³ · ${brl.format(total)}`);
	};

	return (
		<section className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-white shadow-sm">
			<header className="border-b border-gray-100 px-6 py-4">
				<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
					<Calculator className="h-5 w-5 text-indigo-500" aria-hidden />
					Calculadora de Insumos
					<span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600">Essencial</span>
				</h1>
				<p className="mt-1 text-sm text-gray-500">Volume de concreto e custo da obra em tempo real.</p>
			</header>

			<div className="grid gap-6 p-6 md:grid-cols-2">
				<div className="flex flex-col gap-4">
					<Field icon={Ruler} label="Área" suffix="m²" value={area} onChange={setArea} placeholder="120" />
					<Field icon={Layers} label="Espessura" suffix="cm" value={thickness} onChange={setThickness} placeholder="10" />
					<Field icon={Wallet} label="Preço do m³ do Concreto" suffix="R$/m³" value={price} onChange={setPrice} placeholder="620" />
					<button
						type="button"
						onClick={saveBudget}
						className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md"
					>
						<Save className="h-4 w-4" aria-hidden />
						Salvar Orçamento
					</button>
				</div>

				<div className="flex flex-col gap-4">
					<div className="rounded-2xl bg-gradient-to-br from-indigo-50 to-white p-5 ring-1 ring-inset ring-indigo-100">
						<span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-indigo-500">
							<Boxes className="h-4 w-4" aria-hidden />
							Volume de Concreto
						</span>
						<motion.p key={volume} initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
							{num.format(volume)} <span className="text-lg font-semibold text-gray-400">m³</span>
						</motion.p>
					</div>
					<div className="rounded-2xl bg-gray-900 p-5 text-white">
						<span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-white/60">
							<Wallet className="h-4 w-4" aria-hidden />
							Custo Total Estimado
						</span>
						<motion.p key={total} initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="mt-2 text-4xl font-bold tracking-tight">
							{brl.format(total)}
						</motion.p>
						<p className="mt-1 text-xs text-white/50">Concreto usinado · não inclui bombeamento e perdas</p>
					</div>
				</div>
			</div>
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
			<p className="mt-2 text-sm text-gray-500">Sua conta não possui a Calculadora de Insumos ativa.</p>
		</div>
	);
}

export default function ConstructionCalculator(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <Calculator_ />;
}

/** Registry entry contract. */
export function createPlugin(): typeof ConstructionCalculator {
	return ConstructionCalculator;
}
