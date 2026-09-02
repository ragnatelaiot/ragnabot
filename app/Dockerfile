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
# ── Etapa 1b: a interface (doc 33, Etapa 4) ─────────────────────────────────────────────────────
# Pacote próprio, com node_modules próprio: a tela não empresta as dependências do motor, e o motor
# não carrega React em produção. Foi a lição da Etapa 1 — ambiente emprestado mente sobre onde você
# está (naquele caso, um atalho para o node_modules do NOC fez teste local bater no banco de
# produção).
FROM node:20-alpine AS interface

WORKDIR /web

# package.json antes do código: se só a tela mudar, o npm ci reaproveita a camada.
COPY app/web/package.json app/web/package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY app/web/ ./

# ⭐ ONDE A INTERFACE FICA PENDURADA (contrato S1, 02/09/2026 — ver `app/web/COMO-SERVIR.md` §5).
# A tela deixou de usar caminho relativo quando ganhou ROTAS: com `./assets/x.js`, uma rota de dois
# segmentos (`/ragnabot-fluxos/<id>`) pediria `/ragnabot-fluxos/assets/x.js` — 404, tela BRANCA, e a
# rede dizendo 200. Com caminho absoluto é preciso DECLARAR o prefixo, e declarar é o que este ARG
# faz. Padrao `/` (raiz): quem construir sem passar nada continua tendo o pacote de antes.
#
# ⭐ DECIDIDO EM 02/09/2026 (contrato S-PUBLICAR): a interface e publicada em
#    **https://bot.ragnatela.com.br/painel/**. Logo, o comando de construcao de producao e:
#
#     docker build -f app/Dockerfile --build-arg RAGNABOT_PREFIXO_WEB=/painel/ -t ragnabot-motor:X .
#
# ⚠️ ESQUECER O `--build-arg` NAO DA ERRO — da TELA BRANCA com 200 na rede, que e o pior sintoma
# possivel: o indice pediria `/assets/…` na raiz do host, e a raiz do host e o Ingress da
# PLATAFORMA de atendimento, nao o motor. Por isso o `/saude` passou a dizer, em
# `interface.prefixo`, para qual caminho o PACOTE foi construido — lido do proprio indice. Confira
# ali antes de anunciar que subiu.
#
# `/motor-api/` continua sendo a porta de SERVICO (NOC → motor) e nao serve tela nenhuma.
#
# ⚠️ ARG NAO SERVE PARA SEGREDO (fica em `docker history` para sempre). Este aqui e um caminho
# publico, e so.
ARG RAGNABOT_PREFIXO_WEB=/
ENV RAGNABOT_PREFIXO_WEB=${RAGNABOT_PREFIXO_WEB}
RUN npm run build

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
# A tela construída. Fica em /app/web/dist porque é onde `PASTA_INTERFACE` a procura por padrão.
COPY --from=interface /web/dist ./web/dist
RUN mkdir -p logs && chown -R node:node /app

# ⚠️ NÃO-ROOT. A imagem base já traz o usuário `node` (uid 1000).
USER node

EXPOSE 3000

# tini como PID 1: sem ele, o Node não recebe SIGTERM direito e o pod leva 30s para morrer a cada
# rollout — e conexões de banco ficam penduradas.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/servidor.js"]
