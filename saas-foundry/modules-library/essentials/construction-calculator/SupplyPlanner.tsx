import { useEffect, useRef, useState } from 'react';
import { hasScopes, useCoreService, useTrackEvent } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Boxes, Check, ClipboardList, Info, Package, Search, ShieldAlert, Sparkles, Wand2 } from 'lucide-react';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['ui:render'];
const MODULE_ID = 'construction-calculator-v1';

/** Um item da lista de compras preditiva. */
export interface SupplyItem {
	readonly name: string;
	readonly quantity: string;
	readonly note: string;
}

/** Plano completo devolvido pelo motor (hoje simulado; amanhã, a API real). */
export interface SupplyPlan {
	readonly niche: string;
	readonly template: string;
	readonly items: readonly SupplyItem[];
	/** 'simulated' deixa EXPLÍCITO na UI que é prévia de design, não dado real. */
	readonly engine: 'simulated';
}

/** Campo numérico cirúrgico exibido no Passo 3 — texto claro e empático. */
export interface TemplateField {
	readonly id: string;
	readonly label: string;
	readonly suffix: string;
	readonly placeholder: string;
}

/**
 * Entrada do catálogo de materiais: quantidade = número digitado * factor
 * (nunca abaixo de min). Dado declarativo — expandir o produto é adicionar
 * linhas aqui, sem tocar no motor nem na UI.
 */
export interface CatalogEntry {
	readonly name: string;
	readonly factor: number;
	readonly min?: number;
	readonly unit: string;
	readonly note: string;
}

export interface PlannerTemplate {
	readonly id: string;
	readonly label: string;
	readonly hint: string;
	readonly fields: readonly TemplateField[];
	readonly catalog: readonly CatalogEntry[];
}

export interface PlannerNiche {
	readonly id: string;
	readonly emoji: string;
	readonly label: string;
	readonly description: string;
	readonly templates: readonly PlannerTemplate[];
}

const field = (id: string, label: string, suffix: string, placeholder: string): TemplateField => ({ id, label, suffix, placeholder });

