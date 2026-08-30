-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- PROTOCOLO — o numero de atendimento e o contador por empresa/ano que o gera.
--
-- Gerado por `prisma migrate diff --from-empty --to-schema-datamodel` a partir de
-- `prisma/schema.prisma` (Etapa 1 do doc 33) e conferido: ZERO comando DROP.
-- Estas tabelas nasceram no NOC sem SQL versionado; aqui elas passam a ter, porque a base
-- `ragnabot` sera criada do zero por estes arquivos — nunca por `prisma db push` (LEI 2).
--
-- Idempotencia: NAO ha `IF NOT EXISTS`. Rodar duas vezes falha, de proposito — aplicar em base
-- nova, e conferir o resultado, e mais seguro que um script que "passa" sem dizer o que fez.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "RagnabotContadorProtocolo" (
    "tenantId" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "ultimo" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotContadorProtocolo_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "RagnabotProtocolo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "protocolo" TEXT NOT NULL,
    "cwConversationId" INTEGER NOT NULL,
    "cwAccountId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotProtocolo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotContadorProtocolo_prefixo_key" ON "RagnabotContadorProtocolo"("prefixo");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotProtocolo_protocolo_key" ON "RagnabotProtocolo"("protocolo");

-- CreateIndex
CREATE INDEX "RagnabotProtocolo_tenantId_criadoEm_idx" ON "RagnabotProtocolo"("tenantId", "criadoEm");

-- CreateIndex
CREATE INDEX "RagnabotProtocolo_protocolo_idx" ON "RagnabotProtocolo"("protocolo");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotProtocolo_tenantId_numero_key" ON "RagnabotProtocolo"("tenantId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotProtocolo_cwAccountId_cwConversationId_key" ON "RagnabotProtocolo"("cwAccountId", "cwConversationId");
