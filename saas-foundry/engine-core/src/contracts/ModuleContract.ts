import { z } from 'zod';

/**
 * Camada de Contratos Rígidos. Nenhum dado ENTRA ou SAI de um módulo sem
 * passar pelo esquema Zod do contrato — parâmetro fora do padrão aborta a
 * operação imediatamente com feedback estruturado.
 */

export interface ModuleIO<TInput, TOutput> {
	readonly input: z.ZodType<TInput>;
	readonly output: z.ZodType<TOutput>;
}

export interface ContractIssue {
	readonly path: string;
	readonly message: string;
}

export class ContractViolationError extends Error {
	constructor(
		readonly moduleId: string,
		readonly stage: 'input' | 'output',
		readonly issues: readonly ContractIssue[]
	) {
		super(`[${moduleId}] contrato violado (${stage}): ${issues.map(issue => `${issue.path || 'raiz'} — ${issue.message}`).join('; ')}`);
		this.name = 'ContractViolationError';
	}
}

function toIssues(error: z.ZodError): readonly ContractIssue[] {
	return error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }));
}

/**
 * Assinatura EXATA de qualquer ferramenta válida do sistema. Generics fixam
 * os tipos de entrada/saída; os três membros abstratos são obrigatórios —
 * um módulo que não os implemente (ou os implemente com o tipo errado)
 * quebra o build (ver contracts.typetest.ts). `run()` é o ÚNICO caminho de
 * execução: valida entrada, executa e valida a própria saída (um módulo
 * bugado que produza dado corrompido também é abortado).
 */
export abstract class BaseModule<TInput, TOutput> {
	protected abstract readonly moduleId: string;
	protected abstract readonly schema: ModuleIO<TInput, TOutput>;
	protected abstract execute(input: TInput): Promise<TOutput> | TOutput;

	async run(rawInput: unknown): Promise<TOutput> {
		const parsedInput = this.schema.input.safeParse(rawInput);
		if (!parsedInput.success) {
			throw new ContractViolationError(this.moduleId, 'input', toIssues(parsedInput.error));
		}
		const result = await this.execute(parsedInput.data);
		const parsedOutput = this.schema.output.safeParse(result);
		if (!parsedOutput.success) {
			throw new ContractViolationError(this.moduleId, 'output', toIssues(parsedOutput.error));
		}
		return parsedOutput.data;
	}
}
