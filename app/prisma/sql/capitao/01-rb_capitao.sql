-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- CAPITÃO (agente de IA da plataforma, adaptado ao nosso uso) — estrutura base (4 tabelas) · S5
--
-- POR QUE ESTE ARQUIVO EXISTE: a casa NÃO roda `prisma migrate dev` neste repositório, então o
-- `schema.prisma` sozinho não reconstrói o banco. Sem este SQL versionado, recriar do zero
-- (RECUPERACAO-DO-ZERO.md) deixaria as tabelas de fora e a camada do Capitão responderia 503.
--
-- ⚠️ NUNCA RODE `prisma db push` NEM `prisma migrate dev` NESTE REPOSITÓRIO.
-- O banco tem 3 chaves estrangeiras COMPOSTAS que o Prisma não sabe declarar
-- (`rb_no_versao_fk`, `rb_aresta_versao_fk`, `rb_exec_versao_fk`, em
-- `prisma/sql/motor-fluxo/04-rb_fk_compostas.sql`). Os dois comandos as apagam EM SILÊNCIO.
-- Caminho usado aqui:
--   1. `npx prisma migrate diff --from-empty --to-schema-datamodel <só os modelos novos> --script`
--   2. conferir que NÃO veio nenhum `DROP`  ← conferido: `grep -ci drop` devolveu 0
--   3. `npx prisma db execute --file <este arquivo>`
--
-- ⛔ AINDA NÃO APLICADO EM NENHUM BANCO (02/09/2026): não há `DATABASE_URL` alcançável desta
--    estação. Quem aplicar tem de rodar os dois verificadores do motor DEPOIS
--    (`prisma/sql/motor-fluxo/verificar-estrutura.mjs` e `verificar-comportamento.mjs`) para
--    provar que as 3 FKs compostas continuam vivas.
--
-- O QUE AS TABELAS GUARDAM
--   RagnabotCapitaoConfig      — liga/desliga por empresa, marca (nome, tom), teto e confiança
--   RagnabotCapitaoDocumento   — a base de conhecimento POR EMPRESA (isolamento multi-inquilino)
--   RagnabotCapitaoInteracao   — uma linha por tentativa de resposta: é a MEDIÇÃO DE CUSTO e é a
--                                trava que impede duas respostas para a mesma mensagem (`chave`)
--   RagnabotCapitaoConsumoMes  — contador persistido do mês; contador em memória zera no reinício
--                                do pod, e teto que zera sozinho não é teto
--
-- ⚠️ NENHUM TEXTO DE CLIENTE: a pergunta vira `perguntaHash` (sha256) e a resposta vira contagem
--    de caracteres. Medir consumo não é motivo para guardar conversa de terceiro.
--
-- SEM CHAVE ESTRANGEIRA para `RagnabotTenant`: `tenantId` é chave LÓGICA, no mesmo estilo dos
-- modelos `RagnabotAtend*` e do motor de fluxo.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "RagnabotCapitaoConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "nomeAgente" TEXT NOT NULL DEFAULT 'Assistente',
    "tom" TEXT NOT NULL DEFAULT 'cordial',
    "saudacao" TEXT,
    "assinatura" TEXT,
    "idioma" TEXT NOT NULL DEFAULT 'pt_BR',
    "assistenteExternoId" TEXT,
    "modelo" TEXT,
    "tetoRespostasMes" INTEGER,
    "tetoCustoCentavosMes" INTEGER,
    "confiancaMinima" DOUBLE PRECISION NOT NULL DEFAULT 0.55,
    "maxRespostasSeguidas" INTEGER NOT NULL DEFAULT 3,
    "atualizadoPorUserId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

CONSTRAINT "RagnabotCapitaoConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotCapitaoDocumento" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "chaveDocumento" TEXT NOT NULL,
    "conteudoHash" TEXT,
    "tamanhoBytes" INTEGER,
    "externoId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "erro" TEXT,
    "sincronizadoEm" TIMESTAMP(3),
    "criadoPorUserId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

CONSTRAINT "RagnabotCapitaoDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotCapitaoInteracao" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cwAccountId" INTEGER,
    "cwConversationId" INTEGER,
    "entradaId" TEXT,
    "execucaoId" TEXT,
    "noId" TEXT,
    "resultado" TEXT NOT NULL DEFAULT 'reservado',
    "perguntaHash" TEXT,
    "respostaChars" INTEGER,
    "documentosUsados" INTEGER NOT NULL DEFAULT 0,
    "confianca" DOUBLE PRECISION,
    "tokensEntrada" INTEGER,
    "tokensSaida" INTEGER,
    "custoCentavos" INTEGER NOT NULL DEFAULT 0,
    "latenciaMs" INTEGER,
    "modelo" TEXT,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

CONSTRAINT "RagnabotCapitaoInteracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotCapitaoConsumoMes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "respostas" INTEGER NOT NULL DEFAULT 0,
    "naoSabe" INTEGER NOT NULL DEFAULT 0,
    "recusadas" INTEGER NOT NULL DEFAULT 0,
    "tokensEntrada" INTEGER NOT NULL DEFAULT 0,
    "tokensSaida" INTEGER NOT NULL DEFAULT 0,
    "custoCentavos" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

CONSTRAINT "RagnabotCapitaoConsumoMes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotCapitaoConfig_tenantId_key" ON "RagnabotCapitaoConfig"("tenantId");

-- CreateIndex
CREATE INDEX "RagnabotCapitaoConfig_ativo_idx" ON "RagnabotCapitaoConfig"("ativo");

-- CreateIndex
CREATE INDEX "RagnabotCapitaoDocumento_tenantId_status_idx" ON "RagnabotCapitaoDocumento"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotCapitaoDocumento_tenantId_chaveDocumento_key" ON "RagnabotCapitaoDocumento"("tenantId", "chaveDocumento");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotCapitaoInteracao_chave_key" ON "RagnabotCapitaoInteracao"("chave");

-- CreateIndex
CREATE INDEX "RagnabotCapitaoInteracao_tenantId_criadoEm_idx" ON "RagnabotCapitaoInteracao"("tenantId", "criadoEm");

-- CreateIndex
CREATE INDEX "RagnabotCapitaoInteracao_cwAccountId_cwConversationId_idx" ON "RagnabotCapitaoInteracao"("cwAccountId", "cwConversationId");

-- CreateIndex
CREATE INDEX "RagnabotCapitaoInteracao_resultado_criadoEm_idx" ON "RagnabotCapitaoInteracao"("resultado", "criadoEm");

-- CreateIndex
CREATE INDEX "RagnabotCapitaoConsumoMes_competencia_idx" ON "RagnabotCapitaoConsumoMes"("competencia");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotCapitaoConsumoMes_tenantId_competencia_key" ON "RagnabotCapitaoConsumoMes"("tenantId", "competencia");