/** Catálogo guiado completo: nicho -> templates -> campos + materiais. */
export const NICHES: readonly PlannerNiche[] = [
	{
		id: 'obras',
		emoji: '🏗️',
		label: 'Construção & Reformas',
		description: 'Pedreiros, pintores, empreiteiros',
		templates: [
			{
				id: 'alvenaria',
				label: 'Paredes/Alvenaria',
				hint: 'Tijolos, cimento e areia para levantar paredes',
				fields: [field('areaParede', 'Qual a metragem de parede? (m²)', 'm²', 'Ex.: 60')],
				catalog: [
					{ name: 'Tijolo baiano (9x19x19)', factor: 42, unit: 'unidades', note: 'Considerando 10% de margem de perda por quebra' },
					{ name: 'Cimento CP-II 50kg', factor: 0.7, min: 2, unit: 'sacos', note: 'Argamassa de assentamento, traço 1:6' },
					{ name: 'Areia média lavada', factor: 0.08, min: 1, unit: 'm³', note: 'Inclui folga para o reboco inicial' }
				]
			},
			{
				id: 'pintura',
				label: 'Pintura',
				hint: 'Tinta, massa e proteção para pintar',
				fields: [field('areaPintura', 'Qual a metragem da área? (m²)', 'm²', 'Ex.: 50')],
				catalog: [
					{ name: 'Tinta acrílica 18L', factor: 0.02, min: 1, unit: 'latas', note: 'Rendimento de ~250m² por lata em 2 demãos' },
					{ name: 'Massa corrida 25kg', factor: 0.04, min: 1, unit: 'sacos', note: 'Correção de imperfeições antes da pintura' },
					{ name: 'Kit rolo + fita + lona', factor: 0.02, min: 1, unit: 'kits', note: 'Proteção de piso e acabamento limpo' }
				]
			},
			{
				id: 'contrapiso',
				label: 'Contrapiso',
				hint: 'Cimento, areia e brita para o piso',
				fields: [field('areaPiso', 'Qual a área do piso? (m²)', 'm²', 'Ex.: 40')],
				catalog: [
					{ name: 'Cimento CP-II 50kg', factor: 0.9, min: 3, unit: 'sacos', note: 'Contrapiso de 4cm, traço 1:4' },
					{ name: 'Areia média', factor: 0.05, min: 1, unit: 'm³', note: 'Considerando 10% de margem de perda' },
					{ name: 'Brita 0', factor: 0.03, min: 1, unit: 'm³', note: 'Para regularização da base' }
				]
			},
			{
				id: 'telhado',
				label: 'Telhado/Cobertura',
				hint: 'Telhas, madeiramento e fixação',
				fields: [field('areaTelhado', 'Qual a área do telhado? (m²)', 'm²', 'Ex.: 90')],
				catalog: [
					{ name: 'Telha cerâmica', factor: 16, unit: 'unidades', note: '~16 telhas/m² com 5% de reserva para quebra' },
					{ name: 'Ripa 5x2cm 3m', factor: 1.2, min: 6, unit: 'peças', note: 'Madeiramento de apoio das telhas' },
					{ name: 'Prego telheiro 18x30', factor: 0.06, min: 1, unit: 'kg', note: 'Fixação com folga de obra' }
				]
			},
			{
				id: 'eletrica',
				label: 'Elétrica Básica',
				hint: 'Fios, tomadas e disjuntores por ponto',
				fields: [field('pontos', 'Quantos pontos elétricos? (tomadas/luz)', 'pontos', 'Ex.: 20')],
				catalog: [
					{ name: 'Cabo flexível 2,5mm 100m', factor: 0.08, min: 1, unit: 'rolos', note: '~8m por ponto, com folga de passagem' },
					{ name: 'Tomada/interruptor completo', factor: 1, unit: 'unidades', note: '1 conjunto por ponto planejado' },
					{ name: 'Caixinha 4x2 + conduíte 3m', factor: 1, unit: 'kits', note: 'Infraestrutura de cada ponto' }
				]
			}
		]
	},
	{
		id: 'beleza',
		emoji: '💇‍♀️',
		label: 'Estética & Beleza',
		description: 'Salões, barbearias, clínicas',
		templates: [
			{
				id: 'mechas',
				label: 'Mechas/Coloração',
				hint: 'Tinta, descolorante e ox por cliente',
				fields: [field('clientes', 'Quantas clientes estimadas para este serviço?', 'clientes', 'Ex.: 50')],
				catalog: [
					{ name: 'Tinta de coloração 60g', factor: 1, unit: 'tubos', note: '1 tubo por cliente, sem reaproveitamento' },
					{ name: 'Pó descolorante 500g', factor: 0.1, min: 1, unit: 'potes', note: 'Rateio de ~10 aplicações por pote' },
					{ name: 'Ox 30 volumes 900ml', factor: 0.16, min: 1, unit: 'frascos', note: 'Considerando 10% de margem de desperdício' }
				]
			},
			{
				id: 'manicure',
				label: 'Manicure/Unhas',
				hint: 'Esmaltes e descartáveis por atendimento',
				fields: [field('atendimentos', 'Quantos atendimentos no mês?', 'atendimentos', 'Ex.: 80')],
				catalog: [
					{ name: 'Esmalte (cores variadas)', factor: 0.12, min: 3, unit: 'frascos', note: '~8 atendimentos por frasco' },
					{ name: 'Kit descartável (lixa + palito)', factor: 1, unit: 'kits', note: '1 kit novo por cliente, por biossegurança' },
					{ name: 'Algodão 500g', factor: 0.02, min: 1, unit: 'pacotes', note: 'Remoção e acabamento' }
				]
			},
			{
				id: 'barbearia',
				label: 'Barbearia/Cortes',
				hint: 'Lâminas, toalhas e finalização',
				fields: [field('cortes', 'Quantos cortes estimados no mês?', 'cortes', 'Ex.: 120')],
				catalog: [
					{ name: 'Lâmina de barbear descartável', factor: 1, unit: 'unidades', note: '1 lâmina nova por cliente' },
					{ name: 'Pomada/finalizador 120g', factor: 0.05, min: 1, unit: 'potes', note: '~20 aplicações por pote' },
					{ name: 'Toalha descartável', factor: 1.1, unit: 'unidades', note: 'Considerando 10% de reposição' }
				]
			},
			{
				id: 'limpezaPele',
				label: 'Limpeza de Pele/Estética',
				hint: 'Máscaras, luvas e descartáveis por sessão',
				fields: [field('sessoes', 'Quantas sessões agendadas?', 'sessões', 'Ex.: 30')],
				catalog: [
					{ name: 'Máscara/argila 250g', factor: 0.1, min: 1, unit: 'potes', note: '~10 sessões por pote' },
					{ name: 'Par de luvas nitrílicas', factor: 2, unit: 'pares', note: '2 trocas por procedimento' },
					{ name: 'Gaze e algodão (kit)', factor: 1, unit: 'kits', note: '1 kit estéril por sessão' }
				]
			},
			{
				id: 'estoqueBaseBeleza',
				label: 'Estoque Mensal Base',
				hint: 'Reposição geral do salão para o mês',
				fields: [field('clientesMes', 'Quantas clientes você atende por mês?', 'clientes', 'Ex.: 120')],
				catalog: [
					{ name: 'Shampoo profissional 5L', factor: 0.03, min: 1, unit: 'galões', note: '~35 lavagens por galão' },
					{ name: 'Condicionador profissional 5L', factor: 0.025, min: 1, unit: 'galões', note: 'Acompanha o ritmo do shampoo' },
					{ name: 'Toalhas descartáveis', factor: 1.1, unit: 'unidades', note: 'Considerando 10% de margem de reposição' }
				]
			}
		]
	},
	{
		id: 'alimentacao',
		emoji: '🎂',
		label: 'Alimentação & Gastronomia',
		description: 'Confeitarias, marmitarias, lanchonetes',
		templates: [
			{
				id: 'bolos',
				label: 'Produção de Bolos',
				hint: 'Farinha, ovos e açúcar por unidade',
				fields: [field('bolos', 'Quantos bolos você vai produzir?', 'bolos', 'Ex.: 10')],
				catalog: [
					{ name: 'Farinha de trigo 5kg', factor: 0.5, min: 1, unit: 'pacotes', note: '~500g por bolo + margem de erro' },
					{ name: 'Ovos', factor: 6, unit: 'unidades', note: '6 ovos por receita de massa' },
					{ name: 'Açúcar refinado 5kg', factor: 0.4, min: 1, unit: 'pacotes', note: 'Massa + calda + cobertura' }
				]
			},
			{
				id: 'salgados',
				label: 'Salgados para Festa',
				hint: 'Cálculo por número de convidados',
				fields: [field('convidados', 'Quantos convidados terá a festa?', 'convidados', 'Ex.: 100')],
				catalog: [
					{ name: 'Salgados variados', factor: 10, unit: 'unidades', note: 'Média de 10 salgados por convidado' },
					{ name: 'Farinha de trigo 5kg', factor: 0.08, min: 1, unit: 'pacotes', note: 'Massa de coxinha e risole' },
					{ name: 'Óleo para fritura 900ml', factor: 0.06, min: 1, unit: 'frascos', note: 'Troca a cada ~150 unidades fritas' }
				]
			},
			{
				id: 'marmitas',
				label: 'Marmitas da Semana',
				hint: 'Proteína, arroz e embalagens',
				fields: [field('marmitas', 'Quantas marmitas por semana?', 'marmitas', 'Ex.: 60')],
				catalog: [
					{ name: 'Frango/carne (kg)', factor: 0.18, min: 1, unit: 'kg', note: '~180g de proteína por marmita' },
					{ name: 'Arroz 5kg', factor: 0.03, min: 1, unit: 'pacotes', note: '~150g de arroz pronto por unidade' },
					{ name: 'Embalagem térmica com tampa', factor: 1.05, unit: 'unidades', note: '5% de reserva para trocas' }
				]
			},
			{
				id: 'paes',
				label: 'Padaria/Pães',
				hint: 'Farinha, fermento e melhorador',
				fields: [field('kgPao', 'Quantos quilos de pão por dia?', 'kg', 'Ex.: 40')],
				catalog: [
					{ name: 'Farinha de trigo panificável 25kg', factor: 0.03, min: 1, unit: 'sacos', note: '~700g de farinha por kg de pão' },
					{ name: 'Fermento biológico 500g', factor: 0.02, min: 1, unit: 'pacotes', note: 'Fermentação diária' },
					{ name: 'Melhorador de farinha 1kg', factor: 0.005, min: 1, unit: 'pacotes', note: 'Padrão de crescimento e casca' }
				]
			},
			{
				id: 'lanches',
				label: 'Lanches/Hamburgueria',
				hint: 'Blend, pão e queijo por lanche',
				fields: [field('lanches', 'Quantos lanches estimados no mês?', 'lanches', 'Ex.: 300')],
				catalog: [
					{ name: 'Blend de hambúrguer 150g', factor: 1, unit: 'unidades', note: '1 blend por lanche, congelado' },
					{ name: 'Pão brioche', factor: 1.05, unit: 'unidades', note: '5% de reserva para avarias' },
					{ name: 'Queijo fatiado (kg)', factor: 0.02, min: 1, unit: 'kg', note: '~20g por lanche' }
				]
			}
		]
	},
	{
		id: 'moda',
		emoji: '👕',
		label: 'Moda, Costura & Varejo',
		description: 'Ateliês, confecções, lojas',
		templates: [
			{
				id: 'pecas',
				label: 'Produção de Peças',
				hint: 'Tecido, linha e aviamentos por peça',
				fields: [field('pecas', 'Quantas peças você vai produzir?', 'peças', 'Ex.: 30')],
				catalog: [
					{ name: 'Tecido (largura 1,50m)', factor: 1.4, min: 2, unit: 'metros', note: '~1,4m por peça, com 10% de margem de corte' },
					{ name: 'Linha de costura 2000j', factor: 0.1, min: 1, unit: 'cones', note: '~10 peças por cone' },
					{ name: 'Aviamentos (botões/zíper)', factor: 1, unit: 'kits', note: '1 kit por peça produzida' }
				]
			},
			{
				id: 'uniformes',
				label: 'Uniformes sob Encomenda',
				hint: 'Kit completo por funcionário',
				fields: [field('funcionarios', 'Para quantos funcionários?', 'pessoas', 'Ex.: 15')],
				catalog: [
					{ name: 'Camisetas para personalizar', factor: 2, unit: 'unidades', note: '2 unidades por funcionário (troca)' },
					{ name: 'Tecido brim (calça/avental)', factor: 1.6, min: 2, unit: 'metros', note: '~1,6m por funcionário' },
					{ name: 'Bordado/serigrafia', factor: 2, unit: 'aplicações', note: 'Logo em cada peça superior' }
				]
			},
			{
				id: 'enxoval',
				label: 'Enxoval/Sob Medida',
				hint: 'Encomendas personalizadas de cama e banho',
				fields: [field('encomendas', 'Quantas encomendas no mês?', 'encomendas', 'Ex.: 8')],
				catalog: [
					{ name: 'Tecido percal/atoalhado', factor: 3.5, min: 3, unit: 'metros', note: '~3,5m por encomenda média' },
					{ name: 'Viés e rendas', factor: 4, unit: 'metros', note: 'Acabamento das bordas' },
					{ name: 'Embalagem presenteável', factor: 1, unit: 'unidades', note: 'Entrega com padrão premium' }
				]
			},
			{
				id: 'estoqueLoja',
				label: 'Estoque de Loja',
				hint: 'Reposição de varejo pelo giro mensal',
				fields: [field('vendasMes', 'Quantas vendas você faz por mês?', 'vendas', 'Ex.: 100')],
				catalog: [
					{ name: 'Peças de reposição', factor: 1.2, unit: 'unidades', note: '20% acima do giro para não perder venda' },
					{ name: 'Sacolas personalizadas', factor: 1.1, unit: 'unidades', note: 'Considerando 10% de margem' },
					{ name: 'Etiquetas e tags', factor: 1.2, unit: 'unidades', note: 'Acompanham as peças novas' }
				]
			}
		]
	},
	{
		id: 'oficina',
		emoji: '🔧',
		label: 'Oficinas & Serviços Mecânicos',
		description: 'Mecânica, funilaria, detalhamento',
		templates: [
			{
				id: 'revisao',
				label: 'Revisão Geral (Óleos/Filtros)',
				hint: 'Óleo, filtros e fluidos por veículo',
				fields: [field('carros', 'Quantos carros você atende por mês?', 'carros', 'Ex.: 40')],
				catalog: [
					{ name: 'Óleo de motor 5W30 (L)', factor: 4.5, unit: 'litros', note: '~4,5L por troca, com margem' },
					{ name: 'Filtro de óleo', factor: 1, unit: 'unidades', note: '1 filtro novo por revisão' },
					{ name: 'Filtro de ar', factor: 0.7, min: 1, unit: 'unidades', note: '~70% das revisões pedem troca' }
				]
			},
			{
				id: 'funilaria',
				label: 'Funilaria e Pintura',
				hint: 'Massa, lixa e tinta por painel',
				fields: [field('paineis', 'Quantos painéis/peças para pintar?', 'painéis', 'Ex.: 12')],
				catalog: [
					{ name: 'Tinta automotiva (L)', factor: 0.4, min: 1, unit: 'litros', note: '~400ml por painel, com 10% de perda' },
					{ name: 'Massa poliéster 1kg', factor: 0.3, min: 1, unit: 'latas', note: 'Correção de amassados' },
					{ name: 'Kit lixas (80 a 600)', factor: 1, unit: 'kits', note: '1 jogo por painel trabalhado' }
				]
			},
			{
				id: 'freios',
				label: 'Troca de Freios/Suspensão',
				hint: 'Pastilhas, discos e amortecedores',
				fields: [field('veiculos', 'Quantos veículos para este serviço?', 'veículos', 'Ex.: 15')],
				catalog: [
					{ name: 'Jogo de pastilhas dianteiras', factor: 1, unit: 'jogos', note: '1 jogo por veículo' },
					{ name: 'Par de discos de freio', factor: 0.5, min: 1, unit: 'pares', note: '~metade dos serviços pede disco novo' },
					{ name: 'Fluido de freio DOT4 500ml', factor: 1, unit: 'frascos', note: 'Sangria completa a cada troca' }
				]
			},
			{
				id: 'detalhamento',
				label: 'Detalhamento/Estética',
				hint: 'Shampoo, cera e microfibra por carro',
				fields: [field('carrosDetalhe', 'Quantos carros no mês?', 'carros', 'Ex.: 25')],
				catalog: [
					{ name: 'Shampoo automotivo 5L', factor: 0.04, min: 1, unit: 'galões', note: '~25 lavagens por galão' },
					{ name: 'Cera/selante 500g', factor: 0.1, min: 1, unit: 'potes', note: '~10 aplicações por pote' },
					{ name: 'Toalha de microfibra', factor: 0.5, min: 2, unit: 'unidades', note: 'Rodízio com descarte por desgaste' }
				]
			},
			{
				id: 'estoqueOficina',
				label: 'Estoque Mensal Base',
				hint: 'Consumíveis gerais da oficina',
				fields: [field('atendimentosOficina', 'Quantos atendimentos por mês?', 'atendimentos', 'Ex.: 60')],
				catalog: [
					{ name: 'Desengraxante 5L', factor: 0.03, min: 1, unit: 'galões', note: 'Limpeza de peças e bancada' },
					{ name: 'Par de luvas nitrílicas', factor: 2, unit: 'pares', note: '2 trocas por atendimento' },
					{ name: 'Estopa/pano industrial (kg)', factor: 0.1, min: 1, unit: 'kg', note: 'Uso contínuo no box' }
				]
			}
		]
	},
	{
		id: 'pet',
		emoji: '🐶',
		label: 'Mercado Pet',
		description: 'Banho e tosa, clínicas, hotéis',
		templates: [
			{
				id: 'banhoTosa',
				label: 'Banho e Tosa Semanal',
				hint: 'Shampoo, perfume e toalhas por banho',
				fields: [field('banhos', 'Quantos banhos por semana?', 'banhos', 'Ex.: 35')],
				catalog: [
					{ name: 'Shampoo pet neutro 5L', factor: 0.04, min: 1, unit: 'galões', note: '~25 banhos por galão' },
					{ name: 'Perfume/colônia pet 500ml', factor: 0.05, min: 1, unit: 'frascos', note: 'Finalização de cada banho' },
					{ name: 'Toalha descartável pet', factor: 1.1, unit: 'unidades', note: 'Considerando 10% de reposição' }
				]
			},
			{
				id: 'clinico',
				label: 'Atendimentos Clínicos (Vacinas/Luvas)',
				hint: 'Seringas, luvas e antissépticos',
				fields: [field('consultas', 'Quantos atendimentos no mês?', 'consultas', 'Ex.: 80')],
				catalog: [
					{ name: 'Seringa descartável 3ml', factor: 1.2, unit: 'unidades', note: 'Aplicações + 20% de reserva' },
					{ name: 'Par de luvas de procedimento', factor: 2, unit: 'pares', note: '2 trocas por consulta' },
					{ name: 'Álcool 70% 1L', factor: 0.05, min: 1, unit: 'frascos', note: 'Assepsia de bancada e aplicação' }
				]
			},
			{
				id: 'estoquePet',
				label: 'Estoque Mensal de Rações/Produtos',
				hint: 'Reposição de loja pelo giro mensal',
				fields: [field('clientesPet', 'Quantos clientes ativos no mês?', 'clientes', 'Ex.: 120')],
				catalog: [
					{ name: 'Ração premium 15kg', factor: 0.3, min: 2, unit: 'sacos', note: '~30% dos clientes compram no mês' },
					{ name: 'Petiscos e snacks', factor: 0.8, unit: 'unidades', note: 'Item de balcão com alto giro' },
					{ name: 'Tapete higiênico (pacote 30un)', factor: 0.15, min: 1, unit: 'pacotes', note: 'Reposição quinzenal média' }
				]
			},
			{
				id: 'hotelPet',
				label: 'Hotel/Creche Pet',
				hint: 'Alimentação e higiene por diária',
				fields: [field('diarias', 'Quantas diárias vendidas no mês?', 'diárias', 'Ex.: 50')],
				catalog: [
					{ name: 'Ração hóspede (kg)', factor: 0.4, min: 1, unit: 'kg', note: '~400g por diária de porte médio' },
					{ name: 'Tapete higiênico', factor: 2, unit: 'unidades', note: '2 trocas por diária' },
					{ name: 'Desinfetante pet-safe 5L', factor: 0.02, min: 1, unit: 'galões', note: 'Limpeza diária das baias' }
				]
			}
		]
	},
	{
		id: 'limpeza',
		emoji: '🧹',
		label: 'Serviços Domésticos & Limpeza',
		description: 'Diaristas, pós-obra, lavanderias',
		templates: [
			{
				id: 'faxina',
				label: 'Faxina Residencial',
				hint: 'Produtos e panos por faxina',
				fields: [field('faxinas', 'Quantas faxinas no mês?', 'faxinas', 'Ex.: 20')],
				catalog: [
					{ name: 'Multiuso concentrado 1L', factor: 0.2, min: 1, unit: 'frascos', note: '~5 faxinas por frasco' },
					{ name: 'Pano de microfibra', factor: 0.5, min: 2, unit: 'unidades', note: 'Rodízio com descarte quinzenal' },
					{ name: 'Par de luvas de borracha', factor: 0.25, min: 1, unit: 'pares', note: 'Troca a cada ~4 faxinas' }
				]
			},
			{
				id: 'posObra',
				label: 'Limpeza Pós-Obra',
				hint: 'Removedores e EPIs por metragem',
				fields: [field('areaPosObra', 'Qual a metragem da obra? (m²)', 'm²', 'Ex.: 120')],
				catalog: [
					{ name: 'Removedor de cimento 5L', factor: 0.02, min: 1, unit: 'galões', note: 'Pisos e revestimentos com respingo' },
					{ name: 'Saco de entulho reforçado', factor: 0.15, min: 5, unit: 'unidades', note: 'Descarte de resíduos finos' },
					{ name: 'Kit EPI (luva + máscara + óculos)', factor: 0.02, min: 2, unit: 'kits', note: 'Segurança da equipe' }
				]
			},
			{
				id: 'lavanderia',
				label: 'Lavanderia',
				hint: 'Sabão e amaciante por kg de roupa',
				fields: [field('kgRoupa', 'Quantos kg de roupa por semana?', 'kg', 'Ex.: 200')],
				catalog: [
					{ name: 'Sabão líquido profissional 5L', factor: 0.02, min: 1, unit: 'galões', note: '~250kg de roupa por galão' },
					{ name: 'Amaciante concentrado 5L', factor: 0.015, min: 1, unit: 'galões', note: 'Dosagem profissional' },
					{ name: 'Embalagem/cabide de entrega', factor: 0.3, min: 5, unit: 'unidades', note: 'Apresentação da entrega' }
				]
			},
			{
				id: 'estoqueLimpeza',
				label: 'Estoque Mensal de Produtos',
				hint: 'Reposição geral da operação',
				fields: [field('atendimentosLimpeza', 'Quantos atendimentos por mês?', 'atendimentos', 'Ex.: 40')],
				catalog: [
					{ name: 'Água sanitária 5L', factor: 0.1, min: 1, unit: 'galões', note: 'Desinfecção pesada' },
					{ name: 'Desinfetante perfumado 5L', factor: 0.08, min: 1, unit: 'galões', note: 'Acabamento dos ambientes' },
					{ name: 'Saco de lixo reforçado (pacote)', factor: 0.2, min: 1, unit: 'pacotes', note: 'Consumo contínuo' }
				]
			}
		]
	},
	{
		id: 'tatuagem',
		emoji: '✒️',
		label: 'Estúdios de Tatuagem & Piercing',
		description: 'Artistas e estúdios',
		templates: [
			{
				id: 'sessaoTattoo',
				label: 'Sessão de Tatuagem (Tintas/Agulhas)',
				hint: 'Tinta, agulhas e descartáveis por sessão',
				fields: [field('sessoesTattoo', 'Quantas sessões agendadas no mês?', 'sessões', 'Ex.: 25')],
				catalog: [
					{ name: 'Tinta preta 30ml', factor: 0.1, min: 1, unit: 'frascos', note: 'Rateio de ~10 sessões por frasco' },
					{ name: 'Cartucho de agulha estéril', factor: 3, unit: 'unidades', note: '~3 configurações por sessão' },
					{ name: 'Batoque + filme protetor (kit)', factor: 1, unit: 'kits', note: '1 kit descartável por sessão' }
				]
			},
			{
				id: 'piercing',
				label: 'Procedimento de Piercing',
				hint: 'Joias, agulhas e assepsia',
				fields: [field('procedimentos', 'Quantos procedimentos no mês?', 'procedimentos', 'Ex.: 15')],
				catalog: [
					{ name: 'Joia de titânio', factor: 1.1, unit: 'unidades', note: 'Inclui 10% de reserva de tamanhos' },
					{ name: 'Agulha catéter estéril', factor: 1, unit: 'unidades', note: '1 agulha nova por perfuração' },
					{ name: 'Clorexidina 100ml', factor: 0.1, min: 1, unit: 'frascos', note: 'Assepsia pré e pós' }
				]
			},
			{
				id: 'biosseguranca',
				label: 'Materiais de Biossegurança',
				hint: 'Luvas, campos e esterilização',
				fields: [field('atendimentosBio', 'Quantos atendimentos no mês?', 'atendimentos', 'Ex.: 40')],
				catalog: [
					{ name: 'Par de luvas nitrílicas', factor: 3, unit: 'pares', note: '3 trocas por atendimento' },
					{ name: 'Campo cirúrgico descartável', factor: 1, unit: 'unidades', note: '1 campo novo por cliente' },
					{ name: 'Envelope de esterilização', factor: 2, unit: 'unidades', note: 'Autoclave dos instrumentos' }
				]
			},
			{
				id: 'estoqueTattoo',
				label: 'Estoque Mensal Base',
				hint: 'Reposição geral do estúdio',
				fields: [field('sessoesMes', 'Quantas sessões por mês em média?', 'sessões', 'Ex.: 30')],
				catalog: [
					{ name: 'Papel toalha (fardo)', factor: 0.1, min: 1, unit: 'fardos', note: 'Uso contínuo na bancada' },
					{ name: 'Vaselina sólida 500g', factor: 0.05, min: 1, unit: 'potes', note: 'Deslizamento e proteção' },
					{ name: 'Plástico filme protetor (rolo)', factor: 0.15, min: 1, unit: 'rolos', note: 'Envelopamento de máquinas e macas' }
				]
			}
		]
	}
];

