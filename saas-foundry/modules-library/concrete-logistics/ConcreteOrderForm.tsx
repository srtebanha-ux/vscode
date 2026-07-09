import { useCallback, useState } from 'react';
import { hasScopes, useCoreService, useToast, useTrackEvent } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { motion } from 'framer-motion';
import { BadgeCheck, FileText, Gauge, Loader2, ShieldAlert, Truck } from 'lucide-react';

export interface ServiceOrder {
	readonly id: string;
	readonly volumeM3: number;
	readonly spec: '35mpa';
	readonly britaMista: boolean;
	readonly pumpPrice: number;
	readonly total: number;
	readonly createdAt: string;
}

/** Must mirror `permissions` in manifest.json. */
const REQUIRED_SCOPES: readonly SecurityScope[] = ['read:logistics', 'write:logistics'];

const PRICE_PER_M3 = 620; // concreto usinado 35 MPa (BRL/m³)
const BRITA_MISTA_SURCHARGE_PER_M3 = 18;

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Regra de negócio pura (exportada para testes): total da OS em tempo real. */
export function computeOrderTotal(volumeM3: number, britaMista: boolean, pumpPrice: number): number {
	if (volumeM3 <= 0) {
		return Math.max(pumpPrice, 0);
	}
	const surcharge = britaMista ? volumeM3 * BRITA_MISTA_SURCHARGE_PER_M3 : 0;
	return volumeM3 * PRICE_PER_M3 + surcharge + Math.max(pumpPrice, 0);
}

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied rounded-2xl bg-white p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-gray-900">Acesso negado</h2>
			<p className="mt-2 text-sm text-gray-500">Você não possui as permissões necessárias para a Logística de Concreto.</p>
		</div>
	);
}

export default function ConcreteOrderForm(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <OrderForm />;
}

function OrderForm(): React.JSX.Element {
	const { api } = useCoreService();
	const toast = useToast();
	const track = useTrackEvent();
	const [volume, setVolume] = useState('');
	const [britaMista, setBritaMista] = useState(false);
	const [pump, setPump] = useState('');
	const [saving, setSaving] = useState(false);

	const volumeM3 = Number.parseFloat(volume) || 0;
	const pumpPrice = Number.parseFloat(pump) || 0;
	const total = computeOrderTotal(volumeM3, britaMista, pumpPrice);

	const generate = useCallback(async () => {
		if (volumeM3 <= 0) {
			toast.error('Informe o volume de concreto.');
			return;
		}
		setSaving(true);
		const order: ServiceOrder = {
			id: crypto.randomUUID(),
			volumeM3,
			spec: '35mpa',
			britaMista,
			pumpPrice,
			total,
			createdAt: new Date().toISOString()
		};
		try {
			await api.put<ServiceOrder>(`orders/${order.id}`, order);
			track('Cálculo Realizado', { moduleId: 'concrete-logistics-v1', volumeM3, britaMista, total });
			toast.success(`OS gerada: ${volumeM3} m³ · ${brl.format(total)}`);
			setVolume('');
			setBritaMista(false);
			setPump('');
		} catch {
			toast.error('Não foi possível gerar a OS.');
		} finally {
			setSaving(false);
		}
	}, [api, toast, track, volumeM3, britaMista, pumpPrice, total]);

	return (
		<section className="concrete-order mx-auto max-w-xl rounded-2xl bg-white p-6 shadow-sm">
			<header className="mb-6 flex items-start justify-between gap-4">
				<div>
					<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
						<Truck className="h-5 w-5 text-gray-400" aria-hidden />
						Nova Ordem de Serviço
					</h1>
					<p className="mt-1 text-sm text-gray-500">Concreto usinado com preço fechado em tempo real.</p>
				</div>
				<span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm">
					<Gauge className="h-3.5 w-3.5" aria-hidden />
					35 MPa
				</span>
			</header>

			<div className="space-y-5">
				<div>
					<label htmlFor="volume" className="text-sm font-medium text-gray-900">
						Volume de Concreto (m³)
					</label>
					<div className="relative mt-1.5">
						<input
							id="volume"
							type="number"
							min="0"
							step="0.5"
							inputMode="decimal"
							value={volume}
							onChange={event => setVolume(event.target.value)}
							placeholder="0.0"
							className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
						/>
						<span className="pointer-events-none absolute right-3 top-2.5 text-xs text-gray-400">
							{brl.format(PRICE_PER_M3)}/m³ · padrão travado em 35 MPa
						</span>
					</div>
				</div>

				<div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
					<div>
						<p className="text-sm font-medium text-gray-900">Especificação: Adicionar Brita Mista</p>
						<p className="text-xs text-gray-500">+{brl.format(BRITA_MISTA_SURCHARGE_PER_M3)}/m³ no traço</p>
					</div>
					<button
						type="button"
						role="switch"
						aria-checked={britaMista}
						aria-label="Adicionar brita mista"
						onClick={() => setBritaMista(value => !value)}
						className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors ${
							britaMista ? 'justify-end bg-gray-900' : 'justify-start bg-gray-200'
						}`}
					>
						<motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 32 }} className="h-5 w-5 rounded-full bg-white shadow-sm" />
					</button>
				</div>

				<div>
					<label htmlFor="pump" className="text-sm font-medium text-gray-900">
						Preço da Bomba (R$)
					</label>
					<input
						id="pump"
						type="number"
						min="0"
						step="10"
						inputMode="decimal"
						value={pump}
						onChange={event => setPump(event.target.value)}
						placeholder="0,00"
						className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
					/>
				</div>
			</div>

			<footer className="mt-6 border-t border-gray-100 pt-4">
				<div className="flex items-baseline justify-between">
					<span className="text-sm text-gray-500">Total da OS</span>
					<motion.span
						key={total}
						initial={{ scale: 0.92, opacity: 0.6 }}
						animate={{ scale: 1, opacity: 1 }}
						data-testid="os-total"
						className="text-2xl font-semibold tracking-tight text-gray-900"
					>
						{brl.format(total)}
					</motion.span>
				</div>
				<p className="mt-1 text-xs text-gray-400">
					{volumeM3 > 0
						? `${volumeM3} m³ × ${brl.format(PRICE_PER_M3)}${britaMista ? ` + brita mista` : ''}${pumpPrice > 0 ? ' + bomba' : ''}`
						: 'Preencha o volume para fechar o preço.'}
				</p>
				<button
					type="button"
					data-tour="generate-order"
					onClick={() => void generate()}
					disabled={saving}
					className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:scale-105 hover:shadow-md disabled:pointer-events-none disabled:opacity-60"
				>
					{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
					Gerar Pedido
				</button>
				<p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-gray-400">
					<BadgeCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
					OS gravada no silo do seu tenant via Core
				</p>
			</footer>
		</section>
	);
}

/** Registry entry contract. */
export function createPlugin(): typeof ConcreteOrderForm {
	return ConcreteOrderForm;
}
