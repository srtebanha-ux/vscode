/**
 * Lead da isca digital. Persistido em localStorage: uma vez capturado, o
 * visitante desbloqueia todas as ferramentas gratuitas sem repetir o cadastro
 * (PLG — atrito zero na volta). Em produção o mesmo evento alimenta o CRM via
 * Serverless Function; aqui, o telemetrySink registra a conversão.
 */
export interface Lead {
	readonly name: string;
	readonly email: string;
}

const STORAGE_KEY = 'lidar:lead';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
	return EMAIL_PATTERN.test(email.trim());
}

export function getStoredLead(): Lead | null {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<Lead>;
		return typeof parsed.email === 'string' && isValidEmail(parsed.email)
			? { name: parsed.name ?? '', email: parsed.email }
			: null;
	} catch {
		return null;
	}
}

export function storeLead(lead: Lead): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lead));
	} catch {
		/* modo privado: segue sem persistir */
	}
}
