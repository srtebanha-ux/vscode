import { createContext, useCallback, useContext, type ReactElement, type ReactNode } from 'react';

/**
 * Porta de telemetria do SDK — vendor-neutral. O shell injeta a
 * implementação real (PostHog); módulos e o Core só conhecem esta
 * interface. Sem provider, tudo degrada para no-op (testes/SSR).
 */
export interface TelemetrySink {
	capture(event: string, properties?: Readonly<Record<string, unknown>>): void;
}

export const NOOP_TELEMETRY: TelemetrySink = { capture: () => undefined };

const TelemetryContext = createContext<TelemetrySink>(NOOP_TELEMETRY);

export function TelemetryProvider({ sink, children }: { readonly sink: TelemetrySink; readonly children: ReactNode }): ReactElement {
	return <TelemetryContext.Provider value={sink}>{children}</TelemetryContext.Provider>;
}

export type TrackEvent = (event: string, properties?: Readonly<Record<string, unknown>>) => void;

/**
 * Registra ações vitais das ferramentas no painel de Analytics.
 * Eventos canônicos: 'Módulo Ativado', 'Cálculo Realizado', 'Erro na Geração'.
 */
export function useTrackEvent(): TrackEvent {
	const sink = useContext(TelemetryContext);
	return useCallback<TrackEvent>((event, properties) => sink.capture(event, properties), [sink]);
}
