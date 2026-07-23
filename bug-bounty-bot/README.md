# Bug Bounty Bot

Bot em Node.js + TypeScript focado em detectar **Secret Leaks** (vazamento de credenciais) em repositórios públicos via API do GitHub, com notificações via Telegram.

> ⚠️ **Uso autorizado apenas.** Esta ferramenta destina-se a pesquisa de segurança dentro de programas de Bug Bounty públicos e testes autorizados. Respeite o escopo de cada programa e os Termos de Serviço do GitHub.

## Estrutura

```
bug-bounty-bot/
├── src/
│   ├── config/          # Configurações e alvos (targets.json)
│   ├── services/        # Serviços (GitHub, Telegram, scanner) — próximas etapas
│   ├── utils/           # Utilitários auxiliares — próximas etapas
│   └── index.ts         # Ponto de entrada
├── .env.example         # Modelo de variáveis de ambiente
├── package.json
└── tsconfig.json
```

## Configuração

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Copie o arquivo de exemplo e preencha as credenciais:
   ```bash
   cp .env.example .env
   ```

### Variáveis de ambiente

| Variável              | Descrição                                             | Padrão  |
| --------------------- | ----------------------------------------------------- | ------- |
| `GITHUB_TOKEN`        | Personal Access Token do GitHub para a API de busca.  | —       |
| `TELEGRAM_BOT_TOKEN`  | Token do bot do Telegram (via @BotFather).            | —       |
| `TELEGRAM_CHAT_ID`    | ID do chat/canal que receberá os alertas.             | —       |
| `POLLING_INTERVAL_MS` | Intervalo entre ciclos de varredura (ms).             | `60000` |

## Scripts

| Comando             | Descrição                                    |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Executa em modo desenvolvimento (ts-node).   |
| `npm run build`     | Compila TypeScript para `dist/`.             |
| `npm start`         | Executa a versão compilada.                  |
| `npm run typecheck` | Verifica tipos sem gerar saída.              |

## Status

Etapa atual: **base estrutural** concluída. A lógica de varredura e as notificações serão implementadas nas próximas etapas.
