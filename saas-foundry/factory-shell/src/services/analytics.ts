import posthog, { type PostHog } from 'posthog-js';
import type { TelemetrySink } from '@foundry/engine-core/ui';

const env = import.meta.env as Record<string, string | undefined>;
const apiKey = env['VITE_POSTHOG_KEY'];

export const isAnalyticsEnabled = Boolean(apiKey);

/**
 * Inicializado uma única vez no boot. Sem VITE_POSTHOG_KEY (dev), fica
 * null e a telemetria degrada para console.debug — nada quebra.
 */
export const posthogClient: PostHog | null = isAnalyticsEnabled
	? posthog.init(apiKey as string, {
			api_host: env['VITE_POSTHOG_HOST'] ?? 'https://us.i.posthog.com',
			// SPA: pageviews são capturados manualmente no router (capturePageview)
			capture_pageview: false,
			// Session Recording LIGADO: é aqui que descobrimos onde o usuário trava.
			disable_session_recording: false,
			session_recording: {
				maskAllInputs: true // nunca gravar senhas/dados digitados
			},
			person_profiles: 'identified_only',
			autocapture: true
		})
	: null;

/** Implementação PostHog da porta de telemetria do SDK (@foundry/engine-core). */
export const telemetrySink: TelemetrySink = {
	capture(event, properties) {
		if (posthogClient) {
			posthogClient.capture(event, properties as Record<string, unknown> | undefined);
		} else {
			console.debug('[telemetry]', event, properties ?? {});
		}
	}
};

/** Pageview manual a cada troca de rota do SPA. */
export function capturePageview(path: string): void {
	telemetrySink.capture('$pageview', { $current_url: `${window.location.origin}${path}` });
}

/** Vincula os eventos ao tenant logado (chamado pelo composition root pós-auth). */
export function identifyTenant(tenantId: string, email: string | null): void {
	posthogClient?.identify(tenantId, email ? { email } : undefined);
}