/** Id reservado do card "Outro Nicho" — destrava o fluxo via texto livre + IA. */
export const CUSTOM_NICHE_ID = 'outro';

/** Templates universais para nichos fora do catálogo (até a IA real assumir). */
export const CUSTOM_TEMPLATES: readonly PlannerTemplate[] = [
	{
		id: 'porCliente',
		label: 'Serviço por Cliente',
		hint: 'Consumo estimado a cada atendimento',
		fields: [field('clientesCustom', 'Quantos clientes estimados no mês?', 'clientes', 'Ex.: 50')],
		catalog: [
			{ name: 'Insumo principal do serviço', factor: 1, unit: 'unidades', note: '1 uso por cliente, sem reaproveitamento' },
			{ name: 'Descartáveis e EPIs (kit)', factor: 1, unit: 'kits', note: 'Higiene e segurança por atendimento' },
			{ name: 'Material de apoio/limpeza', factor: 0.1, min: 1, unit: 'unidades', note: 'Rateio de uso contínuo' }
		]
	},
	{
		id: 'porUnidade',
		label: 'Produção por Unidade',
		hint: 'Matéria-prima por peça produzida',
		fields: [field('unidades', 'Quantas unidades você vai produzir?', 'unidades', 'Ex.: 100')],
		catalog: [
			{ name: 'Matéria-prima principal', factor: 1.1, unit: 'unidades', note: 'Considerando 10% de margem de perda' },
			{ name: 'Embalagem individual', factor: 1.05, unit: 'unidades', note: '5% de reserva para avarias' },
			{ name: 'Etiqueta/acabamento', factor: 1, unit: 'unidades', note: '1 por unidade final' }
		]
	},
	{
		id: 'estoqueMensal',
		label: 'Estoque Mensal Base',
		hint: 'Reposição geral da operação',
		fields: [field('movimentoMes', 'Quantos atendimentos/vendas por mês?', 'no mês', 'Ex.: 80')],
		catalog: [
			{ name: 'Consumíveis principais', factor: 1.2, unit: 'unidades', note: '20% acima do giro para não faltar' },
			{ name: 'Material de limpeza/higiene', factor: 0.1, min: 2, unit: 'unidades', note: 'Uso contínuo do espaço' },
			{ name: 'Embalagens/descartáveis', factor: 1.1, unit: 'unidades', note: 'Considerando 10% de margem' }
		]
	},
	{
		id: 'eventoEncomenda',
		label: 'Evento ou Encomenda Grande',
		hint: 'Compra pontual por número de pessoas',
		fields: [field('pessoas', 'Para quantas pessoas?', 'pessoas', 'Ex.: 150')],
		catalog: [
			{ name: 'Insumo principal por pessoa', factor: 1.1, unit: 'unidades', note: '10% de reserva de segurança' },
			{ name: 'Descartáveis do evento', factor: 1.2, unit: 'unidades', note: 'Reposição durante o evento' },
			{ name: 'Kit transporte/entrega', factor: 0.1, min: 1, unit: 'kits', note: 'Logística da encomenda' }
		]
	}
];

