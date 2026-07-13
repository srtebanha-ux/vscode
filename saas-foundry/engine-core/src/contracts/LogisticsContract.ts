import { z } from 'zod';
import { BaseModule, type ModuleIO } from './ModuleContract.js';

/** Fonte única de preços — módulos importam daqui; nada de constante paralela. */
export const LOGISTICS_PRICING = Object.freeze({
	PRICE_PER_M3: 620,
	BRITA_MISTA_SURCHARGE_PER_M3: 18,
	MAX_VOLUME_M3: 100,
	MAX_PUMP_PRICE: 10_000
});

/** Número financeiro: finito, não-negativo, 2 casas — nunca NaN/Infinity/negativo/string. */
const money = z
	.number({ error: 'valor numérico obrigatório' })
	.finite('valor deve ser finito')
	.nonnegative('valor não pode ser negativo')
	.multipleOf(0.01, 'máximo de 2 casas decimais');

export const serviceOrderInputSchema = z.strictObject({
	volumeM3: z
		.number({ error: 'volume numérico obrigatório' })
		.finite('volume deve ser finito')
		.positive('volume deve ser maior que zero')
		.multipleOf(0.5, 'volume em incrementos de 0,5 m³')
		.max(LOGISTICS_PRICING.MAX_VOLUME_M3, `volume máximo por OS: ${LOGISTICS_PRICING.MAX_VOLUME_M3} m³`),
	britaMista: z.boolean({ error: 'especificação de brita deve ser booleana' }),
	pumpPrice: money.max(LOGISTICS_PRICING.MAX_PUMP_PRICE, 'preço de bomba acima do teto operacional')
});

export type ServiceOrderInput = z.infer<typeof serviceOrderInputSchema>;

/** Conciliação de custos: o total DECLARADO precisa bater com o recalculado (centavo a centavo). */
export function reconcileTotal(input: ServiceOrderInput): number {
	const surcharge = input.britaMista ? input.volumeM3 * LOGISTICS_PRICING.BRITA_MISTA_SURCHARGE_PER_M3 : 0;
	return Math.round((input.volumeM3 * LOGISTICS_PRICING.PRICE_PER_M3 + surcharge + input.pumpPrice) * 100) / 100;
}

export const serviceOrderSchema = z
	.strictObject({
		id: z.string().regex(/^[0-9a-f-]{36}$/, 'id deve ser um UUID'),
		spec: z.literal('35mpa'),
		volumeM3: serviceOrderInputSchema.shape.volumeM3,
		britaMista: serviceOrderInputSchema.shape.britaMista,
		pumpPrice: serviceOrderInputSchema.shape.pumpPrice,
		total: money,
		createdAt: z.iso.datetime({ message: 'createdAt deve ser ISO-8601' })
	})
	.refine(order => order.total === reconcileTotal(order), {
		path: ['total'],
		message: 'conciliação falhou: total não corresponde a volume × tabela + bomba'
	});

export type ServiceOrder = z.infer<typeof serviceOrderSchema>;

/** Ferramenta de Logística no contrato rígido: entrada e saída blindadas. */
export class ConcreteOrderModule extends BaseModule<ServiceOrderInput, ServiceOrder> {
	protected readonly moduleId = 'concrete-logistics-v1';
	protected readonly schema: ModuleIO<ServiceOrderInput, ServiceOrder> = {
		input: serviceOrderInputSchema,
		output: serviceOrderSchema
	};

	protected execute(input: ServiceOrderInput): ServiceOrder {
		return {
			id: crypto.randomUUID(),
			spec: '35mpa',
			...input,
			total: reconcileTotal(input),
			createdAt: new Date().toISOString()
		};
	}
}

export const concreteOrderModule = new ConcreteOrderModule();
