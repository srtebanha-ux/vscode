import { useState, type FormEvent, type ReactElement } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Sparkles } from 'lucide-react';
import { orchestrate, type AiArchitectResponse } from '../../../api/ai-orchestrator';

export interface MagicPromptProps {
	readonly onRecommendation: (response: AiArchitectResponse) => void;
}

/** POST real na Serverless Function; sem backend no dev, cai no matcher local com latência simulada. */
async function askAiArchitect(prompt: string): Promise<AiArchitectResponse> {
	try {
		const response = await fetch('/api/ai-orchestrator', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ prompt })
		});
		if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
			return (await response.json()) as AiArchitectResponse;
		}
	} catch {
		// dev: sem função serverless rodando
	}
	await new Promise(resolve => setTimeout(resolve, 700));
	return orchestrate(prompt);
}

/** AI Architect: descreve o negócio em linguagem natural e a IA monta o SaaS. */
export function MagicPrompt({ onRecommendation }: MagicPromptProps): ReactElement {
	const [prompt, setPrompt] = useState('');
	const [thinking, setThinking] = useState(false);

	const submit = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (prompt.trim().length < 3 || thinking) {
			return;
		}
		setThinking(true);
		try {
			onRecommendation(await askAiArchitect(prompt.trim()));
		} finally {
			setThinking(false);
		}
	};

	return (
		<motion.div
			initial={{ opacity: 0, y: -8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.3, ease: 'easeOut' }}
			className="rounded-2xl bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-amber-400 p-[2px] shadow-sm"
		>
			<form
				onSubmit={event => void submit(event)}
				className="flex flex-col gap-3 rounded-[14px] bg-white p-4 sm:flex-row sm:items-center"
			>
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-900 text-white shadow-sm">
					<Sparkles className="h-5 w-5" aria-hidden />
				</span>
				<div className="min-w-0 flex-1">
					<label htmlFor="magic-prompt" className="text-xs font-medium uppercase tracking-wider text-gray-400">
						AI Architect
					</label>
					<input
						id="magic-prompt"
						type="text"
						value={prompt}
						maxLength={500}
						onChange={event => setPrompt(event.target.value)}
						placeholder="Descreva seu negócio: “gerencio entregas de concreto usinado e preciso de orçamentos e controle de insumos”"
						className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
					/>
				</div>
				<button
					type="submit"
					disabled={thinking || prompt.trim().length < 3}
					className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:scale-105 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
				>
					{thinking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
					{thinking ? 'Montando…' : 'Montar meu SaaS'}
				</button>
			</form>
		</motion.div>
	);
}