const intl = new Intl.NumberFormat('pt-BR');
const per = (value: number, factor: number, min = 1): string => intl.format(Math.max(min, Math.round(value * factor)));

/**
 * MOCK DE DESIGN — determinístico e declarativo: monta a lista a partir do
 * catálogo do template escalado pelo número digitado. Quando a rota serverless
 * nascer, vira um fetch com o MESMO contrato SupplyPlan e a UI não muda.
 */
export function simulateSupplyPlan(
	nicheId: string,
	templateId: string,
	values: Readonly<Record<string, number>>,
	customLabel = ''
): SupplyPlan {
	const isCustom = nicheId === CUSTOM_NICHE_ID;
	const niche = NICHES.find(option => option.id === nicheId);
	const templates = isCustom ? CUSTOM_TEMPLATES : niche?.templates ?? [];
	const template = templates.find(option => option.id === templateId);
	const amount = Object.values(values)[0] ?? 0;
	return {
		niche: isCustom ? (customLabel.trim() || 'Seu nicho') : niche?.label ?? 'Seu nicho',
		template: template?.label ?? 'Seu projeto',
		engine: 'simulated',
		items: (template?.catalog ?? []).map(entry => ({
			name: entry.name,
			quantity: `${per(amount, entry.factor, entry.min)} ${entry.unit}`,
			note: entry.note
		}))
	};
}

