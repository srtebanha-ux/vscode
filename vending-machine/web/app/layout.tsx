import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SITE_URL } from '@/lib/catalog';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Vending Machine — micro-produtos digitais prontos', template: '%s' },
  description: 'Planilhas, scripts e templates que resolvem uma dor específica. Download imediato após o pagamento.',
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <header className="border-b border-slate-200 dark:border-slate-800">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <a href="/" className="font-semibold tracking-tight">vending<span className="text-accent">.machine</span></a>
            <a href="/#catalogo" className="text-sm text-slate-500 hover:text-accent">Catálogo</a>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 py-10 text-xs text-slate-500">
          Entrega automática por e-mail · Pagamento processado pelo Stripe
        </footer>
      </body>
    </html>
  );
}
