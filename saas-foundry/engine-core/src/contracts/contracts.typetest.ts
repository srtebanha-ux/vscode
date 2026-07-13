/**
 * TESTES DE TIPAGEM DE COMPILAÇÃO — sem runtime, executados pelo `tsc -b`
 * que roda ANTES do `vite build` (npm run build:prod, o buildCommand da
 * Vercel). Se um módulo violar o contrato de dados, o deploy falha aqui,
 * antes de ir ao ar. Cada `@ts-expect-error` é uma violação que DEVE ser
 * erro de compilação: se um dia compilar, o próprio teste quebra o build.
 */
import type { z } from 'zod';
import { BaseModule, type ModuleIO } from './ModuleContract.js';
import {
	serviceOrderInputSchema,
	serviceOrderSchema,
	type ServiceOrder,
	type ServiceOrderInput
} from './LogisticsContract.js';
import { sceneRequestSchema, scenePayloadSchema, type SceneRequest, type ScenePayload } from './CreativeContract.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// Os tipos exportados são EXATAMENTE os inferidos dos schemas (zero drift).
type _logisticsInputAligned = Expect<Equal<ServiceOrderInput, z.infer<typeof serviceOrderInputSchema>>>;
type _logisticsOutputAligned = Expect<Equal<ServiceOrder, z.infer<typeof serviceOrderSchema>>>;
type _creativeInputAligned = Expect<Equal<SceneRequest, z.infer<typeof sceneRequestSchema>>>;
type _creativeOutputAligned = Expect<Equal<ScenePayload, z.infer<typeof scenePayloadSchema>>>;

// Violação 1: módulo sem execute() não compila.
// @ts-expect-error — BaseModule exige a implementação de execute()
class MissingExecute extends BaseModule<ServiceOrderInput, ServiceOrder> {
	protected readonly moduleId = 'broken-no-execute';
	protected readonly schema: ModuleIO<ServiceOrderInput, ServiceOrder> = {
		input: serviceOrderInputSchema,
		output: serviceOrderSchema
	};
}

// Violação 2: execute() com saída fora do contrato não compila.
class WrongOutput extends BaseModule<SceneRequest, ScenePayload> {
	protected readonly moduleId = 'broken-wrong-output';
	protected readonly schema: ModuleIO<SceneRequest, ScenePayload> = {
		input: sceneRequestSchema,
		output: scenePayloadSchema
	};
	// @ts-expect-error — retornar string viola o generic TOutput
	protected execute(): string {
		return 'nope';
	}
}

// Violação 3: schema de outro domínio no lugar errado não compila.
class WrongSchema extends BaseModule<SceneRequest, ScenePayload> {
	protected readonly moduleId = 'broken-wrong-schema';
	// @ts-expect-error — schema de Logística não satisfaz ModuleIO<SceneRequest, ScenePayload>
	protected readonly schema: ModuleIO<SceneRequest, ScenePayload> = { input: serviceOrderInputSchema, output: serviceOrderSchema };
	protected execute(input: SceneRequest): ScenePayload {
		return { character: input.character, payload: input.basePrompt, lockApplied: true };
	}
}

// Violação 4: run() não aceita saída sem passar pelo contrato (tipo do retorno é fixo).
type _runReturnsContractOutput = Expect<Equal<Awaited<ReturnType<WrongSchema['run']>>, ScenePayload>>;

// Mantém as classes "usadas" sem executá-las.
export type _typetests = [
	_logisticsInputAligned,
	_logisticsOutputAligned,
	_creativeInputAligned,
	_creativeOutputAligned,
	_runReturnsContractOutput,
	typeof MissingExecute,
	typeof WrongOutput
];
