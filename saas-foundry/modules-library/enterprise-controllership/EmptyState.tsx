import { Database } from 'lucide-react';

/**
 * EmptyState — o estado "limpo" de todo painel ANTES do cliente importar a sua
 * planilha. Nada de empresa/dado fictício: só um convite para a aba Ingestão ERP.
 * Assim, quando o cliente sobe as informações dele, nunca vê dado de teste.
 */
export function EmptyState({ title, hint }: { readonly title: string; readonly hint?: string }): React.JSX.Element {
	return (
		<div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 p-10 text-center" data-testid="empty-state">
			<span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 text-sky-300 ring-1 ring-inset ring-zinc-800">
				<Database className="h-6 w-6" aria-hidden />
			</span>
			<p className="text-sm font-semibold text-zinc-200">{title}</p>
			<p className="mx-auto mt-1.5 max-w-sm text-xs text-zinc-500">
				{hint ?? 'Importe a planilha da sua empresa na aba '}
				<span className="font-semibold text-zinc-300">Ingestão ERP</span>
				{hint ? '' : ' (Excel ou CSV) e os números reais aparecem aqui.'}
			</p>
		</div>
	);
}
