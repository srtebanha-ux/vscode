import { z } from 'zod';
import { BaseModule, type ModuleIO } from './ModuleContract.js';

/** Tags de estilo INEGOCIÁVEIS — nenhuma renderização sai sem elas. */
export const VISUAL_LOCK = ', estilo animação 3D Pixar, textura do cabelo ondulada (nunca liso)';
export const REQUIRED_STYLE_TAGS = Object.freeze(['estilo animação 3D Pixar', 'textura do cabelo ondulada (nunca liso)'] as const);

export const characterSchema = z.enum(['Zane', 'Naty', 'Zane & Naty'], { error: 'personagem fora do elenco travado' });

export const sceneRequestSchema = z.strictObject({
	character: characterSchema,
	basePrompt: z
		.string({ error: 'prompt textual obrigatório' })
		.trim()
		.min(5, 'descreva a cena com pelo menos 5 caracteres')
		.max(500, 'prompt acima do limite estrutural de 500 caracteres')
		.refine(prompt => !/cabelo\s+liso/i.test(prompt), 'prompt viola a identidade visual: "cabelo liso" é proibido')
});

export type SceneRequest = z.infer<typeof sceneRequestSchema>;

/** Payload final: só é válido se contiver TODAS as tags obrigatórias de estilo. */
export const scenePayloadSchema = z.strictObject({
	character: characterSchema,
	payload: z
		.string()
		.min(1)
		.refine(
			payload => REQUIRED_STYLE_TAGS.every(tag => payload.includes(tag)),
			'payload sem as tags obrigatórias de estilo (trava visual ausente)'
		),
	lockApplied: z.literal(true, { error: 'renderização sem trava visual é proibida' })
});

export type ScenePayload = z.infer<typeof scenePayloadSchema>;

/** Aprovação de publicação: metadados completos ou nada. */
export const publicationSchema = z.strictObject({
	id: z.string().regex(/^[a-z0-9-]{2,40}$/, 'id de publicação inválido'),
	title: z.string().trim().min(3, 'título muito curto').max(120, 'título acima de 120 caracteres'),
	channel: z.string().trim().min(3, 'canal de publicação obrigatório'),
	status: z.enum(['pending', 'approved', 'review'], { error: 'status de aprovação desconhecido' })
});

export type PublicationRecord = z.infer<typeof publicationSchema>;

/** Ferramenta de geração de grid no contrato rígido: a trava é aplicada E verificada. */
export class SceneGridModule extends BaseModule<SceneRequest, ScenePayload> {
	protected readonly moduleId = 'moonsilver-hub-v1';
	protected readonly schema: ModuleIO<SceneRequest, ScenePayload> = {
		input: sceneRequestSchema,
		output: scenePayloadSchema
	};

	protected execute(input: SceneRequest): ScenePayload {
		return {
			character: input.character,
			payload: `${input.character}: ${input.basePrompt}${VISUAL_LOCK}`,
			lockApplied: true
		};
	}
}

export const sceneGridModule = new SceneGridModule();
