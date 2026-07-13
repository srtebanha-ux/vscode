# SaaS Foundry Engine

Meta-SaaS: gera, gerencia e executa instâncias de micro-SaaS isoladas.

## Topologia

```
[cliente] ──► api-gateway (SecurityMiddleware: sanitiza, CORS deny, token↔namespace)
                 │
                 ├─ /core/*  ──► engine-core   (auth, billing, FactoryService, lifecycle)
                 └─ /apps/<ns>/* ──► sandbox-runtime (IsolationContext por instância)
                                        │
                                        └─ compõe blocos de modules-library (auditados, pinados, integrity-checked)
```

## Invariantes de segurança

1. **Deny-by-default** — escopo não concedido = `ScopeDeniedError`; bloco fora do registro = rejeição; origin divergente = 403.
2. **Data Siloing** — toda chave de storage, tópico de evento e rota é prefixada com `ns_<tenant>_<name>_<nonce>` pelo broker, nunca pelo módulo.
3. **Secure Factory** — input do Factory é `unknown` até passar no JSON Schema (`additionalProperties: false`, patterns estritos); escopos requeridos ⊆ plano do tenant ∩ certificação dos blocos.
4. **Core-only scopes** — `core:*` jamais é concedível a um SaaS gerado (firewall dupla: enum do schema + checagem no Factory).
5. **Supply chain** — dependências apenas por versão exata + hash SHA-256 do artefato auditado.

## Pacotes

| Pacote | Papel |
|---|---|
| `shared` | Contratos (`SaaSModuleManifest`, `SaaSInstance`, `PluginManifest`, escopos) + JSON Schemas |
| `engine-core` | `FactoryService` (pipeline fail-closed), `LifecycleService`, `PluginRegistry` (scan + carga dinâmica gated por escopo), shell UI (`AppRouter`, `PluginRenderer`, `ErrorBoundary`, `MockApiService`) |
| `sandbox-runtime` | `SandboxHost` + `IsolationContext` (brokers com namespace forçado) |
| `modules-library` | `ApprovedModuleRegistry` (blocos auditados) + plugins (`task-dashboard`) |
| `api-gateway` | `SecurityMiddleware` global + `GatewayRouter` (rotas dinâmicas) |

## Build

```sh
npm install
npm run typecheck
```
