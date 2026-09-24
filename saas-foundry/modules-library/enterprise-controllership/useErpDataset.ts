import { useEffect, useState } from 'react';
import { ERP_DATASET_EVENT, loadDataset, type ErpDataset } from './erpDataset.js';

/**
 * useErpDataset — dá a QUALQUER painel do ERP o dataset da última planilha
 * ingerida (ou null quando ainda não houve ingestão). Recarrega ao vivo quando a
 * Ingestão grava um dataset novo: escuta o evento in-app (mesma aba) e o evento
 * `storage` (outras abas). Assim, importar a planilha atualiza o Painel, o
 * Simulador e o Dossiê sem recarregar a página.
 */
export function useErpDataset(): ErpDataset | null {
	const [dataset, setDataset] = useState<ErpDataset | null>(() => {
		try {
			return loadDataset();
		} catch {
			return null;
		}
	});

	useEffect(() => {
		const refresh = (): void => {
			try {
				setDataset(loadDataset());
			} catch {
				setDataset(null);
			}
		};
		window.addEventListener(ERP_DATASET_EVENT, refresh);
		window.addEventListener('storage', refresh);
		return () => {
			window.removeEventListener(ERP_DATASET_EVENT, refresh);
			window.removeEventListener('storage', refresh);
		};
	}, []);

	return dataset;
}
