import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components';
import type { ReactElement } from 'react';

export interface WelcomeTemplateProps {
	/** Primeiro nome é derivado; opcional porque o lead pode não ter informado. */
	readonly nome?: string;
	/** Ferramenta que capturou o lead: "Calculadora" | "Recibo" | "Oráculo". */
	readonly ferramentaUsada: string;
	/** Magic Link (URL com JWT temporário) — login sem senha. */
	readonly magicLink: string;
}

/** E-mail transacional de boas-vindas — corporativo, uma única ação óbvia (o Magic Link). */
export function WelcomeTemplate({ nome, ferramentaUsada, magicLink }: WelcomeTemplateProps): ReactElement {
	const firstName = nome?.trim().split(/\s+/)[0] || 'empreendedor';
	return (
		<Html lang="pt-BR">
			<Head />
			<Preview>Seu acesso ao Lidar Core está liberado 🚀</Preview>
			<Body style={main}>
				<Container style={container}>
					<Section style={brandRow}>
						<span style={brandDot}>◈</span>
						<span style={brandName}>Lidar Core</span>
					</Section>

					<Heading style={h1}>Bem-vindo(a), {firstName}!</Heading>

					<Text style={paragraph}>
						Seu acesso ao Lidar Core está liberado. O relatório da sua <strong>{ferramentaUsada}</strong> está
						salvo na sua conta. Como bônus, desbloqueamos o <strong>Assistente de Cobranças</strong> para
						você testar hoje.
					</Text>

					<Section style={ctaWrap}>
						<Button href={magicLink} style={button}>
							Acessar minha conta agora
						</Button>
					</Section>

					<Text style={muted}>
						O botão faz seu login automaticamente (sem senha) e é válido por 24 horas. Se não foi você, ignore
						este e-mail.
					</Text>

					<Hr style={hr} />
					<Text style={footer}>
						Você recebeu este e-mail porque usou uma ferramenta gratuita do Lidar Core.
					</Text>
				</Container>
			</Body>
		</Html>
	);
}

export default WelcomeTemplate;

// ── Estilos inline (clientes de e-mail ignoram CSS externo) ──────────────────
const main: React.CSSProperties = { backgroundColor: '#f4f4f5', fontFamily: "Inter, -apple-system, Segoe UI, sans-serif", margin: 0, padding: '32px 0' };
const container: React.CSSProperties = { backgroundColor: '#ffffff', borderRadius: 16, maxWidth: 520, margin: '0 auto', padding: 40 };
const brandRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const brandDot: React.CSSProperties = { display: 'inline-block', width: 32, height: 32, borderRadius: 9, backgroundColor: '#111827', color: '#ffffff', textAlign: 'center', lineHeight: '32px', fontSize: 16 };
const brandName: React.CSSProperties = { fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: '#111827' };
const h1: React.CSSProperties = { fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: '#111827', margin: '28px 0 12px' };
const paragraph: React.CSSProperties = { fontSize: 15, lineHeight: '1.65', color: '#374151', margin: '0 0 8px' };
const ctaWrap: React.CSSProperties = { textAlign: 'center', margin: '28px 0 20px' };
const button: React.CSSProperties = { backgroundColor: '#4f46e5', color: '#ffffff', fontSize: 16, fontWeight: 600, textDecoration: 'none', borderRadius: 12, padding: '16px 28px', display: 'inline-block' };
const muted: React.CSSProperties = { fontSize: 13, lineHeight: '1.6', color: '#9ca3af', margin: 0 };
const hr: React.CSSProperties = { borderColor: '#f3f4f6', margin: '28px 0 16px' };
const footer: React.CSSProperties = { fontSize: 12, color: '#9ca3af', margin: 0 };
