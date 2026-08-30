# ════════════════════════════════════════════════════════════════════════════════════════════════
# IMAGEM DO ragnabot-motor — o motor de fluxo, a portaria, os relógios, o SaaS e o protocolo.
#
# CONTEXTO DE BUILD = A RAIZ DO REPOSITÓRIO (não a pasta app/), porque o arquivo `VERSAO` mora na
# raiz e é ele que diz a versão do produto:
#     docker build -f app/Dockerfile -t ragnabot-motor:1.03.00 .
#
# ⚠️ NENHUM SEGREDO AQUI. Sem ARG de senha, sem .env copiado, sem chave. Tudo em tempo de execução,
# pelo Secret do Kubernetes (ver deploy/ragnabot-motor.yaml). Segredo em ARG fica na imagem para
# sempre, visível em `docker history`.
# ════════════════════════════════════════════════════════════════════════════════════════════════

# ── Etapa 1: dependências e cliente Prisma ──────────────────────────────────────────────────────
FROM node:20-alpine AS dependencias

# O engine do Prisma precisa do OpenSSL 3 no Alpine; sem ele o cliente gera e quebra só ao conectar.
RUN apk add --no-cache openssl

WORKDIR /app

# package.json antes do resto: se só o código mudar, o npm ci reaproveita a camada.
COPY app/package.json app/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# O cliente Prisma é gerado NA IMAGEM, a partir do schema versionado — nunca copiado de fora.
# DATABASE_URL de mentira: `generate` não conecta em banco nenhum, só precisa da variável existir.
COPY app/prisma ./prisma
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate

# ── Etapa 2: a imagem que roda ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS producao

RUN apk add --no-cache openssl tini

ENV NODE_ENV=production
ENV TZ=America/Fortaleza

WORKDIR /app

# node_modules com o cliente Prisma já gerado.
COPY --from=dependencias /app/node_modules ./node_modules
COPY --from=dependencias /app/prisma ./prisma

COPY app/package.json ./package.json
COPY app/src ./src
# A versão do produto — lida em tempo de execução por src/base/versao.js e mostrada no /saude.
COPY VERSAO ./VERSAO

# O logger escreve em logs/ quando roda fora de contêiner; no pod o que vale é o stdout, mas a
# pasta tem de existir e ser gravável pelo usuário não-root, senão o winston derruba o processo.
RUN mkdir -p logs && chown -R node:node /app

# ⚠️ NÃO-ROOT. A imagem base já traz o usuário `node` (uid 1000).
USER node

EXPOSE 3000

# tini como PID 1: sem ele, o Node não recebe SIGTERM direito e o pod leva 30s para morrer a cada
# rollout — e conexões de banco ficam penduradas.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/servidor.js"]
