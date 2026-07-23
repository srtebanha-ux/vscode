# ---------- Estágio 1: build ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Instala todas as dependências (incluindo devDependencies para compilar TS).
COPY package.json package-lock.json ./
RUN npm ci

# Compila o TypeScript para dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- Estágio 2: runtime ----------
FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Instala apenas as dependências de produção.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copia os artefatos compilados do estágio de build.
COPY --from=builder /app/dist ./dist

# Diretório padrão do volume persistente para o cache (montável no Railway).
# Ajuste CACHE_FILE_PATH para apontar para dentro dele (ex: /data/reported.json).
RUN mkdir -p /data
ENV CACHE_FILE_PATH=/data/reported.json

# Executa o binário já compilado (sem recompilar em produção).
CMD ["node", "dist/index.js"]
