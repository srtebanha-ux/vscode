import { z } from 'zod';
import { LlmError, structured } from '../lib/llm.js';
import { errMeta, logger } from '../lib/log.js';
import type { ProductRecord, Snippet, UseCase } from '../types.js';
import { groundingFacts } from './snippet.js';

const log = logger('usecases');
const REQUIRED_GROUNDED = 2;

const UseCaseSchema = z.object({
  cases: z
    .array(
      z.object({
        title: z.string().min(12).max(110),
        scenario: z.string().min(120).max(600),
        anchor: z.string().min(2).max(90),
      }),
    )
    .length(3),
});

const SYSTEM = `Você escreve casos de uso corporativos para páginas de produto digital.
Cada caso descreve UMA situação operacional concreta em uma empresa real: quem executa, com que frequência, e o que quebra hoje.
O campo "anchor" deve citar LITERALMENTE um dos artefatos listados como disponíveis (nome de coluna, assinatura de função, caminho de campo ou seção) — nunca invente um que não esteja na lista.
Proibido: linguagem de marketing, superlativo, promessa de resultado, texto genérico que serviria para qualquer produto.
Português do Brasil.`;

function factsBlock(facts: string[], snippet: Snippet): string {
  const label =
    snippet.kind === 'table' ? 'Colunas reais da planilha'
    : snippet.kind === 'code' ? 'Funções reais do script'
    : snippet.kind === 'tree' ? 'Campos reais do dataset'
    : 'Seções reais do documento';
  return `${label} (use apenas estes em "anchor"):\n${facts.map((fact) => `- ${fact}`).join('\n')}`;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchFact(anchor: string, facts: string[]): string | null {
  const target = normalize(anchor);
  if (!target) return null;
  return (
    facts.find((fact) => normalize(fact) === target) ??
    facts.find((fact) => normalize(fact).includes(target) || target.includes(normalize(fact))) ??
    null
  );
}

/**
 * Casos de uso aterrados no conteúdo real do artefato. O prompt recebe as colunas/funções
 * extraídas pelo snippet, e a resposta é rejeitada se as âncoras não existirem de fato —
 * é isso que impede o padrão "Mad Libs" de keyword x nicho.
 */
export async function generateUseCases(product: ProductRecord, snippet: Snippet): Promise<UseCase[]> {
  const facts = groundingFacts(snippet);
  if (facts.length === 0) {
    log.warn('no grounding facts, skipping use cases', { slug: product.slug, snippet: snippet.kind });
    return [];
  }

  const prompt = `Produto: ${product.title}
Formato: ${product.kind} (${product.asset.mime})
Dor de origem: ${product.tagline}
Termo de busca principal: ${product.keywords[0] ?? product.title}

${factsBlock(facts, snippet)}

Escreva 3 casos de uso em empresas de portes ou segmentos diferentes entre si. Cada cenário deve explicar qual decisão operacional o artefato resolve e amarrar explicitamente ao item citado em "anchor".`;

  const result = await structured(UseCaseSchema, { system: SYSTEM, prompt, maxTokens: 6_000, effort: 'medium' });

  const cases: UseCase[] = result.cases.map((entry) => {
    const matched = matchFact(entry.anchor, facts);
    return {
      title: entry.title.trim(),
      scenario: entry.scenario.trim(),
      anchor: matched ?? entry.anchor.trim(),
      grounded: matched !== null,
    };
  });

  const grounded = cases.filter((entry) => entry.grounded).length;
  if (grounded < REQUIRED_GROUNDED) {
    throw new LlmError(`only ${grounded}/3 use cases anchored to real artifact facts`, true);
  }
  return cases;
}

export async function safeUseCases(product: ProductRecord, snippet: Snippet): Promise<UseCase[]> {
  try {
    return await generateUseCases(product, snippet);
  } catch (error) {
    log.warn('use case generation failed, publishing without them', { slug: product.slug, ...errMeta(error) });
    return [];
  }
}
