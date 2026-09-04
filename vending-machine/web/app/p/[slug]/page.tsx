import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BuyButton } from '@/components/BuyButton';
import { SnippetView } from '@/components/SnippetView';
import { formatPrice, getPageData, getSlugs } from '@/lib/catalog';

const DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

export const dynamicParams = false;

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return (await getSlugs()).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const landing = await getPageData(slug);
  if (!landing) return { title: 'Produto não encontrado' };
  const { seo, product } = landing;
  return {
    title: seo.metaTitle,
    description: seo.metaDescription,
    keywords: seo.keywordClusters,
    alternates: { canonical: seo.canonical },
    openGraph: {
      type: 'website',
      title: seo.openGraph['og:title'] ?? product.title,
      description: seo.openGraph['og:description'] ?? product.tagline,
      url: seo.canonical,
    },
    twitter: { card: 'summary', title: seo.metaTitle, description: seo.metaDescription },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const landing = await getPageData(slug);
  if (!landing) notFound();
  const { product, seo, snippet, useCases, changelog } = landing;
  const price = formatPrice(product.priceCents, product.currency);
  const current = changelog[0];

  return (
    <article className="grid gap-10 lg:grid-cols-[1.6fr_1fr]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(seo.jsonLd) }}
      />

      <div>
        <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
          <span>{product.kind}</span>
          {current && <span className="rounded border border-slate-200 px-1.5 py-0.5 font-mono normal-case dark:border-slate-800">v{current.version}</span>}
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{seo.h1}</h1>
        <p className="mt-4 max-w-prose text-lg text-slate-600 dark:text-slate-300">{product.tagline}</p>

        <section className="mt-8 max-w-prose whitespace-pre-line leading-relaxed text-slate-700 dark:text-slate-300">
          {product.description}
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">O que está incluído</h2>
          <ul className="mt-4 space-y-2">
            {product.features.map((feature) => (
              <li key={feature} className="flex gap-3 text-slate-700 dark:text-slate-300">
                <span aria-hidden className="text-accent">▸</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Estrutura de {product.assetFilename}</h2>
          <p className="mt-1 text-sm text-slate-500">Conteúdo real do arquivo que você recebe — não é uma amostra ilustrativa.</p>
          <div className="mt-4">
            <SnippetView snippet={snippet} filename={product.assetFilename} />
          </div>
        </section>

        {useCases.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-semibold">Onde isso é usado</h2>
            <div className="mt-4 space-y-6">
              {useCases.map((useCase) => (
                <article key={useCase.title}>
                  <h3 className="font-medium leading-snug">{useCase.title}</h3>
                  <p className="mt-1 max-w-prose text-slate-600 dark:text-slate-400">{useCase.scenario}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    Resolvido por <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{useCase.anchor}</code>
                  </p>
                </article>
              ))}
            </div>
          </section>
        )}

        {changelog.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-semibold">Histórico de versões</h2>
            <ol className="mt-4 space-y-3">
              {changelog.map((entry) => (
                <li key={entry.version} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-2 border-slate-200 pl-4 dark:border-slate-800">
                  <span className="font-mono text-sm font-medium">v{entry.version}</span>
                  <time dateTime={entry.createdAt} className="text-xs text-slate-500">{DATE.format(new Date(entry.createdAt))}</time>
                  <span className="w-full text-sm text-slate-600 dark:text-slate-400">{entry.note}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-slate-500">
              Cada entrada corresponde a uma alteração verificada por checksum SHA-256 do arquivo entregue.
            </p>
          </section>
        )}

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Perguntas frequentes</h2>
          <dl className="mt-4 space-y-5">
            {product.faq.map((item) => (
              <div key={item.question}>
                <dt className="font-medium">{item.question}</dt>
                <dd className="mt-1 max-w-prose text-slate-600 dark:text-slate-400">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        {seo.internalLinks.length > 0 && (
          <section className="mt-10 border-t border-slate-200 pt-6 dark:border-slate-800">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Relacionados</h2>
            <ul className="mt-3 space-y-1">
              {seo.internalLinks.map((link) => (
                <li key={link.slug}>
                  <a href={`/p/${link.slug}`} className="text-accent hover:underline">{link.anchor}</a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="h-fit rounded-xl border border-slate-200 p-6 lg:sticky lg:top-8 dark:border-slate-800">
        <p className="text-3xl font-semibold">{price}</p>
        <p className="mt-1 text-sm text-slate-500">pagamento único · sem assinatura</p>
        <div className="mt-6">
          <BuyButton slug={product.slug} label={`Comprar por ${price}`} />
        </div>
        <ul className="mt-6 space-y-2 text-sm text-slate-500">
          <li>Entrega automática por e-mail</li>
          <li>Arquivo {product.assetFilename} ({Math.max(1, Math.round(product.assetBytes / 1024))} KB)</li>
          <li>Link de download assinado e com expiração</li>
          {current && <li>Versão atual v{current.version}</li>}
        </ul>
      </aside>
    </article>
  );
}
