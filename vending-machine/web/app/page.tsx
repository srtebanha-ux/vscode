import type { Metadata } from 'next';
import { formatPrice, getCatalog } from '@/lib/catalog';

export const metadata: Metadata = {
  title: 'Micro-produtos digitais prontos para usar | Vending Machine',
  description: 'Planilhas, scripts e checklists que resolvem uma dor específica do seu dia a dia. Download imediato.',
  alternates: { canonical: '/' },
};

export const dynamic = 'force-static';

export default function HomePage() {
  const catalog = getCatalog();
  return (
    <>
      <section className="mb-12 max-w-prose">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Ferramentas prontas para dores específicas</h1>
        <p className="mt-4 text-slate-600 dark:text-slate-300">
          Cada item resolve um problema único, custa menos que um almoço e chega no seu e-mail em segundos.
        </p>
      </section>

      <section id="catalogo">
        <h2 className="mb-6 text-xl font-semibold">Catálogo ({catalog.length})</h2>
        {catalog.length === 0 ? (
          <p className="text-slate-500">Nenhum produto publicado ainda. Rode <code>npm run cycle</code> na fábrica.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {catalog.map((item) => (
              <li key={item.slug} className="rounded-xl border border-slate-200 p-5 transition hover:border-accent dark:border-slate-800">
                <a href={`/p/${item.slug}`} className="block">
                  <span className="text-xs uppercase tracking-wide text-slate-400">{item.kind}</span>
                  <h3 className="mt-1 font-medium leading-snug">{item.title}</h3>
                  <p className="mt-2 line-clamp-2 text-sm text-slate-500">{item.tagline}</p>
                  <p className="mt-3 font-semibold text-accent">{formatPrice(item.priceCents, item.currency)}</p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
