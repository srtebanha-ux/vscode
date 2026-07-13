/**
 * Regras de validação do Certificado Digital A1 — lógica pura (sem React) para
 * ser testável e reutilizável. O A1 é um arquivo PKCS#12 pequeno; qualquer
 * coisa fora do padrão é rejeitada ANTES de sair do navegador (fail-closed).
 */

export const CERT_EXTENSIONS = ['.pfx', '.p12'] as const;

/** Um A1 real tem poucos KB; acima de 512 KB é suspeito (fail-closed). */
export const MAX_CERT_BYTES = 512 * 1024;

/** Só aceita a extensão de um PKCS#12 (.pfx / .p12). */
export function isAllowedCertFile(fileName: string): boolean {
	const lower = fileName.trim().toLowerCase();
	return CERT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export interface CertValidation {
	readonly ok: boolean;
	readonly error?: string;
}

/** Valida o arquivo escolhido antes de qualquer upload. */
export function validateCertFile(file: { readonly name: string; readonly size: number }): CertValidation {
	if (!isAllowedCertFile(file.name)) {
		return { ok: false, error: 'Formato inválido. Envie um arquivo .pfx ou .p12.' };
	}
	if (file.size <= 0) {
		return { ok: false, error: 'Arquivo vazio ou corrompido.' };
	}
	if (file.size > MAX_CERT_BYTES) {
		return { ok: false, error: 'Arquivo grande demais para um certificado A1.' };
	}
	return { ok: true };
}
