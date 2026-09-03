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
│   ├── db/{schema.sql,client.ts,repo.ts,migrate.ts}
│   ├── lib/{llm,signer,mailer,stripe,slug,id,log}.ts
│   └── modules/
│       ├── scraper.ts             1. Radar
│       ├── factory.ts             2. Fábrica
│       ├── seo_builder.ts         3. Vitrine SEO
│       └── webhook.ts             4. Checkout zero-touch
└── web/                           Next.js 15 (SSG) + Tailwind
    ├── app/{layout,page}.tsx
    ├── app/p/[slug]/page.tsx      landing programática
    ├── app/api/{checkout,revalidate}/route.ts
    ├── app/{sitemap,robots}.ts
    ├── components/BuyButton.tsx
    └── lib/catalog.ts
```

## Fluxo

1. `scraper.scan()` pontua demanda (`log(volume)` × escassez + bônus de cauda longa) e grava sinais pendentes.
2. `factory.manufacture()` faz duas chamadas ao LLM — blueprint estruturado (zod → structured output) e artefato bruto (streaming) — valida, converte para Base64 e persiste em transação.
3. `seo_builder.publish()` deriva metadados, clusters de cauda longa, silo de links internos e JSON-LD; grava `web/content/products/<slug>.json` de forma atômica; o Next.js pré-renderiza via `generateStaticParams`.
4. `webhook.stripeWebhookHandler()` valida a assinatura, deduplica o evento, cria o pedido, emite token HMAC com expiração e dispara o e-mail. `downloadHandler()` serve o arquivo com limite de usos.

## Execução

```bash
npm install && cp .env.example .env   # preencha ANTHROPIC_API_KEY e as chaves Stripe
npm run migrate
npm run smoke                         # valida persistência, SEO, token e download (sem gastar LLM)
npm run cycle                         # ciclo autônomo completo
npm run dev                           # API :4000
cd web && npm install && npm run build && npm start   # vitrine :3000
```

Webhook local: `stripe listen --forward-to localhost:4000/webhooks/stripe`.