type Phase = 'niche' | 'template' | 'inputs' | 'loading' | 'result';

const STEP_LABELS: readonly string[] = ['Nicho', 'O que calcular', 'Números'];

function stepIndexOf(phase: Phase): number {
	if (phase === 'niche') return 0;
	if (phase === 'template') return 1;
	return 2;
}

/** Barra de progresso do wizard — o usuário sempre sabe onde está. */
function WizardProgress({ phase }: { readonly phase: Phase }): React.JSX.Element {
	const current = stepIndexOf(phase);
	return (
		<ol className="mb-6 flex items-center justify-center gap-2" data-testid="wizard-progress">
			{STEP_LABELS.map((label, index) => (
				<li key={label} className="flex items-center gap-2">
					<span
						className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
							index < current ? 'bg-indigo-500 text-white' : index === current ? 'bg-indigo-100 text-indigo-600 ring-2 ring-indigo-400' : 'bg-gray-100 text-gray-400'
						}`}
					>
						{index < current ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
					</span>
					<span className={`hidden text-xs font-medium sm:inline ${index === current ? 'text-gray-900' : 'text-gray-400'}`}>{label}</span>
					{index < STEP_LABELS.length - 1 && <span className="h-px w-4 bg-gray-200 sm:w-6" aria-hidden />}
				</li>
			))}
		</ol>
	);
}

function Planner(): React.JSX.Element {
	const track = useTrackEvent();
	const [phase, setPhase] = useState<Phase>('niche');
	const [niche, setNiche] = useState<PlannerNiche | null>(null);
	const [customOpen, setCustomOpen] = useState(false);
	const [customNiche, setCustomNiche] = useState('');
	const [template, setTemplate] = useState<PlannerTemplate | null>(null);
	const [values, setValues] = useState<Record<string, string>>({});
	// Sem dados até o motor responder: null = aguardando (zero mock residual).
	const [plan, setPlan] = useState<SupplyPlan | null>(null);
	const timer = useRef<number | null>(null);

	useEffect(() => () => {
		if (timer.current !== null) window.clearTimeout(timer.current);
	}, []);

	const isCustom = niche === null && customOpen;
	const customOk = customNiche.trim().length >= 3;
	const activeTemplates: readonly PlannerTemplate[] = niche ? niche.templates : CUSTOM_TEMPLATES;
	const nicheLabel = niche ? niche.label : customNiche.trim();
	const nicheEmoji = niche ? niche.emoji : '🔍';

	const numericValues: Record<string, number> = {};
	for (const inputField of template?.fields ?? []) {
		const parsed = Number((values[inputField.id] ?? '').replace(',', '.'));
		numericValues[inputField.id] = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
	}
	const inputsOk = (template?.fields ?? []).length > 0 && (template?.fields ?? []).every(inputField => (numericValues[inputField.id] ?? 0) > 0);

	const pickNiche = (option: PlannerNiche): void => {
		setNiche(option);
		setCustomOpen(false);
		setTemplate(null);
		setValues({});
		setPhase('template');
	};

	const confirmCustomNiche = (): void => {
		if (!customOk) return;
		setNiche(null);
		setTemplate(null);
		setValues({});
		setPhase('template');
	};

	const pickTemplate = (option: PlannerTemplate): void => {
		setTemplate(option);
		setValues({});
		setPhase('inputs');
	};

	const generate = (): void => {
		if (!template || !inputsOk) return;
		setPlan(null);
		setPhase('loading');
		// Mock com setTimeout — validação de design; a API real entra aqui depois.
		timer.current = window.setTimeout(() => {
			const result = simulateSupplyPlan(niche?.id ?? CUSTOM_NICHE_ID, template.id, numericValues, customNiche);
			track('Lista de Compras Gerada', { moduleId: MODULE_ID, niche: niche?.id ?? CUSTOM_NICHE_ID, template: template.id });
			setPlan(result);
			setPhase('result');
		}, 1800);
	};

	const restart = (): void => {
		setPhase('niche');
		setNiche(null);
		setCustomOpen(false);
		setCustomNiche('');
		setTemplate(null);
		setValues({});
		setPlan(null);
	};

	return (
		<div className="mx-auto max-w-3xl">
			{phase !== 'loading' && phase !== 'result' && <WizardProgress phase={phase} />}
			<AnimatePresence mode="wait">
				{phase === 'niche' && (
					<motion.section
						key="niche"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="overflow-hidden rounded-2xl bg-white p-6 shadow-sm sm:p-8"
					>
						<span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/30">
							<Boxes className="h-6 w-6" aria-hidden />
						</span>
						<h1 className="mt-5 text-2xl font-bold tracking-tight text-gray-900">Planejador Preditivo de Estoque</h1>
						<p className="mt-1.5 text-sm text-gray-500">Em qual área você trabalha? Toque no seu nicho — sem digitar nada.</p>

						<div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
							{NICHES.map(option => (
								<button
									key={option.id}
									type="button"
									onClick={() => pickNiche(option)}
									data-testid={`niche-${option.id}`}
									className="group flex flex-col items-start gap-1.5 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-500/10"
								>
									<span className="text-3xl" aria-hidden>{option.emoji}</span>
									<span className="text-sm font-semibold leading-snug text-gray-900 group-hover:text-indigo-600">{option.label}</span>
									<span className="text-xs leading-snug text-gray-400">{option.description}</span>
								</button>
							))}

							{/* Card especial: nicho fora do catálogo -> texto livre destrava a IA */}
							<button
								type="button"
								onClick={() => setCustomOpen(open => !open)}
								data-testid="niche-outro"
								aria-expanded={customOpen}
								className={`group col-span-2 flex flex-col items-start gap-1.5 rounded-2xl border-2 border-dashed p-4 text-left transition-all sm:col-span-3 ${
									customOpen ? 'border-indigo-400 bg-indigo-50/50' : 'border-gray-200 bg-gray-50/50 hover:border-indigo-300 hover:bg-indigo-50/30'
								}`}
							>
								<span className="flex items-center gap-2">
									<span className="text-3xl" aria-hidden>🔍</span>
									<span>
										<span className="block text-sm font-semibold text-gray-900 group-hover:text-indigo-600">Outro Nicho</span>
										<span className="block text-xs text-gray-400">Não encontrou seu nicho? A IA cobre qualquer área</span>
									</span>
								</span>
							</button>
						</div>

						{customOpen && (
							<motion.div
								initial={{ opacity: 0, height: 0 }}
								animate={{ opacity: 1, height: 'auto' }}
								transition={{ duration: 0.25 }}
								className="mt-3 overflow-hidden"
							>
								<label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="custom-niche">
									Não encontrou seu nicho? Digite aqui o que você faz
								</label>
								<div className="flex gap-2">
									<div className="flex flex-1 items-center rounded-xl border border-gray-200 bg-white shadow-sm transition-all focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
										<Search className="ml-3.5 h-4 w-4 shrink-0 text-gray-300" aria-hidden />
										<input
											id="custom-niche"
											value={customNiche}
											onChange={event => setCustomNiche(event.target.value)}
											placeholder="Ex.: Chaveiro, floricultura, aulas de música…"
											data-testid="custom-niche-input"
											className="w-full rounded-xl bg-transparent px-3 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-300"
										/>
									</div>
									<button
										type="button"
										onClick={confirmCustomNiche}
										disabled={!customOk}
										data-testid="custom-niche-continue"
										className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
									>
										Continuar <ArrowRight className="h-4 w-4" aria-hidden />
									</button>
								</div>
							</motion.div>
						)}
					</motion.section>
				)}

				{phase === 'template' && (niche || isCustom || customOk) && (
					<motion.section
						key="template"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="overflow-hidden rounded-2xl bg-white p-6 shadow-sm sm:p-8"
					>
						<span className="text-3xl" aria-hidden>{nicheEmoji}</span>
						<h2 className="mt-3 text-xl font-bold tracking-tight text-gray-900">O que você quer calcular em {nicheLabel}?</h2>
						<p className="mt-1.5 text-sm text-gray-500">Escolha uma opção pronta — a gente já sabe os materiais de cada uma.</p>

						<div className="mt-6 grid gap-3">
							{activeTemplates.map(option => (
								<button
									key={option.id}
									type="button"
									onClick={() => pickTemplate(option)}
									data-testid={`template-${option.id}`}
									className="group flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-500/10"
								>
									<span>
										<span className="block text-sm font-semibold text-gray-900 group-hover:text-indigo-600">{option.label}</span>
										<span className="mt-0.5 block text-xs text-gray-400">{option.hint}</span>
									</span>
									<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-50 text-gray-300 transition-colors group-hover:bg-indigo-50 group-hover:text-indigo-500">
										<Sparkles className="h-4 w-4" aria-hidden />
									</span>
								</button>
							))}
						</div>

						<button type="button" onClick={restart} className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600">
							<ArrowLeft className="h-4 w-4" aria-hidden /> Trocar de nicho
						</button>
					</motion.section>
				)}

				{phase === 'inputs' && template && (
					<motion.section
						key="inputs"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="overflow-hidden rounded-2xl bg-white p-6 shadow-sm sm:p-8"
					>
						<span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600">
							{nicheEmoji} {nicheLabel} · {template.label}
						</span>
						<h2 className="mt-4 text-xl font-bold tracking-tight text-gray-900">Só falta o número</h2>
						<p className="mt-1.5 text-sm text-gray-500">Preencha e a IA calcula quantidades com a margem de perda inclusa.</p>

						<div className="mt-6 grid gap-4">
							{template.fields.map(inputField => (
								<label key={inputField.id} className="block">
									<span className="mb-1.5 block text-sm font-medium text-gray-700">{inputField.label}</span>
									<div className="flex items-center rounded-xl border border-gray-200 bg-white shadow-sm transition-all focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
										<input
											type="number"
											inputMode="decimal"
											min={0}
											step="any"
											value={values[inputField.id] ?? ''}
											onChange={event => setValues(current => ({ ...current, [inputField.id]: event.target.value }))}
											placeholder={inputField.placeholder}
											data-testid={`field-${inputField.id}`}
											className="w-full rounded-xl bg-transparent px-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-300"
										/>
										<span className="whitespace-nowrap px-3.5 text-xs font-medium text-gray-400">{inputField.suffix}</span>
									</div>
								</label>
							))}
						</div>

						<button
							type="button"
							onClick={generate}
							disabled={!inputsOk}
							data-testid="generate-button"
							className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
						>
							<Sparkles className="h-4 w-4" aria-hidden /> Gerar Lista de Compras
						</button>

						<button type="button" onClick={() => setPhase('template')} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600">
							<ArrowLeft className="h-4 w-4" aria-hidden /> Escolher outro cálculo
						</button>
					</motion.section>
				)}

				{phase === 'loading' && (
					<motion.section
						key="loading"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.25 }}
						className="flex flex-col items-center rounded-2xl bg-white p-12 text-center shadow-sm"
						data-testid="planner-loading"
					>
						<span className="relative flex h-16 w-16 items-center justify-center">
							<span className="absolute inset-0 animate-ping rounded-full bg-indigo-400/30" />
							<span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
								<ClipboardList className="h-7 w-7 animate-pulse" aria-hidden />
							</span>
						</span>
						<h2 className="mt-6 text-lg font-semibold tracking-tight text-gray-900">
							Nossa IA está calculando os materiais necessários para o seu projeto…
						</h2>
						<p className="mt-2 text-sm text-gray-500">Quantidades exatas, com margem de perda inclusa.</p>
						<div className="mt-5 flex gap-1.5" aria-hidden>
							{[0, 1, 2].map(dot => (
								<span
									key={dot}
									className="h-2 w-2 animate-bounce rounded-full bg-indigo-500"
									style={{ animationDelay: `${dot * 0.15}s` }}
								/>
							))}
						</div>
					</motion.section>
				)}

				{phase === 'result' && plan && (
					<motion.section
						key="result"
						initial={{ opacity: 0, scale: 0.97 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.98 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="overflow-hidden rounded-2xl bg-white shadow-sm"
						data-testid="planner-results"
					>
						<div className="border-b border-gray-100 bg-gradient-to-br from-indigo-50 to-white px-6 py-5">
							<div className="flex items-center justify-between gap-2">
								<span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-indigo-600 shadow-sm">
									<ClipboardList className="h-3.5 w-3.5" aria-hidden /> Sua Lista de Compras
								</span>
								{plan.engine === 'simulated' && (
									<span
										className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200"
										data-testid="planner-simulated-badge"
									>
										Prévia simulada — API real em breve
									</span>
								)}
							</div>
							<h2 className="mt-3 text-lg font-semibold tracking-tight text-gray-900">
								{plan.niche} · <span className="text-gray-500">{plan.template}</span>
							</h2>
						</div>

						<ul className="grid gap-3 p-6">
							{plan.items.map(item => (
								<li
									key={item.name}
									className="flex items-start gap-4 rounded-2xl border border-gray-100 p-4 transition-shadow hover:shadow-sm"
									data-testid="planner-item"
								>
									<span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
										<Package className="h-5 w-5" aria-hidden />
									</span>
									<div className="min-w-0">
										<p className="text-sm font-semibold text-gray-900">{item.name}</p>
										<p className="mt-0.5 text-lg font-bold tracking-tight text-indigo-600">{item.quantity}</p>
										<p className="mt-0.5 text-xs text-gray-400">{item.note}</p>
									</div>
								</li>
							))}
						</ul>

						<div className="mx-6 mb-4 flex items-start gap-2 rounded-xl bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
							<Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
							<span>
								Quantidades estimadas para planejamento de compra. Confirme medidas e rendimentos com seus fornecedores antes de fechar o pedido.
							</span>
						</div>

						<div className="flex flex-col gap-3 border-t border-gray-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
							<button type="button" onClick={restart} className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600">
								<ArrowLeft className="h-4 w-4" aria-hidden /> Planejar outro projeto
							</button>
							<button
								type="button"
								onClick={() => setPhase('inputs')}
								className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md"
							>
								<Wand2 className="h-4 w-4" aria-hidden /> Ajustar os números
							</button>
						</div>
					</motion.section>
				)}
			</AnimatePresence>
		</div>
	);
}

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied mx-auto max-w-md rounded-2xl bg-white p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-gray-900">Acesso negado</h2>
			<p className="mt-2 text-sm text-gray-500">Sua conta não possui o Planejador Preditivo de Estoque ativo.</p>
		</div>
	);
}

export default function SupplyPlanner(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <Planner />;
}

/** Registry entry contract. */
export function createPlugin(): typeof SupplyPlanner {
	return SupplyPlanner;
}
