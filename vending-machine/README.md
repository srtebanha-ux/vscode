# Autonomous Digital Vending Machine

Ecossistema autônomo: detecta demanda → fabrica o produto digital com LLM → publica landing page estática otimizada para SEO → entrega o arquivo por link assinado após o pagamento. Nenhuma etapa exige intervenção humana.

## Modelo econômico

`Profit = Σ (Tᵢ × Cᵢ × Pᵢ) − (C_server + C_api)`

`T` vem de SEO programático (CAC = 0), `C` é alta porque cada página ataca uma dor micro-específica, `P` é ticket de impulso. Custo marginal de fabricação ≈ 0 ⇒ margem bruta próxima de 99%.

## Árvore

```
vending-machine/
├── data/niche_pains.json          seed de dores de nicho (fallback do Radar)
├── src/
│   ├── config.ts                  env validado por zod
│   ├── types.ts                   contratos de domínio
│   ├── pipeline.ts                ciclo Radar → Fábrica → Vitrine
│   ├── server.ts                  express: webhook, download, checkout
│   ├── smoke.ts                   teste do caminho sem-LLM
│   ├── db/{schema.sql,client.ts,repo.ts,migrate.ts}   libSQL: Turso ou file:
│   ├── lib/{llm,signer,mailer,stripe,slug,id,log}.ts
│   └── modules/
│       ├── scraper.ts             1. Radar
│       ├── factory.ts             2. Fábrica (+ refabricate)
│       ├── seo_builder.ts         3. Vitrine SEO
│       ├── snippet.ts             tokenizador por MIME (server-side)
│       ├── usecases.ts            casos de uso aterrados no artefato
│       ├── changelog.ts           versionamento por checksum
│       └── webhook.ts             4. Checkout zero-touch
└── web/                           Next.js 15 (SSG) + Tailwind
    ├── app/{layout,page}.tsx
    ├── app/p/[slug]/page.tsx      landing programática
    ├── app/api/{checkout,revalidate}/route.ts
    ├── app/{sitemap,robots}.ts
    ├── components/{BuyButton,SnippetView}.tsx
    └── lib/catalog.ts             fetch do Turso + cache/ISR por tag
```

## Fluxo

1. `scraper.scan()` pontua demanda (`log(volume)` × escassez + bônus de cauda longa) e grava sinais pendentes.
2. `factory.manufacture()` faz duas chamadas ao LLM — blueprint estruturado (zod → structured output) e artefato bruto (streaming) — valida, converte para Base64 e persiste em transação.
3. `seo_builder.publish()` deriva metadados, clusters de cauda longa, silo de links internos e JSON-LD, e injeta três camadas de densidade — **todas pré-computadas aqui** e gravadas em `published_pages.landing_json`, para que o storefront só precise de um `SELECT`:
   - **Snippet estruturado** (`snippet.ts`): CSV vira `<table>` real + schema `Dataset` com `variableMeasured`; script vira tokens em `<span>` + `SoftwareSourceCode`; JSON vira árvore de campos. Tokenização no Node, zero KB de highlighter no cliente.
   - **Casos de uso aterrados** (`usecases.ts`): uma chamada ao LLM cujo prompt carrega as colunas/assinaturas reais extraídas do artefato; a resposta é rejeitada se as âncoras não existirem de fato no arquivo.
   - **Changelog com proveniência** (`changelog.ts`): `v1.0.0` na primeira publicação; revisões seguintes só geram versão quando o checksum SHA-256 ou os campos do blueprint realmente mudam, com a nota derivada do diff. `dateModified` só entra no JSON-LD a partir da segunda versão.
4. `webhook.stripeWebhookHandler()` valida a assinatura, deduplica o evento, cria o pedido, emite token HMAC com expiração e dispara o e-mail. `downloadHandler()` serve o arquivo com limite de usos.

## Execução

```bash
npm install && cp .env.example .env   # ANTHROPIC_API_KEY, chaves Stripe, Turso (opcional)
npm run migrate                       # aplica o schema no Turso ou no arquivo local
npm run smoke                         # valida persistência, SEO, token e download (sem gastar LLM)
npm run cycle                         # ciclo autônomo completo
npm run dev                           # API :4000
cd web && npm install && npm run build && npm start   # vitrine :3000
```

Webhook local: `stripe listen --forward-to localhost:4000/webhooks/stripe`.

## Fonte de verdade: Turso (libSQL)

Um único driver (`@libsql/client`) atende os dois lados. Com `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` a conexão vai para o Turso; sem elas cai para `file:` local, então a fábrica roda offline sem mudar uma linha.

- **Escrita** — `publish()` grava numa transação (`batch`) o `products.status = published` e o upsert em `published_pages`, que carrega `landing_json` (a landing inteira serializada) mais os metadados de catálogo. Nada é escrito em disco.
- **Leitura** — `web/lib/catalog.ts`: `getSlugs()` alimenta o `generateStaticParams`, `getPageData(slug)` faz `SELECT landing_json ... WHERE slug = ?`. `published_pages` nunca expõe o Base64 do artefato — o download continua saindo do backend com link assinado.
- **Cache** — `cache()` do React deduplica dentro de uma renderização (`generateStaticParams`, `sitemap` e home batem no banco uma vez só); `unstable_cache` persiste entre requisições com `revalidate: CATALOG_CACHE_TTL` e as tags `catalog` / `page:<slug>`. Publicar dispara `POST /api/revalidate`, que faz `revalidateTag` — sem rebuild completo.

Deploy na Vercel: Root Directory `vending-machine/web`, com `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SITE_URL`, `API_BASE_URL` e `REVALIDATE_SECRET` no ambiente.
