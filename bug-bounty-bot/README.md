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
| `npm start`         | Compila e executa a versão de produção.      |
| `npm run serve`     | Executa `dist/index.js` (sem recompilar).    |
| `npm run typecheck` | Verifica tipos sem gerar saída.              |

## Deploy (Railway)

Este bot é um **worker de longa duração** (loop com `setInterval` + `sleep` de
rate limit + cache em disco). Ele **não** deve rodar em plataformas serverless
(como o Vercel), que matam o processo após alguns segundos e não mantêm o
`setInterval` nem o filesystem entre invocações. Use um host de processo
contínuo — o repositório já vem pronto para o **Railway** via `Dockerfile`.

Passos:

1. No [Railway](https://railway.app), crie um projeto a partir deste repositório.
   Se for um monorepo, defina o **Root Directory** como `bug-bounty-bot`.
2. O build usa o `Dockerfile` (configurado em `railway.json`); nada além disso
   é necessário.
3. Em **Variables**, defina as variáveis de ambiente:
   - `GITHUB_TOKEN`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `POLLING_INTERVAL_MS` (opcional, padrão `60000`)
4. **Cache persistente (recomendado):** adicione um **Volume** e monte-o em
   `/data`. A imagem já define `CACHE_FILE_PATH=/data/reported.json`, então o
   cache de vazamentos já reportados sobrevive a reinícios/deploys e o bot não
   reenvia alertas duplicados. Sem volume, o cache é efêmero e alertas antigos
   podem ser reenviados após cada deploy.

O mesmo `Dockerfile` funciona em **Render (Background Worker)**, **Fly.io** ou
qualquer host Docker. Localmente:

```bash
docker build -t bug-bounty-bot .
docker run --env-file .env -v "$(pwd)/.cache:/data" bug-bounty-bot
```

## Status

Sistema completo: scanner (`githubScanner`), notificador (`telegramNotifier`),
cache persistente (`reportCache`) e loop de execução (`index.ts`). Pronto para
deploy como worker contínuo.
